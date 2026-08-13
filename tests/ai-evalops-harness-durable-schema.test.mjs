import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

import { validateMigrationDirectory } from "../scripts/ai-evalops-harness/schema-drift-check.mjs"

const migrationDirectory = path.resolve("migrations/ai-evalops-harness")
const sql = await readFile(path.join(migrationDirectory, "0002_durable_control_schema.sql"), "utf8")
const rollback = await readFile(path.join(migrationDirectory, "0002_durable_control_schema.rollback.sql"), "utf8")
const typeContract = await readFile(path.resolve("lib/execution-control/schema.ts"), "utf8")

test("migration remains manifest-complete and disposable-static", async () => {
  const result = await validateMigrationDirectory(migrationDirectory, {})
  assert.equal(result.status, "PASS")
  assert.ok(result.checked.some(({ id, phase }) => id === "0002_durable_control_schema" && phase === "expand"))
})

test("immutable intent is physically separated from mutable projection", () => {
  const jobs = sql.match(/CREATE TABLE ai_evalops\.jobs \(([\s\S]*?)\n\);/)?.[1] ?? ""
  const projection = sql.match(/CREATE TABLE ai_evalops\.job_projection \(([\s\S]*?)\n\);/)?.[1] ?? ""
  for (const mutable of ["state", "current_attempt_id", "terminal_classification", "version"]) assert.doesNotMatch(jobs, new RegExp(`\\b${mutable}\\b`))
  for (const mutable of ["state", "current_attempt_id", "terminal_classification", "version"]) assert.match(projection, new RegExp(`\\b${mutable}\\b`))
  assert.match(sql, /CREATE TRIGGER jobs_immutable BEFORE UPDATE OR DELETE/)
})

