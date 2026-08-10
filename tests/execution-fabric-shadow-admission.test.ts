import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import { compileShadowAdmission } from "../scripts/execution-fabric/admission/compile-shadow-admission.mjs"

type Json = Record<string, any>
const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex")
const reviewed = ({ reviewedCommit, artifacts }: Json) => ({ trusted_ref: "refs/heads/main", reviewed_commit: reviewedCommit, exact_artifact_count: artifacts.length })
const compile = (selected: Json, proof: any = reviewed) => compileShadowAdmission({ candidate: selected.candidate, repositoryRoot: selected.root, reviewProof: proof })

function fixture(overrides: Json = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-admission-"))
  const commit = "a".repeat(40)
  const write = (relative: string, bytes: Buffer | string) => {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
    return { path: relative, sha256: sha(bytes) }
  }
  const receipt = {
    schema_version: "0.2-pinned-placement-recommendation", status: "RECOMMENDED",
    recommendation_only: true, eligibility_scope: "recommendation-only", work_order_id: "WO-LIVE-001",
    evaluated_at: "2026-08-10T07:59:30.000Z",
    workload: { id: "reviewed-maintenance", title: "Reviewed maintenance", storage_semantics: "none" },
    scheduler: { state: "disabled", authority: "not-granted", autonomous_dispatch: "forbidden" },
    recommendation: { node_id: "omen", rank: 1, rank_basis: { stable_node_id: "omen" }, execution_authorized: false, dispatch_allowed: false },
    eligible_nodes: [{ node_id: "omen", eligible: true, rank: 1, rank_basis: { stable_node_id: "omen" }, reasons: [], evidence_used: [], confidence: "observed", freshness: { state: "fresh", expires_at: "2026-08-10T08:00:30.000Z" }, execution_authorized: false, dispatch_allowed: false }],
    ineligible_nodes: [], confidence: { state: "observed", freshness: "fresh", registry_freshness: "fresh" },
    placement_policy_version: "execution-fabric-placement/0.2",
    evidence_snapshot: [{ node: "aegis", snapshot_sha256: "2".repeat(64) }, { node: "atlas", snapshot_sha256: "3".repeat(64) }, { node: "hermes-node", snapshot_sha256: "4".repeat(64) }],
    evidence_verifier: { contract: "jcs-rfc8785/1", sha256: "5".repeat(64), result: "PASS" },
    input_artifacts: { registry_base_sha256: "6".repeat(64) }, decision_input_sha256: "1".repeat(64),
    authority_mutated: false, remote_systems_modified: false,
  }
  const outcome = {
    actual_target_node: "omen",
    authority_outcome: { checked_at: "2026-08-10T08:00:01.000Z", reference: "authority-WO-LIVE-001", status: "COMPLIANT" },
    completed_at: "2026-08-10T08:00:03.000Z",
    resource_observations: [{ metric: "concurrency_used", observed_at: "2026-08-10T08:00:02.000Z", unit: "count", value: 1 }],
    result: "SUCCEEDED", schema_version: "0.1-shadow-outcome-evidence",
    started_at: "2026-08-10T08:00:00.000Z", status: "COMPLETED", work_order_id: "WO-LIVE-001",
  }
  const outcomeBytes = Buffer.from(`${canonicalizeJcs(outcome)}\n`)
  const candidate = {
    schema_version: "0.1-shadow-admission-candidate", candidate_id: "WO-LIVE-001-run-1",
    work_order_id: "WO-LIVE-001", workload_id: "reviewed-maintenance", producer_lane: "resident-hermes",
    outcome_kind: "RESIDENT_HERMES_REVIEWED",
    receipt: write("docs/reports/shadow-admission/WO-LIVE-001-receipt.json", `${JSON.stringify(receipt)}\n`),
    delivery_record: write("docs/reports/WO-LIVE-001-delivery.md", "# WO-LIVE-001\n\nTARGET: omen\n\n## Result\nPASS\n\nLATENCY_MS: 3000\n"),
    outcome_evidence: write("docs/reports/execution-fabric-shadow-outcomes/WO-LIVE-001.json", outcomeBytes),
    review_evidence: write("docs/reports/shadow-admission/WO-LIVE-001-review.md", `# WO-LIVE-001 review\n\nReviewed commit: ${commit}\n`),
    authority: { reference: "authority-WO-LIVE-001", allowed_canonical_nodes: ["omen"], valid_from: "2026-08-10T07:59:00.000Z", expires_at: "2026-08-10T08:01:00.000Z", reviewed_commit: commit },
    review_commit: "b".repeat(40),
    recorded_at: "2026-08-10T08:01:01.000Z", divergence_reasons: [],
    ...overrides,
  }
  return { root, candidate }
}

