/**
 * The premise a runtime-provisioning actor must check BEFORE starting the service.
 *
 * runtime_control lets an actor start, stop, and restart a service. It does NOT license fixing the
 * source tree underneath that service. The serving-node checkout we observed on HERMES is at
 * fd294dc3 while another observed TerraFusion checkout was at 731b15f0, so "just start the OS Shell
 * here" could start it from the wrong revision and then observe a real endpoint over it. That is the
 * original failure in a new form: canonical service correct, real endpoint correct, wrong revision
 * underneath.
 *
 * So provisioning begins with one question -- does the serving-node checkout's observed revision
 * equal the W1-bound revision? -- and the answer routes:
 *
 *   match    → start the declared service from that exact checkout, observe, write the endpoint.
 *   mismatch → raise a SEPARATE routed dependency (a different authority class) to establish a
 *              serving-node checkout at the bound revision. Do NOT git pull, switch branches, copy
 *              files, or otherwise "fix" the checkout under runtime_control. Provisioning waits on
 *              that one operation, then resumes.
 *
 * Pure, so the gate is mechanical rather than a matter of the provisioning actor's judgement.
 */

import { revisionMatches } from "@/lib/work-orders/truth-binding"

export type ProvisioningPremise =
  | { ok: true }
  | { ok: false; reason: "NO_BOUND_REVISION" | "NO_SERVING_CHECKOUT" | "REVISION_MISMATCH"; detail: string }

/**
 * Whether the serving-node checkout is at the W1-bound revision.
 *
 * An abbreviated SHA matches the full one it prefixes (via revisionMatches). A missing bound
 * revision or a missing serving checkout is a refusal, not an assumption.
 */
export function checkProvisioningPremise(input: {
  boundRevision: string | null | undefined
  servingObservedRevision: string | null | undefined
  servingNode: string
}): ProvisioningPremise {
  if (!input.boundRevision?.trim()) {
    return { ok: false, reason: "NO_BOUND_REVISION", detail: "The W1 truth binding has no bound revision to check against" }
  }
  if (!input.servingObservedRevision?.trim()) {
    return {
      ok: false,
      reason: "NO_SERVING_CHECKOUT",
      detail: `No observed checkout revision on ${input.servingNode} to compare with the bound revision`,
    }
  }
  if (!revisionMatches(input.boundRevision, input.servingObservedRevision)) {
    return {
      ok: false,
      reason: "REVISION_MISMATCH",
      detail: `Serving checkout on ${input.servingNode} is ${input.servingObservedRevision}, but W1 is bound to ${input.boundRevision}`,
    }
  }
  return { ok: true }
}

export interface ProvisioningPlan {
  /** May the actor start the service now? */
  readyToProvision: boolean
  /** When not ready, the operation that must be routed FIRST — and never done under runtime_control. */
  routeFirst?: {
    operation: string
    requiredClass: string
    requiredCapability: string
    detail: string
  }
}

/**
 * What a provisioning actor should do given the premise.
 *
 * A mismatch does not stop the system; it produces one routed dependency in a different authority
 * class, after which provisioning resumes. Establishing a checkout at a revision is a source-tree
 * operation, deliberately NOT runtime_control.
 */
export function provisioningPlan(premise: ProvisioningPremise, servingNode: string): ProvisioningPlan {
  if (premise.ok) return { readyToProvision: true }

  if (premise.reason === "REVISION_MISMATCH" || premise.reason === "NO_SERVING_CHECKOUT") {
    return {
      readyToProvision: false,
      routeFirst: {
        operation: `establish a serving-node checkout on ${servingNode} at the W1-bound revision`,
        requiredClass: "source",
        requiredCapability: "write",
        detail: premise.detail,
      },
    }
  }

  // NO_BOUND_REVISION: nothing to provision against; the W1 contract must bind a revision first.
  return { readyToProvision: false }
}
