import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { runPinnedPlacementInProcessCli } from "../recommend-pinned-placement.mjs"
import { createSingleShotDispatchStore } from "../runtime/single-shot-dispatch-store.mjs"
import {
  buildResidentHermesRequestBody,
  executeResidentHermesBoundedDispatch,
} from "./resident-hermes-bounded-dispatch.mjs"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const LEDGER_ROOT = "C:\\HermesLab\\bounded-dispatch-ledger"
const STATE_PATH = `${LEDGER_ROOT}\\dispatch-state-v02.json`

function parseArguments(argv) {
  const parsed = {}
  const allowed = new Set(["request", "receipt"])
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must use --name value pairs")
    const name = key.slice(2)
    if (!allowed.has(name) || Object.hasOwn(parsed, name)) throw new Error(`unsupported or duplicate option --${name}`)
    parsed[name] = value
  }
  if (!parsed.request || !parsed.receipt) throw new Error("--request and --receipt are required")
  return parsed
}

function readConfined(relativePath, requiredPrefix) {
  const root = fs.realpathSync(REPOSITORY_ROOT)
  const lexical = path.resolve(root, relativePath)
  const relative = path.relative(root, lexical).replace(/\\/g, "/")
  if (relative.startsWith("../") || path.isAbsolute(relative) || !relative.startsWith(requiredPrefix)) {
    throw new Error(`${requiredPrefix} artifact boundary is required`)
  }
  const real = fs.realpathSync(lexical)
  const realRelative = path.relative(root, real).replace(/\\/g, "/")
  if (realRelative.startsWith("../") || path.isAbsolute(realRelative) || !realRelative.startsWith(requiredPrefix)
    || fs.lstatSync(lexical).isSymbolicLink()) throw new Error("artifact path is not repository-confined")
  return fs.readFileSync(real)
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: REPOSITORY_ROOT, encoding: "utf8", windowsHide: true })
  if (result.status !== 0) throw new Error("trusted-main Git proof failed")
  return result.stdout
}

function proveTrustedAuthority({ registrySha256, authority, scope }) {
  const trustedRef = "refs/remotes/origin/main"
  git("merge-base", "--is-ancestor", authority.reviewed_commit, trustedRef)
  const retained = Buffer.from(git(
    "show",
    `${trustedRef}:config/execution-fabric/bounded-dispatch-authority-registry.json`,
  ), "utf8")
  const retainedSha256 = crypto.createHash("sha256").update(retained).digest("hex")
  if (retainedSha256 !== registrySha256) throw new Error("trusted main does not contain the exact authority registry bytes")
  const registry = JSON.parse(retained.toString("utf8"))
  const retainedScope = Buffer.from(git("show", `${authority.reviewed_commit}:${scope.path}`), "utf8")
  const retainedScopeSha256 = crypto.createHash("sha256").update(retainedScope).digest("hex")
  if (retainedScopeSha256 !== scope.sha256 || retainedScopeSha256 !== authority.scope_artifact_sha256) {
    throw new Error("reviewed commit does not contain the exact authority scope bytes")
  }
  const activationLine = git(
    "log", "-1", "--format=%H%x00%cI", trustedRef, "--",
    "config/execution-fabric/bounded-dispatch-authority-registry.json",
  ).trim()
  const [activationCommit, activationTimestamp] = activationLine.split("\0")
  if (!/^[a-f0-9]{40}$/.test(activationCommit) || !activationTimestamp) {
    throw new Error("trusted activation commit is unavailable")
  }
  git("merge-base", "--is-ancestor", authority.reviewed_commit, activationCommit)
  git("merge-base", "--is-ancestor", activationCommit, trustedRef)
  const activatedAt = new Date(activationTimestamp).toISOString()
  if (activationCommit === authority.reviewed_commit || Date.parse(activatedAt) >= Date.parse(authority.valid_from)) {
    throw new Error("authority activation chronology is invalid")
  }
  return {
    schema_version: "0.1-trusted-bounded-dispatch-authority-proof",
    trusted_ref: trustedRef,
    registry_sha256: registrySha256,
    authority_reference: authority.reference,
    authority_reviewed_commit: authority.reviewed_commit,
    scope_artifact_sha256: retainedScopeSha256,
    activation_commit: activationCommit,
    activated_at: activatedAt,
    trusted_head: git("rev-parse", trustedRef).trim(),
    exact_entry_count: registry.entries.filter((entry) => entry.reference === authority.reference).length,
  }
}

