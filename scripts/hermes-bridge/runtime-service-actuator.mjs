/**
 * START_WORKSPACE_RUNTIME_SERVICE — the bounded, single-purpose runtime actuator for W1 (D5).
 *
 * This is the missing execution half of the authority architecture: WilliamOS can already AUTHORIZE
 * and ACQUIRE a `runtime_control:control` dependency; this actuator is the only thing permitted to
 * PERFORM one — and only for exactly one declared operation on exactly one declared service.
 *
 * Hard boundaries (deliberately narrow — this is NOT a runtime-control shell):
 *   - It takes NO command, args, script, shell, path, or port from the work item. Every executable
 *     fact comes from a governed launch contract, never from prose.
 *   - runtime_control does NOT compile or mutate source. Build and run are separate responsibilities:
 *     the launch contract points at a prepared, revision-bound artifact; if that artifact is absent,
 *     the actuator routes a build/artifact dependency rather than compiling anything itself.
 *   - It validates the ENTIRE governed binding envelope before any side effect: operation, capability,
 *     service identity, Project, WO, node, checkout, bound revision, concrete active grant, lease
 *     fence. Any mismatch / drift / expiry / fence-break refuses with a typed reason.
 *   - When no governed launch contract exists (today's reality), it refuses LAUNCH_CONTRACT_UNDEFINED
 *     and routes DEFINE_WORKSPACE_RUNTIME_LAUNCH_CONTRACT with the exact structured fields required.
 *     It NEVER improvises a dev server or asks a code agent to "figure out how to start it."
 *
 * Pure orchestration with all IO injected, so it is tested hard before HERMES is touched.
 */

export const ACTUATOR_OPERATION = "START_WORKSPACE_RUNTIME_SERVICE"
export const BOUND_SERVICE_IDENTITY = "terrafusion/os-shell"
export const BOUND_CAPABILITY = "runtime_control:control"

/** The structured fields a launch contract MUST declare before the actuator will run anything. A
 *  contract missing ANY of these is treated as undefined — the actuator refuses and routes the
 *  DEFINE dependency naming exactly what is missing. */
export const REQUIRED_LAUNCH_CONTRACT_FIELDS = Object.freeze([
  "serviceIdentity",
  "launchMode",
  "artifactPrerequisite",
  "command",
  "workingDirectory",
  "requiredEnvNames",
  "bindPolicy",
  "portPolicy",
  "readinessProbe",
  "shutdownMethod",
  "prerequisiteServices",
  "expectedProjectRevisionProof",
])

export const ACTUATOR_REFUSALS = Object.freeze({
  WRONG_OPERATION: "WRONG_OPERATION",
  WRONG_CAPABILITY: "WRONG_CAPABILITY",
  WRONG_SERVICE: "WRONG_SERVICE",
  WRONG_PROJECT: "WRONG_PROJECT",
  WRONG_WORK_ORDER: "WRONG_WORK_ORDER",
  WRONG_NODE: "WRONG_NODE",
  ARBITRARY_COMMAND_REJECTED: "ARBITRARY_COMMAND_REJECTED",
  CHECKOUT_MISSING: "CHECKOUT_MISSING",
  CHECKOUT_DRIFT: "CHECKOUT_DRIFT",
  GRANT_ABSENT: "GRANT_ABSENT",
  FENCE_MISMATCH: "FENCE_MISMATCH",
  LAUNCH_CONTRACT_UNDEFINED: "LAUNCH_CONTRACT_UNDEFINED",
  ARTIFACT_PREREQUISITE_MISSING: "ARTIFACT_PREREQUISITE_MISSING",
})

/** Keys that would be an arbitrary-command escape hatch if present on the request. The actuator
 *  refuses if the work item tries to smuggle ANY of these — the recipe is the contract's, never the
 *  work item's. */
