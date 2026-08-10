import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import { evaluateShadowPlacementTestFixture } from "../scripts/execution-fabric/evaluate-shadow-placement.mjs"
import {
  captureResidentShadowOutcome,
  compileReviewedResidentShadowCandidate,
  materializeResidentShadowCandidate,
  materializeResidentShadowEvidence,
  preflightResidentShadowProducer,
} from "../scripts/execution-fabric/producer/resident-shadow-producer.mjs"

type Json = Record<string, any>
const digest = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex")

function receipt(overrides: Json = {}) {
  return {
    schema_version: "0.2-pinned-placement-recommendation",
    status: "RECOMMENDED",
    recommendation_only: true,
    eligibility_scope: "recommendation-only",
    evaluated_at: "2026-08-10T08:00:00.000Z",
    workload: { id: "cpu-heavy-build", title: "CPU-heavy build", storage_semantics: "scratch-only" },
    scheduler: { state: "disabled", authority: "not-granted", autonomous_dispatch: "forbidden" },
    recommendation: {
      node_id: "hermes-node", rank: 1, rank_basis: { stable_node_id: "hermes-node" },
      execution_authorized: false, dispatch_allowed: false,
    },
    eligible_nodes: [{
      node_id: "hermes-node", eligible: true, rank: 1,
      rank_basis: { stable_node_id: "hermes-node" }, reasons: [], evidence_used: [],
      confidence: "observed", freshness: { state: "fresh", expires_at: "2026-08-10T08:10:00.000Z" },
      execution_authorized: false, dispatch_allowed: false,
    }],
    ineligible_nodes: [],
    confidence: { state: "observed", freshness: "fresh", registry_freshness: "fresh" },
    placement_policy_version: "execution-fabric-placement/0.2",
    evidence_snapshot: [
      { node: "aegis", snapshot_sha256: "2".repeat(64) },
      { node: "atlas", snapshot_sha256: "3".repeat(64) },
      { node: "hermes-node", snapshot_sha256: "4".repeat(64) },
    ],
    evidence_verifier: { contract: "jcs-rfc8785/1", sha256: "5".repeat(64), result: "PASS" },
    input_artifacts: { registry_base_sha256: "6".repeat(64) },
    decision_input_sha256: "1".repeat(64),
    authority_mutated: false,
    remote_systems_modified: false,
    ...overrides,
  }
}

function authority(overrides: Json = {}) {
  return {
    reference: "issue-538-phase2-shadow-001",
    work_order_id: "WO-EF-SHADOW-001",
    allowed_canonical_nodes: ["hermes-node"],
    valid_from: "2026-08-10T07:59:00.000Z",
    expires_at: "2026-08-10T08:20:00.000Z",
    reviewed_commit: "a".repeat(40),
    status: "ACTIVE",
    ...overrides,
  }
}

function facts(overrides: Json = {}) {
  return {
    schema_version: "0.1-resident-shadow-producer-facts",
    preflight_sha256: "7".repeat(64),
    receipt_sha256: "8".repeat(64),
    work_order_id: "WO-EF-SHADOW-001",
    resident_node_id: "hermes-node",
    producer_lane: "resident-hermes",
    started_at: "2026-08-10T08:02:00.000Z",
    completed_at: "2026-08-10T08:03:00.000Z",
    authority_checked_at: "2026-08-10T08:02:00.000Z",
    authority_reference: "issue-538-phase2-shadow-001",
    authority_status: "COMPLIANT",
    status: "COMPLETED",
    result: "SUCCEEDED",
    resource_observations: [
      { metric: "concurrency_used", observed_at: "2026-08-10T08:02:30.000Z", unit: "count", value: 1 },
      { metric: "cpu_load_pct", observed_at: "2026-08-10T08:02:30.000Z", unit: "percent", value: 32 },
    ],
    ...overrides,
  }
}

const authorityProof = ({ registrySha256, authority: selectedAuthority }: Json) => ({
  schema_version: "0.1-trusted-shadow-authority-proof",
  trusted_ref: "refs/heads/main",
  registry_sha256: registrySha256,
  authority_reference: selectedAuthority.reference,
  authority_reviewed_commit: selectedAuthority.reviewed_commit,
  exact_entry_count: 1,
})

const factsFor = (checked: Json, overrides: Json = {}) => facts({
  preflight_sha256: checked.preflight_sha256,
  receipt_sha256: checked.receipt_sha256,
  ...overrides,
})