function proveTrustedPlacement({ receiptSha256, receipt }) {
  const args = [
    "--snapshot-root", "C:\\HermesLab\\snapshots",
    "--verifier", "C:\\HermesLab\\tools\\verify_snapshot.py",
    "--registry", path.join(REPOSITORY_ROOT, "config/execution-fabric/registry.seed.json"),
    "--schema", path.join(REPOSITORY_ROOT, "config/execution-fabric/registry.schema.json"),
    "--policy", path.join(REPOSITORY_ROOT, "config/execution-fabric/pinned-evidence-policy.json"),
    "--workloads", path.join(REPOSITORY_ROOT, "config/execution-fabric/placement-workloads.json"),
    "--workload", receipt.workload.id,
    "--at", receipt.evaluated_at,
  ]
  for (const evidence of receipt.evidence_snapshot) args.push("--evidence", `${evidence.node}=${evidence.snapshot_sha256}`)
  const replay = runPinnedPlacementInProcessCli(args)
  if (replay.status === "INPUT_REJECTED" || canonicalizeJcs(replay) !== canonicalizeJcs(receipt)) {
    throw new Error("pinned placement replay does not reproduce the exact receipt semantics")
  }
  return {
    schema_version: "0.1-trusted-pinned-placement-proof",
    receipt_sha256: receiptSha256,
    semantic_replay_sha256: crypto.createHash("sha256").update(canonicalizeJcs(replay)).digest("hex"),
    evidence_count: replay.evidence_snapshot.length,
    verified: true,
  }
}

async function invokeLoopbackModel({ adapter_id, model, prompt, timeout_ms, max_response_bytes }) {
  if (adapter_id !== "resident-hermes-loopback-ollama-v1") throw new Error("unsupported bounded adapter")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout_ms)
  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0, num_predict: 64 } }),
      signal: controller.signal,
      redirect: "error",
    })
    if (!response.ok) throw new Error(`loopback model returned HTTP ${response.status}`)
    const transportCeiling = max_response_bytes * 4
    const declaredLength = Number(response.headers.get("content-length") ?? 0)
    if (declaredLength > transportCeiling) throw new Error("loopback model response exceeds transport ceiling")
    if (!response.body) throw new Error("loopback model response body is missing")
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      total += chunk.byteLength
      if (total > transportCeiling) {
        await reader.cancel()
        throw new Error("loopback model response exceeds transport ceiling")
      }
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    if (!value || typeof value.response !== "string") throw new Error("loopback model response contract is invalid")
    return value.response
  } finally {
    clearTimeout(timer)
  }
}

