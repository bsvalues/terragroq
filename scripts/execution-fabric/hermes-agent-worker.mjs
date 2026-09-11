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
  // A model × runtime × compute binding is incomplete without all three — fail closed rather than
  // hand the agent an undefined runtime/compute.
  if (!workerPolicy.runtime) throw new Error("WORKER_POLICY_INCOMPLETE:no-runtime")
  if (!workerPolicy.placement?.executionNode) throw new Error("WORKER_POLICY_INCOMPLETE:no-placement")
  const selected = placementDecision.selected
  // The selected model's immutable identity is the exact binding the agent must load — never a
  // moving alias, so the agent reproduces the exact qualified model the Fabric chose.
  const modelIdentity = selected.model?.immutableIdentity ?? selected.immutableIdentity
  if (!modelIdentity) throw new Error("PLACEMENT_HAS_NO_MODEL_BINDING")
  const runtimeId = selected.runtimeId ?? null
  const compute = selected.compute?.id ?? null
  if (!runtimeId) throw new Error("PLACEMENT_INCOMPLETE:no-runtime-binding")
  if (!compute) throw new Error("PLACEMENT_INCOMPLETE:no-compute-binding")
  return {
    providerId: workerPolicy.providerId,
    runtime: workerPolicy.runtime,
    // The Fabric-selected model overrides whatever the worker would otherwise default to.
    modelBinding: modelIdentity,
    // The serving alias the proxy actually resolves; the immutable identity is the evidence binding.
    modelAlias: selected.model?.alias ?? String(modelIdentity).split("@")[0],
    executionClass: selected.executionClass ?? "LOCAL",
    compute,
    runtimeId,
  }
}

/**
 * Convert a live Fabric placement recommendation (node_id from the placement evidence) into the
 * placement decision the worker resolver consumes, using the worker policy's qualified bindings.
 * Fail-closed: no qualified binding for the recommended node means NO placement for this worker —
 * the worker must not improvise a model for a node it was never qualified on.
 */
export function placementDecisionFromFabric({ recommendation, qualifiedBindings = [] }) {
  const nodeId = recommendation?.recommendation?.node_id ?? recommendation?.node_id ?? null
  if (!nodeId) throw new Error("NO_PLACEMENT_RECOMMENDATION")
  const matches = qualifiedBindings.filter((binding) => binding.computeId === nodeId)
  if (matches.length === 0) throw new Error(`PLACEMENT_INCOMPLETE:no-model-for-node:${nodeId}`)
  if (matches.length > 1) throw new Error(`PLACEMENT_AMBIGUOUS:${nodeId}`)
  const binding = matches[0]
  return {
    selected: {
      model: { immutableIdentity: binding.modelIdentity, alias: binding.alias },
      runtimeId: binding.runtimeId,
      compute: { id: binding.computeId },
      executionClass: binding.executionClass ?? "LOCAL",
    },
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
  const requested = invocation && typeof invocation === "object" ? invocation.modelBinding : undefined
  if (typeof requested !== "string" || requested.length === 0) return { ok: false, reason: "no-invocation-model-binding" }
  if (requested !== placedModel) return { ok: false, reason: "model-mismatch", placed: placedModel, requested }
  return { ok: true }
}
