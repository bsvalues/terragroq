import { describe, it, expect } from "vitest"

import {
  OPEN_ROUTING_STATES,
  ROUTING_STATES,
  ROUTING_TRANSITIONS,
  canTransitionRouting,
  canUnblock,
  evaluateBlocked,
  isOpenDependency,
  isUnsatisfied,
  shouldStopWork,
  type RoutedDependencyLike,
  type RoutingState,
} from "@/lib/work-orders/routed-dependency"

import {
  ANY_RESOURCE,
  RESOURCE_SCOPED_CLASSES,
  SURFACE_CAPABILITIES,
  SURFACE_CLASSES,
  capabilityRank,
  envelopePermits,
  isCapabilityOf,
  isSurfaceClass,
  validateEnvelopeEntry,
  type EnvelopeEntry,
} from "@/lib/work-orders/authority-surface"

import {
  APPLY_GOVERNANCE_SCHEMA_MIGRATIONS,
  APPLY_SERVICE_ENDPOINT_SCHEMA,
  DECLARE_WORKSPACE_RUNTIME_SERVICE,
  PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME,
  RATIFY_CANONICAL_PROJECT_REPOSITORIES,
  BOOTSTRAP_DEPENDENCIES,
  resolvedDependencyKeys,
  BOOTSTRAP_INDEPENDENT_WORK,
  DEPLOY_OUTCOME_ORCHESTRATION_REVISION,
  LAND_OUTCOME_ORCHESTRATION_REVISION,
  executableWorkAfter,
  isActionable,
  nextActionableDependency,
} from "@/lib/work-orders/bootstrap-dependencies"
import { canTransition as canTransitionWorkOrder } from "@/lib/work-orders/lifecycle"