async function captureResourceObservations({ completed_at }) {
  return [{
    metric: "ram_used_bytes",
    unit: "bytes",
    value: os.totalmem() - os.freemem(),
    observed_at: completed_at,
  }]
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  if (os.hostname().toLowerCase() !== "hermes") throw new Error("resident HERMES identity is required")
  git("fetch", "--quiet", "origin", "main")
  const trustedHead = git("rev-parse", "refs/remotes/origin/main").trim()
  if (git("rev-parse", "HEAD").trim() !== trustedHead) throw new Error("checkout is not the exact trusted origin/main head")
  git("diff", "--quiet")
  git("diff", "--cached", "--quiet")
  const requestBytes = readConfined(args.request, "docs/reports/bounded-dispatch/")
  const receiptBytes = readConfined(args.receipt, "docs/reports/")
  const request = JSON.parse(requestBytes.toString("utf8").replace(/^\uFEFF/, ""))
  const authorityRegistry = JSON.parse(fs.readFileSync(path.join(
    REPOSITORY_ROOT,
    "config/execution-fabric/bounded-dispatch-authority-registry.json",
  ), "utf8"))
  const authority = authorityRegistry.entries.find((entry) => entry.reference === request.authority_reference)
  if (!authority || authority.status !== "ACTIVE") throw new Error("active bounded authority is required")
  const store = createSingleShotDispatchStore(STATE_PATH, {
    storeId: "execution-fabric-resident-hermes-v02",
    requireExisting: true,
    expectedGenesisSha256: authority.ledger_genesis_sha256,
  })
  const templateBytes = fs.readFileSync(path.join(
    REPOSITORY_ROOT,
    "config/execution-fabric/bounded-dispatch-templates.json",
  ))
  let leaseContext = null
  const admission = {
    dispatch_id: request.request_id,
    work_order_id: request.work_order_id,
    authority_reference: request.authority_reference,
    admission_sha256: crypto.createHash("sha256").update(canonicalizeJcs(request)).digest("hex"),
    template_id: request.template_id,
    template_sha256: crypto.createHash("sha256").update(templateBytes).digest("hex"),
    selected_node_id: "hermes-node",
  }
  const retained = store.read().dispatches[request.request_id]
  if (retained) {
    if (retained.admission_sha256 !== admission.admission_sha256) {
      throw new Error("dispatch admission collides with retained durable state")
    }
    if (retained.state === "COMPLETE") {
      process.stdout.write(`${JSON.stringify({
        schema_version: "0.1-bounded-dispatch-replay-result",
        status: "ALREADY_COMPLETE_NO_REPLAY",
        dispatch_performed: false,
        scheduler_activated: false,
        autonomous_dispatch: false,
        retained_result: retained.receipt,
        event_head_sha256: retained.event_head_sha256,
      }, null, 2)}\n`)
      return
    }
    if (["REQUEST_STARTED", "FAILED_TERMINAL", "OUTCOME_UNKNOWN_DO_NOT_REPLAY"].includes(retained.state)) {
      throw new Error(`dispatch is terminal and cannot replay: ${retained.state}`)
    }
  }
  const result = await executeResidentHermesBoundedDispatch({
    repositoryRoot: REPOSITORY_ROOT,
    receiptBytes,
    request,
    clock: () => new Date().toISOString(),
    proveTrustedPlacement,
    proveTrustedAuthority,
    claimSingleUse: async () => {
      const record = store.admit(admission)
      return {
        claimed: !["REQUEST_STARTED", "COMPLETE", "FAILED_TERMINAL", "OUTCOME_UNKNOWN_DO_NOT_REPLAY"].includes(record.state),
        claim_id: `claim-${record.admission_sha256.slice(0, 24)}`,
        claimed_at: record.events[0].at,
      }
    },
    acquireExclusiveRuntimeLease: async ({ claim_id }) => {
      const prior = store.read().dispatches[request.request_id]
      const holderId = `resident-hermes-${process.pid}-${crypto.randomUUID()}`
      const holderTokenDigest = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex")
      let leased
      try {
        leased = prior.state === "ADMITTED"
          ? store.acquire({ dispatchId: request.request_id, holderId, holderTokenDigest, leaseDurationMs: 90_000 })
          : store.recoverExpired({
            dispatchId: request.request_id,
            holderId,
            holderTokenDigest,
            expectedFencingToken: prior.fencing_token,
            leaseDurationMs: 90_000,
          })
      } catch {
        return { acquired: false, lease_id: `lease-${claim_id}`, acquired_at: new Date().toISOString() }
      }
      leaseContext = { holderId, fencingToken: leased.fencing_token }
      return {
        acquired: leased.state === "LEASED",
        lease_id: `lease-${leased.fencing_token}-${claim_id}`,
        acquired_at: leased.events.at(-1).at,
      }
    },
    settleSuccessfulDispatch: async ({ result: completion }) => {
      if (!leaseContext) return false
      const settled = store.complete({
        dispatchId: request.request_id,
        holderId: leaseContext.holderId,
        fencingToken: leaseContext.fencingToken,
        responseSha256: completion.output.sha256,
        receipt: completion,
      })
      return settled.state === "COMPLETE"
    },
    settleFailedDispatch: async ({ reason }) => {
      if (!leaseContext) return false
      const settled = store.failTerminal({
        dispatchId: request.request_id,
        holderId: leaseContext.holderId,
        fencingToken: leaseContext.fencingToken,
        reason,
      })
      return ["FAILED_TERMINAL", "OUTCOME_UNKNOWN_DO_NOT_REPLAY"].includes(settled.state)
    },
    invokeLoopbackModel: async (input) => {
      if (!leaseContext) throw new Error("durable lease context is missing")
      const body = buildResidentHermesRequestBody(request)
      store.markRequestStarted({
        dispatchId: request.request_id,
        holderId: leaseContext.holderId,
        fencingToken: leaseContext.fencingToken,
        requestSha256: crypto.createHash("sha256").update(body).digest("hex"),
      })
      return invokeLoopbackModel(input)
    },
    captureResourceObservations,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    schema_version: "0.1-bounded-dispatch-runtime-error",
    status: "FAILED_CLOSED",
    detail: String(error?.message ?? error),
    claim_id: error?.claimId ?? null,
    runtime_lease_id: error?.runtimeLeaseId ?? null,
    dispatch_attempted: error?.dispatchAttempted === true,
    runtime_lease_released: error?.runtimeLeaseReleased === true,
    dispatch_allowed: false,
    scheduler_activated: false,
    autonomous_dispatch: false,
    silent_replacement: false,
  }, null, 2)}\n`)
  process.exitCode = 2
})