test("attempts and ledgers are append-only and evidence is off-worker by reference", () => {
  for (const table of ["attempts", "events", "evidence_references"]) assert.match(sql, new RegExp(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE`))
  assert.match(sql, /durable_uri text NOT NULL/)
  assert.match(sql, /content_digest text NOT NULL CHECK \(content_digest ~ '\^sha256:/)
  assert.doesNotMatch(sql, /evidence_(?:bytes|payload) bytea/i)
})

test("idempotency is unique in the effect domain for jobs and outbox", () => {
  assert.equal((sql.match(/UNIQUE \(effect_domain, idempotency_key\)/g) ?? []).length, 2)
  assert.match(sql, /FOREIGN KEY \(job_id, effect_domain, idempotency_key\)[\s\S]*REFERENCES ai_evalops\.jobs/)
})

test("lease constraints require positive monotonic fences and one active domain holder", () => {
  assert.match(sql, /next_fencing_token bigint NOT NULL DEFAULT 1 CHECK \(next_fencing_token > 0\)/)
  assert.match(sql, /fencing_token bigint NOT NULL CHECK \(fencing_token > 0\)/)
  assert.match(sql, /UNIQUE \(effect_domain, fencing_token\)/)
  assert.match(sql, /CREATE UNIQUE INDEX leases_one_active_per_effect_domain[\s\S]*WHERE released_at IS NULL/)
  assert.match(sql, /renewal_sequence bigint NOT NULL DEFAULT 0 CHECK \(renewal_sequence >= 0\)/)
  assert.match(sql, /CREATE TRIGGER leases_monotonic_fence BEFORE INSERT/)
  assert.match(sql, /next_fencing_token = NEW\.fencing_token/)
  assert.match(sql, /CREATE TRIGGER leases_transition BEFORE UPDATE/)
  assert.match(sql, /released lease cannot be renewed or reopened/)
  assert.match(sql, /renewal_sequence <> OLD\.renewal_sequence \+ 1/)
})

test("composite keys bind projection, leases, and outbox to the same durable identities", () => {
  assert.match(sql, /job_projection_attempt_fk FOREIGN KEY \(job_id, current_attempt_id\)/)
  assert.match(sql, /FOREIGN KEY \(attempt_id, effect_domain\)[\s\S]*REFERENCES ai_evalops\.attempts/)
  assert.match(sql, /FOREIGN KEY \(attempt_id, effect_domain, fencing_token\)[\s\S]*REFERENCES ai_evalops\.leases/)
  assert.equal((sql.match(/FOREIGN KEY \(job_id, attempt_id\)[\s\S]*?REFERENCES ai_evalops\.attempts\(job_id, attempt_id\)/g) ?? []).length, 2)
  assert.match(sql, /CREATE TRIGGER outbox_current_lease BEFORE INSERT/)
  assert.match(sql, /fencing_token = NEW\.fencing_token AND released_at IS NULL/)
})

test("terminal projection requires one typed classification and receipt reference", () => {
  assert.match(sql, /'NOT_EXECUTED','EXECUTED','AMBIGUOUS','EXPIRED','FENCED'/)
  assert.match(sql, /\(state = 'TERMINAL'\) = \(terminal_classification IS NOT NULL\)/)
  assert.match(sql, /\(terminal_classification IS NULL\) = \(terminal_receipt_evidence_id IS NULL\)/)
  assert.match(sql, /events_prior_digest_fk FOREIGN KEY \(prior_event_digest\)/)
  assert.match(sql, /CREATE TRIGGER events_contiguous_chain BEFORE INSERT/)
  assert.match(sql, /sequence = NEW\.sequence - 1/)
  assert.match(sql, /evidence_type = 'TERMINAL_RECEIPT'/)
})

test("cached PostgreSQL enforces relational negative fixtures", { timeout: 60_000 }, (context) => {
  const image = spawnSync("docker", ["image", "inspect", "postgres:16"], { encoding: "utf8" })
  if (image.status !== 0) return context.skip("cached postgres:16 image unavailable")
  const name = `aeh015-${process.pid}-${Date.now()}`
  const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input })
  const run = docker(["run", "-d", "--name", name, "-e", "POSTGRES_PASSWORD=fixture-only", "postgres:16"])
  assert.equal(run.status, 0, run.stderr)
  try {
    let ready = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (docker(["exec", name, "pg_isready", "-U", "postgres"]).status === 0) { ready = true; break }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
    assert.equal(ready, true, "disposable PostgreSQL did not become ready")
    const base = ["0000_expand_migration_control.sql", "0001_contract_migration_control.sql", "0002_durable_control_schema.sql"]
      .map((file) => requireText(path.join(migrationDirectory, file))).join("\n")
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], base).status, 0)
    const seed = `
INSERT INTO ai_evalops.effect_domain_fences VALUES ('hermes:model', 1);
INSERT INTO ai_evalops.workers(worker_id,node_id,instance_id,boot_id,capability_digest) VALUES
('10000000-0000-4000-8000-000000000001','hermes','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','sha256:${"a".repeat(64)}');
INSERT INTO ai_evalops.jobs(job_id,work_order_id,effect_domain,operation_class,idempotency_key,input_digest,authority_digest,policy_digest,base_digest,requested_output_digest,admission_expires_at) VALUES
('20000000-0000-4000-8000-000000000001','WO-AEH-015','hermes:model','MODEL_EVAL','one','sha256:${"b".repeat(64)}','sha256:${"c".repeat(64)}','sha256:${"d".repeat(64)}','sha256:${"e".repeat(64)}','sha256:${"f".repeat(64)}',clock_timestamp()+interval '1 hour'),
('20000000-0000-4000-8000-000000000002','WO-AEH-015','hermes:model','MODEL_EVAL','two','sha256:${"b".repeat(64)}','sha256:${"c".repeat(64)}','sha256:${"d".repeat(64)}','sha256:${"e".repeat(64)}','sha256:${"f".repeat(64)}',clock_timestamp()+interval '1 hour');
INSERT INTO ai_evalops.attempts(attempt_id,job_id,effect_domain,ordinal,worker_id,worker_instance_id,boot_id,claim_id,input_digest) VALUES
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','hermes:model',1,'10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000011','sha256:${"b".repeat(64)}'),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','hermes:model',1,'10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000012','sha256:${"b".repeat(64)}');
INSERT INTO ai_evalops.leases(lease_id,attempt_id,effect_domain,holder_worker_id,holder_instance_id,boot_id,fencing_token,expires_at) VALUES
('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','hermes:model','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',1,clock_timestamp()+interval '5 minutes');`
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], seed).status, 0)
    const reject = (statement) => assert.notEqual(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], statement).status, 0)
    reject("INSERT INTO ai_evalops.job_projection(job_id,state,current_attempt_id) VALUES ('20000000-0000-4000-8000-000000000001','CLAIMED','30000000-0000-4000-8000-000000000002');")
    reject("UPDATE ai_evalops.leases SET fencing_token=2, renewal_sequence=1, expires_at=expires_at+interval '1 minute' WHERE lease_id='40000000-0000-4000-8000-000000000001';")
    reject("UPDATE ai_evalops.leases SET expires_at=expires_at+interval '1 minute' WHERE lease_id='40000000-0000-4000-8000-000000000001';")
    reject(`INSERT INTO ai_evalops.outbox(outbox_id,job_id,attempt_id,effect_domain,idempotency_key,fencing_token,payload_digest) VALUES ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','hermes:model','bad-fence',2,'sha256:${"a".repeat(64)}');`)
    reject(`INSERT INTO ai_evalops.outbox(outbox_id,job_id,attempt_id,effect_domain,idempotency_key,fencing_token,payload_digest) VALUES ('50000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','hermes:model','cross-job',1,'sha256:${"a".repeat(64)}');`)
    reject(`INSERT INTO ai_evalops.events(event_id,job_id,attempt_id,sequence,event_type,actor_id,authority_digest,event_digest) VALUES ('60000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',1,'ADMITTED','fixture','sha256:${"a".repeat(64)}','sha256:${"f".repeat(64)}');`)
    reject(`INSERT INTO ai_evalops.events(event_id,job_id,sequence,event_type,actor_id,authority_digest,prior_event_digest,event_digest) VALUES ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1,'ADMITTED','fixture','sha256:${"a".repeat(64)}','sha256:${"b".repeat(64)}','sha256:${"c".repeat(64)}');`)
    const renewRelease = "UPDATE ai_evalops.leases SET renewal_sequence=1, expires_at=expires_at+interval '1 minute' WHERE lease_id='40000000-0000-4000-8000-000000000001'; UPDATE ai_evalops.leases SET released_at=clock_timestamp(), release_reason='COMPLETE' WHERE lease_id='40000000-0000-4000-8000-000000000001';"
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], renewRelease).status, 0)
    reject("UPDATE ai_evalops.leases SET renewal_sequence=2, expires_at=expires_at+interval '1 minute', released_at=NULL, release_reason=NULL WHERE lease_id='40000000-0000-4000-8000-000000000001';")
    reject(`INSERT INTO ai_evalops.outbox(outbox_id,job_id,attempt_id,effect_domain,idempotency_key,fencing_token,payload_digest) VALUES ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','hermes:model','released-lease',1,'sha256:${"a".repeat(64)}');`)
    const firstEvent = `INSERT INTO ai_evalops.events(event_id,job_id,sequence,event_type,actor_id,authority_digest,event_digest) VALUES ('60000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001',1,'ADMITTED','fixture','sha256:${"a".repeat(64)}','sha256:${"d".repeat(64)}');`
    assert.equal(docker(["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], firstEvent).status, 0)
    reject(`INSERT INTO ai_evalops.events(event_id,job_id,sequence,event_type,actor_id,authority_digest,prior_event_digest,event_digest) VALUES ('60000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000001',3,'RUNNING','fixture','sha256:${"a".repeat(64)}','sha256:${"d".repeat(64)}','sha256:${"e".repeat(64)}');`)
    const wrongEvidence = `INSERT INTO ai_evalops.evidence_references(evidence_id,evidence_type,content_digest,durable_uri,media_type,size_bytes) VALUES ('70000000-0000-4000-8000-000000000001','ATTEMPT_OUTPUT','sha256:${"a".repeat(64)}','fixture://evidence/one','application/json',1); INSERT INTO ai_evalops.job_projection(job_id,state,terminal_classification,terminal_receipt_evidence_id,terminal_receipt_evidence_type) VALUES ('20000000-0000-4000-8000-000000000001','TERMINAL','EXECUTED','70000000-0000-4000-8000-000000000001','TERMINAL_RECEIPT');`
    reject(wrongEvidence)
  } finally { docker(["rm", "-f", name]) }
})

