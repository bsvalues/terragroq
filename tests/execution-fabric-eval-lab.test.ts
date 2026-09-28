import { describe, expect, it } from "vitest"

import { CapabilityEvidenceSchema, EvaluationRunSchema, ScopedEvidenceReportSchema } from "@/components/operator/intelligence-fabric-contracts"
import { EVALUATION_CORPUS, evidenceFromRun, promoteToProven, scopeEvidence } from "../scripts/execution-fabric/eval-lab.mjs"

const subject = {
  modelArtifactId: "qwen3-8b-daedalus",
  runtimeId: "daedalus-hf-transformers",
  runtimeRevision: "5.16.1",
  runtimeConfigDigest: "sha256:" + "a".repeat(64),
  computeResourceClass: "NVIDIA_AMPERE_RTX3090_24GB",
}
const run = {
  id: "eval-qwen3-8b-001",
  taskId: "bounded-repo-task",
  capability: "bounded-read-only-inference",
  subject,
  metrics: { taskSuccess: 1, tokensPerSec: 31 },
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
    expect(ev.verdict).toBe("MEASURED")
    expect(ev.modelArtifactId).toBe(subject.modelArtifactId)
    expect(ev.runtimeRevision).toBe(subject.runtimeRevision)
    expect(ev.runtimeConfigDigest).toBe(subject.runtimeConfigDigest)
  })

  it("a capability/task with no corpus entry is refused, never silently MEASURED", () => {
    expect(() => evidenceFromRun({ ...run, taskId: "not-a-corpus-task" })).toThrow(/EVALUATION_TASK_NOT_IN_CORPUS/)
    expect(() => evidenceFromRun({ ...run, capability: "unsupported-capability" })).toThrow(/EVALUATION_TASK_NOT_IN_CORPUS/)
  })

  it("a run is evidence only for the corpus task it names (taskId is binding)", () => {
    const ev = evidenceFromRun(run) // bounded-repo-task measures taskSuccess
    expect(ev.evaluationId).toBe("eval-qwen3-8b-001")
    // a run naming taskId=bounded-repo-task but lacking taskSuccess metric fails its own task
    const noMetric = evidenceFromRun({ ...run, id: "eval-2", metrics: {} })
    expect(noMetric.verdict).not.toBe("MEASURED")
  })
})

describe("IF-05 subject cannot mark itself PROVEN", () => {
  it("independent promotion to PROVEN succeeds when the promoter differs from the subject", () => {
    const ev = evidenceFromRun(run)
    const proven = promoteToProven(ev, { subjectIdentity: "lane.daedalus-model", promotedBy: "agent.hermes.independent-review", expandsProductionEligibility: true })
    expect(proven.verdict).toBe("PROVEN")
    expect(CapabilityEvidenceSchema.safeParse(proven).success).toBe(true)
  })

  it("the subject marking itself PROVEN while expanding eligibility is refused, even via an alias", () => {
    const ev = evidenceFromRun(run)
    expect(() => promoteToProven(ev, { subjectIdentity: "lane.daedalus-model", promotedBy: "lane.daedalus-model", expandsProductionEligibility: true })).toThrow(/PROMOTION_SELF_ATTESTATION_FORBIDDEN/)
    // alias forms (case / separator differences) still canonicalize to the same subject
    expect(() => promoteToProven(ev, { subjectIdentity: "lane.daedalus-model", promotedBy: "Lane.Daedalus_Model", expandsProductionEligibility: true })).toThrow(/PROMOTION_SELF_ATTESTATION_FORBIDDEN/)
  })

  it("the contract itself refuses self-attested PROVEN evidence", () => {
    const ev = evidenceFromRun(run)
    const selfAttested = { ...ev, verdict: "PROVEN", promotedBy: "lane.daedalus-model", subjectIdentity: "lane.daedalus-model" }
    expect(CapabilityEvidenceSchema.safeParse(selfAttested).success).toBe(false)
  })
})

describe("IF-05 changed model/runtime revision scopes prior evidence", () => {
  it("evidence stays in scope while the binding is unchanged", () => {
    const ev = evidenceFromRun(run)
    const report = scopeEvidence(ev, subject)
    expect(ScopedEvidenceReportSchema.safeParse(report).success).toBe(true)
    expect(report.inScope).toBe(true)
  })

  it("a changed model revision scopes the evidence out (never carried forward, never rewritten)", () => {
    const ev = evidenceFromRun(run)
    const report = scopeEvidence(ev, { ...subject, modelArtifactId: "qwen3-8b-newrev" })
    expect(report.inScope).toBe(false)
    expect(report.scopeReason).toBe("model-revision-changed")
    expect(report.evidence.verdict).toBe("MEASURED") // original evidence is not rewritten
  })

  it("a changed runtime revision scopes the evidence out", () => {
    const ev = evidenceFromRun(run)
    const report = scopeEvidence(ev, { ...subject, runtimeRevision: "6.0.0" })
    expect(report.inScope).toBe(false)
    expect(report.scopeReason).toBe("runtime-changed")
  })

  it("a changed runtime config digest scopes the evidence out with the right reason", () => {
    const ev = evidenceFromRun(run)
    const report = scopeEvidence(ev, { ...subject, runtimeConfigDigest: "sha256:" + "b".repeat(64) })
    expect(report.inScope).toBe(false)
    expect(report.scopeReason).toBe("runtime-config-changed")
  })
})
