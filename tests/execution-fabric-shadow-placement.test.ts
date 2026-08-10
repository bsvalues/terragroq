import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

import { runShadowPlacementCli } from "../scripts/execution-fabric/evaluate-shadow-placement.mjs"
import { runPinnedPlacementCli } from "../scripts/execution-fabric/recommend-pinned-placement.mjs"

type JsonObject = Record<string, any>

const evaluatedAt = "2026-08-10T07:00:00.000Z"
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const temporaryRoots: string[] = []
const workloadCatalogBytes = fs.readFileSync(path.join(repositoryRoot, "config/execution-fabric/placement-workloads.json"))
const workloadCatalog = JSON.parse(workloadCatalogBytes.toString("utf8")) as JsonObject
const decisionWorkload = workloadCatalog.workloads.find((workload: JsonObject) => workload.id === "cpu-heavy-build")
const testPython = process.platform === "win32" ? "py" : "python3"
const verifierPath = path.join(repositoryRoot, "scripts/execution-fabric/verify_snapshot.py")
const registryPath = path.join(repositoryRoot, "config/execution-fabric/registry.seed.json")
const schemaPath = path.join(repositoryRoot, "config/execution-fabric/registry.schema.json")
const policyPath = path.join(repositoryRoot, "config/execution-fabric/pinned-evidence-policy.json")
const workloadsSourcePath = path.join(repositoryRoot, "config/execution-fabric/placement-workloads.json")
const pinHelper = path.join(repositoryRoot, "tests/fixtures/execution-fabric/pin_test_snapshot.py")

function phaseOneFeeds(): Record<string, JsonObject> {
  return {
    "hermes-node": {
      schema: "hermes-placement-readiness/1", canonicalization: "jcs-rfc8785/1", node: "hermes-node",
      observed_at: "2026-08-10T06:55:42Z", scheduler: "OFF",
      resources: {
        cpu_cores: 8, cpu_threads: 16, cpu_load_pct: 25, ram_total_gb: 31.9, ram_free_gb: 19.4,
        c_free_gb: 311.9, d_free_gb: 106.3, workspace_free_gb: 311.9, docker: "v28.5.1",
        gpus: [{ name: "NVIDIA GeForce RTX 3050", vram_total_mb: 6144, vram_free_mb: 5279, vram_used_mb: 724, util_pct: 15, temp_c: 28 }],
        ollama: "running", running_workloads: ["ollama", "open-webui", "portainer"],
      },
      node_health: "OK", compute_capability_health: "READY", gpu_inference_capability_health: "READY",
      gpu_reason: "OK", local_llm_capability_health: "READY", local_llm_reason: "OK",
      limits: {
        min_free_ram_gb: 4, min_free_disk_gb: 20, gpu_vram_headroom_mb: 1024, max_concurrent_ai_jobs: 1,
        inference_fail_closed_when: ["no GPU/driver"], do_not_fail_node_when: ["GPU busy/hot"],
      },
      model_inventory: [{
        name: "llama3.2:3b", id: "a80c4f17acd5", size_gb: 2, params: "3b", quantization: "default(~q4)",
        est_vram_mb: 2048, fits_gpu: true, preferred_path: "gpu", latency_class: "low", task_class: "general-lightweight-llm",
      }],
      workload_classes: { ready: ["local-llm-inference", "gpu-batch", "agent-runtime", "model-evaluation"], pending_or_reject: ["authoritative-state"] },
    },
    atlas: {
      schema: "atlas-placement-readiness/1", canonicalization: "jcs-rfc8785/1", node: "atlas",
      observed_at: "2026-08-10T06:58:20Z", scheduler: "OFF",
      resources: {
        cores: 28, load1: "0.05", ram_total_mb: 32007, ram_avail_pct: 96, root_free_gb: 638,
        forge: "mounted", forge_free_gb: 3156, forge_smart: "PASSED", io_pressure_avg10: "0.33",
        cpu_pressure_avg10: "0.00", nic: "up@1000Mb", postgres: "ready", mongo: "ready", redis: "running",
      },
      node_health: "OK", state_capability_health: "READY", state_reason: "OK",
      retrieval_capability_health: "READY", retrieval_reason: "OK", storage_capability_health: "READY", storage_reason: "OK",
      thresholds: { min_ram_headroom_pct: 15, min_forge_free_gb: 100, io_pressure_cutoff: 25, max_load_for_optional: 19.6 },
      placement_constraints: ["retains authoritative durable state", "DB latency + storage health take priority"],
      workload_classes: { ready_with_headroom: ["retrieval-index-read", "db-backed-query", "state-read"], disfavored: ["noisy-unbounded-cpu-batch"], reject: ["county-production-writes"] },
    },
    aegis: {
      schema: "aegis-capability/1", canonicalization: "jcs-rfc8785/1", node: "aegis",
      observed_at: "2026-08-10T06:59:09Z", timestamp: "2026-08-10T06:59:09+00:00", status: "warn",
      root_avail_gb: 1747, root_use_pct: 1, docker_active: "active", docker_disk: "Images=786.2MB",
      portainer_agent: "running", load1: "0.02", cores: 28, cpu_temp_c: "36", ram_total_mb: 15906,
      ram_avail_pct: 94, smart: "sda=PASSED", nic: "up@1000Mb", storage_role: "backup-ready",
      node_health: "WARN", compute_capability_health: "READY", backup_capability_health: "READY",
      archive_capability_health: "READY", backup_reason: "OK", scheduler: "OFF",
      backup: { last_backup: "20260810T061501Z", last_restore_verify: "20260810T061501Z", age_hours: "0.7", capability: "READY", reason: "OK", threshold_hours: 48 },
      issues: "sdb ABSENT_OR_PHANTOM",
    },
  }
}

const phaseOneRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-shadow-phase1-"))
temporaryRoots.push(phaseOneRoot)
const phaseOneSnapshotRoot = path.join(phaseOneRoot, "snapshots")
const phaseOneReferences: Record<string, string> = {}
for (const [node, feed] of Object.entries(phaseOneFeeds())) {
  const feedPath = path.join(phaseOneRoot, `${node}.json`)
  fs.writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`)
  const pinned = spawnSync(testPython, [pinHelper, feedPath, phaseOneSnapshotRoot], { encoding: "utf8", windowsHide: true })
  if (pinned.status !== 0) throw new Error(`shadow test snapshot pin failed: ${pinned.stderr || pinned.stdout}`)
  phaseOneReferences[node] = pinned.stdout.trim()
}
const trustedPhaseOneReceipt = runPinnedPlacementCli([
  "--snapshot-root", phaseOneSnapshotRoot, "--verifier", verifierPath, "--python", testPython,
  "--registry", registryPath, "--schema", schemaPath, "--policy", policyPath,
  "--workloads", workloadsSourcePath, "--workload", "cpu-heavy-build", "--at", evaluatedAt,
  "--evidence", `hermes-node=${phaseOneReferences["hermes-node"]}`,
  "--evidence", `atlas=${phaseOneReferences.atlas}`,
  "--evidence", `aegis=${phaseOneReferences.aegis}`,
]) as JsonObject
if (trustedPhaseOneReceipt.status !== "RECOMMENDED") throw new Error("trusted Phase 1 shadow fixture was not recommended")

function phaseOneReceipt(): JsonObject {
  return structuredClone(trustedPhaseOneReceipt)
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function phaseOneDecisionInputSha256(receipt: JsonObject): string {
  return crypto.createHash("sha256").update(canonicalJson({
    workload: { ...decisionWorkload, ...receipt.workload },
    evidence_snapshot: receipt.evidence_snapshot,
    placement_policy_version: receipt.placement_policy_version,
    evaluated_at: receipt.evaluated_at,
    input_artifacts: receipt.input_artifacts,
    verifier_contract: receipt.evidence_verifier.contract,
  })).digest("hex")
}

function observation(receiptSha256: string, overrides: JsonObject = {}): JsonObject {
  const base = {
    schema_version: "0.1-shadow-placement-observation",
    observation_id: "shadow-observation-001",
    work_order_id: "WO-EF-PLACEMENT-001",
    observed_at: "2026-08-10T07:01:00.000Z",
    placement_receipt_sha256: receiptSha256,
    actual_target: {
      status: "RECORDED",
      node_id: "aegis",
      selection_source: "operator-selected",
      outcome_ref: "shadow-outcome-001",
      latency_ms: 120,
    },
    divergence: { status: "MATCH", reason_code: null, explanation: null },
  }
  return { ...base, ...overrides }
}

function fixture(receipt = phaseOneReceipt(), makeObservation?: (sha256: string) => JsonObject) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-shadow-placement-"))
  temporaryRoots.push(root)
  const workloadsPath = path.join(root, "placement-workloads.json")
  fs.writeFileSync(workloadsPath, workloadCatalogBytes)
  const receiptPath = path.join(root, "receipt.json")
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)
  fs.writeFileSync(receiptPath, receiptBytes)
  const receiptSha256 = crypto.createHash("sha256").update(receiptBytes).digest("hex")
  const observationPath = path.join(root, "observation.json")
  fs.writeFileSync(observationPath, `${JSON.stringify(makeObservation?.(receiptSha256) ?? observation(receiptSha256), null, 2)}\n`)
  return { root, receiptPath, observationPath, workloadsPath, receiptSha256 }
}

function run(value: ReturnType<typeof fixture>) {
  return runShadowPlacementCli([
    "--receipt", value.receiptPath,
    "--observation", value.observationPath,
    "--snapshot-root", phaseOneSnapshotRoot,
    "--verifier", verifierPath,
    "--python", testPython,
    "--registry", registryPath,
    "--schema", schemaPath,
    "--policy", policyPath,
    "--workloads", value.workloadsPath,
  ]) as JsonObject
}

afterAll(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true })
})

function expectSafety(result: JsonObject) {
  expect(result).toMatchObject({
    shadow_only: true,
    dispatch_allowed: false,
    execution_authorized: false,
    remote_systems_modified: false,
  })
}

function expectRejected(result: JsonObject, detail?: RegExp) {
  expect(result.status).toBe("INPUT_REJECTED")
  expectSafety(result)
  expect(result.error).toEqual(expect.objectContaining({ code: expect.any(String), detail: expect.any(String) }))
  if (detail) expect(result.error.detail).toMatch(detail)
}

describe("Execution Fabric Phase 2 shadow placement", () => {
  it("is deterministically replayable from the exact receipt and observation bytes", () => {
    const value = fixture()
    const first = run(value)
    const second = run(value)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      status: "SHADOW_MATCH",
      observation_id: "shadow-observation-001",
      work_order_id: "WO-EF-PLACEMENT-001",
      placement_receipt_sha256: value.receiptSha256,
    })
    expectSafety(first)
  })

  it("records an explained divergence without turning it into dispatch authority", () => {
    const value = fixture(phaseOneReceipt(), (sha256) => observation(sha256, {
      observed_at: "2026-08-10T07:00:30.000Z",
      actual_target: {
        status: "RECORDED", node_id: "hermes-node", selection_source: "known-safe",
        outcome_ref: "shadow-outcome-002", latency_ms: 215,
      },
      divergence: {
        status: "DIVERGED", reason_code: "OPERATOR_KNOWN_SAFE_OVERRIDE",
        explanation: "The known-safe target was selected for an already-running local build observation.",
      },
    }))

    expect(run(value)).toMatchObject({ status: "SHADOW_DIVERGENCE", shadow_only: true })
    expectSafety(run(value))
  })

  it("records that real work was not run and makes no placement-quality claim", () => {
    const value = fixture(phaseOneReceipt(), (sha256) => observation(sha256, {
      actual_target: {
        status: "NOT_RUN", node_id: null, selection_source: "none", outcome_ref: null, latency_ms: null,
      },
      divergence: {
        status: "NOT_COMPARABLE", reason_code: null, explanation: null,
      },
    }))

    const result = run(value)
    expect(result.status).toBe("SHADOW_NOT_RUN")
    expectSafety(result)
  })

  it("rejects a receipt-hash mismatch and a receipt changed after observation", () => {
    const mismatch = fixture(phaseOneReceipt(), () => observation("f".repeat(64)))
    expectRejected(run(mismatch), /receipt|sha256|digest|hash/i)

    const tampered = fixture()
    const changed = JSON.parse(fs.readFileSync(tampered.receiptPath, "utf8"))
    changed.recommendation.node_id = "hermes-node"
    fs.writeFileSync(tampered.receiptPath, `${JSON.stringify(changed, null, 2)}\n`)
    expectRejected(run(tampered), /receipt|sha256|digest|hash|rank|recommend/i)
  })

  it("rejects a coherently rewritten recommendation through trusted Phase 1 replay", () => {
    const forged = phaseOneReceipt()
    const aegis = forged.eligible_nodes.find((candidate: JsonObject) => candidate.node_id === "aegis")
    const hermes = forged.eligible_nodes.find((candidate: JsonObject) => candidate.node_id === "hermes-node")
    aegis.rank = 2
    hermes.rank = 1
    forged.recommendation.node_id = "hermes-node"
    forged.recommendation.rank = 1

    const value = fixture(forged, (sha256) => observation(sha256, {
      observed_at: "2026-08-10T07:00:30.000Z",
      actual_target: {
        status: "RECORDED", node_id: "hermes-node", selection_source: "operator-selected",
        outcome_ref: "shadow-outcome-forged-recommendation", latency_ms: 120,
      },
    }))
    expectRejected(run(value), /trusted Phase 1 replay|authenticate|exactly match/i)
  })

  it("rejects an observation at or after the selected evidence expiry", () => {
    const value = fixture(phaseOneReceipt(), (sha256) => observation(sha256, {
      observed_at: "2026-08-10T07:04:09.000Z",
    }))
    const result = run(value)
    expectRejected(result, /expired|stale|evidence/i)
    expect(result.stale_evidence).toBe(true)
  })

  it("rejects malformed input and a Phase 1 receipt that did not recommend a target", () => {
    const malformed = fixture(phaseOneReceipt(), (sha256) => ({
      ...observation(sha256), schema_version: "unexpected-shadow-schema",
    }))
    expectRejected(run(malformed), /schema/i)

    for (const status of ["INPUT_REJECTED", "NO_ELIGIBLE_NODE"]) {
      const receipt = phaseOneReceipt()
      receipt.status = status
      receipt.recommendation = null
      expectRejected(run(fixture(receipt)), /receipt|recommend|status/i)
    }
  })

  it("rejects any dispatch-enabled or execution-authorized Phase 1 receipt", () => {
    for (const mutate of [
      (receipt: JsonObject) => { receipt.recommendation.dispatch_allowed = true },
      (receipt: JsonObject) => { receipt.recommendation.execution_authorized = true },
      (receipt: JsonObject) => { receipt.scheduler.state = "enabled" },
      (receipt: JsonObject) => { receipt.scheduler.authority = "granted" },
    ]) {
      const receipt = phaseOneReceipt()
      mutate(receipt)
      expectRejected(run(fixture(receipt)), /authori|dispatch|execution|scheduler/i)
    }
  })

  it("rejects an unexplained mismatch rather than silently treating it as fallback", () => {
    const value = fixture(phaseOneReceipt(), (sha256) => observation(sha256, {
      observed_at: "2026-08-10T07:00:30.000Z",
      actual_target: {
        status: "RECORDED", node_id: "hermes-node", selection_source: "operator-selected",
        outcome_ref: "shadow-outcome-003", latency_ms: 180,
      },
      divergence: { status: "MATCH", reason_code: null, explanation: null },
    }))

    expectRejected(run(value), /diverg|mismatch|explanation|match/i)

    const falseDivergence = fixture(phaseOneReceipt(), (sha256) => observation(sha256, {
      actual_target: {
        status: "RECORDED", node_id: "aegis", selection_source: "operator-selected",
        outcome_ref: "shadow-outcome-003b", latency_ms: 180,
      },
      divergence: {
        status: "DIVERGED", reason_code: "FALSE_DIVERGENCE_CLAIM",
        explanation: "The observation claims divergence while running on the recommended node.",
      },
    }))

    expectRejected(run(falseDivergence), /diverg|match|recommended/i)
  })

  it("fails closed when the actual target was authority-ineligible or stale in the pinned receipt", () => {
    const authorityViolation = fixture(phaseOneReceipt(), (sha256) => observation(sha256, {
      actual_target: {
        status: "RECORDED", node_id: "atlas", selection_source: "operator-selected",
        outcome_ref: "shadow-outcome-004", latency_ms: 75,
      },
      divergence: {
        status: "DIVERGED", reason_code: "AUTHORITY_EXCEPTION_ATTEMPTED",
        explanation: "Observed selection conflicts with the receipt's authority exclusion.",
      },
    }))
    const authorityResult = run(authorityViolation)
    expectRejected(authorityResult, /authority|ineligible|actual target/i)
    expect(authorityResult.authority_violation).toBe(true)

    const staleTarget = fixture(phaseOneReceipt(), (sha256) => observation(sha256, {
      actual_target: {
        status: "RECORDED", node_id: "omen", selection_source: "known-safe",
        outcome_ref: "shadow-outcome-005", latency_ms: 91,
      },
      divergence: {
        status: "DIVERGED", reason_code: "STALE_TARGET_OBSERVED",
        explanation: "The observed target had stale evidence in the pinned receipt.",
      },
    }))
    const staleResult = run(staleTarget)
    expectRejected(staleResult, /stale|ineligible|actual target/i)
    expect(staleResult.stale_evidence).toBe(true)
  })

  it("rejects executable, credential-like, and secret-like fields anywhere in observation input", () => {
    for (const [field, value] of [
      ["command", "ssh aegis build"],
      ["shell", "powershell.exe"],
      ["api_key", "not-a-real-key"],
      ["authorization", "Bearer not-a-real-token"],
      ["secret", "not-a-real-secret"],
    ]) {
      const candidate = fixture(phaseOneReceipt(), (sha256) => ({ ...observation(sha256), [field]: value }))
      expectRejected(run(candidate), /field|secret|credential|executable|additional|allowed/i)
    }
  })

  it("rejects receipt shape tampering even when the observation pins the changed bytes", () => {
    const receipt = phaseOneReceipt()
    receipt.recommendation.untrusted_execution_adapter = { command: "run" }
    const value = fixture(receipt)

    expectRejected(run(value), /receipt|field|execution|shape|additional/i)
  })

  it("rejects rehashed receipts that claim authority or remote mutation", () => {
    for (const [field, changed] of [
      ["authority_mutated", true],
      ["remote_systems_modified", true],
    ] as const) {
      const receipt = phaseOneReceipt()
      receipt[field] = changed
      const result = run(fixture(receipt))
      expectRejected(result, /authority|remote|modified|mutation|receipt/i)
      expectSafety(result)
    }
  })

  it("rejects rehashed receipts with untrusted verifier results or malformed verifier digests", () => {
    const failedVerifier = phaseOneReceipt()
    failedVerifier.evidence_verifier.result = "FAIL"
    expectRejected(run(fixture(failedVerifier)), /verifier|result|pass/i)

    for (const invalidDigest of ["f".repeat(63), "G".repeat(64)]) {
      const malformedVerifier = phaseOneReceipt()
      malformedVerifier.evidence_verifier.sha256 = invalidDigest
      expectRejected(run(fixture(malformedVerifier)), /verifier|sha256|digest/i)
    }
  })

  it("rejects rehashed receipts whose selected or eligible candidates are stale", () => {
    const selectedStale = phaseOneReceipt()
    selectedStale.eligible_nodes[0].freshness.state = "stale"
    expectRejected(run(fixture(selectedStale)), /stale|freshness|eligible|recommend/i)

    const otherEligibleStale = phaseOneReceipt()
    otherEligibleStale.eligible_nodes[1].freshness.state = "stale"
    expectRejected(run(fixture(otherEligibleStale)), /stale|freshness|eligible/i)
  })

  it("rejects rehashed receipts that classify authority-rejected candidates as eligible", () => {
    for (const reasonCode of ["AUTHORITY_REQUIRED", "AUTHORITY_EXCLUDED", "AUTHORITY_DENIED"]) {
      const receipt = phaseOneReceipt()
      receipt.eligible_nodes[1].reasons = [{ code: reasonCode, detail: "authority contradiction" }]
      expectRejected(run(fixture(receipt)), /authority|eligible|reason|candidate/i)
    }
  })

  it("rejects inconsistent recommendation ranks and duplicate eligible ranks", () => {
    const inconsistent = phaseOneReceipt()
    inconsistent.recommendation.rank = 2
    expectRejected(run(fixture(inconsistent)), /rank|recommend/i)

    const duplicate = phaseOneReceipt()
    duplicate.eligible_nodes[1].rank = 1
    expectRejected(run(fixture(duplicate)), /rank|duplicate|eligible/i)
  })

  it("rejects secret-like values in permitted fields without reflecting them in results", () => {
    const githubToken = `ghp_${"A".repeat(36)}`
    const privateKey = "-----BEGIN PRIVATE KEY-----\\nnot-real-key-material\\n-----END PRIVATE KEY-----"
    const credentialedDatabase = "postgres://operator:not-a-real-password@atlas.internal/williamos"
    const cases = [
      (sha256: string) => observation(sha256, {
        actual_target: {
          status: "RECORDED", node_id: "aegis", selection_source: "operator-selected",
          outcome_ref: githubToken, latency_ms: 120,
        },
      }),
      (sha256: string) => observation(sha256, {
        divergence: {
          status: "DIVERGED", reason_code: "OBSERVED_OVERRIDE", explanation: privateKey,
        },
        actual_target: {
          status: "RECORDED", node_id: "hermes-node", selection_source: "known-safe",
          outcome_ref: "shadow-outcome-private-key", latency_ms: 120,
        },
      }),
      (sha256: string) => observation(sha256, {
        actual_target: {
          status: "RECORDED", node_id: "aegis", selection_source: "operator-selected",
          outcome_ref: credentialedDatabase, latency_ms: 120,
        },
      }),
    ]
    const secrets = [githubToken, privateKey, credentialedDatabase]

    cases.forEach((makeObservation, index) => {
      const result = run(fixture(phaseOneReceipt(), makeObservation))
      expectRejected(result, /secret|credential|token|private key|unsafe|value/i)
      expect(JSON.stringify(result)).not.toContain(secrets[index])
    })
  })

  it("surfaces AUTHORITY_DENIED on an actual ineligible target and remains fail-closed", () => {
    const receipt = phaseOneReceipt()
    receipt.ineligible_nodes[0].reasons = [{ code: "AUTHORITY_DENIED", detail: "county-production-write" }]
    const value = fixture(receipt, (sha256) => observation(sha256, {
      actual_target: {
        status: "RECORDED", node_id: "atlas", selection_source: "operator-selected",
        outcome_ref: "shadow-outcome-authority-denied", latency_ms: 75,
      },
      divergence: {
        status: "DIVERGED", reason_code: "AUTHORITY_DENIED_TARGET",
        explanation: "The actual target was denied by the pinned authority evidence.",
      },
    }))

    const result = run(value)
    expectRejected(result, /authority|ineligible|actual target|trusted Phase 1 replay/i)
    expect(result.authority_violation).toBe(true)
    expectSafety(result)
  })

  it("rejects rehashed receipts that substitute a fictitious verifier contract or implementation", () => {
    const fictitiousContract = phaseOneReceipt()
    fictitiousContract.evidence_verifier.contract = "not-the-pinned-canonicalization-contract/99"
    expectRejected(run(fixture(fictitiousContract)), /verifier|contract|canonical/i)

    const fictitiousImplementation = phaseOneReceipt()
    fictitiousImplementation.evidence_verifier.reference_implementation = "trust-me-verifier.py"
    expectRejected(run(fixture(fictitiousImplementation)), /verifier|reference|implementation/i)
  })

  it("requires the exact Phase 1 evidence node set after receipt rehashing", () => {
    const empty = phaseOneReceipt()
    empty.evidence_snapshot = []
    expectRejected(run(fixture(empty)), /evidence|node|snapshot|set/i)

    const duplicate = phaseOneReceipt()
    duplicate.evidence_snapshot[1].node = "aegis"
    expectRejected(run(fixture(duplicate)), /evidence|node|duplicate|unique/i)

    const wrong = phaseOneReceipt()
    wrong.evidence_snapshot[1].node = "omen"
    expectRejected(run(fixture(wrong)), /evidence|node|snapshot|set|required/i)
  })

  it("rejects root confidence that is declared or has insufficient freshness", () => {
    const declared = phaseOneReceipt()
    declared.confidence.state = "declared"
    expectRejected(run(fixture(declared)), /confidence|declared|observed|proven/i)

    const insufficient = phaseOneReceipt()
    insufficient.confidence.freshness = "insufficient"
    expectRejected(run(fixture(insufficient)), /confidence|freshness|insufficient/i)
  })

  it("rejects declared or missing confidence on every eligible candidate, including selection", () => {
    const selectedDeclared = phaseOneReceipt()
    selectedDeclared.eligible_nodes[0].confidence = "declared"
    expectRejected(run(fixture(selectedDeclared)), /aegis|confidence|declared|eligible/i)

    const otherDeclared = phaseOneReceipt()
    otherDeclared.eligible_nodes[1].confidence = "declared"
    expectRejected(run(fixture(otherDeclared)), /hermes-node|confidence|declared|eligible/i)

    for (const index of [0, 1]) {
      const missing = phaseOneReceipt()
      delete missing.eligible_nodes[index].confidence
      expectRejected(run(fixture(missing)), /confidence|eligible|candidate/i)
    }
  })

  it("binds every Phase 1 decision input across a rehashed receipt", () => {
    const mutations: Array<[string, (receipt: JsonObject) => void]> = [
      ["snapshot digest", (receipt) => { receipt.evidence_snapshot[0].snapshot_sha256 = "a".repeat(64) }],
      ["workload", (receipt) => { receipt.workload.title = "Substituted workload" }],
      ["placement policy", (receipt) => { receipt.placement_policy_version = "execution-fabric-placement/99" }],
      ["evaluation time", (receipt) => { receipt.evaluated_at = "2026-08-10T07:00:01.000Z" }],
      ["input artifact", (receipt) => { receipt.input_artifacts.registry_base_sha256 = "b".repeat(64) }],
    ]

    for (const [label, mutate] of mutations) {
      const receipt = phaseOneReceipt()
      mutate(receipt)
      expectRejected(run(fixture(receipt)), /decision|digest|workload|policy|evaluated|artifact|input/i)
      expect(receipt.decision_input_sha256, `${label} mutation must retain the prior decision commitment`)
        .not.toBe(phaseOneDecisionInputSha256(receipt))
    }
  })

  it("rejects verifier SHA replacement independently of receipt and decision rehashing", () => {
    const receipt = phaseOneReceipt()
    receipt.evidence_verifier.sha256 = "f".repeat(64)
    expectRejected(run(fixture(receipt)), /verifier|sha256|pinned|digest/i)

    const forged = phaseOneReceipt()
    forged.evidence_verifier.sha256 = "f".repeat(64)
    forged.decision_input_sha256 = phaseOneDecisionInputSha256(forged)
    expectRejected(run(fixture(forged)), /verifier|sha256|pinned|digest/i)
  })

  it("rejects workload-catalog byte tampering and receipt/catalog summary disagreement", () => {
    const tamperedCatalog = fixture()
    const changedCatalog = JSON.parse(fs.readFileSync(tamperedCatalog.workloadsPath, "utf8"))
    changedCatalog.workloads[0].title = "Tampered after Phase 1"
    fs.writeFileSync(tamperedCatalog.workloadsPath, `${JSON.stringify(changedCatalog, null, 2)}\n`)
    expectRejected(run(tamperedCatalog), /catalog|workload|sha256|digest|artifact/i)

    const summaryMismatch = phaseOneReceipt()
    summaryMismatch.workload.title = "Forged receipt summary"
    summaryMismatch.decision_input_sha256 = phaseOneDecisionInputSha256(summaryMismatch)
    expectRejected(run(fixture(summaryMismatch)), /workload|summary|catalog|title|parity/i)
  })

  it("requires the explicitly pinned workload catalog CLI input", () => {
    const value = fixture()
    const result = runShadowPlacementCli([
      "--receipt", value.receiptPath,
      "--observation", value.observationPath,
    ]) as JsonObject
    expectRejected(result, /workloads|required|catalog/i)
  })
})