function fixture(authorityOverride: Json = {}, receiptOverride: Json = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resident-shadow-producer-"))
  const registryPath = path.join(root, "config", "execution-fabric", "shadow-authority-registry.json")
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, JSON.stringify({
    schema_version: "0.1-shadow-authority-registry",
    registry_id: "execution-fabric-shadow-authorities",
    entries: [authority(authorityOverride)],
  }))
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt(receiptOverride))}\n`)
  return { root, receiptBytes, receiptSha256: digest(receiptBytes), registryPath }
}

function preflight(selected: Json, events: string[] = []) {
  return preflightResidentShadowProducer({
    repositoryRoot: selected.root,
    receiptBytes: selected.receiptBytes,
    receiptSha256: selected.receiptSha256,
    workOrderId: "WO-EF-SHADOW-001",
    trustedClock: () => { events.push("clock"); return "2026-08-10T08:01:00.000Z" },
    trustedResidentIdentity: () => {
      events.push("identity")
      return { node_id: "hermes-node", producer_lane: "resident-hermes" }
    },
    trustedAuthorityProof: authorityProof,
  })
}

describe("resident Hermes shadow producer", () => {
  it("preflights the exact receipt before identity/facts and materializes compiler-shaped evidence", () => {
    const selected = fixture()
    const events: string[] = []
    const checked = preflight(selected, events)
    expect(events).toEqual(["identity", "clock"])
    expect(checked).toMatchObject({
      status: "PREFLIGHT_PASSED",
      resident_node_id: "hermes-node",
      work_order_id: "WO-EF-SHADOW-001",
      authority: { reference: "issue-538-phase2-shadow-001", reviewed_commit: "a".repeat(40) },
      safety: {
        observation_only: true, job_launched: false, scheduler_activated: false,
        dispatch_authority_granted: false, registry_modified: false, authority_mutated: false,
        remote_accessed: false, shell_executed: false,
      },
    })

    const readFacts = vi.fn(() => { events.push("facts"); return factsFor(checked) })
    const capture = captureResidentShadowOutcome({
      repositoryRoot: selected.root,
      receiptBytes: selected.receiptBytes,
      preflight: checked,
      readTrustedProducerFacts: readFacts,
      trustedAuthorityProof: authorityProof,
    })
    expect(events).toEqual(["identity", "clock", "facts"])
    expect(readFacts).toHaveBeenCalledWith({
      preflight_sha256: checked.preflight_sha256,
      receipt_sha256: selected.receiptSha256,
      work_order_id: "WO-EF-SHADOW-001",
      resident_node_id: "hermes-node",
    })
    expect(capture.outcome).toMatchObject({
      actual_target_node: "hermes-node",
      authority_outcome: { reference: "issue-538-phase2-shadow-001", status: "COMPLIANT" },
      status: "COMPLETED",
      result: "SUCCEEDED",
    })
    expect(capture.delivery_bytes.toString()).toContain("LATENCY_MS: 60000")

    const retained = materializeResidentShadowEvidence({
      repositoryRoot: selected.root,
      receiptBytes: selected.receiptBytes,
      capture,
    })
    expect(fs.readFileSync(path.join(selected.root, retained.receipt.path))).toEqual(selected.receiptBytes)
    expect(fs.readFileSync(path.join(selected.root, retained.outcome_evidence.path))).toEqual(capture.outcome_bytes)
    expect(capture.outcome_bytes).toEqual(Buffer.from(`${canonicalizeJcs(capture.outcome)}\n`))

    const reviewBytes = Buffer.from(`# WO-EF-SHADOW-001 independent review\n\nExecution commit: ${"b".repeat(40)}\n\nREVIEWER: assurance-agent\nVERDICT: PASS\n`)
    const reviewPath = "docs/reports/shadow-admission/WO-EF-SHADOW-001-review.md"
    fs.writeFileSync(path.join(selected.root, reviewPath), reviewBytes)
    const candidateInput = {
      repositoryRoot: selected.root,
      capture,
      retainedEvidence: retained,
      reviewEvidence: { path: reviewPath, sha256: digest(reviewBytes) },
      executionCommit: "b".repeat(40),
      reviewCommit: "c".repeat(40),
      reviewerIdentity: "assurance-agent",
      trustedClock: () => "2026-08-10T08:04:00.000Z",
      trustedAuthorityProof: authorityProof,
      proveReviewCommitOrder: ({ executionCommit, reviewCommit }: Json) => ({
        trusted_ref: "refs/heads/main", execution_commit: executionCommit,
        review_commit: reviewCommit, execution_is_strict_ancestor: true,
      }),
    }
    expect(() => materializeResidentShadowCandidate({
      ...candidateInput,
      reviewerIdentity: "resident-hermes",
    })).toThrow("reviewer identity must be independent")
    expect(() => materializeResidentShadowCandidate({
      ...candidateInput,
      proveReviewCommitOrder: ({ executionCommit, reviewCommit }: Json) => ({
        trusted_ref: "refs/heads/main", execution_commit: executionCommit,
        review_commit: reviewCommit, execution_is_strict_ancestor: false,
      }),
    })).toThrow("does not establish strict")
    const candidate = materializeResidentShadowCandidate({
      ...candidateInput,
    })
    expect(candidate.candidate).toMatchObject({
      schema_version: "0.1-shadow-admission-candidate",
      work_order_id: "WO-EF-SHADOW-001",
      producer_lane: "resident-hermes",
      authority: { reviewed_commit: "a".repeat(40) },
      execution_commit: "b".repeat(40),
      review_commit: "c".repeat(40),
      reviewer_identity: "assurance-agent",
    })
    expect(candidate.status).toBe("PENDING_REVIEWED_REGISTRY_ADMISSION")
    const candidateBytes = fs.readFileSync(path.join(selected.root, candidate.candidate_path))
    expect(candidateBytes).toEqual(Buffer.from(`${canonicalizeJcs(candidate.candidate)}\n`))

    const bundle = compileReviewedResidentShadowCandidate({
      candidate: candidate.candidate,
      repositoryRoot: selected.root,
      reviewProof: ({ reviewedCommit, artifacts, predecessorCommit }: Json) => ({
        trusted_ref: "refs/heads/main",
        reviewed_commit: reviewedCommit,
        exact_artifact_count: artifacts.length,
        ...(predecessorCommit ? { strict_after_commit: predecessorCommit } : {}),
      }),
    })
    expect(bundle.status).toBe("READY_FOR_REVIEWED_REGISTRY_ADMISSION")
    const registryRoot = path.join(selected.root, "config", "execution-fabric")
    fs.writeFileSync(path.join(registryRoot, "shadow-receipt-registry.json"), JSON.stringify({
      schema_version: "0.1-shadow-receipt-registry",
      placement_policy_version: "execution-fabric-placement/0.2",
      trusted_receipts: [bundle.registry_entries.receipt],
    }))
    fs.writeFileSync(path.join(registryRoot, "shadow-outcome-registry.json"), JSON.stringify({
      schema_version: "0.1-shadow-outcome-registry",
      registry_id: "execution-fabric-shadow-outcomes",
      entries: [bundle.registry_entries.outcome],
    }))
    fs.writeFileSync(path.join(registryRoot, "shadow-authority-registry.json"), JSON.stringify({
      schema_version: "0.1-shadow-authority-registry",
      registry_id: "execution-fabric-shadow-authorities",
      entries: [bundle.registry_entries.authority],
    }))
    const evaluated = evaluateShadowPlacementTestFixture({
      receiptBytes: selected.receiptBytes,
      observationBytes: Buffer.from(`${canonicalizeJcs(bundle.observation)}\n`),
      repositoryRoot: selected.root,
    })
    expect(evaluated).toMatchObject({
      status: "TEST_OBSERVED",
      trust_scope: "test-fixture",
      safety: { authority_violations: 0, stale_evidence_placements: 0, silent_fallbacks: 0 },
      job_launched: false,
      scheduler_activated: false,
      authority_mutated: false,
      remote_accessed: false,
      shell_executed: false,
    })
  })

  it("does not touch trusted identity or fact readers when receipt preflight fails", () => {
    const selected = fixture()
    const identity = vi.fn(() => ({ node_id: "hermes-node", producer_lane: "resident-hermes" }))
    expect(() => preflightResidentShadowProducer({
      repositoryRoot: selected.root,
      receiptBytes: selected.receiptBytes,
      receiptSha256: "f".repeat(64),
      workOrderId: "WO-EF-SHADOW-001",
      trustedClock: () => "2026-08-10T08:01:00.000Z",
      trustedResidentIdentity: identity,
      trustedAuthorityProof: authorityProof,
    })).toThrow("receipt bytes do not match")
    expect(identity).not.toHaveBeenCalled()

    const stale = fixture({}, {
      eligible_nodes: [{
        node_id: "hermes-node", eligible: true, rank: 1,
        rank_basis: { stable_node_id: "hermes-node" }, reasons: [], evidence_used: [],
        confidence: "observed", freshness: { state: "fresh", expires_at: "2026-08-10T08:00:30.000Z" },
        execution_authorized: false, dispatch_allowed: false,
      }],
    })
    expect(() => preflight(stale)).toThrow("not fresh at preflight")
  })

  it("loads authority only from the reviewed repository registry and fails closed on inactive or mismatched entries", () => {
    expect(() => preflight(fixture({ status: "REVOKED" }))).toThrow("status must be ACTIVE")
    expect(() => preflight(fixture({ allowed_canonical_nodes: ["atlas"] }))).toThrow("exactly one reviewed authority")
    expect(() => preflight(fixture({ valid_from: "2026-08-10T08:02:00.000Z" }))).toThrow("does not cover preflight")
    const selected = fixture()
    expect(() => preflightResidentShadowProducer({
      repositoryRoot: selected.root,
      receiptBytes: selected.receiptBytes,
      receiptSha256: selected.receiptSha256,
      workOrderId: "WO-EF-SHADOW-001",
      trustedClock: () => "2026-08-10T08:01:00.000Z",
      trustedResidentIdentity: () => ({ node_id: "hermes-node", producer_lane: "resident-hermes" }),
      trustedAuthorityProof: ({ registrySha256, authority: selectedAuthority }: Json) => ({
        ...authorityProof({ registrySha256, authority: selectedAuthority }),
        registry_sha256: "f".repeat(64),
      }),
    })).toThrow("does not bind the exact registry")
    expect(() => preflightResidentShadowProducer({
      repositoryRoot: selected.root,
      receiptBytes: selected.receiptBytes,
      receiptSha256: selected.receiptSha256,
      workOrderId: "WO-EF-SHADOW-001",
      trustedClock: () => "2026-08-10T08:01:00.000Z",
      trustedResidentIdentity: () => ({ node_id: "hermes-node", producer_lane: "resident-hermes" }),
    })).toThrow("trusted-main authority proof is required")

    const ineligible = fixture({}, {
      status: "NO_ELIGIBLE_NODE", recommendation: null, eligible_nodes: [],
      ineligible_nodes: [{ node_id: "hermes-node", eligible: false, reasons: ["STALE_EVIDENCE"], execution_authorized: false, dispatch_allowed: false }],
    })
    expect(() => preflight(ineligible)).toThrow("resident Hermes is not eligible")
  })

  it("requires trusted producer identity, chronology, result, authority, and resource facts without defaults", () => {
    const selected = fixture()
    const checked = preflight(selected)
    const capture = (selectedFacts: Json) => captureResidentShadowOutcome({
      repositoryRoot: selected.root,
      receiptBytes: selected.receiptBytes,
      preflight: checked,
      readTrustedProducerFacts: () => selectedFacts,
      trustedAuthorityProof: authorityProof,
    })
    const missingResources = factsFor(checked)
    delete missingResources.resource_observations
    expect(() => capture(missingResources)).toThrow("fields do not match the contract")
    expect(() => capture(factsFor(checked, { resident_node_id: "atlas" }))).toThrow("do not bind the exact preflight")
    expect(() => capture(factsFor(checked, { receipt_sha256: "9".repeat(64) }))).toThrow("do not bind the exact preflight")
    expect(() => capture(factsFor(checked, { authority_status: "VIOLATION" }))).toThrow("must be COMPLIANT")
    expect(() => capture(factsFor(checked, { authority_reference: "different-authority" }))).toThrow("do not bind a compliant")
    expect(() => capture(factsFor(checked, { authority_checked_at: "2026-08-10T08:02:01.000Z" }))).toThrow("exact outcome start")
    expect(() => capture(factsFor(checked, { started_at: "2026-08-10T08:10:00.000Z", completed_at: "2026-08-10T08:11:00.000Z", authority_checked_at: "2026-08-10T08:10:00.000Z" })))
      .toThrow("did not begin while placement evidence was fresh")
    expect(() => capture(factsFor(checked, { completed_at: "2026-08-10T08:21:00.000Z" })))
      .toThrow("reviewed authority does not cover")
    expect(() => capture(factsFor(checked, { status: "COMPLETED", result: "FAILED" }))).toThrow("status/result pair is invalid")
    expect(() => capture(factsFor(checked, { resource_observations: [] }))).toThrow("resource facts are required")
  })

  it("detects authority changes before reading facts and never overwrites retained evidence", () => {
    const selected = fixture()
    const checked = preflight(selected)
    const registry = JSON.parse(fs.readFileSync(selected.registryPath, "utf8"))
    registry.entries[0].status = "REVOKED"
    fs.writeFileSync(selected.registryPath, JSON.stringify(registry))
    const factReader = vi.fn(() => factsFor(checked))
    expect(() => captureResidentShadowOutcome({
      repositoryRoot: selected.root,
      receiptBytes: selected.receiptBytes,
      preflight: checked,
      readTrustedProducerFacts: factReader,
      trustedAuthorityProof: authorityProof,
    })).toThrow("status must be ACTIVE")
    expect(factReader).not.toHaveBeenCalled()

    const valid = fixture()
    const validPreflight = preflight(valid)
    const captured = captureResidentShadowOutcome({
      repositoryRoot: valid.root,
      receiptBytes: valid.receiptBytes,
      preflight: validPreflight,
      readTrustedProducerFacts: () => factsFor(validPreflight),
      trustedAuthorityProof: authorityProof,
    })
    const retained = materializeResidentShadowEvidence({ repositoryRoot: valid.root, receiptBytes: valid.receiptBytes, capture: captured })
    fs.writeFileSync(path.join(valid.root, retained.delivery_record.path), "different bytes")
    expect(() => materializeResidentShadowEvidence({ repositoryRoot: valid.root, receiptBytes: valid.receiptBytes, capture: captured }))
      .toThrow("refusing to overwrite different retained artifact")

    const tamperRoot = fixture()
    const tamperPreflight = preflight(tamperRoot)
    const tampered = captureResidentShadowOutcome({
      repositoryRoot: tamperRoot.root,
      receiptBytes: tamperRoot.receiptBytes,
      preflight: tamperPreflight,
      readTrustedProducerFacts: () => factsFor(tamperPreflight),
      trustedAuthorityProof: authorityProof,
    })
    tampered.outcome = { ...tampered.outcome, work_order_id: "WO-TAMPERED" }
    tampered.capture_sha256 = digest(Buffer.from(`${canonicalizeJcs({
      schema_version: tampered.schema_version,
      status: tampered.status,
      preflight: tampered.preflight,
      outcome: tampered.outcome,
      outcome_sha256: tampered.outcome_sha256,
      delivery_sha256: tampered.delivery_sha256,
      safety: tampered.safety,
    })}\n`))
    expect(() => materializeResidentShadowEvidence({
      repositoryRoot: tamperRoot.root, receiptBytes: tamperRoot.receiptBytes, capture: tampered,
    })).toThrow("outcome object and canonical bytes do not match")
  })

  it("rejects retained write parents that resolve outside the repository", () => {
    const selected = fixture()
    const checked = preflight(selected)
    const captured = captureResidentShadowOutcome({
      repositoryRoot: selected.root,
      receiptBytes: selected.receiptBytes,
      preflight: checked,
      readTrustedProducerFacts: () => factsFor(checked),
      trustedAuthorityProof: authorityProof,
    })
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "resident-shadow-outside-"))
    const docs = path.join(selected.root, "docs")
    fs.mkdirSync(docs)
    fs.symlinkSync(outside, path.join(docs, "reports"), process.platform === "win32" ? "junction" : "dir")
    expect(() => materializeResidentShadowEvidence({
      repositoryRoot: selected.root, receiptBytes: selected.receiptBytes, capture: captured,
    })).toThrow(/symbolic link|outside repository/)
    expect(fs.readdirSync(outside)).toEqual([])
  })

  it("contains no execution, dispatch, registry-write, shell, Git, or remote-action surface", () => {
    const source = fs.readFileSync(path.join(
      process.cwd(), "scripts", "execution-fabric", "producer", "resident-shadow-producer.mjs",
    ), "utf8")
    expect(source).not.toMatch(/child_process|execFile|spawn\(|fetch\(|https?:\/\//)
    expect(source).not.toContain("shadow-receipt-registry.json")
    expect(source).not.toContain("shadow-outcome-registry.json")
    expect(source).not.toMatch(/(?:execFile|spawn|execFileSync|spawnSync)\s*\([^)]*["'`]git["'`]/)
  })
})
