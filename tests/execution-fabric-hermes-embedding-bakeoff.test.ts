import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  EMBEDDING_CONTRACT,
  executeResidentHermesEmbeddingBakeoff,
  prepareResidentHermesEmbeddingBakeoff,
} from "../scripts/execution-fabric/bounded-dispatch/resident-hermes-embedding-bakeoff.mjs"

function sha256(value: string | Buffer | Uint8Array) {
  return crypto.createHash("sha256").update(value).digest("hex")
}
function canonicalDigest(value: unknown) { return sha256(canonicalizeJcs(value)) }

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-embedding-adapter-"))
  const copy = (relativePath: string) => {
    const destination = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(process.cwd(), relativePath), destination)
  }
  copy(EMBEDDING_CONTRACT.corpusManifestPath)
  copy(EMBEDDING_CONTRACT.permissionPath)
  const evaluator = Buffer.from("# reviewed fixture evaluator\n", "utf8")
  const evaluatorPath = path.join(root, EMBEDDING_CONTRACT.evaluatorPath)
  fs.mkdirSync(path.dirname(evaluatorPath), { recursive: true })
  fs.writeFileSync(evaluatorPath, evaluator)
  const permissionSha256 = sha256(fs.readFileSync(path.join(root, EMBEDDING_CONTRACT.permissionPath)))
  const admission: any = {
    schema_version: "1.0-hermes-embedding-bakeoff-admission",
    admission_id: "issue-704-granite-test-admission",
    work_order_id: EMBEDDING_CONTRACT.workOrderId,
    source_commit: EMBEDDING_CONTRACT.sourceCommit,
    corpus: {
      manifest_path: EMBEDDING_CONTRACT.corpusManifestPath,
      manifest_sha256: EMBEDDING_CONTRACT.corpusManifestSha256,
      corpus_id: EMBEDDING_CONTRACT.corpusId,
      corpus_fingerprint: EMBEDDING_CONTRACT.corpusFingerprint,
      documents: 49,
      queries: 80,
    },
    model: {
      model_id: "granite-embedding:278m-multilingual",
      revision: "r2",
      weights_sha256: "1".repeat(64),
      license: "Apache-2.0",
      source: "ollama-library",
      manifest_sha256: "2".repeat(64),
    },
    runtime: {
      runtime_id: "ollama",
      version: "0.11.4",
      executable_sha256: "3".repeat(64),
      evaluator_sha256: sha256(evaluator),
      manifest_sha256: "4".repeat(64),
    },
    placement: {
      node_id: EMBEDDING_CONTRACT.nodeId,
      inventory_snapshot_sha256: "5".repeat(64),
      host_manifest_sha256: "6".repeat(64),
      endpoint_contract: "ollama-loopback-api-embed-v1",
    },
    limits: {
      timeout_ms: 60_000,
      max_cpu_pct: 90,
      max_gpu_vram_bytes: 6_442_450_944,
      max_ram_bytes: 34_359_738_368,
      max_scratch_bytes: 536_870_912,
      max_result_bytes: 8_388_608,
      network_scope: "loopback-only",
    },
    permission_set_sha256: permissionSha256,
    valid_from: "2026-08-12T20:00:00.000Z",
    expires_at: "2026-08-12T21:00:00.000Z",
    maximum_attempts: 1,
    status: "ADMITTED_SINGLE_USE",
  }
  const request: any = {
    schema_version: "1.0-hermes-embedding-bakeoff-request",
    request_id: "issue-704-granite-test-run",
    admission_sha256: canonicalDigest(admission),
  }
  const proveTrustedAdmission = ({ admissionSha256, admission: admitted }: any) => ({
    schema_version: "1.0-trusted-hermes-embedding-admission-proof",
    admission_sha256: admissionSha256,
    source_commit: EMBEDDING_CONTRACT.sourceCommit,
    inventory_snapshot_sha256: admitted.placement.inventory_snapshot_sha256,
    exact_entry_count: 1,
    verified: true,
  })
  return { repositoryRoot: root, request, admission, proveTrustedAdmission }
}