const FORBIDDEN_WORK_ITEM_KEYS = Object.freeze([
  "command", "args", "script", "shell", "exec", "cmd", "run", "powershell", "bash", "port", "path",
])

function refuse(refusal, detail, routeDependency) {
  return routeDependency
    ? { ok: false, refusal, detail, routeDependency }
    : { ok: false, refusal, detail }
}

/** A contract is "defined" only if it is an object declaring every required field with a non-empty
 *  value (arrays may be empty — an explicit "no prerequisites" is a real declaration; strings and
 *  the artifact/proof objects may not be blank). Returns the list of missing/blank fields. */
export function launchContractMissingFields(contract) {
  if (!contract || typeof contract !== "object") return [...REQUIRED_LAUNCH_CONTRACT_FIELDS]
  const missing = []
  for (const field of REQUIRED_LAUNCH_CONTRACT_FIELDS) {
    const value = contract[field]
    if (value === undefined || value === null) { missing.push(field); continue }
    if (typeof value === "string" && value.trim() === "") { missing.push(field); continue }
    // requiredEnvNames / prerequisiteServices may be empty arrays (explicit), but must be arrays.
    if ((field === "requiredEnvNames" || field === "prerequisiteServices") && !Array.isArray(value)) {
      missing.push(field)
    }
  }
  return missing
}

/** The structured DEFINE dependency the actuator routes when no launch contract exists. */
export function defineLaunchContractDependency(serviceIdentity, boundRevision, missing) {
  return {
    operation: "DEFINE_WORKSPACE_RUNTIME_LAUNCH_CONTRACT",
    requiredResource: `launch-contract:${serviceIdentity}`,
    requiredClass: "runtime_config",
    requiredCapability: "write",
    serviceIdentity,
    boundRevision,
    requiredContractFields: [...REQUIRED_LAUNCH_CONTRACT_FIELDS],
    missing,
    // Build and run are separate: the contract MUST point at a prepared, revision-bound artifact, and
    // the actuator only starts/stops/observes it. runtime_control never compiles source.
    note: "runtime_control:control starts/stops/observes only; the contract points at a prepared, "
      + "revision-bound artifact. If no artifact exists, route a build/artifact dependency first. "
      + "Vite is dev tooling and is never the canonical W1 service.",
  }
}

/**
 * The actuator. Validates the whole governed envelope, then (today) refuses LAUNCH_CONTRACT_UNDEFINED.
 *
 * @param request bound execution facts, resolved by the caller from GOVERNED bindings only:
 *   { operation, capability, serviceIdentity, projectId, workOrderId, node, checkoutPath,
 *     boundRevision, expected: { serviceIdentity, projectId, workOrderId, node, boundRevision },
 *     grant, fence }
 *   The request MUST NOT carry any executable recipe (command/args/script/shell/port/path/...).
 * @param deps injected IO:
 *   { readCheckoutRevision(path) => sha|null,
 *     verifyGrant(grant) => { ok, detail? },
 *     verifyFence(fence) => { ok, detail? },
 *     loadLaunchContract(serviceIdentity, boundRevision) => contract|null,
 *     artifactExists?(prerequisite, boundRevision) => boolean }
 */
