
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  evaluateShadowPlacement,
  evaluateShadowPlacementTestFixture,
  evaluateShadowPlacementTestFixtureBatch,
  runShadowPlacementCli,
} from "../scripts/execution-fabric/evaluate-shadow-placement.mjs"

type JsonObject = Record<string, any>

const retainedRecord = "docs/reports/WO-LOCAL-107-resume-williamos-proof-image-refresh.md"
const secondRetainedRecord = "docs/reports/WO-LOCAL-053-full-manual-cycle-validation.md"
const alternateRetainedRecord = "docs/reports/WO-LOCAL-107-alternate-retained-evidence.md"

function retainedRecordBytes(workOrderId: string, target = "omen", sourcePath = "") {
  return Buffer.from(`# ${workOrderId} retained delivery evidence\n\nSOURCE: ${sourcePath}\nTARGET: ${target}\n\n## Result\nPASS\nLATENCY_MS: 12345\n`)
}

function outcomeEvidence(workOrderId: string, target = "omen") {
  const value = {
    schema_version: "0.1-shadow-outcome-evidence",
    work_order_id: workOrderId,
    actual_target_node: target,
    status: "COMPLETED",
    result: "SUCCEEDED",
    started_at: "2026-08-10T07:01:00.000Z",
    completed_at: "2026-08-10T07:01:12.345Z",
    authority_outcome: {
      status: "COMPLIANT",
      reference: "authority-shadow-observation-v1",
      checked_at: "2026-08-10T07:01:00.000Z",
    },
    resource_observations: [
      { metric: "cpu_load_pct", observed_at: "2026-08-10T07:01:05.000Z", unit: "percent", value: 25 },
    ],
  }
  const bytes = Buffer.from(`${canonicalizeJcs(value)}\n`)
  return { bytes, sha256: sha256Bytes(bytes) }
}

function sha256Bytes(bytes: Buffer | string) {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function receipt(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: "0.2-pinned-placement-recommendation",
    status: "RECOMMENDED",
    recommendation_only: true,
    eligibility_scope: "recommendation-only",
    evaluated_at: "2026-08-10T07:00:00.000Z",
    workload: { id: "interactive-development", title: "Interactive development", storage_semantics: "none" },
    scheduler: { state: "disabled", authority: "not-granted", autonomous_dispatch: "forbidden" },
    recommendation: {
      node_id: "omen", rank: 1, rank_basis: { stable_node_id: "omen" },
      execution_authorized: false, dispatch_allowed: false,
    },
    eligible_nodes: [{
      node_id: "omen", eligible: true, rank: 1, rank_basis: { stable_node_id: "omen" },
      reasons: [], evidence_used: [{ path: "nodes.omen.evidence", value: "recorded" }],
      confidence: "observed", freshness: { state: "fresh", expires_at: "2026-08-10T07:05:00.000Z" }, execution_authorized: false,
      dispatch_allowed: false,
    }],
    ineligible_nodes: [{
      node_id: "atlas", eligible: false, rank: null, reasons: [{ code: "CAPABILITY_REQUIRED" }],
      confidence: "observed", freshness: { state: "fresh" }, execution_authorized: false,
      dispatch_allowed: false,
    }],
    confidence: { state: "observed", freshness: "fresh", registry_freshness: "mixed" },
    placement_policy_version: "execution-fabric-placement/0.2",
    evidence_snapshot: [
      { node: "aegis", snapshot_sha256: "a".repeat(64) },
      { node: "atlas", snapshot_sha256: "b".repeat(64) },
      { node: "hermes-node", snapshot_sha256: "c".repeat(64) },
    ],
    evidence_verifier: { contract: "jcs-rfc8785/1", sha256: "d".repeat(64), result: "PASS" },
    input_artifacts: { registry_base_sha256: "e".repeat(64) },
    decision_input_sha256: "f".repeat(64),
    authority_mutated: false,
    remote_systems_modified: false,
    ...overrides,
  }
}

