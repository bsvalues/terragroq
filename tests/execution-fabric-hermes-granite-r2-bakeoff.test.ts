import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { GRANITE_R2_CONTRACT, executeResidentHermesGraniteR2Bakeoff, prepareResidentHermesGraniteR2Bakeoff } from "../scripts/execution-fabric/bounded-dispatch/resident-hermes-granite-r2-bakeoff.mjs"
import { claimSingleUseAtRoot, verifyTrustedAuthorityRegistry } from "../scripts/execution-fabric/bounded-dispatch/run-resident-hermes-granite-r2-bakeoff.mjs"
import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"

const roots: string[] = []
const digest = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex")
const canonicalDigest = (value: unknown) => digest(canonicalizeJcs(value))

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "granite-r2-adapter-")); roots.push(root)
  const sourcePaths = [GRANITE_R2_CONTRACT.evaluatorPath, GRANITE_R2_CONTRACT.bakeoffPath, GRANITE_R2_CONTRACT.embedPath, GRANITE_R2_CONTRACT.metricsPath, GRANITE_R2_CONTRACT.graniteModulePath,
    GRANITE_R2_CONTRACT.canonicalJsonPath, GRANITE_R2_CONTRACT.collectorPath, GRANITE_R2_CONTRACT.boundedLauncherPath, GRANITE_R2_CONTRACT.adapterPath, GRANITE_R2_CONTRACT.runnerPath, GRANITE_R2_CONTRACT.corpusManifestPath, GRANITE_R2_CONTRACT.permissionPath]
  for (const relative of sourcePaths) { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(process.cwd(), relative), target) }
  const hashes = Object.fromEntries(sourcePaths.map((relative) => [relative, digest(fs.readFileSync(path.join(root, relative)))]))
  const artifacts = GRANITE_R2_CONTRACT.modelFiles.map((file, index) => ({ path: file, sha256: String(index + 1).repeat(64).slice(0, 64), byte_length: index + 1 }))
  const admission: any = {
    schema_version: "1.0-hermes-granite-r2-bakeoff-admission", admission_id: "granite-r2-test-admission", work_order_id: "WO-R1B-EXEC-001", corpus_source_commit: GRANITE_R2_CONTRACT.corpusSourceCommit,
    execution_commit: "a".repeat(40), corpus: { manifest_path: GRANITE_R2_CONTRACT.corpusManifestPath, manifest_sha256: GRANITE_R2_CONTRACT.corpusManifestSha256, corpus_id: GRANITE_R2_CONTRACT.corpusId, corpus_fingerprint: GRANITE_R2_CONTRACT.corpusFingerprint, documents: 49, queries: 80 },
    model: { model_id: GRANITE_R2_CONTRACT.modelId, revision: GRANITE_R2_CONTRACT.revision, dimension: 768, backend: GRANITE_R2_CONTRACT.backend, manifest_sha256: "b".repeat(64), artifacts },
    runtime: { runtime_id: "williamos-sealed-embedding-runtime-v1", backend: GRANITE_R2_CONTRACT.backend, python_sha256: "c".repeat(64), git_sha256: "d".repeat(64), closure_manifest_sha256: "e".repeat(64), closure_file_count: 100,
      evaluator_sha256: hashes[GRANITE_R2_CONTRACT.evaluatorPath], bakeoff_sha256: hashes[GRANITE_R2_CONTRACT.bakeoffPath], embed_sha256: hashes[GRANITE_R2_CONTRACT.embedPath], metrics_sha256: hashes[GRANITE_R2_CONTRACT.metricsPath], granite_r2_onnx_sha256: hashes[GRANITE_R2_CONTRACT.graniteModulePath],
      canonical_json_sha256: hashes[GRANITE_R2_CONTRACT.canonicalJsonPath], collector_sha256: hashes[GRANITE_R2_CONTRACT.collectorPath], bounded_launcher_sha256: hashes[GRANITE_R2_CONTRACT.boundedLauncherPath], adapter_sha256: hashes[GRANITE_R2_CONTRACT.adapterPath], runner_sha256: hashes[GRANITE_R2_CONTRACT.runnerPath] },
    placement: { node_id: "hermes-node", machine_id_sha256: "f".repeat(64), inventory_snapshot_sha256: "1".repeat(64), host_manifest_sha256: "2".repeat(64), runtime_owner: "NT SERVICE\\TrustedInstaller", runtime_acl_sha256: "3".repeat(64) },
    limits: { timeout_ms: 60_000, max_input_bytes: 524_288, max_result_bytes: 1_048_576, max_scratch_bytes: 500_000_000, max_cpu_threads: 4, max_memory_bytes: 2_147_483_648, minimum_memory_available_bytes: 1_073_741_824, active_process_limit: 1, network_scope: "NONE" },
    permission_set_sha256: hashes[GRANITE_R2_CONTRACT.permissionPath], valid_from: "2026-08-12T19:59:00.000Z", expires_at: "2026-08-12T21:00:00.000Z", maximum_attempts: 1, status: "ADMITTED_SINGLE_USE",
  }
  const request = { schema_version: "1.0-hermes-granite-r2-bakeoff-request", request_id: "granite-r2-request", admission_sha256: canonicalDigest(admission) }
  const sourceClosure: any = { [GRANITE_R2_CONTRACT.evaluatorPath]: admission.runtime.evaluator_sha256, [GRANITE_R2_CONTRACT.bakeoffPath]: admission.runtime.bakeoff_sha256, [GRANITE_R2_CONTRACT.embedPath]: admission.runtime.embed_sha256,
    [GRANITE_R2_CONTRACT.metricsPath]: admission.runtime.metrics_sha256, [GRANITE_R2_CONTRACT.graniteModulePath]: admission.runtime.granite_r2_onnx_sha256, [GRANITE_R2_CONTRACT.canonicalJsonPath]: admission.runtime.canonical_json_sha256,
    [GRANITE_R2_CONTRACT.collectorPath]: admission.runtime.collector_sha256, [GRANITE_R2_CONTRACT.boundedLauncherPath]: admission.runtime.bounded_launcher_sha256, [GRANITE_R2_CONTRACT.adapterPath]: admission.runtime.adapter_sha256, [GRANITE_R2_CONTRACT.runnerPath]: admission.runtime.runner_sha256 }
  const proveTrustedAdmission = vi.fn(() => ({ schema_version: "1.0-trusted-hermes-granite-r2-admission-proof", admission_sha256: canonicalDigest(admission), execution_commit: admission.execution_commit, inventory_snapshot_sha256: admission.placement.inventory_snapshot_sha256, source_closure_sha256: canonicalDigest(sourceClosure), exact_entry_count: 1, verified: true }))
  return { root, admission, request, proveTrustedAdmission }
}

