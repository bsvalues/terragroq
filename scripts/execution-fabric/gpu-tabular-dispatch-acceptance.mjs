/**
 * GPU-tabular dispatch seam — live acceptance across the owner's full matrix.
 * Real evidence ledger, real lane-lease store, real fabric SSH, real DAEDALUS, real app DB.
 * DATABASE_URL is read inside the process and never echoed. Synthetic data only.
 *
 * Run: node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        C:/Users/bs/seam-acceptance.mjs [--only=name1,name2]
 */
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

const LANE = "C:/HermesLab/gpu-promote-lane"
process.chdir(LANE)
const RUN_TAG = process.env.SEAM_RUN_TAG ?? `seam-${Date.now()}`
const OUTDIR = path.join(os.homedir(), "AppData", "Local", "Temp", "seam-acceptance", RUN_TAG)
fs.mkdirSync(OUTDIR, { recursive: true })
const STATE_DIR = path.join(OUTDIR, "state")
fs.mkdirSync(STATE_DIR, { recursive: true })
process.env.WILLIAMOS_GPU_TABULAR_STATE_DIR = STATE_DIR

const envText = fs.readFileSync("C:/HermesLab/williamos-runtime-64034e93-flat/.env.local", "utf8")
const DATABASE_URL = envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!DATABASE_URL) throw new Error("DATABASE_URL unavailable from runtime env")

const { Pool } = await import("pg")
const pool = new Pool({ connectionString: DATABASE_URL, max: 2 })
const q = (sql, params) => pool.query(sql, params)

const seam = await import(pathToFileURL(path.resolve("scripts/execution-fabric/gpu-tabular-dispatch.mjs")).href)
const registry = await import(pathToFileURL(path.resolve("components/operator/multi-agent-capability-registry.ts")).href)
const adapter = await import(pathToFileURL(path.resolve("scripts/execution-fabric/gpu-tabular-capability.mjs")).href)
const bindings = await seam.loadLedgerBindings()
const leaseMod = await seam.loadLeaseBindings()

const GP = "scripts/execution-fabric"
const OWNER = (await q(`SELECT "userId" FROM work_order WHERE ref='WO-EXT-73FB47098DD1330415669FE0' LIMIT 1`)).rows[0]?.userId
  ?? (await q(`SELECT "userId" FROM work_order LIMIT 1`)).rows[0].userId

async function makeWorkOrder(label, { allowedFiles = [GP], status = "approved", grantActions = [GP] } = {}) {
  const ref = `WO-${label}-${RUN_TAG}`.slice(0, 60)
  const wo = await q(`INSERT INTO work_order ("userId", ref, title, description, "allowedFiles", validators,
      status, "authorityLevel", "authorityGranted", agent, lane, goal, loop, scope)
    VALUES ($1,$2,$3,'live acceptance of the promoted GPU tabular dispatch seam (synthetic only)',$4,
      ARRAY['gpu-tabular matrix'],$5,'A2_WRITE_OWN','A2_WRITE_OWN','gpu-tabular-dispatch',
      'operator-objective','live-acceptance','compute-dispatch','synthetic tabular compute only')
    RETURNING id, ref, "userId", "allowedFiles", status`,
    [OWNER, ref, `GPU tabular seam acceptance: ${label}`, allowedFiles, status])
  const row = wo.rows[0]
  if (grantActions !== null) {
    await q(`INSERT INTO authority_grant ("userId", ref, "workOrderId", "grantedBy", "grantedTo",
        "authorityLevel", scope, "allowedActions", reason, status, "expiresAt")
      VALUES ($1,$2,$3,'williamos-agent','gpu-tabular-dispatch','A2_WRITE_OWN',
        '{"outcome":"live-acceptance"}',$4,'bounded synthetic acceptance','active',
        timezone('UTC', now()) + interval '24 hours')`,
      [OWNER, `GRANT-${label}-${RUN_TAG}`.slice(0, 60), row.id, grantActions])
  }
  return row
}

const loadWO = (ref) => q(`SELECT id, ref, status, "userId", "allowedFiles", evidence FROM work_order WHERE ref=$1`, [ref])
  .then((r) => r.rows[0] ?? null)
