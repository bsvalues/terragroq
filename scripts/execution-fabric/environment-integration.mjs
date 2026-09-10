/**
 * IF-12 — Environment integration: make the Fabric disappear in normal use.
 *
 * The owner should never have to choose a model, a GPU, a runtime, or a provider, and should never
 * watch a provider-specific conversation or lose focus when work is rerouted. This module projects
 * the placement chain (IF-06/07/11) into TWO views:
 *
 *  - Thread-level human state: a job is "running" / "done" / "needs attention" with NO
 *    infrastructure vocabulary. A provider/model switch is a silent reroute, never a new pane or a
 *    navigation event.
 *  - An optional Technical/Execution projection the owner can open AFTER completion to inspect
 *    provenance (which model/runtime/compute actually ran, and why).
 */

const HUMAN_STATES = Object.freeze(["queued", "running", "done", "needs-attention"])

/**
 * Project a placement chain into Thread-level human state. This is the ONLY view in the required
 * path: it carries no model/provider/GPU/runtime names, no provider-specific conversation, and no
 * reroute event that would steal focus.
 *
 * chain: { status, rerouted?, outcomeSummary?, error? }
 */
export function projectThreadState(chain) {
  if (!chain || typeof chain !== "object") throw new Error("THREAD_CHAIN_INVALID")
  const status = HUMAN_STATES.includes(chain.status) ? chain.status : "running"
  return {
    // Human state only — the machinery is invisible here.
    state: status,
    // A reroute is folded into the same running job; it never surfaces as a new pane or navigation.
    message:
      status === "done" ? (chain.outcomeSummary ?? "Done.")
        : status === "needs-attention" ? "This needs your attention."
        : "Working on it.",
    // No model/provider/GPU/runtime vocabulary in the required path.
    infrastructureVisible: false,
    // No focus theft: a reroute is not a navigation event.
    focusEvent: null,
    // Provenance is available but not shown until the owner asks (Technical projection).
    provenanceAvailable: true,
  }
}

/**
 * The optional Technical/Execution projection of the placement chain. The owner opens this AFTER
 * completion to inspect provenance. It names the model/runtime/compute that actually ran and the
 * placement/optimizer rationale — the machinery, made visible on demand only.
 */
export function projectTechnicalView(placementDecision, execution, optimizerChoice) {
  if (!placementDecision || !execution) throw new Error("TECHNICAL_VIEW_REQUIRES_CHAIN")
  return {
    visible: true,
    selected: {
      model: execution.model ?? null,
      runtime: execution.runtime ?? null,
      compute: execution.compute ?? null,
      workerLane: placementDecision.selected?.candidateId ?? null,
    },
    placementRationale: placementDecision.reason ?? null,
    optimizerRationale: optimizerChoice?.rationale ?? null,
    consideredCount: (placementDecision.considered ?? []).length,
    refusedCount: (placementDecision.considered ?? []).filter((c) => !c.eligible).length,
    provenance: {
      placementDecisionId: placementDecision.id ?? null,
      executionId: execution.id ?? null,
    },
  }
}

/**
 * A provider/model switch during execution must NOT open panes, navigate, or steal focus. The
 * reroute is absorbed into the same Thread job; the human state stays "running".
 */
export function absorbReroute(threadState) {
  if (!threadState || threadState.infrastructureVisible) throw new Error("REROUTE_REQUIRES_THREAD_STATE")
  return { ...threadState, state: threadState.state === "done" ? "done" : "running", focusEvent: null }
}