function attestation(admission: any) {
  const value: any = {
    schema_version: "1.0-trusted-hermes-embedding-host-attestation",
    collector_id: "trusted-resident-hermes-collector",
    node_id: EMBEDDING_CONTRACT.nodeId,
    machine_id_sha256: "7".repeat(64),
    inventory_snapshot_sha256: admission.placement.inventory_snapshot_sha256,
    host_manifest_sha256: admission.placement.host_manifest_sha256,
    model_id: admission.model.model_id,
    weights_sha256: admission.model.weights_sha256,
    runtime_id: admission.runtime.runtime_id,
    runtime_version: admission.runtime.version,
    runtime_executable_sha256: admission.runtime.executable_sha256,
    endpoint: EMBEDDING_CONTRACT.endpoint,
    observed_at: "2026-08-12T20:00:00.150Z",
    expires_at: "2026-08-12T20:05:00.000Z",
    verified: true,
  }
  value.attestation_sha256 = canonicalDigest(value)
  return value
}

function output(admission: any) {
  const resultBytes = Buffer.from('{"summary":{"recall@5":1},"per_query":[]}\n', "utf8")
  return {
    result_bytes: resultBytes,
    result_sha256: sha256(resultBytes),
    model_manifest_sha256: admission.model.manifest_sha256,
    runtime_manifest_sha256: admission.runtime.manifest_sha256,
    host_manifest_sha256: admission.placement.host_manifest_sha256,
    corpus_fingerprint: EMBEDDING_CONTRACT.corpusFingerprint,
    model_id: admission.model.model_id,
    runtime_id: admission.runtime.runtime_id,
    node_id: EMBEDDING_CONTRACT.nodeId,
    endpoint: EMBEDDING_CONTRACT.endpoint,
    external_provider_used: false,
    fallback_used: false,
    canonical_vectors_written: false,
    database_mutated: false,
  }
}

function runtime(value = fixture()) {
  const times = ["2026-08-12T20:00:00.000Z", "2026-08-12T20:00:00.200Z", "2026-08-12T20:00:01.000Z"]
  return {
    ...value,
    clock: () => times.shift()!,
    claimSingleUse: vi.fn(async () => ({ claimed: true, claim_id: "claim-issue-704-test", claimed_at: "2026-08-12T20:00:00.100Z" })),
    acquireExclusiveLease: vi.fn(async () => ({ acquired: true, lease_id: "lease-issue-704-test", fencing_token: 1, acquired_at: "2026-08-12T20:00:00.150Z" })),
    releaseExclusiveLease: vi.fn(async () => true),
    collectTrustedHostAttestation: vi.fn(async () => attestation(value.admission)),
    invokeFixedEvaluator: vi.fn(async () => output(value.admission)),
  }
}

