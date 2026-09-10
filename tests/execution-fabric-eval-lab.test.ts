import { describe, expect, it } from "vitest"

import { CapabilityEvidenceSchema, EvaluationRunSchema } from "@/components/operator/intelligence-fabric-contracts"
import { EVALUATION_CORPUS, evidenceFromRun, promoteToProven, scopeEvidence } from "../scripts/execution-fabric/eval-lab.mjs"

const subject = {
  modelArtifactId: "qwen3-8b-daedalus",
  runtimeId: "daedalus-hf-transformers",
  runtimeConfigDigest: "sha256:" + "a".repeat(64),
  computeResourceClass: "NVIDIA_AMPERE_RTX3090_24GB",
}
const passingMetrics = { schemaValidity: 1, contextFaithfulness: 0.95, taskSuccess: 1, authorityCompliance: 1, semanticScopeCompliance: 1, toolAccuracy: 1, withinBudget: 1, tokensPerSec: 31 }
const run = {
  id: "eval-qwen3-8b-001",
  taskId: "bounded-repo-task",
  capability: "bounded-read-only-inference",
  subject,
  metrics: passingMetrics,
  outcome: "PASS",
  ranAt: "2026-09-10T11:00:00Z",
  evaluatorRef: "eval-lab.v1",
  evidenceRef: "local://daedalus/evaluations/eval-qwen3-8b-001.json",
}

describe("IF-05 evaluation contracts", () => {
  it("an EvaluationRun validates against the contract", () => {
    expect(EvaluationRunSchema.safeParse(run).success).toBe(true)
  })

  it("the representative corpus covers all required dimensions", () => {
    const metrics = new Set(EVALUATION_CORPUS.map((t) => t.metric))
    for (const m of ["schemaValidity", "contextFaithfulness", "taskSuccess", "authorityCompliance", "semanticScopeCompliance", "toolAccuracy", "withinBudget"]) {
      expect(metrics.has(m), `corpus must measure ${m}`).toBe(true)
    }
  })
})

describe("IF-05 evidence binds exact model × runtime × config × compute class", () => {
  it("a passing run yields MEASURED evidence bound to the exact binding, never PROVEN from the runner", () => {
    const ev = evidenceFromRun(run)
    expect(CapabilityEvidenceSchema.safeParse(ev).success).toBe(true)
    expect(ev.verdict).toBe("MEASURED") // the runner never marks PROVEN
    expect(ev.modelArtifactId).toBe(subject.modelArtifactId)
    expect(ev.runtimeId).toBe(subject.runtimeId)
    expect(ev.runtimeConfigDigest).toBe(subject.runtimeConfigDigest)
    expect(ev.computeResourceClass).toBe(subject.computeResourceClass)
  })

  it("a failing run yields FAILED evidence", () => {
    const ev = evidenceFromRun({ ...run, id: "eval-fail", outcome: "FAIL", metrics: { ...passingMetrics, taskSuccess: 0 } })
    expect(ev.verdict).toBe("FAILED")
  })
})

describe("IF-05 subject cannot mark itself PROVEN", () => {
  it("independent promotion to PROVEN succeeds when the promoter differs from the subject", () => {
    const ev = evidenceFromRun(run)
    const proven = promoteToProven(ev, { subjectIdentity: "lane.daedalus-model", promotedBy: "agent.hermes.independent-review", expandsProductionEligibility: true })
    expect(proven.verdict).toBe("PROVEN")
    expect(proven.promotedBy).toBe("agent.hermes.independent-review")
  })

  it("the subject marking itself PROVEN while expanding production eligibility is refused", () => {
    const ev = evidenceFromRun(run)
    expect(() => promoteToProven(ev, { subjectIdentity: "lane.daedalus-model", promotedBy: "lane.daedalus-model", expandsProductionEligibility: true }))
      .toThrow(/PROMOTION_SELF_ATTESTATION_FORBIDDEN/)
  })

  it("promotion requires a MEASURED verdict and an independent promoter", () => {
    const ev = evidenceFromRun(run)
    expect(() => promoteToProven({ ...ev, verdict: "UNKNOWN" }, { subjectIdentity: "a", promotedBy: "b", expandsProductionEligibility: true })).toThrow(/PROMOTION_REQUIRES_MEASURED/)
    expect(() => promoteToProven(ev, { subjectIdentity: "a", promotedBy: null, expandsProductionEligibility: true })).toThrow(/PROMOTION_REQUIRES_INDEPENDENT_PROMOTER/)
  })
})

describe("IF-05 changed model/runtime revision scopes prior evidence", () => {
  it("evidence stays valid while the binding is unchanged", () => {
    const ev = evidenceFromRun(run)
    const scoped = scopeEvidence(ev, subject)
    expect(scoped.scopedOut).toBe(false)
    expect(scoped.verdict).toBe(ev.verdict)
  })

  it("a changed model revision retires the evidence (never silently carried forward)", () => {
    const ev = evidenceFromRun(run)
    const scoped = scopeEvidence(ev, { ...subject, modelArtifactId: "qwen3-8b-daedalus-newrev" })
    expect(scoped.scopedOut).toBe(true)
    expect(scoped.verdict).toBe("RETIRED")
    expect(scoped.scopeReason).toBe("model-revision-changed")
  })

  it("a changed runtime config digest retires the evidence with the right reason", () => {
    const ev = evidenceFromRun(run)
    const scoped = scopeEvidence(ev, { ...subject, runtimeConfigDigest: "sha256:" + "b".repeat(64) })
    expect(scoped.verdict).toBe("RETIRED")
    expect(scoped.scopeReason).toBe("runtime-config-changed")
  })
})