function requireText(file) {
  return readFileSync(file, "utf8")
}

test("rollback is explicit, reverse ordered, and scoped to the new schema", () => {
  const names = ["outbox", "events", "evidence_references", "leases", "attempts", "workers", "job_projection", "jobs", "effect_domain_fences"]
  for (const name of names) assert.match(rollback, new RegExp(`DROP TABLE IF EXISTS ai_evalops\\.${name}`))
  assert.doesNotMatch(rollback, /DROP (?:DATABASE|SCHEMA)/)
  assert.doesNotMatch(rollback, /schema_release/)
})

test("TypeScript contract carries immutable intent, projection, attempt, lease, and evidence identities", () => {
  for (const name of ["ImmutableJobIntent", "JobProjection", "AttemptIdentity", "LeaseFence", "EvidenceReference"]) assert.match(typeContract, new RegExp(`interface ${name}`))
  for (const outcome of ["NOT_EXECUTED", "EXECUTED", "AMBIGUOUS", "EXPIRED", "FENCED"]) assert.match(typeContract, new RegExp(`\\"${outcome}\\"`))
})

test("monotonic allocation and domain idempotency properties reject duplicates", () => {
  const allocated = new Map(); const effects = new Set()
  const allocate = (domain) => { const next = (allocated.get(domain) ?? 0n) + 1n; allocated.set(domain, next); return next }
  const admit = (domain, key) => { const compound = `${domain}\u0000${key}`; if (effects.has(compound)) return false; effects.add(compound); return true }
  for (let index = 1n; index <= 128n; index += 1n) assert.equal(allocate("hermes:model"), index)
  assert.equal(admit("hermes:model", "request-1"), true)
  assert.equal(admit("hermes:model", "request-1"), false)
  assert.equal(admit("aegis:hash", "request-1"), true)
})