function observation(receiptSha256: string, overrides: JsonObject = {}): JsonObject {
  const { sourcePath = retainedRecord, ...selectedOverrides } = overrides
  const selectedWorkOrder = selectedOverrides.work_order_id ?? "WO-LOCAL-107"
  const selectedTarget = selectedOverrides.manual_target ?? "omen"
  const sourceBytes = retainedRecordBytes(selectedWorkOrder, selectedTarget, sourcePath)
  const outcome = outcomeEvidence(selectedWorkOrder, selectedTarget)
  return {
    schema_version: "0.1-shadow-placement-observation",
    classification: "recorded-historical-observation",
    observation_id: "shadow-WO-LOCAL-107",
    work_order_id: "WO-LOCAL-107",
    workload_id: "interactive-development",
    receipt_sha256: receiptSha256,
    recorded_at: "2026-08-10T07:05:00.000Z",
    manual_target: "omen",
    source: {
      kind: "retained-repository-delivery-record",
      path: sourcePath,
      sha256: sha256Bytes(sourceBytes),
    },
    outcome_evidence: {
      kind: "retained-canonical-outcome-evidence",
      path: `docs/reports/execution-fabric-shadow-outcomes/${selectedWorkOrder}.json`,
      sha256: outcome.sha256,
    },
    divergence_reasons: [],
    ...selectedOverrides,
  }
}

function trustedRepository(
  receiptValue: JsonObject,
  receiptSha256: string,
  observationValue: JsonObject = observation(receiptSha256),
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-shadow-trust-"))
  for (const [relativePath, workOrderId] of [
    [retainedRecord, "WO-LOCAL-107"],
    [secondRetainedRecord, "WO-LOCAL-053"],
    [alternateRetainedRecord, "WO-LOCAL-107"],
  ]) {
    const destination = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, retainedRecordBytes(workOrderId, "omen", relativePath))
    const outcome = outcomeEvidence(workOrderId)
    const outcomePath = path.join(root, `docs/reports/execution-fabric-shadow-outcomes/${workOrderId}.json`)
    fs.mkdirSync(path.dirname(outcomePath), { recursive: true })
    fs.writeFileSync(outcomePath, outcome.bytes)
  }
  const registryPath = path.join(root, "config/execution-fabric/shadow-receipt-registry.json")
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, `${JSON.stringify({
    schema_version: "0.1-shadow-receipt-registry",
    placement_policy_version: "execution-fabric-placement/0.2",
    trusted_receipts: [{
      receipt_sha256: receiptSha256,
      work_order_id: observationValue.work_order_id,
      workload_id: receiptValue.workload.id,
      decision_input_sha256: receiptValue.decision_input_sha256,
      evidence_snapshot: receiptValue.evidence_snapshot,
      reviewed_commit: "a".repeat(40),
      status: "TRUSTED",
    }],
  }, null, 2)}\n`)
  const selectedOutcome = outcomeEvidence(observationValue.work_order_id, observationValue.manual_target)
  const selectedSourceSha256 = observationValue.source.sha256
  fs.writeFileSync(path.join(root, "config/execution-fabric/shadow-outcome-registry.json"), `${JSON.stringify({
    schema_version: "0.1-shadow-outcome-registry",
    registry_id: "shadow-outcomes-test-v1",
    entries: [{
      artifact_sha256: selectedOutcome.sha256,
      work_order_id: observationValue.work_order_id,
      actual_target_node: observationValue.manual_target,
      retained_source_sha256: selectedSourceSha256,
      authority_reference: "authority-shadow-observation-v1",
      reviewed_commit: "b".repeat(40),
      status: "ACTIVE",
    }],
  }, null, 2)}\n`)
  fs.writeFileSync(path.join(root, "config/execution-fabric/shadow-authority-registry.json"), `${JSON.stringify({
    schema_version: "0.1-shadow-authority-registry",
    registry_id: "shadow-authorities-test-v1",
    entries: [{
      reference: "authority-shadow-observation-v1",
      work_order_id: observationValue.work_order_id,
      allowed_canonical_nodes: [observationValue.manual_target],
      valid_from: "2026-08-10T07:00:30.000Z",
      expires_at: "2026-08-10T07:02:00.000Z",
      reviewed_commit: "c".repeat(40),
      status: "ACTIVE",
    }],
  }, null, 2)}\n`)
  return root
}

function entry(receiptValue = receipt(), observationOverrides: JsonObject = {}) {
  const bytes = `${JSON.stringify(receiptValue, null, 2)}\n`
  const receiptSha256 = sha256Bytes(bytes)
  const observationValue = observation(receiptSha256, observationOverrides)
  return {
    receiptBytes: Buffer.from(bytes),
    observationBytes: Buffer.from(`${JSON.stringify(observationValue, null, 2)}\n`),
    repositoryRoot: trustedRepository(receiptValue, receiptSha256, observationValue),
  }
}

