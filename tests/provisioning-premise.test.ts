import { describe, it, expect } from "vitest"

import {
  checkProvisioningPremise,
  provisioningPlan,
} from "@/lib/loom/provisioning-premise"
import { ESTABLISH_SERVING_NODE_CHECKOUT } from "@/lib/work-orders/bootstrap-dependencies"

const BOUND = "731b15f082341b936cdc8710ec8229c4619a6486"
const HERMES_OBSERVED = "fd294dc389f8f7f5821881fa2335b7d62bc630f0"

describe("provisioning checks the checkout revision before starting the service", () => {
  it("passes when the serving checkout is at the bound revision", () => {
    expect(
      checkProvisioningPremise({
        boundRevision: BOUND,
        servingObservedRevision: BOUND,
        servingNode: "hermes",
      }),
    ).toEqual({ ok: true })
  })

  it("accepts an abbreviated SHA that prefixes the bound revision", () => {
    expect(
      checkProvisioningPremise({ boundRevision: BOUND, servingObservedRevision: BOUND.slice(0, 9), servingNode: "hermes" })
        .ok,
    ).toBe(true)
  })

  it("catches the HERMES fd294dc3 / bound 731b15f0 mismatch", () => {
    // The exact live divergence: a real endpoint over the wrong revision is the original failure in
    // a new form.
    const p = checkProvisioningPremise({
      boundRevision: BOUND,
      servingObservedRevision: HERMES_OBSERVED,
      servingNode: "hermes",
    })
    expect(p).toMatchObject({ ok: false, reason: "REVISION_MISMATCH" })
    if (!p.ok) expect(p.detail).toMatch(/fd294dc3.*bound to 731b15f0/)
  })

  it("refuses when there is no bound revision to check against", () => {
    expect(
      checkProvisioningPremise({ boundRevision: null, servingObservedRevision: BOUND, servingNode: "hermes" }),
    ).toMatchObject({ ok: false, reason: "NO_BOUND_REVISION" })
  })

  it("refuses when the serving node has no observed checkout", () => {
    expect(
      checkProvisioningPremise({ boundRevision: BOUND, servingObservedRevision: null, servingNode: "hermes" }),
    ).toMatchObject({ ok: false, reason: "NO_SERVING_CHECKOUT" })
  })
})

describe("a mismatch is one routed dependency, not a git pull", () => {
  it("readyToProvision when the premise holds", () => {
    const plan = provisioningPlan({ ok: true }, "hermes")
    expect(plan).toEqual({ readyToProvision: true })
  })

  it("routes ESTABLISH_SERVING_NODE_CHECKOUT on a mismatch, in a NON-runtime_control class", () => {
    const premise = checkProvisioningPremise({
      boundRevision: BOUND,
      servingObservedRevision: HERMES_OBSERVED,
      servingNode: "hermes",
    })
    const plan = provisioningPlan(premise, "hermes")
    expect(plan.readyToProvision).toBe(false)
    expect(plan.routeFirst?.requiredClass).toBe("source")
    expect(plan.routeFirst?.requiredClass).not.toBe("runtime_control")
    expect(plan.routeFirst?.operation).toMatch(/establish a serving-node checkout/)
  })

  it("routes a checkout establishment when the node has no checkout at all", () => {
    const premise = checkProvisioningPremise({ boundRevision: BOUND, servingObservedRevision: null, servingNode: "hermes" })
    expect(provisioningPlan(premise, "hermes").routeFirst?.requiredClass).toBe("source")
  })

  it("does not route a checkout op when the real problem is a missing bound revision", () => {
    // NO_BOUND_REVISION is upstream (the W1 contract must bind first); establishing a checkout would
    // not help, so no checkout dependency is raised.
    const premise = checkProvisioningPremise({ boundRevision: null, servingObservedRevision: BOUND, servingNode: "hermes" })
    const plan = provisioningPlan(premise, "hermes")
    expect(plan.readyToProvision).toBe(false)
    expect(plan.routeFirst).toBeUndefined()
  })

  it("the ESTABLISH dependency is a source op, not runtime_control", () => {
    expect(ESTABLISH_SERVING_NODE_CHECKOUT.requiredClass).toBe("source")
    expect(ESTABLISH_SERVING_NODE_CHECKOUT.requiredClass).not.toBe("runtime_control")
    expect(ESTABLISH_SERVING_NODE_CHECKOUT.blocksAcceptance).toBe(true)
  })
})
