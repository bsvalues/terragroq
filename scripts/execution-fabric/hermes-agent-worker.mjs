/**
 * Tier 2 — Nous Hermes Agent as a governed Fabric worker runtime.
 *
 * The existing hermes-free-dev-agent binding (config/execution-fabric/hermes-free-dev-agent-v2.policy.json)
 * hard-codes its model to a local qwen. This module lets the Hermes Agent worker consume a
 * Fabric-selected model binding — HERMES places the work, the Fabric selects the model, and the
 * agent runtime executes against that binding rather than its own fixed universe. The owner-facing
 * product stays WilliamOS; Hermes Agent is a worker runtime the Fabric composes.
 */

/**
 * Resolve the model a Hermes Agent worker should execute against, given the Fabric's placement
 * decision. The worker never picks its own model — it executes the model the Fabric selected for
 * this placement, so model × runtime × compute is a single governed binding.
 *
 * placementDecision: the Fabric PlacementDecision (selected model + runtime + compute).
 * workerPolicy: the existing hermes-free-dev-agent policy (runtime, workspace, placement).
 * Returns the invocation context the agent should run with.
 */
export function resolveAgentModelBinding(placementDecision, workerPolicy) {
  if (!placementDecision?.selected) throw new Error("NO_PLACEMENT_DECISION")
  if (!workerPolicy?.providerId) throw new Error("NO_WORKER_POLICY")
  const selected = placementDecision.selected
  // The selected model's immutable identity is the exact binding the agent must load — never a
  // moving alias, so the agent reproduces the exact qualified model the Fabric chose.
  const modelIdentity = selected.model?.immutableIdentity ?? selected.immutableIdentity
  if (!modelIdentity) throw new Error("PLACEMENT_HAS_NO_MODEL_BINDING")
  return {
    providerId: workerPolicy.providerId,
    runtime: workerPolicy.runtime,
    // The Fabric-selected model overrides whatever the worker would otherwise default to.
    modelBinding: modelIdentity,
    executionClass: selected.executionClass ?? "LOCAL",
    compute: selected.compute?.id ?? workerPolicy.placement?.executionNode,
    runtimeId: selected.runtimeId ?? null,
  }
}

/**
 * Fail-closed: is this agent invocation consistent with the Fabric's placement? The worker must
 * execute the exact model the Fabric selected — if the invocation's model binding differs from the
 * placement decision, refuse (never silently run a different model than the one qualified).
 */
export function assertAgentExecutesPlacedModel(invocation, placementDecision) {
  const placedModel = placementDecision?.selected?.model?.immutableIdentity ?? placementDecision?.selected?.immutableIdentity
  if (!placedModel) return { ok: false, reason: "no-placed-model" }
  if (invocation.modelBinding !== placedModel) return { ok: false, reason: "model-mismatch", placed: placedModel, requested: invocation.modelBinding }
  return { ok: true }
}