function evaluate(receiptValue = receipt(), observationOverrides: JsonObject = {}) {
  return evaluateShadowPlacementTestFixture({
    ...entry(receiptValue, observationOverrides),
  }) as JsonObject
}

function expectRejected(action: () => unknown, detail: string) {
  expect(action).toThrowError(`FABRIC_SHADOW_PLACEMENT_INVALID: ${detail}`)
}

function mutateRepositoryJson(repositoryRoot: string, relativePath: string, mutate: (value: JsonObject) => void) {
  const artifactPath = path.join(repositoryRoot, relativePath)
  const value = JSON.parse(fs.readFileSync(artifactPath, "utf8"))
  mutate(value)
  fs.writeFileSync(artifactPath, `${JSON.stringify(value, null, 2)}\n`)
}

describe("Execution Fabric Phase 2 shadow placement", () => {
  it("replays the reviewed WO-EF-SHADOW-001 production observation exactly", () => {
    const receiptBytes = fs.readFileSync(path.join(
      process.cwd(),
      "docs/reports/execution-fabric-shadow-receipts/WO-EF-SHADOW-001.json",
    ))
    const observationBytes = fs.readFileSync(path.join(
      process.cwd(),
      "docs/reports/execution-fabric-shadow-observations/WO-EF-SHADOW-001.json",
    ))

    const first = evaluateShadowPlacement({ receiptBytes, observationBytes }) as JsonObject
    const replay = evaluateShadowPlacement({ receiptBytes, observationBytes }) as JsonObject

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      status: "OBSERVED",
      trust_scope: "production",
      observation_only: true,
      work_order_id: "WO-EF-SHADOW-001",
      policy_receipt: { selected_node_id: "aegis" },
      recorded_observation: {
        manual_target: "hermes-node",
        outcome_trust: { status: "TRUSTED" },
      },
      comparison: {
        diverged: true,
        divergence_reasons: [
          "MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION",
          "RECORDED_AUTHORITY_CONSTRAINT",
        ],
        silent_fallback: false,
      },
      safety: {
        authority_violations: 0,
        stale_evidence_placements: 0,
        silent_fallbacks: 0,
      },
    })
  })

  it("replays an exact recorded historical observation deterministically without execution", () => {
    const first = evaluate()
    const second = evaluate()

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      status: "TEST_OBSERVED", trust_scope: "test-fixture", observation_only: true,
      policy_receipt: { status: "RECOMMENDED", selected_node_id: "omen" },
      recorded_observation: {
        manual_target: "omen",
        outcome_evidence: { outcome: { status: "COMPLETED", result: "SUCCEEDED" } },
      },
      comparison: { diverged: false, divergence_reasons: [], silent_fallback: false },
      safety: {
        authority_violations: 0, stale_evidence_placements: 0, silent_fallbacks: 0,
        scheduler_state: "disabled",
      },
      job_launched: false, scheduler_activated: false, authority_mutated: false,
      remote_accessed: false, shell_executed: false,
    })
    expect(first.replay_sha256).toMatch(/^[a-f0-9]{64}$/)
})
  it("rolls up a bounded observation set deterministically and rejects duplicate records", () => {
    const receiptValue = receipt()
    const first = entry(receiptValue)
    const second = entry(receipt({ decision_input_sha256: "1".repeat(64) }), {
      sourcePath: secondRetainedRecord,
      observation_id: "shadow-WO-LOCAL-053",
      work_order_id: "WO-LOCAL-053",
    })

    const forward = evaluateShadowPlacementTestFixtureBatch([first, second]) as JsonObject
    const reverse = evaluateShadowPlacementTestFixtureBatch([second, first]) as JsonObject
    expect(forward).toEqual(reverse)
    expect(forward).toMatchObject({
      gate: "HERMES_PLACEMENT_SHADOW_TEST_FIXTURE", status: "TEST_PASS", trust_scope: "test-fixture",
      bounded_observation_count: 2, divergence_count: 0,
      authority_violations: 0, stale_evidence_placements: 0, silent_fallbacks: 0,
      job_launched: false, scheduler_activated: false, authority_mutated: false,
      remote_accessed: false, shell_executed: false,
    })
    expectRejected(() => evaluateShadowPlacementTestFixtureBatch([first, first]),
      "shadow batch contains duplicate observation IDs")
    const relabeled = entry(receiptValue, { observation_id: "shadow-WO-LOCAL-107-relabeled" })
    expectRejected(() => evaluateShadowPlacementTestFixtureBatch([first, relabeled]),
      "shadow batch contains duplicate receipt-to-source bindings")
    const alternateReport = entry(receiptValue, {
      sourcePath: alternateRetainedRecord,
      observation_id: "shadow-WO-LOCAL-107-alternate-report",
    })
    expectRejected(() => evaluateShadowPlacementTestFixtureBatch([first, alternateReport]),
      "shadow batch contains duplicate immutable outcomes")
  })

  it("requires an explicit classified reason for every target mismatch", () => {
    const hermesReceipt = receipt({
      recommendation: {
        node_id: "hermes-node", rank: 1, rank_basis: { stable_node_id: "hermes-node" },
        execution_authorized: false, dispatch_allowed: false,
      },
      eligible_nodes: [{
        ...receipt().eligible_nodes[0], node_id: "hermes-node",
        rank_basis: { stable_node_id: "hermes-node" },
      }, {
        ...receipt().eligible_nodes[0], rank: 2,
      }],
    })
    expectRejected(
      () => evaluate(hermesReceipt),
      "target mismatch requires MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION",
    )

    const result = evaluate(hermesReceipt, {
      divergence_reasons: ["RECORDED_RESOURCE_CONSTRAINT", "MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION"],
    })
    expect(result.comparison).toEqual({
      diverged: true,
      divergence_reasons: ["MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION", "RECORDED_RESOURCE_CONSTRAINT"],
      silent_fallback: false,
    })
  })

  it("requires trustworthy semantics for every eligible target", () => {
    for (const candidateOverride of [
      { eligible: false },
      { freshness: { state: "stale", expires_at: "2026-08-10T07:05:00.000Z" } },
      { confidence: "declared" },
      { freshness: { state: "fresh", expires_at: "2026-08-10T06:59:59.000Z" } },
    ]) {
      const contradictory = receipt({
        eligible_nodes: [{ ...receipt().eligible_nodes[0], ...candidateOverride }],
      })
      expect(() => evaluate(contradictory)).toThrowError(/eligible candidate|eligible evidence is already expired/)
    }

    const contradictoryAlternate = receipt({
      recommendation: {
        node_id: "hermes-node", rank: 1, rank_basis: { stable_node_id: "hermes-node" },
        execution_authorized: false, dispatch_allowed: false,
      },
      eligible_nodes: [{
        ...receipt().eligible_nodes[0], node_id: "hermes-node",
        rank_basis: { stable_node_id: "hermes-node" },
      }, {
        ...receipt().eligible_nodes[0], eligible: false, rank: 2,
      }],
    })
    expectRejected(() => evaluate(contradictoryAlternate, {
      divergence_reasons: ["MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION"],
    }), "omen: eligible candidate semantics are contradictory or untrusted")
  })

  it("rejects every actual target when the trusted receipt has no eligible node", () => {
    const blockedReceipt = receipt({
      status: "NO_ELIGIBLE_NODE",
      recommendation: null,
      eligible_nodes: [],
      confidence: { state: "insufficient", freshness: "insufficient", registry_freshness: "stale" },
    })
    expectRejected(() => evaluate(blockedReceipt),
      "actual target is not eligible in the trusted placement receipt")
  })

  it("rejects stale or untrusted recommendation evidence", () => {
    const stale = receipt()
    stale.eligible_nodes[0].freshness.state = "stale"
    expectRejected(() => evaluate(stale), "omen: eligible candidate semantics are contradictory or untrusted")

    const unverified = receipt()
    unverified.evidence_verifier.result = "FAIL"
    expectRejected(() => evaluate(unverified), "receipt evidence verifier did not pass")

    const expiredAtExecution = receipt()
    expiredAtExecution.eligible_nodes[0].freshness.expires_at = "2026-08-10T07:01:00.000Z"
    expectRejected(() => evaluate(expiredAtExecution),
      "outcome execution began at or after selected evidence expiry")
  })

  it("rejects receipt secret or executable aliases recursively", () => {
    for (const field of [
      "cmd", "exec", "spawn", "env", "environment", "token", "api_key", "api-key", "private-key", "authorization",
    ]) {
      const unsafe = receipt()
      unsafe.workload[field] = "not-permitted"
      expectRejected(() => evaluate(unsafe), `receipt.workload.${field} is not permitted in observation-only input`)
    }
  })

  it("rejects authority-bearing receipts and tampered outcome-evidence bindings", () => {
    const authorityBearing = receipt()
    authorityBearing.recommendation.execution_authorized = true
    expectRejected(
      () => evaluate(authorityBearing),
      "receipt recommendation is not the rank-1 non-authorizing eligible candidate",
    )
    const selected = observation("0".repeat(64)).outcome_evidence
    expectRejected(() => evaluate(receipt(), {
      outcome_evidence: { ...selected, sha256: "0".repeat(64) },
    }), "outcome evidence rejected: artifact bytes do not match expected SHA-256")
  })

  it("binds exact receipt bytes and exact retained repository record bytes", () => {
    const value = receipt()
    const bytes = `${JSON.stringify(value, null, 2)}\n`
    const mismatchedObservation = observation("0".repeat(64))
    expectRejected(() => evaluateShadowPlacementTestFixture({
      receiptBytes: Buffer.from(bytes),
      observationBytes: Buffer.from(`${JSON.stringify(mismatchedObservation, null, 2)}\n`),
      repositoryRoot: trustedRepository(value, sha256Bytes(bytes)),
    }), "observation receipt hash does not match exact receipt bytes")

    expectRejected(() => evaluate(value, {
      source: { ...observation(sha256Bytes(bytes)).source, sha256: "0".repeat(64) },
    }), "observation source hash does not match exact retained record bytes")
    expectRejected(() => evaluate(value, { work_order_id: "WO-NOT-IN-RETAINED-REPORT" }),
      "observation source hash does not match exact retained record bytes")
  })

  it("rejects every recorded placement that predates the receipt", () => {
    expectRejected(() => evaluate(receipt(), { recorded_at: "2026-08-10T06:59:59.000Z" }),
      "shadow observation predates the placement recommendation")
    expectRejected(() => evaluate(receipt(), {
      recorded_at: "2026-08-10T06:59:59.000Z",
      divergence_reasons: ["OPERATOR_PLACEMENT_PRECEDED_POLICY_RECEIPT"],
    }), "shadow observation predates the placement recommendation")
  })

  it("rejects divergence reasons that cannot occur in the accepted chronology", () => {
    expectRejected(() => evaluate(receipt(), {
      divergence_reasons: ["OPERATOR_PLACEMENT_PRECEDED_POLICY_RECEIPT"],
    }), "observation divergence_reasons are invalid or duplicated")
  })

  it("requires independently reviewed outcome and authority settlement", () => {
    const wrongWorkOrder = entry()
    mutateRepositoryJson(wrongWorkOrder.repositoryRoot,
      "config/execution-fabric/shadow-receipt-registry.json",
      (registry) => { registry.trusted_receipts[0].work_order_id = "WO-OTHER" })
    expectRejected(() => evaluateShadowPlacementTestFixture(wrongWorkOrder),
      "receipt does not match its reviewed trust-registry binding")

    const unregistered = entry()
    mutateRepositoryJson(unregistered.repositoryRoot,
      "config/execution-fabric/shadow-outcome-registry.json",
      (registry) => { registry.entries = [] })
    expectRejected(() => evaluateShadowPlacementTestFixture(unregistered),
      "outcome trust settlement rejected: empty or invalid trust registries cannot settle outcome evidence")

    const forgedSource = entry()
    mutateRepositoryJson(forgedSource.repositoryRoot,
      "config/execution-fabric/shadow-outcome-registry.json",
      (registry) => { registry.entries[0].retained_source_sha256 = "0".repeat(64) })
    expectRejected(() => evaluateShadowPlacementTestFixture(forgedSource),
      "outcome trust settlement rejected: outcome retained-source binding mismatch")

    const unauthorizedNode = entry()
    mutateRepositoryJson(unauthorizedNode.repositoryRoot,
      "config/execution-fabric/shadow-authority-registry.json",
      (registry) => { registry.entries[0].allowed_canonical_nodes = ["atlas"] })
    expectRejected(() => evaluateShadowPlacementTestFixture(unauthorizedNode),
      "outcome trust settlement rejected: actual target is not allowed by the reviewed authority entry")

    const expiredExecution = entry()
    mutateRepositoryJson(expiredExecution.repositoryRoot,
      "config/execution-fabric/shadow-authority-registry.json",
      (registry) => { registry.entries[0].expires_at = "2026-08-10T07:01:10.000Z" })
    expectRejected(() => evaluateShadowPlacementTestFixture(expiredExecution),
      "outcome trust settlement rejected: authority check or execution chronology is outside the reviewed validity window")
  })

  it("rejects normalized impossible calendar timestamps", () => {
    expectRejected(() => evaluate(receipt({ evaluated_at: "2026-02-30T07:00:00.000Z" })),
      "receipt.evaluated_at is not a valid UTC calendar timestamp")
    expectRejected(() => evaluate(receipt(), { recorded_at: "2026-02-30T07:05:00.000Z" }),
      "observation.recorded_at is not a valid UTC calendar timestamp")
  })

  it("rejects unclassified fixtures, path escape, and records outside the retained report boundary", () => {
    expectRejected(() => evaluate(receipt(), { classification: "synthetic-execution" }),
      "observation must be classified as recorded-historical-observation")
    expectRejected(() => evaluate(receipt(), {
      source: { kind: "retained-repository-delivery-record", path: "../outside.md", sha256: "0".repeat(64) },
    }), "observation source escapes repository root")
    expectRejected(() => evaluate(receipt(), {
      source: { kind: "retained-repository-delivery-record", path: "package.json", sha256: "0".repeat(64) },
    }), "observation source must be a retained repository delivery record under docs/reports")
  })

  it("fails closed at the CLI boundary for altered receipt bytes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-shadow-placement-"))
    const receiptPath = path.join(root, "receipt.json")
    const observationPath = path.join(root, "observation.json")
    const value = receipt()
    const originalBytes = `${JSON.stringify(value, null, 2)}\n`
    fs.writeFileSync(receiptPath, originalBytes)
    fs.writeFileSync(observationPath, `${JSON.stringify(observation(sha256Bytes(originalBytes)), null, 2)}\n`)
    value.workload.title = "altered after observation"
    fs.writeFileSync(receiptPath, `${JSON.stringify(value, null, 2)}\n`)

    const result = runShadowPlacementCli([
      "--receipt", receiptPath,
      "--observation", observationPath,
    ]) as JsonObject
    expect(result).toMatchObject({
      status: "INPUT_REJECTED", observation_only: true,
      error: { code: "FABRIC_SHADOW_PLACEMENT_INVALID" },
      job_launched: false, scheduler_activated: false, authority_mutated: false,
      remote_accessed: false, shell_executed: false,
    })
    expect(result.error.detail).toContain("receipt digest is absent from the reviewed trust registry")
  })

  it("computes receipt identity from exact bytes instead of accepting a caller-supplied digest", () => {
    const selected = entry()
    const altered = JSON.parse(Buffer.from(selected.receiptBytes).toString("utf8"))
    altered.workload.title = "altered after observation binding"
    expectRejected(() => evaluateShadowPlacementTestFixture({
      ...selected,
      receiptBytes: Buffer.from(`${JSON.stringify(altered, null, 2)}\n`),
    }), "receipt digest is absent from the reviewed trust registry")
  })

  it("keeps the repository gate fail-closed while no reviewed receipt is admitted", () => {
    const selected = entry()
    expectRejected(() => evaluateShadowPlacement(selected),
      "receipt digest is absent from the reviewed trust registry")
  })

  it("rejects caller-controlled production trust roots", () => {
    const result = runShadowPlacementCli([
      "--receipt", "unused.json",
      "--observation", "unused.json",
      "--repository-root", trustedRepository(receipt(), "0".repeat(64)),
    ]) as JsonObject
    expect(result.status).toBe("INPUT_REJECTED")
    expect(result.error.detail).toContain("--repository-root is not supported")
  })

  it("rejects noncanonical target words", () => {
    expectRejected(() => evaluate(receipt(), {
      manual_target: "stop",
      divergence_reasons: ["MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION"],
    }), "recorded manual target is not a canonical Fabric node")
  })
})