const loadGrant = (id) => q(`SELECT id, ref, status, "allowedActions", "expiresAt" FROM authority_grant
    WHERE "workOrderId"=$1 AND status='active' AND ("expiresAt" IS NULL OR "expiresAt" > timezone('UTC', now()))
    ORDER BY id LIMIT 1`, [id]).then((r) => r.rows[0] ?? null)

function dispatch(submission, overrides = {}) {
  return seam.dispatchComputeJob(submission, {
    registry, adapter, bindings, leaseMod, runQuery: q,
    loadWorkOrder: loadWO, loadActiveGrant: loadGrant, maxAttempts: 4, ...overrides,
  })
}

const results = []
async function scenario(name, expect, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    const ok = detail?.pass === true
    results.push({ name, expect, ok, seconds: (Date.now() - started) / 1000, detail })
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail).slice(0, 200)}`)
  } catch (error) {
    results.push({ name, expect, ok: false, error: String(error.message ?? error).slice(0, 300),
      seconds: (Date.now() - started) / 1000 })
    console.log(`FAIL  ${name}  ERROR ${String(error.message ?? error).slice(0, 200)}`)
  }
}

const countEvidence = (woId) => q(
  `SELECT count(*)::int AS n FROM evidence_record WHERE "workOrderId"=$1`, [woId]).then((r) => r.rows[0].n)
const gpuEvidence = (woId) => q(
  `SELECT ref, result, notes, "contentHash" FROM evidence_record WHERE "workOrderId"=$1 ORDER BY id`, [woId])
  .then((r) => r.rows)

// -------------------------------------------------------------------------------------------- scenarios

const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").replace("--only=", "").split(",").filter(Boolean)
const want = (name) => !only.length || only.includes(name)

if (want("health")) await scenario("health", "deviceHealthy true", async () => {
  const health = await seam.probeBinding({})
  return { pass: health.deviceHealthy === true && health.deviceQuerySucceeded === true, cuml: health.cumlVersion }
})

if (want("place-matrix")) await scenario("place-matrix", "threshold decisions", async () => {
  const health = await seam.probeBinding({})
  const place = async (workload, rows) => (await seam.preflightPlacement(
    { workload, rows, workOrder: { allowedFiles: [GP] }, grant: { allowedActions: [GP] } },
    { registry, adapter, health })).placement
  const cases = {
    "regression 2.5M": [await place("regression", 2_500_000), "CUDA_DEVICE"],
    "regression 60k": [await place("regression", 60_000), "CUDA_DEVICE"],
    "regression 49,999": [await place("regression", 49_999), "CPU"],
    "clustering 60k": [await place("clustering", 60_000), "CUDA_DEVICE"],
    "aggregation 100k": [await place("aggregation", 100_000), "CUDA_DEVICE"],
    "aggregation 60k": [await place("aggregation", 60_000), "CPU"],
    "decomposition 2.5M": [await place("decomposition", 2_500_000), "CPU"],
  }
  const wrong = Object.entries(cases).filter(([, pair]) => pair[0] !== pair[1])
  return { pass: wrong.length === 0, cases, wrong }
})

if (want("exec-regression-gpu")) {
  const wo = await makeWorkOrder("exec-reg")
  let first
  await scenario("exec-regression-gpu", "SUCCEEDED CUDA_DEVICE", async () => {
    first = await dispatch({ workOrderRef: wo.ref, workload: "regression",
      synthetic: { parcels: 60_000, seed: 777 } })
    const ev = await gpuEvidence(wo.id)
    return { pass: first.status === "SUCCEEDED" && first.placement === "CUDA_DEVICE" && ev.length === 1,
      placement: first.placement, reason: first.reasonCode, evidence: ev.length,
      seconds: first.workloadSeconds }
  })
  await scenario("replay-regression", "IDEMPOTENT_REPLAY no second evidence", async () => {
    const before = await countEvidence(wo.id)
    const sshCalls = []
    const replay = await dispatch({ workOrderRef: wo.ref, workload: "regression",
      synthetic: { parcels: 60_000, seed: 777 } },
    { ssh: async (n, opts) => { sshCalls.push(opts.command); return { exitCode: 0, stdout: "", stderr: "" } } })
    const after = await countEvidence(wo.id)
    return { pass: replay.outcome === "IDEMPOTENT_REPLAY" && replay.executed === false
      && after === before && sshCalls.every((c) => !c.includes("resident-gpu-tabular-worker")),
    outcome: replay.outcome, evidenceBefore: before, evidenceAfter: after }
  })
}

if (want("exec-clustering-gpu")) {
  const wo = await makeWorkOrder("exec-clus")
  await scenario("exec-clustering-gpu", "SUCCEEDED CUDA_DEVICE", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "clustering",
      synthetic: { parcels: 60_000, seed: 778 } })
    return { pass: r.status === "SUCCEEDED" && r.placement === "CUDA_DEVICE",
      reason: r.reasonCode, seconds: r.workloadSeconds, evidence: await countEvidence(wo.id) }
  })
}

if (want("exec-aggregation-size-aware")) {
  const wo = await makeWorkOrder("exec-agg")
  await scenario("exec-aggregation-gpu", "SUCCEEDED CUDA_DEVICE >=100k", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "aggregation",
      synthetic: { parcels: 100_000, transactions: 800_000, seed: 779 } })
    return { pass: r.status === "SUCCEEDED" && r.placement === "CUDA_DEVICE", seconds: r.workloadSeconds }
  })
  await scenario("exec-aggregation-cpu-below", "SUCCEEDED CPU <100k", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "aggregation",
      synthetic: { parcels: 60_000, transactions: 480_000, seed: 780 } })
    return { pass: r.status === "SUCCEEDED" && r.placement === "CPU"
      && r.reasonCode === "CPU_BELOW_MEASURED_THRESHOLD" }
  })
}

if (want("exec-pca-cpu")) {
  const wo = await makeWorkOrder("exec-pca")
  await scenario("exec-pca-cpu", "SUCCEEDED CPU measured-refusal", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "decomposition",
      synthetic: { parcels: 60_000, seed: 781 } })
    return { pass: r.status === "SUCCEEDED" && r.placement === "CPU"
      && r.reasonCode === "CPU_MEASURED_NO_GPU_BENEFIT" }
  })
}

if (want("exec-outlier-refused")) {
  const wo = await makeWorkOrder("exec-out")
  await scenario("exec-outlier-refused", "REFUSED screening-only", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "outlier",
      synthetic: { parcels: 60_000, seed: 782 } })
    return { pass: r.status === "REFUSED" && r.outcome === "SCREENING_ONLY_NOT_AUTHORITATIVE"
      && (await countEvidence(wo.id)) === 0 }
  })
}

if (want("failclosed-evidence")) {
  const wo = await makeWorkOrder("fail-ev")
  const staleCurve = path.join(OUTDIR, "stale-curve.json")
  const curve = JSON.parse(fs.readFileSync(
    "scripts/execution-fabric/gpu-tabular-bench/evidence/placement-curve.json", "utf8"))
  curve.finishedAt = "2020-01-01T00:00:00Z"
  fs.writeFileSync(staleCurve, JSON.stringify(curve))
  await scenario("stale-evidence-cpu", "CPU stale evidence", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "regression",
      synthetic: { parcels: 60_000, seed: 790 } }, { curvePath: staleCurve })
    return { pass: r.status === "SUCCEEDED" && r.placement === "CPU"
      && r.reasonCode === "CPU_DEFAULT_THRESHOLD_EVIDENCE_STALE" }
  })
  await scenario("missing-evidence-cpu", "CPU missing evidence", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "clustering",
      synthetic: { parcels: 60_000, seed: 791 } },
    { curvePath: path.join(OUTDIR, "does-not-exist.json") })
    return { pass: r.status === "SUCCEEDED" && r.placement === "CPU"
      && r.reasonCode === "CPU_DEFAULT_THRESHOLD_EVIDENCE_UNAVAILABLE" }
  })
}

if (want("failclosed-authority")) {
  const wo = await makeWorkOrder("fail-auth", { grantActions: null }) // no grant at all
  await scenario("missing-grant-cpu", "CPU authority missing", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "regression",
      synthetic: { parcels: 60_000, seed: 792 } })
    return { pass: r.status === "SUCCEEDED" && r.placement === "CPU"
      && r.reasonCode === "CPU_DEFAULT_AUTHORITY_MISSING" }
  })
  const wo2 = await makeWorkOrder("fail-drift", { allowedFiles: ["docs"], grantActions: [GP] })
  await scenario("scope-drift-cpu", "CPU trust-gate scope mismatch", async () => {
    const r = await dispatch({ workOrderRef: wo2.ref, workload: "regression",
      synthetic: { parcels: 60_000, seed: 793 } })
    return { pass: r.status === "SUCCEEDED" && r.placement === "CPU"
      && r.reasonCode === "CPU_DEFAULT_TRUST_GATE_DENIED" }
  })
}

if (want("failclosed-binding")) {
  const wo = await makeWorkOrder("fail-bind")
  await scenario("unhealthy-binding-cpu", "CPU binding unavailable", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "regression",
      synthetic: { parcels: 60_000, seed: 794 } },
    { healthProbe: { deviceHealthy: false, deviceQuerySucceeded: false, probeError: "forced" } })
    return { pass: r.status === "SUCCEEDED" && r.placement === "CPU"
      && r.reasonCode === "CPU_DEFAULT_BINDING_UNAVAILABLE" }
  })
  await scenario("node-down-incomplete", "DISPATCH_INCOMPLETE node unreachable", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "regression",
      synthetic: { parcels: 60_000, seed: 795 } },
    { healthProbe: { deviceHealthy: true, deviceQuerySucceeded: true }, // claim healthy, kill transport
      ssh: async () => { throw new Error("simulated fabric outage") } })
    return { pass: r.status === "DISPATCH_INCOMPLETE" && r.outcome.startsWith("COMPUTE") }
  })
  // Device down but node up: the CPU fallback must still execute on the reviewed venv.
  const wo2 = await makeWorkOrder("fail-dev")
  await scenario("device-down-cpu-fallback", "SUCCEEDED CPU with device down", async () => {
    // Unset CUDA visibility on the remote command: the health probe sees query-success but no
    // compute round-trip -> deviceHealthy false; placement falls to CPU and the job must still
    // execute on the reviewed venv via the same fabric node.
    process.env.WILLIAMOS_GPU_TABULAR_REMOTE_PREFIX = "CUDA_VISIBLE_DEVICES= "
    try {
      const health = await seam.probeBinding({})
      const r = await dispatch({ workOrderRef: wo2.ref, workload: "regression",
        synthetic: { parcels: 60_000, seed: 796 } })
      return { pass: health.deviceHealthy === false && health.deviceQuerySucceeded === true
        && r.status === "SUCCEEDED" && r.placement === "CPU"
        && r.reasonCode === "CPU_DEFAULT_BINDING_UNAVAILABLE",
      health: { q: health.deviceQuerySucceeded, healthy: health.deviceHealthy }, placement: r.placement }
    } finally {
      delete process.env.WILLIAMOS_GPU_TABULAR_REMOTE_PREFIX
    }
  })
}

if (want("cancel-live")) {
  const wo = await makeWorkOrder("cancel")
  await scenario("cancel-live-workload", "CANCELLED no evidence", async () => {
    // Real 2.5M-parcel GPU regression; cancel ~3s after it starts (mid-generation or mid-fit).
    let arm = false
    const timer = setTimeout(() => { arm = true }, 3_000)
    const r = await dispatch({ workOrderRef: wo.ref, workload: "regression",
      synthetic: { parcels: 2_500_000, transactions: 20_000_000, seed: 797 },
      cancelCheck: () => arm }, { jobTimeoutMs: 180_000 })
    clearTimeout(timer)
    // Device must be free again after the cancellation (the proven release path).
    const after = await seam.probeBinding({})
    const evCount = await countEvidence(wo.id)
    return { pass: r.status === "CANCELLED" && evCount === 0,
      status: r.status, phase: r.phase, evidence: evCount,
      deviceFreeAfter: after.deviceHealthy === true || after.deviceQuerySucceeded === true }
  })
}

if (want("restart-recovery")) {
  const wo = await makeWorkOrder("restart")
  await scenario("dispatcher-death-orphan-adopt", "adopt orphan, one evidence row", async () => {
    const submission = { workOrderRef: wo.ref, workload: "clustering",
      synthetic: { parcels: 60_000, seed: 798 } }
    // Kill the dispatching process mid-run: a child node process runs the same dispatch CLI and
    // is SIGKILLed shortly after the worker starts. The remote worker keeps running and writes its
    // result file; the parent never records completion.
    const child = spawn(process.execPath,
      ["--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        path.resolve("scripts/execution-fabric/gpu-tabular-dispatch.mjs"), "submit", "clustering",
        `--wo=${wo.ref}`, "--parcels=60000", "--seed=798"],
      { cwd: LANE, env: { ...process.env, DATABASE_URL }, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (c) => { out += c })
    child.stderr.on("data", (c) => { out += c })
    await new Promise((resolve) => setTimeout(resolve, 4_000)) // let the remote run start
    child.kill("SIGKILL")
    await new Promise((resolve) => child.on("exit", resolve))
    // The remote worker (untouched by the local kill) finishes and writes result.json. Poll for
    // the orphan file, then replay through the SAME state dir (a fresh process = the recovery pass).
    const digest = seam.jobDigest({ workOrderRef: wo.ref, workload: "clustering",
      synthetic: submission.synthetic, devicePolicy: "auto" })
    const deadline = Date.now() + 120_000
    let orphanSeen = null
    while (Date.now() < deadline) {
      const probe = await seam.fabricSsh("daedalus", {
        command: seam.orphanScanCommand(seam.jobIdentity(digest, 0).scratchBase), timeoutMs: 20_000 })
      if (probe.exitCode === 0 && probe.stdout.includes("SUCCEEDED")) { orphanSeen = true; break }
      await new Promise((resolve) => setTimeout(resolve, 3_000))
    }
    if (!orphanSeen) return { pass: false, reason: "orphan result never appeared", killed: out.slice(-160) }
    const r = await dispatch(submission)
    const ev = await gpuEvidence(wo.id)
    return { pass: ["RECOVERED_ADOPTED_ORPHAN_RESULT", "IDEMPOTENT_REPLAY", "RECOVERED_ADOPTED_RESULT"]
        .includes(r.outcome) && ev.length === 1,
      outcome: r.outcome, status: r.status, evidenceRows: ev.length }
  })
}

if (want("provenance-lands")) {
  const wo = await makeWorkOrder("prov")
  await scenario("evidence-lands-on-wo", "evidence_record + governance_event + wo.evidence", async () => {
    const r = await dispatch({ workOrderRef: wo.ref, workload: "regression",
      synthetic: { parcels: 60_000, seed: 799 } })
    const ev = await gpuEvidence(wo.id)
    const gev = await q(`SELECT "eventType", actor, reason FROM governance_event
      WHERE "entityType"='work_order' AND "entityId"=$1 AND "eventType"='GPU_TABULAR_COMPUTE_DISPATCHED'`,
    [String(wo.id)])
    const woRow = await loadWO(wo.ref)
    const receipt = ev.length ? JSON.parse(ev[0].notes) : null
    return { pass: r.status === "SUCCEEDED" && ev.length === 1 && gev.rows.length === 1
      && woRow.evidence?.some((entry) => String(entry).startsWith("EV-GPU-"))
      && receipt?.workOrderRef === wo.ref && receipt?.registryAllowed === true
      && receipt?.device === "cuda" && receipt.syntheticDataOnly === true && receipt.promoted === false,
    evidenceRef: ev[0]?.ref, woEvidence: woRow.evidence?.length, receiptDevice: receipt?.device }
  })
}

// -------------------------------------------------------------------------------------------- rollup
fs.writeFileSync(path.join(OUTDIR, "rollup.json"), JSON.stringify({
  runTag: RUN_TAG, generatedAt: new Date().toISOString(),
  total: results.length, passed: results.filter((entry) => entry.ok).length,
  stateDir: STATE_DIR, results,
}, null, 2))
await pool.end()
const failed = results.filter((entry) => !entry.ok)
console.log(`\nACCEPTANCE ROLLUP: ${results.length - failed.length}/${results.length} pass`)
if (failed.length) console.log(failed.map((entry) => `  FAIL ${entry.name}: ${JSON.stringify(entry.detail ?? entry.error)}`).join("\n"))
process.exitCode = failed.length ? 1 : 0
