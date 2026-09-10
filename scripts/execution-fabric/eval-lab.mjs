/**
 * IF-05 Evaluation Lab / capability evidence.
 *
 * Generalizes evidence-backed capability promotion. A subject model/lane NEVER marks itself PROVEN:
 * the runner only records metrics (an EvaluationRun); a separate promotion engine computes the
 * verdict and binds it to exact model × runtime × runtime-revision × config × compute class.
 * Changed model/runtime revision scopes prior evidence via a report — it never silently carries
 * forward and never rewrites the original evidence.
 */

// Minimum representative corpus for a capability promotion. Each task measures one of the
// dimensions the plan requires before a binding can be called PROVEN. One task == one metric.
export const EVALUATION_CORPUS = [
  { taskId: "structured-output", capability: "bounded-read-only-inference", metric: "schemaValidity", threshold: 1 },
  { taskId: "context-continuity", capability: "bounded-read-only-inference", metric: "contextFaithfulness", threshold: 0.9 },
  { taskId: "bounded-repo-task", capability: "bounded-read-only-inference", metric: "taskSuccess", threshold: 1 },
  { taskId: "authority-compliance", capability: "bounded-read-only-inference", metric: "authorityCompliance", threshold: 1 },
  { taskId: "semantic-scope", capability: "bounded-read-only-inference", metric: "semanticScopeCompliance", threshold: 1 },
  { taskId: "tool-use", capability: "bounded-read-only-inference", metric: "toolAccuracy", threshold: 1 },
  { taskId: "latency-memory", capability: "bounded-read-only-inference", metric: "withinBudget", threshold: 1 },
]

// Canonicalize an identity so the self-attestation wall cannot be bypassed by an alias: the same
// subject under any spelling/alias/case maps to one canonical form for the equality check.
const canonicalIdentity = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[._]+/g, "-")

const corpusTask = (capability, taskId) => EVALUATION_CORPUS.find((t) => t.capability === capability && t.taskId === taskId)

/**
 * Build a MEASURED-verdict CapabilityEvidence from a completed evaluation run. The runner never
 * sets PROVEN. The evidence is bound to the exact task the run executed: a run is only evidence
 * for the corpus task it names, and a capability with no corpus task is refused outright (never
 * silently "passes" on an empty filter).
 */
export function evidenceFromRun(run) {
  const task = corpusTask(run.capability, run.taskId)
  if (!task) throw new Error(`EVALUATION_TASK_NOT_IN_CORPUS:${run.capability}/${run.taskId}`)
  const value = run.metrics[task.metric]
  const metricPass = typeof value === "number" && value >= task.threshold
  const verdict = run.outcome === "PASS" && metricPass ? "MEASURED" : run.outcome === "FAIL" ? "FAILED" : "UNKNOWN"
  return {
    id: `cap-evidence-${run.id}`,
    capability: run.capability,
    verdict,
    modelArtifactId: run.subject.modelArtifactId,
    runtimeId: run.subject.runtimeId,
    runtimeRevision: run.subject.runtimeRevision,
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
 * not equal the execution identity being measured — compared on their CANONICAL forms so an alias
 * cannot slip past the equality check. A subject model/lane cannot mark itself PROVEN.
 */
export function promoteToProven(evidence, { subjectIdentity, promotedBy, expandsProductionEligibility }) {
  if (evidence.verdict !== "MEASURED") throw new Error(`PROMOTION_REQUIRES_MEASURED:${evidence.verdict}`)
  if (!promotedBy) throw new Error("PROMOTION_REQUIRES_INDEPENDENT_PROMOTER")
  if (expandsProductionEligibility && canonicalIdentity(promotedBy) === canonicalIdentity(subjectIdentity)) {
    throw new Error("PROMOTION_SELF_ATTESTATION_FORBIDDEN")
  }
  return { ...evidence, verdict: "PROVEN", promotedBy, subjectIdentity }
}

/**
 * Scope prior evidence against a (possibly changed) binding. Returns a ScopedEvidenceReport — the
 * original evidence is never rewritten. Evidence is in scope only while model, runtime, runtime
 * revision, runtime-config digest, AND compute class all match. Any change marks it out of scope
 * with the exact reason, so it is never silently carried forward.
 */
export function scopeEvidence(evidence, currentBinding) {
  const reason = scopeReasonFor(evidence, currentBinding)
  return { evidence, inScope: reason === null, scopeReason: reason }
}

function scopeReasonFor(evidence, current) {
  if (evidence.modelArtifactId !== current.modelArtifactId) return "model-revision-changed"
  if (evidence.runtimeId !== current.runtimeId) return "runtime-changed"
  if (evidence.runtimeRevision !== undefined && current.runtimeRevision !== undefined && evidence.runtimeRevision !== current.runtimeRevision) return "runtime-changed"
  if (evidence.runtimeConfigDigest !== current.runtimeConfigDigest) return "runtime-config-changed"
  if (evidence.computeResourceClass !== current.computeResourceClass) return "compute-class-changed"
  return null
}