function attestation(admission: any) {
  const value: any = { schema_version: "1.0-trusted-hermes-granite-r2-runtime-attestation", collector_id: "reviewed-resident-hermes-granite-r2-collector", node_id: "hermes-node", machine_id_sha256: admission.placement.machine_id_sha256,
    inventory_snapshot_sha256: admission.placement.inventory_snapshot_sha256, host_manifest_sha256: admission.placement.host_manifest_sha256, python_sha256: admission.runtime.python_sha256, closure_manifest_sha256: admission.runtime.closure_manifest_sha256,
    closure_file_count: admission.runtime.closure_file_count, runtime_owner: admission.placement.runtime_owner, runtime_acl_sha256: admission.placement.runtime_acl_sha256, model_manifest_sha256: admission.model.manifest_sha256,
    model_artifacts: structuredClone(admission.model.artifacts), resources: { cpu_threads: 8, memory_total_bytes: 8_589_934_592, memory_available_bytes: 4_294_967_296 }, observed_at: "2026-08-12T20:00:00.300Z", expires_at: "2026-08-12T20:05:00.300Z", verified: true }
  value.attestation_sha256 = canonicalDigest(value); return value
}
function runtime() {
  const value: any = fixture(); const times = ["2026-08-12T20:00:00.000Z", "2026-08-12T20:00:00.200Z", "2026-08-12T20:00:00.500Z"]
  return { repositoryRoot: value.root, request: value.request, admission: value.admission, proveTrustedAdmission: value.proveTrustedAdmission, clock: vi.fn(() => times.shift()!),
    claimSingleUse: vi.fn(async () => ({ claimed: true, claim_id: "granite-r2-claim", claimed_at: "2026-08-12T20:00:00.100Z" })),
    acquireExclusiveLease: vi.fn(async () => ({ acquired: true, lease_id: "granite-r2-lease", fencing_token: 7, acquired_at: "2026-08-12T20:00:00.150Z", stale_lease_recovered: false, stale_lease_sha256: null })), releaseExclusiveLease: vi.fn(async () => true),
    collectTrustedHostAttestation: vi.fn(async () => attestation(value.admission)), invokeFixedEvaluator: vi.fn(async () => { const bytes = Buffer.from('{"ok":true}\n'); return { result_bytes: bytes, result_sha256: digest(bytes), model_manifest_sha256: value.admission.model.manifest_sha256,
      closure_manifest_sha256: value.admission.runtime.closure_manifest_sha256, host_manifest_sha256: value.admission.placement.host_manifest_sha256, corpus_fingerprint: GRANITE_R2_CONTRACT.corpusFingerprint, model_id: GRANITE_R2_CONTRACT.modelId, revision: GRANITE_R2_CONTRACT.revision,
      dimension: 768, backend: GRANITE_R2_CONTRACT.backend, node_id: "hermes-node", execution_receipt: { status: "COMPLETED" }, network_used: false, container_used: false, external_provider_used: false, fallback_used: false, database_write_performed: false, vector_write_performed: false } }) }
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe("resident HERMES Granite R2 bakeoff", () => {
  it("hard-binds the distinct Granite v1 identity and blocks substitution before claim", () => {
    const value = fixture(); value.admission.model.model_id = "qwen3-embedding:4b"; value.request.admission_sha256 = canonicalDigest(value.admission)
    expect(prepareResidentHermesGraniteR2Bakeoff({ repositoryRoot: value.root, request: value.request, admission: value.admission, evaluatedAt: "2026-08-12T20:00:00.000Z", proveTrustedAdmission: value.proveTrustedAdmission })).toMatchObject({ status: "BLOCKED", reasons: [{ code: "MODEL_BINDING_MISMATCH" }] })
  })

  it.each([
    ["runtime closure", (value: any) => { value.closure_manifest_sha256 = "9".repeat(64) }, "HOST_ATTESTATION_MISMATCH"],
    ["ACL", (value: any) => { value.runtime_acl_sha256 = "9".repeat(64) }, "HOST_ATTESTATION_MISMATCH"],
    ["model", (value: any) => { value.model_artifacts[0].sha256 = "9".repeat(64) }, "MODEL_DRIFT"],
  ])("rejects %s drift before dispatch", async (_name, mutate, code) => {
    const value = runtime(); value.collectTrustedHostAttestation.mockImplementation(async () => { const live: any = attestation(value.admission); mutate(live); delete live.attestation_sha256; live.attestation_sha256 = canonicalDigest(live); return live })
    await expect(executeResidentHermesGraniteR2Bakeoff(value)).rejects.toThrow(code); expect(value.invokeFixedEvaluator).not.toHaveBeenCalled(); expect(value.releaseExclusiveLease).toHaveBeenCalledOnce()
  })

  it("rejects replay and occupied lease before dispatch", async () => {
    const replay = runtime(); replay.claimSingleUse.mockResolvedValue({ claimed: false, claim_id: "granite-r2-claim", claimed_at: "2026-08-12T20:00:00.100Z" })
    await expect(executeResidentHermesGraniteR2Bakeoff(replay)).rejects.toThrow("REQUEST_ALREADY_CONSUMED"); expect(replay.acquireExclusiveLease).not.toHaveBeenCalled()
    const lease = runtime(); lease.acquireExclusiveLease.mockResolvedValue({ acquired: false, lease_id: "granite-r2-lease", fencing_token: 7, acquired_at: "2026-08-12T20:00:00.150Z", stale_lease_recovered: false, stale_lease_sha256: null })
    await expect(executeResidentHermesGraniteR2Bakeoff(lease)).rejects.toThrow("CONCURRENCY_LIMIT_REACHED"); expect(lease.invokeFixedEvaluator).not.toHaveBeenCalled()
  })

  it("binds the exact result and releases the fenced lease", async () => {
    const value = runtime(); const result = await executeResidentHermesGraniteR2Bakeoff(value)
    expect(result).toMatchObject({ status: "COMPLETED", work_order_id: "WO-R1B-EXEC-001", scheduler_activated: false, autonomous_dispatch: false, network_used: false, container_used: false, external_provider_used: false, fallback_used: false, database_write_performed: false, vector_write_performed: false, lease_released: true })
    expect(value.releaseExclusiveLease).toHaveBeenCalledWith({ lease_id: "granite-r2-lease", claim_id: "granite-r2-claim", fencing_token: 7 })
  })

  it("rejects result substitution, network, fallback, and writes", async () => {
    for (const mutate of [(out: any) => { out.dimension = 1024 }, (out: any) => { out.network_used = true }, (out: any) => { out.external_provider_used = true }, (out: any) => { out.database_write_performed = true }, (out: any) => { out.vector_write_performed = true }]) {
      const value = runtime(); const original = value.invokeFixedEvaluator; value.invokeFixedEvaluator = vi.fn(async (...args: any[]) => { const out = await original(...args); mutate(out); return out })
      await expect(executeResidentHermesGraniteR2Bakeoff(value)).rejects.toThrow(/RESULT_BINDING_MISMATCH|FORBIDDEN_SIDE_EFFECT/); expect(value.releaseExclusiveLease).toHaveBeenCalledOnce()
    }
  })

  it("closes over the Granite module and all reviewed execution sources", () => {
    for (const relative of [GRANITE_R2_CONTRACT.graniteModulePath, GRANITE_R2_CONTRACT.collectorPath, GRANITE_R2_CONTRACT.boundedLauncherPath, GRANITE_R2_CONTRACT.runnerPath]) {
      const value = fixture(); fs.appendFileSync(path.join(value.root, relative), "\n# drift\n")
      expect(prepareResidentHermesGraniteR2Bakeoff({ repositoryRoot: value.root, request: value.request, admission: value.admission, evaluatedAt: "2026-08-12T20:00:00.000Z", proveTrustedAdmission: value.proveTrustedAdmission })).toMatchObject({ status: "BLOCKED", reasons: [{ code: "SOURCE_CLOSURE_MISMATCH" }] })
    }
  })

  it("publishes scope only with an empty authority registry", () => {
    const permission = JSON.parse(fs.readFileSync(path.join(process.cwd(), GRANITE_R2_CONTRACT.permissionPath), "utf8")); const registry = JSON.parse(fs.readFileSync(path.join(process.cwd(), GRANITE_R2_CONTRACT.authorityRegistryPath), "utf8"))
    expect(permission).toMatchObject({ provider_identity: "HERMES", maximum_attempts: 1, maximum_concurrency: 1, scheduler_activation_allowed: false, autonomous_dispatch_allowed: false, model_download_allowed: false, network_allowed: false, database_write_allowed: false, vector_write_allowed: false, status: "SCOPE_ONLY_NOT_AUTHORITY" })
    expect(registry.entries).toEqual([])
  })

  it("fails closed when the trusted authority registry has no exact admission", () => {
    const value = fixture()
    const missing = verifyTrustedAuthorityRegistry({ registry: { schema_version: "1.0-hermes-granite-r2-bakeoff-authority-registry", registry_id: "hermes-granite-r2-bakeoff-authorities", entries: [] }, admission: value.admission })
    const mismatchedAdmission = structuredClone(value.admission); mismatchedAdmission.admission_id = "different-granite-admission"
    const mismatched = verifyTrustedAuthorityRegistry({ registry: { schema_version: "1.0-hermes-granite-r2-bakeoff-authority-registry", registry_id: "hermes-granite-r2-bakeoff-authorities", entries: [mismatchedAdmission] }, admission: value.admission })
    expect(missing).toEqual({ exact_entry_count: 0, verified: false })
    expect(mismatched).toEqual({ exact_entry_count: 0, verified: false })
  })

  it("rejects malformed or mismatched authority registry identity", () => {
    const value = fixture()
    expect(() => verifyTrustedAuthorityRegistry({ registry: { schema_version: "1.0-hermes-granite-r2-bakeoff-authority-registry", registry_id: "wrong", entries: [] }, admission: value.admission })).toThrow("authority registry is invalid")
    expect(() => verifyTrustedAuthorityRegistry({ registry: { schema_version: "1.0-hermes-granite-r2-bakeoff-authority-registry", registry_id: "hermes-granite-r2-bakeoff-authorities" }, admission: value.admission })).toThrow("authority registry is invalid")
  })

  it("durably rejects the same admission under a different request id", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "granite-r2-claim-")); roots.push(root)
    const admissionSha256 = "a".repeat(64)
    const first = await claimSingleUseAtRoot(root, { request_id: "request-one", request_sha256: "b".repeat(64), admission_sha256: admissionSha256, maximum_attempts: 1 })
    const replay = await claimSingleUseAtRoot(root, { request_id: "request-two", request_sha256: "c".repeat(64), admission_sha256: admissionSha256, maximum_attempts: 1 })
    expect(first).toMatchObject({ claimed: true, claim_id: `claim-${admissionSha256}` })
    expect(replay).toMatchObject({ claimed: false, claim_id: first.claim_id })
    expect(fs.readdirSync(root).filter((name) => name.startsWith("claim-"))).toHaveLength(1)
  })
})
