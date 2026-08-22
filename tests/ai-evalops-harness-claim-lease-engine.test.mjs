import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import test from "node:test"

const migrations = path.resolve("migrations/ai-evalops-harness")
const engine = readFileSync(path.resolve("lib/execution-control/claim-lease-engine.ts"), "utf8")
const sql = readFileSync(path.join(migrations, "0003_claim_lease_engine.sql"), "utf8")

test("typed client exposes only bounded claim renew and release operations", () => {
  for (const operation of ["claimJob", "renewLease", "releaseLease", "expireLease", "validateCurrentFence", "reconcileExpiry", "pullEligibleJob"]) assert.match(engine, new RegExp(`function ${operation}`))
  for (const code of ["CLAIM_NOT_ELIGIBLE", "CLAIM_WORKER_IDENTITY_INVALID", "CLAIM_TTL_INVALID", "LEASE_STALE_OR_FORGED", "LEASE_WRONG_HOLDER", "LEASE_WRONG_BOOT", "LEASE_ALREADY_RELEASED"]) assert.match(engine, new RegExp(code))
  assert.doesNotMatch(engine, /shell|commandText|issue.?357/i)
  assert.match(engine, /fencingToken: bigint/)
  assert.match(engine, /code !== "40001" && code !== "40P01"/)
})

test("SQL claim is row-locked, atomic, database-timed, and projection-bound", () => {
  assert.match(sql, /FROM ai_evalops\.jobs WHERE job_id=p_job_id FOR UPDATE/)
  assert.match(sql, /INSERT INTO ai_evalops\.attempts/)
  assert.match(sql, /INSERT INTO ai_evalops\.leases/)
  assert.match(sql, /UPDATE ai_evalops\.job_projection SET state='CLAIMED'/)
  assert.match(sql, /clock_timestamp\(\)\+p_ttl/)
  assert.doesNotMatch(sql, /now\(\)\s*\+/i)
  assert.match(sql, /lease_operation_receipts/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_operation_id::text,0\)\)/)
  assert.match(sql, /request_digest<>v_request_digest/)
  assert.doesNotMatch(sql, /p_request_digest/)
  assert.match(sql, /version=v_projection\.version AND state='ADMITTED'/)
  assert.match(sql, /FOR UPDATE OF j SKIP LOCKED LIMIT 1/)
  assert.match(sql, /CREATE FUNCTION ai_evalops\.validate_current_fence/)
  assert.match(sql, /operation_kind<>'PULL'/)
  assert.match(sql, /operation_kind<>'RECONCILE'/)
  assert.match(sql, /f\.next_fencing_token=p_fence\+1/)
  assert.match(engine, /pullEligibleJob/)
  assert.match(engine, /maxAttempts > 3/)
})

