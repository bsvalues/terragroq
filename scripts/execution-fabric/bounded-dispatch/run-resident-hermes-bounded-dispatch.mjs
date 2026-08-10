import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { runPinnedPlacementCli } from "../recommend-pinned-placement.mjs"
import { executeResidentHermesBoundedDispatch } from "./resident-hermes-bounded-dispatch.mjs"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const LEDGER_ROOT = "C:\\HermesLab\\bounded-dispatch-ledger"

function ensureLedgerRoot() {
  const labRoot = fs.realpathSync("C:\\HermesLab")
  fs.mkdirSync(LEDGER_ROOT, { recursive: true })
  if (fs.lstatSync(LEDGER_ROOT).isSymbolicLink()) throw new Error("bounded dispatch ledger must not be a link")
  const realLedger = fs.realpathSync(LEDGER_ROOT)
  const relative = path.relative(labRoot, realLedger)
  if (relative !== "bounded-dispatch-ledger" || path.isAbsolute(relative)) {
    throw new Error("bounded dispatch ledger escapes the resident HERMES root")
  }
  return realLedger
}

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
  git("merge-base", "--is-ancestor", authority.reviewed_commit, "refs/heads/main")
  const retained = Buffer.from(git(
    "show",
    "refs/heads/main:config/execution-fabric/bounded-dispatch-authority-registry.json",
  ), "utf8")
  const retainedSha256 = crypto.createHash("sha256").update(retained).digest("hex")
  if (retainedSha256 !== registrySha256) throw new Error("trusted main does not contain the exact authority registry bytes")
  const registry = JSON.parse(retained.toString("utf8"))
  const retainedScope = Buffer.from(git("show", `${authority.reviewed_commit}:${scope.path}`), "utf8")
  const retainedScopeSha256 = crypto.createHash("sha256").update(retainedScope).digest("hex")
  if (retainedScopeSha256 !== scope.sha256 || retainedScopeSha256 !== authority.scope_artifact_sha256) {
    throw new Error("reviewed commit does not contain the exact authority scope bytes")
  }
  return {
    schema_version: "0.1-trusted-bounded-dispatch-authority-proof",
    trusted_ref: "refs/heads/main",
    registry_sha256: registrySha256,
    authority_reference: authority.reference,
    authority_reviewed_commit: authority.reviewed_commit,
    scope_artifact_sha256: retainedScopeSha256,
    exact_entry_count: registry.entries.filter((entry) => entry.reference === authority.reference).length,
  }
}

function proveTrustedPlacement({ receiptSha256, receipt }) {
  const args = [
    "--snapshot-root", "C:\\HermesLab\\snapshots",
    "--verifier", "C:\\HermesLab\\tools\\verify_snapshot.py",
    "--python", "py",
    "--registry", path.join(REPOSITORY_ROOT, "config/execution-fabric/registry.seed.json"),
    "--schema", path.join(REPOSITORY_ROOT, "config/execution-fabric/registry.schema.json"),
    "--policy", path.join(REPOSITORY_ROOT, "config/execution-fabric/pinned-evidence-policy.json"),
    "--workloads", path.join(REPOSITORY_ROOT, "config/execution-fabric/placement-workloads.json"),
    "--workload", receipt.workload.id,
    "--at", receipt.evaluated_at,
  ]
  for (const evidence of receipt.evidence_snapshot) args.push("--evidence", `${evidence.node}=${evidence.snapshot_sha256}`)
  const replay = runPinnedPlacementCli(args)
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

async function claimSingleUse({ request_id, request_sha256, scope_sha256, authority_reference, maximum_attempts }) {
  if (process.platform !== "win32") throw new Error("resident HERMES bounded dispatch requires Windows")
  const ledgerRoot = ensureLedgerRoot()
  const claimKeySha256 = crypto.createHash("sha256").update(canonicalizeJcs({
    authority_reference,
    scope_sha256,
  })).digest("hex")
  const claimPath = path.join(ledgerRoot, `${claimKeySha256}.json`)
  const claimedAt = new Date().toISOString()
  const claim = {
    schema_version: "0.1-bounded-dispatch-single-use-claim",
    request_id,
    request_sha256,
    scope_sha256,
    claim_key_sha256: claimKeySha256,
    authority_reference,
    maximum_attempts,
    claimed_at: claimedAt,
  }
  claim.claim_sha256 = crypto.createHash("sha256").update(canonicalizeJcs(claim)).digest("hex")
  let descriptor
  try {
    descriptor = fs.openSync(claimPath, "wx")
    fs.writeFileSync(descriptor, `${JSON.stringify(claim)}\n`, "utf8")
  } catch (error) {
    if (error?.code === "EEXIST") return { claimed: false, claim_id: `claim-${claimKeySha256.slice(0, 24)}`, claimed_at: claimedAt }
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  return { claimed: true, claim_id: `claim-${claim.claim_sha256.slice(0, 24)}`, claimed_at: claimedAt }
}

async function acquireExclusiveRuntimeLease({ claim_id, request_sha256, authority_reference }) {
  const leasePath = path.join(ensureLedgerRoot(), "resident-hermes-active.json")
  const acquiredAt = new Date().toISOString()
  const leaseId = `lease-${crypto.createHash("sha256").update(canonicalizeJcs({
    claim_id, request_sha256, authority_reference, acquired_at: acquiredAt,
  })).digest("hex").slice(0, 24)}`
  let descriptor
  try {
    descriptor = fs.openSync(leasePath, "wx")
    fs.writeFileSync(descriptor, `${JSON.stringify({
      schema_version: "0.1-resident-hermes-runtime-lease",
      lease_id: leaseId,
      claim_id,
      request_sha256,
      authority_reference,
      acquired_at: acquiredAt,
    })}\n`, "utf8")
  } catch (error) {
    if (error?.code === "EEXIST") return { acquired: false, lease_id: leaseId, acquired_at: acquiredAt }
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  return { acquired: true, lease_id: leaseId, acquired_at: acquiredAt }
}

async function releaseExclusiveRuntimeLease({ lease_id, claim_id }) {
  const leasePath = path.join(ensureLedgerRoot(), "resident-hermes-active.json")
  const retained = JSON.parse(fs.readFileSync(leasePath, "utf8"))
  if (retained.lease_id !== lease_id || retained.claim_id !== claim_id) return false
  fs.unlinkSync(leasePath)
  return true
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
  const requestBytes = readConfined(args.request, "docs/reports/bounded-dispatch/")
  const receiptBytes = readConfined(args.receipt, "docs/reports/")
  const request = JSON.parse(requestBytes.toString("utf8").replace(/^\uFEFF/, ""))
  const result = await executeResidentHermesBoundedDispatch({
    repositoryRoot: REPOSITORY_ROOT,
    receiptBytes,
    request,
    clock: () => new Date().toISOString(),
    proveTrustedPlacement,
    proveTrustedAuthority,
    claimSingleUse,
    acquireExclusiveRuntimeLease,
    releaseExclusiveRuntimeLease,
    invokeLoopbackModel,
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
