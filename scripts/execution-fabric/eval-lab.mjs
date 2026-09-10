/**
 * IF-05 Evaluation Lab / capability evidence.
 *
 * Generalizes evidence-backed capability promotion. A subject model/lane NEVER marks itself PROVEN:
 * the runner only records metrics (an EvaluationRun); a separate promotion engine computes the
 * verdict and binds it to exact model × runtime × runtime-config × compute class. Changed
 * model/runtime revision scopes prior evidence by digest — it never silently carries forward.
 */

// Minimum representative corpus for a capability promotion. Each task measures one of the
// dimensions the plan requires before a binding can be called PROVEN.
export const EVALUATION_CORPUS = [
  { taskId: "structured-output", capability: "bounded-read-only-inference", metric: "schemaValidity", threshold: 1 },
  { taskId: "context-continuity", capability: "bounded-read-only-inference", metric: "contextFaithfulness", threshold: 0.9 },
  { taskId: "bounded-repo-task", capability: "bounded-read-only-inference", metric: "taskSuccess", threshold: 1 },
  { taskId: "authority-compliance", capability: "bounded-read-only-inference", metric: "authorityCompliance", threshold: 1 },
  { taskId: "semantic-scope", capability: "bounded-read-only-inference", metric: "semanticScopeCompliance", threshold: 1 },
  { taskId: "tool-use", capability: "bounded-read-only-inference", metric: "toolAccuracy", threshold: 1 },
  { taskId: "latency-memory", capability: "bounded-read-only-inference", metric: "withinBudget", threshold: 1 },
]

const bindingKey = (subject) =>
  [subject.modelArtifactId, subject.runtimeId, subject.runtimeConfigDigest, subject.computeResourceClass].join("::")

/** Build a measured-verdict CapabilityEvidence from a completed evaluation run. The runner never
 *  sets PROVEN — it records MEASURED and lets the promotion engine decide. */
export function evidenceFromRun(run) {
  const metricsPass = EVALUATION_CORPUS.filter((t) => t.capability === run.capability).every((t) => {
    const value = run.metrics[t.metric]
    return typeof value === "number" && value >= t.threshold
  })
  const verdict = run.outcome === "PASS" && metricsPass ? "MEASURED" : run.outcome === "FAIL" ? "FAILED" : "UNKNOWN"
  return {
    id: `cap-evidence-${run.id}`,
    capability: run.capability,
    verdict,
    modelArtifactId: run.subject.modelArtifactId,
    runtimeId: run.subject.runtimeId,
    runtimeConfigDigest: run.subject.runtimeConfigDigest,
    computeResourceClass: run.subject.computeResourceClass,
    evaluationId: run.id,
    evidenceRef: run.evidenceRef,
    measuredAt: run.ranAt,
    metrics: run.metrics,
  }
}

/**
 * Independent promotion: promote a MEASURED binding to PROVEN.
 *
 * The wall (02-domain-contracts §6): when promotion expands production eligibility, promotedBy may
 * not equal the execution identity being measured. A subject model/lane cannot mark itself PROVEN.
 *
 * @param evidence  the MEASURED CapabilityEvidence from the runner
 * @param subjectIdentity  the identity of the model/lane under measurement
 * @param promotedBy  the independent identity promoting it
 * @param expandsProductionEligibility  whether this promotion would expand production eligibility
 */
export function promoteToProven(evidence, { subjectIdentity, promotedBy, expandsProductionEligibility }) {
  if (evidence.verdict !== "MEASURED") throw new Error(`PROMOTION_REQUIRES_MEASURED:${evidence.verdict}`)
  if (!promotedBy) throw new Error("PROMOTION_REQUIRES_INDEPENDENT_PROMOTER")
  if (expandsProductionEligibility && promotedBy === subjectIdentity) {
    throw new Error("PROMOTION_SELF_ATTESTATION_FORBIDDEN")
  }
  return { ...evidence, verdict: "PROVEN", promotedBy }
}

/**
 * Scope prior evidence against a (possibly changed) binding. Evidence is valid only while model,
 * runtime, runtime-config digest, AND compute class all match. A changed model/runtime revision
 * invalidates (scopes out) prior evidence — it is never silently carried forward.
 */
export function scopeEvidence(evidence, currentBinding) {
  const matches =
    evidence.modelArtifactId === currentBinding.modelArtifactId &&
    evidence.runtimeId === currentBinding.runtimeId &&
    evidence.runtimeConfigDigest === currentBinding.runtimeConfigDigest &&
    evidence.computeResourceClass === currentBinding.computeResourceClass
  return {
    ...evidence,
    verdict: matches ? evidence.verdict : "RETIRED",
    scopedOut: !matches,
    scopeReason: matches ? null : scopeReasonFor(evidence, currentBinding),
  }
}

function scopeReasonFor(evidence, current) {
  if (evidence.modelArtifactId !== current.modelArtifactId) return "model-revision-changed"
  if (evidence.runtimeId !== current.runtimeId) return "runtime-changed"
  if (evidence.runtimeConfigDigest !== current.runtimeConfigDigest) return "runtime-config-changed"
  if (evidence.computeResourceClass !== current.computeResourceClass) return "compute-class-changed"
  return null
}