function dep(over: Partial<RoutedDependencyLike> = {}): RoutedDependencyLike {
  return {
    operation: "modify deploy/hermes/start-williamos-live.ps1",
    requiredClass: "runtime_config",
    requiredCapability: "write",
    routingState: "raised",
    blocksAcceptance: false,
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* The guard                                                           */
/* ------------------------------------------------------------------ */

describe("blocked is narrow, and hard to reach", () => {
  it("one forbidden mutation does NOT block the contract", () => {
    // The exact failure this exists to prevent: "Claude cannot modify this config file" becoming
    // "frontend development stops."
    const e = evaluateBlocked({ dependencies: [dep()] })
    expect(e.blocked).toBe(false)
    expect(shouldStopWork(e)).toBe(false)
    expect(e.reason).toMatch(/none of them gate acceptance/i)
  })

  it("a gating dependency still does not block while a path remains executable", () => {
    const e = evaluateBlocked({
      dependencies: [dep({ blocksAcceptance: true })],
      anyAcceptancePathExecutable: true,
    })
    expect(e.blocked).toBe(false)
    expect(e.reason).toMatch(/keep working/i)
  })

  it("blocks only when a gating dependency is open AND no path remains", () => {
    const e = evaluateBlocked({
      dependencies: [dep({ blocksAcceptance: true })],
      anyAcceptancePathExecutable: false,
    })
    expect(e.blocked).toBe(true)
    expect(e.blockingDependencies).toHaveLength(1)
    expect(e.reason).toMatch(/no executable acceptance path/i)
  })

  it("does not block when no path remains but nothing gates acceptance", () => {
    // Nothing to route means nothing to wait for; being stuck for some other reason is not this
    // state's job to describe.
    const e = evaluateBlocked({ dependencies: [dep()], anyAcceptancePathExecutable: false })
    expect(e.blocked).toBe(false)
  })

  it("defaults to keeping work moving when the caller says nothing", () => {
    expect(
      evaluateBlocked({ dependencies: [dep({ blocksAcceptance: true })] }).blocked,
    ).toBe(false)
  })

  it("a resolved dependency stops gating", () => {
    const e = evaluateBlocked({
      dependencies: [dep({ blocksAcceptance: true, routingState: "resolved" })],
      anyAcceptancePathExecutable: false,
    })
    expect(e.blocked).toBe(false)
  })

  it("a REFUSED dependency still gates — refusing does not make the outcome reachable", () => {
    const e = evaluateBlocked({
      dependencies: [dep({ blocksAcceptance: true, routingState: "refused" })],
      anyAcceptancePathExecutable: false,
    })
    expect(e.blocked).toBe(true)
  })

  it("separates gating from merely open", () => {
    const e = evaluateBlocked({
      dependencies: [
        dep({ blocksAcceptance: true }),
        dep({ operation: "restart the runtime", blocksAcceptance: false }),
      ],
      anyAcceptancePathExecutable: false,
    })
    expect(e.blockingDependencies).toHaveLength(1)
    expect(e.nonBlockingOpen).toHaveLength(1)
  })

  it("no dependencies at all never blocks", () => {
    expect(evaluateBlocked({ dependencies: [], anyAcceptancePathExecutable: false }).blocked).toBe(
      false,
    )
  })
})

describe("unblocking is automatic", () => {
  it("unblocks once every gating dependency is satisfied", () => {
    expect(canUnblock([dep({ blocksAcceptance: true, routingState: "resolved" })])).toBe(true)
  })

  it("stays blocked while one gating dependency is open", () => {
    expect(
      canUnblock([
        dep({ blocksAcceptance: true, routingState: "resolved" }),
        dep({ blocksAcceptance: true, routingState: "accepted" }),
      ]),
    ).toBe(false)
  })

  it("ignores non-gating dependencies", () => {
    expect(canUnblock([dep({ blocksAcceptance: false, routingState: "raised" })])).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Routing lifecycle                                                   */
/* ------------------------------------------------------------------ */

describe("routing lifecycle", () => {
  it("every state has a transition entry", () => {
    for (const s of ROUTING_STATES) expect(ROUTING_TRANSITIONS[s]).toBeDefined()
  })

  it("follows raised → routed → accepted → resolved", () => {
    expect(canTransitionRouting("raised", "routed")).toBe(true)
    expect(canTransitionRouting("routed", "accepted")).toBe(true)
    expect(canTransitionRouting("accepted", "resolved")).toBe(true)
  })

  it("a routed dependency can come back for re-routing", () => {
    // The assignee declined; it returns to the queue rather than dying there.
    expect(canTransitionRouting("routed", "raised")).toBe(true)
  })

  it("cannot resolve something nobody accepted", () => {
    expect(canTransitionRouting("raised", "resolved")).toBe(false)
    expect(canTransitionRouting("routed", "resolved")).toBe(false)
  })

  it("resolved and refused are terminal", () => {
    expect(ROUTING_TRANSITIONS.resolved).toEqual([])
    expect(ROUTING_TRANSITIONS.refused).toEqual([])
  })

  it.each(OPEN_ROUTING_STATES)("%s is open", (s) => {
    expect(isOpenDependency(s)).toBe(true)
    expect(isUnsatisfied(s)).toBe(true)
  })

  it("only resolved counts as satisfied", () => {
    expect(isUnsatisfied("resolved" as RoutingState)).toBe(false)
    expect(isUnsatisfied("refused" as RoutingState)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Authority surface classes                                           */
/* ------------------------------------------------------------------ */

describe("authority is resource x class x capability", () => {
  it("every class has capabilities beginning at none", () => {
    for (const c of SURFACE_CLASSES) {
      expect(SURFACE_CAPABILITIES[c][0]).toBe("none")
      expect(isSurfaceClass(c)).toBe(true)
    }
  })

  it("classes are independent — delivery does not imply data or secrets", () => {
    // The A0-A9 ladder could not express this: A7_COMMIT outranks A5_DESTRUCTIVE and A6_AUTH, so
    // "may merge frontend code, may not run migrations or read secrets" was unsayable.
    const envelope: EnvelopeEntry[] = [
      { resourceKey: "tf-repo", surfaceClass: "delivery", capability: "merge" },
      { resourceKey: "tf-repo", surfaceClass: "source", capability: "write" },
    ]
    expect(
      envelopePermits(envelope, {
        resourceKey: "tf-repo",
        surfaceClass: "delivery",
        capability: "merge",
      }),
    ).toBe(true)
    expect(
      envelopePermits(envelope, {
        resourceKey: "atlas-db",
        surfaceClass: "data",
        capability: "destructive",
      }),
    ).toBe(false)
    expect(
      envelopePermits(envelope, {
        resourceKey: "tf-repo",
        surfaceClass: "secrets",
        capability: "read",
      }),
    ).toBe(false)
  })

  it("a grant on one resource does not reach another", () => {
    const envelope: EnvelopeEntry[] = [
      { resourceKey: "tf-repo", surfaceClass: "source", capability: "write" },
    ]
    expect(
      envelopePermits(envelope, {
        resourceKey: "other-repo",
        surfaceClass: "source",
        capability: "write",
      }),
    ).toBe(false)
  })

  it("a lower capability satisfies a lower need within the same class", () => {
    const envelope: EnvelopeEntry[] = [
      { resourceKey: "tf-repo", surfaceClass: "delivery", capability: "merge" },
    ]
    expect(
      envelopePermits(envelope, {
        resourceKey: "tf-repo",
        surfaceClass: "delivery",
        capability: "commit",
      }),
    ).toBe(true)
    expect(
      envelopePermits(envelope, {
        resourceKey: "tf-repo",
        surfaceClass: "delivery",
        capability: "release",
      }),
    ).toBe(false)
  })

  it("absence is never permission", () => {
    expect(
      envelopePermits([], { resourceKey: "tf-repo", surfaceClass: "source", capability: "write" }),
    ).toBe(false)
  })

  it.each(RESOURCE_SCOPED_CLASSES)("%s must name a resource", (cls) => {
    const bare = validateEnvelopeEntry({
      resourceKey: ANY_RESOURCE,
      surfaceClass: cls,
      capability: SURFACE_CAPABILITIES[cls][1],
    })
    expect(bare.valid).toBe(false)
    expect(bare.problems.join(" ")).toMatch(/bare grant is invalid/i)
  })

  it.each(RESOURCE_SCOPED_CLASSES)("a wildcard DENIAL of %s is fine", (cls) => {
    // `none` is a denial, not a grant. "* / data / none" says "no data authority anywhere", which
    // is both meaningful and safe; the scoping rule exists so a grant that actually confers
    // something cannot be vague about what it confers it over.
    expect(
      validateEnvelopeEntry({ resourceKey: ANY_RESOURCE, surfaceClass: cls, capability: "none" })
        .valid,
    ).toBe(true)
  })

  it("a wildcard on a non-scoped class is fine", () => {
    expect(
      validateEnvelopeEntry({
        resourceKey: ANY_RESOURCE,
        surfaceClass: "external",
        capability: "none",
      }).valid,
    ).toBe(true)
  })

  it("rejects a capability that belongs to a different class", () => {
    const v = validateEnvelopeEntry({
      resourceKey: "tf-repo",
      surfaceClass: "source",
      capability: "release",
    })
    expect(v.valid).toBe(false)
  })

  it("rejects an unknown class outright", () => {
    const v = validateEnvelopeEntry({
      resourceKey: "tf-repo",
      surfaceClass: "vibes" as never,
      capability: "write",
    })
    expect(v.valid).toBe(false)
  })

  it("capability ranks order within a class only", () => {
    expect(capabilityRank("delivery", "merge")).toBeGreaterThan(capabilityRank("delivery", "commit"))
    expect(isCapabilityOf("data", "destructive")).toBe(true)
    expect(isCapabilityOf("source", "destructive")).toBe(false)
  })

  it("the W1 envelope is expressible and correctly bounded", () => {
    const w1: EnvelopeEntry[] = [
      { resourceKey: "terrafusion-primary-repo", surfaceClass: "source", capability: "write" },
      { resourceKey: "terrafusion-primary-repo", surfaceClass: "delivery", capability: "merge" },
      { resourceKey: "terrafusion-runtime", surfaceClass: "runtime_control", capability: "observe" },
      { resourceKey: "terrafusion-runtime", surfaceClass: "runtime_config", capability: "propose" },
    ]
    for (const e of w1) expect(validateEnvelopeEntry(e).valid).toBe(true)

    // The ResizeObserver fix is ordinary work inside this envelope...
    expect(
      envelopePermits(w1, {
        resourceKey: "terrafusion-primary-repo",
        surfaceClass: "source",
        capability: "write",
      }),
    ).toBe(true)
    // ...and touching protected deployment configuration is a routed dependency, not a stoppage.
    expect(
      envelopePermits(w1, {
        resourceKey: "terrafusion-runtime",
        surfaceClass: "runtime_config",
        capability: "write",
      }),
    ).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* The bootstrap outcome's own dependencies                            */
/* ------------------------------------------------------------------ */

describe("the bootstrap outcome's three live-boundary dependencies", () => {
  const ALL = BOOTSTRAP_DEPENDENCIES.map((d) => d.key)

  it("each names a real unavailable authority or capability", () => {
    for (const d of BOOTSTRAP_DEPENDENCIES) {
      // Either an authority class, or a non-authority capability (ratification is the latter).
      const namesANeed = (d.requiredClass && isSurfaceClass(d.requiredClass)) || Boolean(d.requiredCapabilityNonAuth)
      expect(namesANeed).toBe(true)
      expect(d.requiredResource).toBeTruthy()
      expect(d.evidence.length).toBeGreaterThan(0)
      expect(d.blocksAcceptance).toBe(true)
    }
  })

  it("landing and deploying are SEPARATE authorities", () => {
    // Collapsing them lets "deploy this known revision" quietly become "and change whatever
    // configuration is convenient on the way".
    expect(LAND_OUTCOME_ORCHESTRATION_REVISION.requiredClass).toBe("delivery")
    expect(DEPLOY_OUTCOME_ORCHESTRATION_REVISION.requiredClass).toBe("runtime_control")
  })

  it("deploying explicitly excludes config mutation", () => {
    // The load-bearing exclusion. Without it the protected surface stops being protected.
    expect(DEPLOY_OUTCOME_ORCHESTRATION_REVISION.excludes?.join(" ")).toMatch(
      /runtime_config:write.*SEPARATE routed dependency/,
    )
  })

  it("deploying is pinned to the exact landed successor", () => {
    expect(DEPLOY_OUTCOME_ORCHESTRATION_REVISION.excludes?.join(" ")).toMatch(
      /any revision other than the exact landed successor/i,
    )
  })

  it("the migration is additive only", () => {
    expect(APPLY_GOVERNANCE_SCHEMA_MIGRATIONS.excludes?.join(" ")).toMatch(/destructive/i)
  })

  it("orders the boundaries: schema, then land, then deploy", () => {
    expect(nextActionableDependency([])?.key).toBe("APPLY_GOVERNANCE_SCHEMA_MIGRATIONS")
    expect(nextActionableDependency(["APPLY_GOVERNANCE_SCHEMA_MIGRATIONS"])?.key).toBe(
      "APPLY_SERVICE_ENDPOINT_SCHEMA",
    )
    // After both schemas the agent chain STALLS: the next step, provisioning, needs the owner's
    // service declaration first, so there is nothing an executor can take until that resolves.
    expect(
      nextActionableDependency(["APPLY_GOVERNANCE_SCHEMA_MIGRATIONS", "APPLY_SERVICE_ENDPOINT_SCHEMA"]),
    ).toBeNull()
    // With the owner declaration in, provisioning becomes the next executable step.
    expect(
      nextActionableDependency([
        "APPLY_GOVERNANCE_SCHEMA_MIGRATIONS",
        "APPLY_SERVICE_ENDPOINT_SCHEMA",
        "DECLARE_WORKSPACE_RUNTIME_SERVICE",
      ])?.key,
    ).toBe("PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME")
    // Then land, then deploy.
    expect(
      nextActionableDependency([
        "APPLY_GOVERNANCE_SCHEMA_MIGRATIONS",
        "APPLY_SERVICE_ENDPOINT_SCHEMA",
        "DECLARE_WORKSPACE_RUNTIME_SERVICE",
        "PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME",
      ])?.key,
    ).toBe("LAND_OUTCOME_ORCHESTRATION_REVISION")
  })

  it("provisioning cannot resurrect the invented dev server", () => {
    // The load-bearing exclusion one level up: a declared canonical service pointed at :5199 is the
    // same failure this whole model removes.
    expect(PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME.excludes?.join(" ")).toMatch(/5199.*improvised/)
    expect(PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME.requiredClass).toBe("runtime_control")
    expect(PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME.ownerRouted ?? false).toBe(false)
  })

  it("declaring the service is not the same as running it", () => {
    // Declaration answers what is authoritative; provisioning makes it exist and produces the
    // observed endpoint binding. They are separate authorities.
    expect(DECLARE_WORKSPACE_RUNTIME_SERVICE.unlocks.join(" ")).toMatch(/provisioning/i)
    expect(PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME.dependsOn).toContain("DECLARE_WORKSPACE_RUNTIME_SERVICE")
  })

  it("recompute reflects live state: PROVISION is the next executable step", () => {
    // Both schemas applied, owner declared the service and ratified the repo -- so the next thing an
    // executor can take is provisioning the real runtime. It needs runtime_control, routed to a
    // runtime actor, but it IS now actionable.
    const live = resolvedDependencyKeys()
    expect(live).toContain("DECLARE_WORKSPACE_RUNTIME_SERVICE")
    expect(nextActionableDependency(live)?.key).toBe("PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME")
    // LAND still waits on the provisioned runtime, which is not yet resolved.
    expect(isActionable(LAND_OUTCOME_ORCHESTRATION_REVISION, live)).toBe(false)
    expect(
      isActionable(LAND_OUTCOME_ORCHESTRATION_REVISION, [...live, "PROVISION_AND_OBSERVE_WORKSPACE_RUNTIME"]),
    ).toBe(true)
  })

  it("never routes ratification to an agent — it is owner-placed", () => {
    // Even with nothing resolved, the agent chain starts at the schema migration, not ratification,
    // because ratification is a governance act the router cannot hand to an executor.
    expect(nextActionableDependency([])?.key).toBe("APPLY_GOVERNANCE_SCHEMA_MIGRATIONS")
    expect(RATIFY_CANONICAL_PROJECT_REPOSITORIES.ownerRouted).toBe(true)
  })

  it("the missing workspace-runtime service is an owner declaration, not agent work", () => {
    // Project 2's only service resource is the PACS data runtime; declaring what the Project's
    // canonical workspace service IS is governance, so the router never hands it to an executor.
    expect(DECLARE_WORKSPACE_RUNTIME_SERVICE.ownerRouted).toBe(true)
    expect(DECLARE_WORKSPACE_RUNTIME_SERVICE.blocksAcceptance).toBe(true)
    expect(nextActionableDependency([])?.key).not.toBe("DECLARE_WORKSPACE_RUNTIME_SERVICE")
  })

  it("the endpoint schema is agent-appliable additive DDL, in the chain before land", () => {
    expect(APPLY_SERVICE_ENDPOINT_SCHEMA.requiredClass).toBe("data")
    expect(APPLY_SERVICE_ENDPOINT_SCHEMA.requiredCapability).toBe("additive")
    expect(APPLY_SERVICE_ENDPOINT_SCHEMA.ownerRouted ?? false).toBe(false)
  })

  it("ratification blocks certification but not the source work", () => {
    // It gates final W1 certification, and it explicitly is NOT among the schema/land/deploy chain,
    // so route wiring, runtime derivation, Space identity and the verifier proceed without it.
    expect(RATIFY_CANONICAL_PROJECT_REPOSITORIES.blocksAcceptance).toBe(true)
    expect(RATIFY_CANONICAL_PROJECT_REPOSITORIES.dependsOn ?? []).toEqual([])
    expect(RATIFY_CANONICAL_PROJECT_REPOSITORIES.unlocks.join(" ")).toMatch(/certification/i)
  })

  it("will not land before the schema-dependent source work is possible", () => {
    // The current branch is a checkpoint, not the final deployable result.
    expect(isActionable(LAND_OUTCOME_ORCHESTRATION_REVISION, [])).toBe(false)
    expect(isActionable(DEPLOY_OUTCOME_ORCHESTRATION_REVISION, ["APPLY_GOVERNANCE_SCHEMA_MIGRATIONS"])).toBe(
      false,
    )
  })
})

describe("blocked describes the present, not the past", () => {
  it("is blocked NOW, because independent work is genuinely exhausted", () => {
    // The first honest use of this state. Every path inside the envelope has been walked.
    expect(BOOTSTRAP_INDEPENDENT_WORK).toEqual([])
    const e = evaluateBlocked({
      dependencies: [...BOOTSTRAP_DEPENDENCIES],
      anyAcceptancePathExecutable: executableWorkAfter([]).length > 0,
    })
    // Every dependency not already resolved gates acceptance -- computed from the data so this stays
    // correct as more resolve. Two schema migrations are live now, so the rest still block.
    const stillPending = BOOTSTRAP_DEPENDENCIES.filter((d) => d.routingState !== "resolved").length
    expect(e.blocked).toBe(true)
    expect(e.blockingDependencies).toHaveLength(stillPending)
    expect(resolvedDependencyKeys()).toEqual([
      "APPLY_GOVERNANCE_SCHEMA_MIGRATIONS",
      "APPLY_SERVICE_ENDPOINT_SCHEMA",
      "DECLARE_WORKSPACE_RUNTIME_SERVICE",
      "RATIFY_CANONICAL_PROJECT_REPOSITORIES",
    ])
  })

  it("stops being blocked the moment the schema dependency resolves", () => {
    // It must not stay blocked merely because it once was: resolving the schema makes the
    // Project-bound route wiring executable again and the work order returns to active.
    const unlocked = executableWorkAfter(["APPLY_GOVERNANCE_SCHEMA_MIGRATIONS"])
    expect(unlocked.length).toBeGreaterThan(0)

    const deps = BOOTSTRAP_DEPENDENCIES.map((d) =>
      d.key === "APPLY_GOVERNANCE_SCHEMA_MIGRATIONS"
        ? { ...d, routingState: "resolved" as const }
        : d,
    )
    const e = evaluateBlocked({
      dependencies: deps,
      anyAcceptancePathExecutable: unlocked.length > 0,
    })
    expect(e.blocked).toBe(false)
    expect(e.reason).toMatch(/keep working/i)
  })

  it("returning to active is a legal transition, so the recomputation can be acted on", () => {
    expect(canTransitionWorkOrder("blocked", "active")).toBe(true)
  })

  it("resolving everything unblocks without anyone lifting it by hand", () => {
    expect(
      canUnblock(BOOTSTRAP_DEPENDENCIES.map((d) => ({ ...d, routingState: "resolved" as const }))),
    ).toBe(true)
  })
})