test("cached PostgreSQL permits exactly one claimant and rejects stale identities", { timeout: 60_000 }, async (context) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:16"]).status !== 0) return context.skip("cached postgres:16 unavailable")
  const name = `aeh016-${process.pid}-${Date.now()}`
  const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input })
  assert.equal(docker(["run", "-d", "--name", name, "-e", "POSTGRES_PASSWORD=fixture-only", "postgres:16"]).status, 0)
  try {
    let ready = false
    for (let index = 0; index < 40; index += 1) {
      if (docker(["exec", name, "pg_isready", "-U", "postgres"]).status === 0) { ready = true; break }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
    assert.equal(ready, true)
    const allSql = ["0000_expand_migration_control.sql", "0001_contract_migration_control.sql", "0002_durable_control_schema.sql", "0003_claim_lease_engine.sql"].map((file) => readFileSync(path.join(migrations, file), "utf8")).join("\n")
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], allSql).status, 0)
    const digest = (character) => `sha256:${character.repeat(64)}`
    const seed = `
INSERT INTO ai_evalops.effect_domain_fences VALUES ('hermes:model',1);
INSERT INTO ai_evalops.workers(worker_id,node_id,instance_id,boot_id,capability_digest) VALUES
('10000000-0000-4000-8000-000000000001','hermes','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','${digest("a")}'),
('10000000-0000-4000-8000-000000000011','hermes','10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000013','${digest("b")}');
INSERT INTO ai_evalops.authority_status(authority_digest,status,valid_until) VALUES ('${digest("c")}','ACTIVE',clock_timestamp()+interval '1 hour');
INSERT INTO ai_evalops.worker_capability_status(worker_id,instance_id,boot_id,capability_digest,status,observed_at,valid_until) VALUES
('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','${digest("a")}','FRESH',clock_timestamp(),clock_timestamp()+interval '1 hour'),
('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000013','${digest("b")}','FRESH',clock_timestamp(),clock_timestamp()+interval '1 hour');
INSERT INTO ai_evalops.jobs(job_id,work_order_id,effect_domain,operation_class,idempotency_key,input_digest,authority_digest,policy_digest,base_digest,requested_output_digest,admission_expires_at) VALUES
('20000000-0000-4000-8000-000000000001','WO-AEH-016','hermes:model','MODEL_EVAL','claim-contention','${digest("b")}','${digest("c")}','${digest("d")}','${digest("e")}','${digest("f")}',clock_timestamp()+interval '1 hour');
INSERT INTO ai_evalops.job_projection(job_id,state) VALUES ('20000000-0000-4000-8000-000000000001','ADMITTED');`
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], seed).status, 0)
    const claim = (worker, instance, boot, claimId, leaseId, operationId) => concurrentDocker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000001','${worker}','${instance}','${boot}','${claimId}','${leaseId}','${operationId}',interval '30 seconds');`])
    const results = await Promise.all([
      claim("10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003", "30000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000001", "80000000-0000-4000-8000-000000000001"),
      claim("10000000-0000-4000-8000-000000000011", "10000000-0000-4000-8000-000000000012", "10000000-0000-4000-8000-000000000013", "30000000-0000-4000-8000-000000000002", "40000000-0000-4000-8000-000000000002", "80000000-0000-4000-8000-000000000002"),
    ])
    assert.equal(results.filter((result) => result.code === 0).length, 1)
    assert.match(results.find((result) => result.code !== 0).stderr, /CLAIM_NOT_ELIGIBLE/)
    const counts = docker(["exec", name, "psql", "-At", "-U", "postgres", "-c", "SELECT (SELECT count(*) FROM ai_evalops.attempts),(SELECT count(*) FROM ai_evalops.leases),(SELECT next_fencing_token FROM ai_evalops.effect_domain_fences WHERE effect_domain='hermes:model'),(SELECT count(*) FROM ai_evalops.events WHERE event_type='CLAIMED');"])
    assert.equal(counts.stdout.trim(), "1|1|2|1")
    const winner = results.find((result) => result.code === 0).stdout.trim().split("|")
    const [attemptId, leaseId, fence] = winner
    const firstWon = leaseId.endsWith("0001")
    const holder = firstWon
      ? ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"]
      : ["10000000-0000-4000-8000-000000000011", "10000000-0000-4000-8000-000000000012", "10000000-0000-4000-8000-000000000013"]
    const other = firstWon
      ? ["10000000-0000-4000-8000-000000000011", "10000000-0000-4000-8000-000000000012", "10000000-0000-4000-8000-000000000013"]
      : ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"]
    const winningClaim = firstWon ? "30000000-0000-4000-8000-000000000001" : "30000000-0000-4000-8000-000000000002"
    const winningOperation = firstWon ? "80000000-0000-4000-8000-000000000001" : "80000000-0000-4000-8000-000000000002"
    const reject = (query, code) => { const result = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", query]); assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(code)) }
    const replayClaim = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000001','${holder[0]}','${holder[1]}','${holder[2]}','${winningClaim}','${leaseId}','${winningOperation}',interval '30 seconds');`])
    assert.equal(replayClaim.stdout.trim(), results.find((result) => result.code === 0).stdout.trim())
    reject(`SELECT * FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000001','${holder[0]}','${holder[1]}','${holder[2]}','${winningClaim}','${leaseId}','${winningOperation}',interval '31 seconds');`, "OPERATION_IDEMPOTENCY_CONFLICT")
    const concurrentClaimReplayConflict = await Promise.all([
      concurrentDocker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000001','${holder[0]}','${holder[1]}','${holder[2]}','${winningClaim}','${leaseId}','${winningOperation}',interval '30 seconds');`]),
      concurrentDocker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000001','${holder[0]}','${holder[1]}','${holder[2]}','${winningClaim}','${leaseId}','${winningOperation}',interval '31 seconds');`]),
    ])
    assert.equal(concurrentClaimReplayConflict.filter((result) => result.code === 0).length, 1)
    assert.match(concurrentClaimReplayConflict.find((result) => result.code !== 0).stderr, /OPERATION_IDEMPOTENCY_CONFLICT/)
    const domainFixtures = `
INSERT INTO ai_evalops.effect_domain_fences VALUES ('aegis:hash',9007199254740993);
INSERT INTO ai_evalops.jobs(job_id,work_order_id,effect_domain,operation_class,idempotency_key,input_digest,authority_digest,policy_digest,base_digest,requested_output_digest,admission_expires_at) VALUES
('20000000-0000-4000-8000-000000000002','WO-AEH-016','hermes:model','MODEL_EVAL','same-domain','${digest("b")}','${digest("c")}','${digest("d")}','${digest("e")}','${digest("f")}',clock_timestamp()+interval '1 hour'),
('20000000-0000-4000-8000-000000000003','WO-AEH-016','aegis:hash','HASH_VERIFY','different-domain','${digest("b")}','${digest("c")}','${digest("d")}','${digest("e")}','${digest("f")}',clock_timestamp()+interval '1 hour');
INSERT INTO ai_evalops.job_projection(job_id,state) VALUES ('20000000-0000-4000-8000-000000000002','ADMITTED'),('20000000-0000-4000-8000-000000000003','ADMITTED');`
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], domainFixtures).status, 0)
    reject(`SELECT * FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000002','${holder[0]}','${holder[1]}','${holder[2]}','30000000-0000-4000-8000-000000000021','40000000-0000-4000-8000-000000000021','80000000-0000-4000-8000-000000000021',interval '30 seconds');`, "CLAIM_NOT_ELIGIBLE")
    const largeFence = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT fencing_token FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000003','${other[0]}','${other[1]}','${other[2]}','30000000-0000-4000-8000-000000000031','40000000-0000-4000-8000-000000000031','80000000-0000-4000-8000-000000000031',interval '30 seconds');`])
    assert.equal(largeFence.stdout.trim(), "9007199254740993")
    const pullOperation = "85000000-0000-4000-8000-000000000061"
    const pullFixtures = `INSERT INTO ai_evalops.effect_domain_fences VALUES ('pull:test',1); INSERT INTO ai_evalops.jobs(job_id,work_order_id,effect_domain,operation_class,idempotency_key,input_digest,authority_digest,policy_digest,base_digest,requested_output_digest,admission_expires_at) VALUES ('20000000-0000-4000-8000-000000000006','WO-AEH-016','pull:test','HASH_VERIFY','pull','${digest("b")}','${digest("c")}','${digest("d")}','${digest("e")}','${digest("f")}',clock_timestamp()+interval '1 hour'); INSERT INTO ai_evalops.job_projection(job_id,state) VALUES ('20000000-0000-4000-8000-000000000006','ADMITTED');`
    assert.equal(docker(["exec", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", pullFixtures]).status, 0)
    const lossClient = spawn("docker", ["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.pull_next_job('${other[0]}','${other[1]}','${other[2]}','30000000-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000061','${pullOperation}',interval '30 seconds');`, "-c", "SELECT pg_sleep(20);"])
    let lossStderr = ""
    lossClient.stderr.on("data", (chunk) => { lossStderr += chunk })
    let pullCommitted = false
    for (let index = 0; index < 40; index += 1) {
      const seen = docker(["exec", name, "psql", "-At", "-U", "postgres", "-c", `SELECT count(*) FROM ai_evalops.lease_operation_receipts WHERE operation_id='${pullOperation}' AND operation_kind='PULL';`])
      if (seen.stdout.trim() === "1") { pullCommitted = true; break }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
    assert.equal(pullCommitted, true, lossStderr)
    lossClient.kill()
    const pullReplay = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT fencing_token FROM ai_evalops.pull_next_job('${other[0]}','${other[1]}','${other[2]}','30000000-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000061','${pullOperation}',interval '30 seconds');`])
    assert.equal(pullReplay.stdout.trim(), "1")
    reject(`SELECT * FROM ai_evalops.pull_next_job('${other[0]}','${other[1]}','${other[2]}','30000000-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000061','${pullOperation}',interval '31 seconds');`, "OPERATION_IDEMPOTENCY_CONFLICT")
    const currentFence = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT ai_evalops.validate_current_fence('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},'${digest("c")}','${firstWon ? digest("a") : digest("b")}');`])
    assert.equal(currentFence.stdout.trim(), "t")
    reject(`SELECT ai_evalops.validate_current_fence('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},'${digest("9")}','${firstWon ? digest("a") : digest("b")}');`, "FENCE_NOT_CURRENT")
    reject(`SELECT ai_evalops.validate_current_fence('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},'${digest("c")}','${digest("9")}');`, "FENCE_NOT_CURRENT")
    assert.equal(docker(["exec", name, "psql", "-U", "postgres", "-c", `UPDATE ai_evalops.authority_status SET status='REVOKED',revoked_at=clock_timestamp() WHERE authority_digest='${digest("c")}';`]).status, 0)
    reject(`SELECT ai_evalops.validate_current_fence('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},'${digest("c")}','${firstWon ? digest("a") : digest("b")}');`, "FENCE_NOT_CURRENT")
    assert.equal(docker(["exec", name, "psql", "-U", "postgres", "-c", `UPDATE ai_evalops.authority_status SET status='ACTIVE',revoked_at=NULL,valid_until=clock_timestamp()+interval '1 hour' WHERE authority_digest='${digest("c")}'; UPDATE ai_evalops.worker_capability_status SET status='STALE' WHERE worker_id='${holder[0]}';`]).status, 0)
    reject(`SELECT ai_evalops.validate_current_fence('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},'${digest("c")}','${firstWon ? digest("a") : digest("b")}');`, "FENCE_NOT_CURRENT")
    assert.equal(docker(["exec", name, "psql", "-U", "postgres", "-c", `UPDATE ai_evalops.worker_capability_status SET status='FRESH',valid_until=clock_timestamp()+interval '1 hour' WHERE worker_id='${holder[0]}';`]).status, 0)
    reject(`SELECT * FROM ai_evalops.renew_lease('${leaseId}','${attemptId}','${other[0]}','${other[1]}','${holder[2]}',${fence},0,'81000000-0000-4000-8000-000000000001',interval '30 seconds');`, "LEASE_WRONG_HOLDER")
    reject(`SELECT * FROM ai_evalops.renew_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','10000000-0000-4000-8000-000000000099',${fence},0,'81000000-0000-4000-8000-000000000002',interval '30 seconds');`, "LEASE_WRONG_BOOT")
    reject(`SELECT * FROM ai_evalops.renew_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',999,0,'81000000-0000-4000-8000-000000000003',interval '30 seconds');`, "LEASE_STALE_OR_FORGED")
    const renew = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT renewal_sequence,(expires_at>clock_timestamp()) FROM ai_evalops.renew_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},0,'81000000-0000-4000-8000-000000000004',interval '30 seconds');`])
    assert.equal(renew.stdout.trim(), "1|t")
    const replayRenew = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT renewal_sequence,(expires_at>clock_timestamp()) FROM ai_evalops.renew_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},0,'81000000-0000-4000-8000-000000000004',interval '30 seconds');`])
    assert.equal(replayRenew.stdout.trim(), renew.stdout.trim())
    reject(`SELECT * FROM ai_evalops.renew_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},0,'81000000-0000-4000-8000-000000000004',interval '31 seconds');`, "OPERATION_IDEMPOTENCY_CONFLICT")
    const concurrentRenewReplayConflict = await Promise.all([
      concurrentDocker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.renew_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},0,'81000000-0000-4000-8000-000000000004',interval '30 seconds');`]),
      concurrentDocker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.renew_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},0,'81000000-0000-4000-8000-000000000004',interval '31 seconds');`]),
    ])
    assert.equal(concurrentRenewReplayConflict.filter((result) => result.code === 0).length, 1)
    assert.match(concurrentRenewReplayConflict.find((result) => result.code !== 0).stderr, /OPERATION_IDEMPOTENCY_CONFLICT/)
    const race = await Promise.all([
      concurrentDocker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.renew_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},1,'81000000-0000-4000-8000-000000000005',interval '30 seconds');`]),
      concurrentDocker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.release_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},1,'82000000-0000-4000-8000-000000000001','COMPLETE');`]),
    ])
    assert.equal(race.filter((result) => result.code === 0).length, 1)
    const state = docker(["exec", name, "psql", "-At", "-U", "postgres", "-c", `SELECT renewal_sequence,released_at IS NOT NULL FROM ai_evalops.leases WHERE lease_id='${leaseId}';`]).stdout.trim()
    if (state === "2|f") assert.equal(docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.release_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},2,'82000000-0000-4000-8000-000000000002','COMPLETE');`]).status, 0)
    const releaseReplay = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.release_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},${state === "2|f" ? 2 : 1},'${state === "2|f" ? "82000000-0000-4000-8000-000000000002" : "82000000-0000-4000-8000-000000000001"}','COMPLETE');`])
    assert.equal(releaseReplay.status, 0)
    reject(`SELECT * FROM ai_evalops.release_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},${state === "2|f" ? 2 : 1},'${state === "2|f" ? "82000000-0000-4000-8000-000000000002" : "82000000-0000-4000-8000-000000000001"}','DIFFERENT');`, "OPERATION_IDEMPOTENCY_CONFLICT")
    const releaseOperation = state === "2|f" ? "82000000-0000-4000-8000-000000000002" : "82000000-0000-4000-8000-000000000001"
    const releaseSequence = state === "2|f" ? 2 : 1
    const concurrentReleaseReplayConflict = await Promise.all([
      concurrentDocker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.release_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},${releaseSequence},'${releaseOperation}','COMPLETE');`]),
      concurrentDocker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.release_lease('${leaseId}','${attemptId}','${holder[0]}','${holder[1]}','${holder[2]}',${fence},${releaseSequence},'${releaseOperation}','DIFFERENT');`]),
    ])
    assert.equal(concurrentReleaseReplayConflict.filter((result) => result.code === 0).length, 1)
    assert.match(concurrentReleaseReplayConflict.find((result) => result.code !== 0).stderr, /OPERATION_IDEMPOTENCY_CONFLICT/)

    const crashFixtures = `
INSERT INTO ai_evalops.effect_domain_fences VALUES ('crash:test',1),('expiry:test',1);
INSERT INTO ai_evalops.jobs(job_id,work_order_id,effect_domain,operation_class,idempotency_key,input_digest,authority_digest,policy_digest,base_digest,requested_output_digest,admission_expires_at) VALUES
('20000000-0000-4000-8000-000000000004','WO-AEH-016','crash:test','HASH_VERIFY','crash','${digest("b")}','${digest("c")}','${digest("d")}','${digest("e")}','${digest("f")}',clock_timestamp()+interval '1 hour'),
('20000000-0000-4000-8000-000000000005','WO-AEH-016','expiry:test','HASH_VERIFY','expiry','${digest("b")}','${digest("c")}','${digest("d")}','${digest("e")}','${digest("f")}',clock_timestamp()+interval '1 hour');
INSERT INTO ai_evalops.job_projection(job_id,state) VALUES ('20000000-0000-4000-8000-000000000004','ADMITTED'),('20000000-0000-4000-8000-000000000005','ADMITTED');`
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], crashFixtures).status, 0)
    const rolledBack = `BEGIN; SELECT * FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000004','${holder[0]}','${holder[1]}','${holder[2]}','30000000-0000-4000-8000-000000000041','40000000-0000-4000-8000-000000000041','80000000-0000-4000-8000-000000000041',interval '30 seconds'); ROLLBACK;`
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], rolledBack).status, 0)
    assert.equal(docker(["exec", name, "psql", "-At", "-U", "postgres", "-c", "SELECT count(*) FROM ai_evalops.attempts WHERE job_id='20000000-0000-4000-8000-000000000004';"]).stdout.trim(), "0")
    const expiredAttempt = "30000000-0000-4000-8000-000000000051", expiredLease = "40000000-0000-4000-8000-000000000051"
    const deterministicExpiry = `INSERT INTO ai_evalops.attempts(attempt_id,job_id,effect_domain,ordinal,worker_id,worker_instance_id,boot_id,claim_id,input_digest) VALUES ('${expiredAttempt}','20000000-0000-4000-8000-000000000005','expiry:test',1,'${holder[0]}','${holder[1]}','${holder[2]}','30000000-0000-4000-8000-000000000059','${digest("b")}'); INSERT INTO ai_evalops.leases(lease_id,attempt_id,effect_domain,holder_worker_id,holder_instance_id,boot_id,fencing_token,acquired_at,expires_at) VALUES ('${expiredLease}','${expiredAttempt}','expiry:test','${holder[0]}','${holder[1]}','${holder[2]}',1,clock_timestamp()-interval '10 seconds',clock_timestamp()-interval '5 seconds'); UPDATE ai_evalops.job_projection SET state='CLAIMED',current_attempt_id='${expiredAttempt}',version=version+1 WHERE job_id='20000000-0000-4000-8000-000000000005';`
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], deterministicExpiry).status, 0)
    reject(`SELECT * FROM ai_evalops.release_lease('${expiredLease}','${expiredAttempt}','${holder[0]}','${holder[1]}','${holder[2]}',1,0,'82000000-0000-4000-8000-000000000051','COMPLETE');`, "LEASE_EXPIRED")
    reject(`INSERT INTO ai_evalops.outbox(outbox_id,job_id,attempt_id,effect_domain,idempotency_key,fencing_token,payload_digest) VALUES ('50000000-0000-4000-8000-000000000051','20000000-0000-4000-8000-000000000005','${expiredAttempt}','expiry:test','expired',1,'${digest("a")}');`, "outbox requires current allocated lease")
    const expired = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT * FROM ai_evalops.expire_lease('${expiredLease}','83000000-0000-4000-8000-000000000051');`])
    assert.equal(expired.status, 0, expired.stderr)
    assert.equal(docker(["exec", name, "psql", "-At", "-U", "postgres", "-c", "SELECT state FROM ai_evalops.job_projection WHERE job_id='20000000-0000-4000-8000-000000000005';"]).stdout.trim(), "RECONCILING")
    reject(`SELECT * FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000005','${holder[0]}','${holder[1]}','${holder[2]}','30000000-0000-4000-8000-000000000052','40000000-0000-4000-8000-000000000052','80000000-0000-4000-8000-000000000052',interval '30 seconds');`, "CLAIM_NOT_ELIGIBLE")
    const observationId = "60000000-0000-4000-8000-000000000051"
    assert.equal(docker(["exec", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `INSERT INTO ai_evalops.evidence_references(evidence_id,evidence_type,content_digest,durable_uri,media_type,size_bytes) VALUES ('${observationId}','RECOVERY_OBSERVATION','${digest("7")}','fixture://reconciliation/51','application/json',1);`]).status, 0)
    const ambiguousReconcile = `SELECT ai_evalops.reconcile_expiry('20000000-0000-4000-8000-000000000005','${expiredAttempt}','84000000-0000-4000-8000-000000000051','adapter:fixture','${digest("c")}','${observationId}','${digest("7")}','AMBIGUOUS',2);`
    assert.equal(docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", ambiguousReconcile]).stdout.trim(), "AMBIGUOUS_RECONCILIATION_REQUIRED")
    assert.equal(docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", ambiguousReconcile]).stdout.trim(), "AMBIGUOUS_RECONCILIATION_REQUIRED")
    reject(ambiguousReconcile.replace("'AMBIGUOUS'", "'EXECUTED'"), "OPERATION_IDEMPOTENCY_CONFLICT")
    assert.equal(docker(["exec", name, "psql", "-At", "-U", "postgres", "-c", `SELECT state FROM ai_evalops.job_projection WHERE job_id='20000000-0000-4000-8000-000000000005';`]).stdout.trim(), "RECONCILING")
    assert.equal(docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT ai_evalops.reconcile_expiry('20000000-0000-4000-8000-000000000005','${expiredAttempt}','84000000-0000-4000-8000-000000000052','adapter:fixture','${digest("c")}','${observationId}','${digest("7")}','NOT_EXECUTED',2);`]).stdout.trim(), "RETRY_SAFE")
    assert.equal(docker(["exec", name, "psql", "-At", "-U", "postgres", "-c", `SELECT count(*) FROM ai_evalops.events WHERE job_id='20000000-0000-4000-8000-000000000005' AND event_type='EXPIRY_RECONCILED';`]).stdout.trim(), "2")
    const reclaimed = docker(["exec", name, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", `SELECT fencing_token FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000005','${holder[0]}','${holder[1]}','${holder[2]}','30000000-0000-4000-8000-000000000052','40000000-0000-4000-8000-000000000052','80000000-0000-4000-8000-000000000052',interval '30 seconds');`])
    assert.equal(reclaimed.stdout.trim(), "2")
  } finally {
    const removed = docker(["rm", "-f", name])
    assert.equal(removed.status, 0, removed.stderr)
    const residue = docker(["ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"])
    assert.equal(residue.status, 0, residue.stderr)
    assert.equal(residue.stdout.trim(), "")
  }
})

function concurrentDocker(args) {
  return new Promise((resolve) => {
    const child = spawn("docker", args)
    let stdout = "", stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}