describe("Execution Fabric genuine shadow outcome admission", () => {
  it("compiles genuine reviewed evidence into deterministic evaluator inputs without dispatch", () => {
    const selected = fixture()
    const first = compile(selected)
    const second = compile(selected)
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      status: "READY_FOR_REVIEWED_REGISTRY_ADMISSION",
      observation: { classification: "recorded-historical-observation", manual_target: "omen", divergence_reasons: [] },
      registry_entries: {
        receipt: { work_order_id: "WO-LIVE-001", status: "TRUSTED" },
        outcome: { actual_target_node: "omen", status: "ACTIVE" },
        authority: { allowed_canonical_nodes: ["omen"], status: "ACTIVE" },
      },
      safety: { observation_only: true, job_launched: false, scheduler_activated: false, dispatch_authority_granted: false, authority_mutated: false, remote_accessed: false, shell_executed: false },
    })
    expect(first.bundle_sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it("requires retained review bytes to bind the Work Order and exact reviewed commit", () => {
    const selected = fixture()
    const reviewPath = path.join(selected.root, selected.candidate.review_evidence.path)
    fs.writeFileSync(reviewPath, "# unrelated review\n")
    selected.candidate.review_evidence.sha256 = sha(fs.readFileSync(reviewPath))
    expect(() => compile(selected))
      .toThrow("review evidence does not bind Work Order and reviewed commit")
  })

  it("rejects authority gaps, premature admission, and fabricated target divergence", () => {
    let selected = fixture({ authority: { reference: "authority-WO-LIVE-001", allowed_canonical_nodes: ["atlas"], valid_from: "2026-08-10T07:59:00.000Z", expires_at: "2026-08-10T08:01:00.000Z", reviewed_commit: "a".repeat(40) } })
    expect(() => compile(selected)).toThrow("reviewed authority does not include actual target")

    selected = fixture({ recorded_at: "2026-08-10T08:00:01.000Z" })
    expect(() => compile(selected)).toThrow("admission predates outcome completion")

    selected = fixture({ divergence_reasons: ["MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION"] })
    expect(() => compile(selected)).toThrow("target divergence classification does not match")
  })

  it("rejects executable or secret-bearing producer packages before reading evidence", () => {
    const executable = fixture({ command: "do work" })
    expect(() => compile(executable)).toThrow("not permitted in observation-only admission")
    const secret = fixture({ producer_lane: "Bearer abcdefghijklmnopqrstuvwxyz" })
    expect(() => compile(secret)).toThrow("secret-like material")
  })

  it("fails closed when trusted-main proof does not bind all exact artifacts", () => {
    const selected = fixture()
    expect(() => compile(selected, ({ reviewedCommit }: Json) => ({ trusted_ref: "refs/heads/main", reviewed_commit: reviewedCommit, exact_artifact_count: 2 })))
      .toThrow("review proof did not bind trusted main")
  })

  it("rejects receipts outside the canonical Phase 2 contract and unmerged review records", () => {
    const invalidReceipt = fixture()
    const receiptPath = path.join(invalidReceipt.root, invalidReceipt.candidate.receipt.path)
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    receipt.scheduler.state = "enabled"
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`)
    invalidReceipt.candidate.receipt.sha256 = sha(fs.readFileSync(receiptPath))
    expect(() => compile(invalidReceipt)).toThrow("receipt scheduler boundary is invalid")

    const missingReview = fixture()
    expect(() => compile(missingReview, ({ reviewedCommit, artifacts }: Json) => ({
      trusted_ref: "refs/heads/main",
      reviewed_commit: reviewedCommit,
      exact_artifact_count: reviewedCommit === missingReview.candidate.review_commit ? 0 : artifacts.length,
    }))).toThrow("review proof did not bind the exact review record")
  })

  it("rejects cross-artifact target, recommendation chronology, and freshness mismatches", () => {
    let selected = fixture()
    let receiptPath = path.join(selected.root, selected.candidate.receipt.path)
    let receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    receipt.eligible_nodes = []
    receipt.status = "NO_ELIGIBLE_NODE"
    receipt.recommendation = null
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`)
    selected.candidate.receipt.sha256 = sha(fs.readFileSync(receiptPath))
    expect(() => compile(selected)).toThrow("actual target is not eligible")

    selected = fixture()
    receiptPath = path.join(selected.root, selected.candidate.receipt.path)
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    receipt.evaluated_at = "2026-08-10T08:00:01.000Z"
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`)
    selected.candidate.receipt.sha256 = sha(fs.readFileSync(receiptPath))
    expect(() => compile(selected)).toThrow("outcome execution predates")

    selected = fixture()
    receiptPath = path.join(selected.root, selected.candidate.receipt.path)
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    receipt.eligible_nodes[0].freshness.expires_at = "2026-08-10T08:00:00.000Z"
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`)
    selected.candidate.receipt.sha256 = sha(fs.readFileSync(receiptPath))
    expect(() => compile(selected)).toThrow("at or after actual target evidence expiry")
  })

  it("rejects delivery records that do not prove the actual target and latency", () => {
    let selected = fixture()
    let deliveryPath = path.join(selected.root, selected.candidate.delivery_record.path)
    fs.writeFileSync(deliveryPath, "# WO-LIVE-001\n\n## Result\nPASS\n\nLATENCY_MS: 3000\n")
    selected.candidate.delivery_record.sha256 = sha(fs.readFileSync(deliveryPath))
    expect(() => compile(selected)).toThrow("does not identify the recorded manual target")

    selected = fixture()
    deliveryPath = path.join(selected.root, selected.candidate.delivery_record.path)
    fs.writeFileSync(deliveryPath, "# WO-LIVE-001\n\nTARGET: omen\n\n## Result\nPASS\n\nLATENCY_MS: 2999\n")
    selected.candidate.delivery_record.sha256 = sha(fs.readFileSync(deliveryPath))
    expect(() => compile(selected)).toThrow("does not support the recorded latency")
  })

  it("rejects impossible calendar instants and symlinked retained evidence", () => {
    const impossible = fixture({ recorded_at: "2026-02-30T08:01:01.000Z" })
    expect(() => compile(impossible)).toThrow("must name a real UTC calendar instant")

    if (process.platform !== "win32") {
      const linked = fixture()
      const receiptPath = path.join(linked.root, linked.candidate.receipt.path)
      const targetPath = `${receiptPath}.target`
      fs.renameSync(receiptPath, targetPath)
      fs.symlinkSync(targetPath, receiptPath)
      expect(() => compile(linked)).toThrow("must not be a symbolic link")
    }
  })
})