export async function startWorkspaceRuntimeService(request, deps) {
  const r = request ?? {}
  const expected = r.expected ?? {}

  // 0. Exactly this actuator's operation + capability, or refuse. A source capability never gets here.
  if (r.operation !== ACTUATOR_OPERATION) {
    return refuse("WRONG_OPERATION", `actuator performs only ${ACTUATOR_OPERATION}, got ${r.operation ?? "<none>"}`)
  }
  if (r.capability !== BOUND_CAPABILITY) {
    return refuse("WRONG_CAPABILITY", `actuator requires ${BOUND_CAPABILITY}, got ${r.capability ?? "<none>"}`)
  }

  // 1. NO arbitrary command escape hatch. The recipe is the contract's, never the work item's.
  for (const key of FORBIDDEN_WORK_ITEM_KEYS) {
    if (r[key] !== undefined) {
      return refuse("ARBITRARY_COMMAND_REJECTED", `work item may not carry '${key}'; the launch recipe comes only from the governed contract`)
    }
  }

  // 2. Service / Project / WO / node identity, all against governed expectations.
  if (r.serviceIdentity !== BOUND_SERVICE_IDENTITY || r.serviceIdentity !== expected.serviceIdentity) {
    return refuse("WRONG_SERVICE", `service ${r.serviceIdentity} != bound ${BOUND_SERVICE_IDENTITY}/${expected.serviceIdentity}`)
  }
  if (r.projectId !== expected.projectId) return refuse("WRONG_PROJECT", `project ${r.projectId} != ${expected.projectId}`)
  if (r.workOrderId !== expected.workOrderId) return refuse("WRONG_WORK_ORDER", `WO ${r.workOrderId} != ${expected.workOrderId}`)
  if (r.node !== expected.node) return refuse("WRONG_NODE", `node ${r.node} != ${expected.node}`)

  // 3. Checkout exists and is at the exact bound revision (no drift). runtime_control never mutates it.
  const rev = await deps.readCheckoutRevision(r.checkoutPath)
  if (rev == null) return refuse("CHECKOUT_MISSING", `no checkout at ${r.checkoutPath}`)
  if (rev !== r.boundRevision || rev !== expected.boundRevision) {
    return refuse("CHECKOUT_DRIFT", `checkout ${rev} != bound ${r.boundRevision}/${expected.boundRevision}`)
  }

  // 4. Concrete active grant, re-verified at execution (matched is never trusted alone).
  const grantOk = await deps.verifyGrant(r.grant)
  if (!grantOk?.ok) return refuse("GRANT_ABSENT", grantOk?.detail ?? "no active grant backs this operation")

  // 5. Lease fence matches the live projection lease (a stale/forged fence is refused).
  const fenceOk = await deps.verifyFence(r.fence)
  if (!fenceOk?.ok) return refuse("FENCE_MISMATCH", fenceOk?.detail ?? "execution fence does not match the live lease")

  // 6. Everything governed is validated. Require a launch contract; refuse if undefined. NEVER improvise.
  const contract = await deps.loadLaunchContract(r.serviceIdentity, r.boundRevision)
  const missing = launchContractMissingFields(contract)
  if (missing.length > 0) {
    return refuse(
      "LAUNCH_CONTRACT_UNDEFINED",
      `no governed launch contract for ${r.serviceIdentity} at ${r.boundRevision}; missing: ${missing.join(", ")}`,
      defineLaunchContractDependency(r.serviceIdentity, r.boundRevision, missing),
    )
  }

  // 7. Build/run separation: the contract must point at a prepared, revision-bound artifact. If it is
  //    absent, route a build/artifact dependency — the runtime actuator does not compile.
  if (contract.artifactPrerequisite) {
    const present = deps.artifactExists ? await deps.artifactExists(contract.artifactPrerequisite, r.boundRevision) : false
    if (!present) {
      return refuse("ARTIFACT_PREREQUISITE_MISSING", `artifact ${contract.artifactPrerequisite} for ${r.boundRevision} is not prepared`, {
        operation: "BUILD_WORKSPACE_RUNTIME_ARTIFACT",
        requiredResource: `artifact:${r.serviceIdentity}`,
        requiredClass: "artifact",
        requiredCapability: "write",
        serviceIdentity: r.serviceIdentity,
        boundRevision: r.boundRevision,
        artifactPrerequisite: contract.artifactPrerequisite,
      })
    }
  }

  // 8. A valid contract + prepared artifact exist. Starting/observing the exact governed service is
  //    the next build step, unreachable until a contract is defined (this pass ends at step 6).
  return { ok: true, ready: true, serviceIdentity: r.serviceIdentity, boundRevision: r.boundRevision, contract }
}