describe("resident HERMES embedding bake-off adapter", () => {
  it("prepares only the fixed corpus, source, node, permission, and single-use envelope", () => {
    expect(prepareResidentHermesEmbeddingBakeoff({ ...fixture(), evaluatedAt: "2026-08-12T20:00:00.000Z" })).toMatchObject({
      status: "READY_FOR_SINGLE_USE_CLAIM",
      work_order_id: "WO-R1B-EXEC-001",
      source_commit: "d544f19708e4aa9c7f430c3cc9fde4ff0f5c1b85",
      corpus_manifest_sha256: "0b0fdf909583990975a771195c7f7a8b6e5e938f01800369b1d6cf9fb5ca7dee",
      node_id: "hermes-node",
      endpoint_contract: "ollama-loopback-api-embed-v1",
      maximum_attempts: 1,
      maximum_concurrency: 1,
      scheduler_activated: false,
      autonomous_dispatch: false,
      fallback_allowed: false,
      external_provider_allowed: false,
    })
  })

  it.each([
    ["caller URL", (value: any) => { value.request.url = "http://example.test" }, "CALLER_CONTROLLED_CAPABILITY"],
    ["caller command", (value: any) => { value.request.command = "python evil.py" }, "CALLER_CONTROLLED_CAPABILITY"],
    ["caller host", (value: any) => { value.request.host_identity = "other-host" }, "CALLER_CONTROLLED_CAPABILITY"],
    ["caller output", (value: any) => { value.request.output_path = "C:/elsewhere/result.json" }, "CALLER_CONTROLLED_CAPABILITY"],
  ])("blocks %s", (_name, mutate, code) => {
    const value = fixture(); mutate(value)
    expect(prepareResidentHermesEmbeddingBakeoff({ ...value, evaluatedAt: "2026-08-12T20:00:00.000Z" })).toMatchObject({ status: "BLOCKED", reasons: [{ code }] })
  })

  it.each([
    ["source commit", (value: any) => { value.admission.source_commit = "a".repeat(40) }, "ADMISSION_INVALID"],
    ["corpus fingerprint", (value: any) => { value.admission.corpus.corpus_fingerprint = "f".repeat(64) }, "CORPUS_BINDING_MISMATCH"],
    ["node", (value: any) => { value.admission.placement.node_id = "omen" }, "PLACEMENT_BINDING_MISMATCH"],
    ["network", (value: any) => { value.admission.limits.network_scope = "lan" }, "NETWORK_SCOPE_INVALID"],
    ["attempt count", (value: any) => { value.admission.maximum_attempts = 2 }, "ADMISSION_INVALID"],
  ])("fails closed on changed %s binding", (_name, mutate, code) => {
    const value = fixture(); mutate(value); value.request.admission_sha256 = canonicalDigest(value.admission)
    expect(prepareResidentHermesEmbeddingBakeoff({ ...value, evaluatedAt: "2026-08-12T20:00:00.000Z" })).toMatchObject({ status: "BLOCKED", reasons: [{ code }] })
  })

  it("executes one claim and one fenced lease with exact result bindings", async () => {
    const value = runtime()
    const result = await executeResidentHermesEmbeddingBakeoff(value)
    expect(value.claimSingleUse).toHaveBeenCalledTimes(1)
    expect(value.acquireExclusiveLease).toHaveBeenCalledTimes(1)
    expect(value.invokeFixedEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "http://127.0.0.1:11434/api/embed",
      evaluator_path: "scripts/embedding-bakeoff/fabric_measure.py",
    }))
    expect(value.releaseExclusiveLease).toHaveBeenCalledWith({ lease_id: "lease-issue-704-test", claim_id: "claim-issue-704-test", fencing_token: 1 })
    expect(result).toMatchObject({ status: "COMPLETED", result: "SUCCEEDED", lease_released: true, scheduler_activated: false, autonomous_dispatch: false, external_provider_used: false, fallback_used: false, canonical_vectors_written: false, database_mutated: false })
    expect(result.attestation_sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rejects replay before lease or evaluator invocation", async () => {
    const value = runtime()
    value.claimSingleUse.mockResolvedValue({ claimed: false, claim_id: "claim-replayed", claimed_at: "2026-08-12T20:00:00.100Z" })
    await expect(executeResidentHermesEmbeddingBakeoff(value)).rejects.toThrow("REQUEST_ALREADY_CONSUMED")
    expect(value.acquireExclusiveLease).not.toHaveBeenCalled()
    expect(value.invokeFixedEvaluator).not.toHaveBeenCalled()
  })

  it("rejects occupied or incorrectly fenced leases before host collection", async () => {
    for (const lease of [
      { acquired: false, lease_id: "lease-occupied", fencing_token: 1, acquired_at: "2026-08-12T20:00:00.150Z" },
      { acquired: true, lease_id: "lease-wrong-fence", fencing_token: 2, acquired_at: "2026-08-12T20:00:00.150Z" },
    ]) {
      const value = runtime(); value.acquireExclusiveLease.mockResolvedValue(lease)
      await expect(executeResidentHermesEmbeddingBakeoff(value)).rejects.toThrow(lease.acquired ? "LEASE_FENCE_MISMATCH" : "CONCURRENCY_LIMIT_REACHED")
      expect(value.collectTrustedHostAttestation).not.toHaveBeenCalled()
      expect(value.releaseExclusiveLease).toHaveBeenCalledTimes(lease.acquired ? 1 : 0)
    }
  })

  it("releases the lease after host-attestation or evaluator failure", async () => {
    const badHost = runtime()
    badHost.collectTrustedHostAttestation.mockImplementation(async () => ({ ...attestation(badHost.admission), node_id: "omen" }))
    await expect(executeResidentHermesEmbeddingBakeoff(badHost)).rejects.toMatchObject({ message: expect.stringContaining("HOST_ATTESTATION_MISMATCH"), dispatchAttempted: false, leaseReleased: true })
    expect(badHost.releaseExclusiveLease).toHaveBeenCalledTimes(1)

    const evaluatorFailure = runtime()
    evaluatorFailure.invokeFixedEvaluator.mockRejectedValue(new Error("offline evaluator failure"))
    await expect(executeResidentHermesEmbeddingBakeoff(evaluatorFailure)).rejects.toMatchObject({ dispatchAttempted: true, leaseReleased: true })
    expect(evaluatorFailure.releaseExclusiveLease).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["external provider", (result: any) => { result.external_provider_used = true }],
    ["fallback", (result: any) => { result.fallback_used = true }],
    ["database mutation", (result: any) => { result.database_mutated = true }],
    ["canonical vectors", (result: any) => { result.canonical_vectors_written = true }],
    ["model drift", (result: any) => { result.model_id = "qwen3-embedding:4b" }],
    ["runtime drift", (result: any) => { result.runtime_id = "other-runtime" }],
    ["host drift", (result: any) => { result.node_id = "omen" }],
    ["endpoint drift", (result: any) => { result.endpoint = "http://127.0.0.1:11435/api/embed" }],
  ])("fails closed on evaluator-reported %s", async (_name, mutate) => {
    const value = runtime()
    value.invokeFixedEvaluator.mockImplementation(async () => { const result = output(value.admission); mutate(result); return result })
    await expect(executeResidentHermesEmbeddingBakeoff(value)).rejects.toThrow(/FORBIDDEN_SIDE_EFFECT|RESULT_BINDING_MISMATCH/)
    expect(value.releaseExclusiveLease).toHaveBeenCalledTimes(1)
  })

  it("rejects non-monotonic chronology and an unconfirmed lease release", async () => {
    const chronology = runtime()
    chronology.acquireExclusiveLease.mockResolvedValue({ acquired: true, lease_id: "lease-time", fencing_token: 1, acquired_at: "2026-08-12T20:00:00.050Z" })
    await expect(executeResidentHermesEmbeddingBakeoff(chronology)).rejects.toThrow("CLAIM_LEASE_CHRONOLOGY_INVALID")

    const release = runtime(); release.releaseExclusiveLease.mockResolvedValue(false)
    await expect(executeResidentHermesEmbeddingBakeoff(release)).rejects.toMatchObject({ message: expect.stringContaining("LEASE_RELEASE_FAILED"), dispatchAttempted: true, leaseReleased: false })
  })

  it("keeps the production runner fixed, zero-argument, loopback-only, and evaluator-only", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/execution-fabric/bounded-dispatch/run-resident-hermes-embedding-bakeoff.mjs"), "utf8")
    expect(source).toContain('const EVALUATOR_PATH = path.join(REPOSITORY_ROOT, EMBEDDING_CONTRACT.evaluatorPath)')
    expect(source).toContain('endpoint: "http://127.0.0.1:11434/api/embed"')
    expect(source).toContain('process.argv.length !== 2')
    expect(source.match(/spawnSync\(/g)).toHaveLength(1)
    expect(source).toContain('spawnSync(PYTHON_EXECUTABLE, [EVALUATOR_PATH')
    expect(source).not.toMatch(/process\.env|https:\/\/|\/api\/generate|child_process\.exec|execSync|fetch\(/)
  })

  it("publishes scope only and cannot activate authority, scheduling, fallback, downloads, or writes", () => {
    const permission = JSON.parse(fs.readFileSync(path.join(process.cwd(), EMBEDDING_CONTRACT.permissionPath), "utf8"))
    expect(permission).toMatchObject({ maximum_attempts: 1, maximum_concurrency: 1, scheduler_activation_allowed: false, autonomous_dispatch_allowed: false, fallback_allowed: false, external_provider_allowed: false, status: "SCOPE_ONLY_NOT_AUTHORITY" })
    expect(permission.prohibited_actions).toEqual(expect.arrayContaining(["authority-mutation", "model-download", "canonical-vector-write", "database-mutation", "external-provider-access", "silent-fallback"]))
  })
})
