import { describe, it, expect } from "vitest"

import {
  W1_ACCEPTANCE_STEPS,
  W1_ENVELOPE,
  W1_EXPECTED_DEPENDENCIES,
  W1_RUNTIME_RESOURCE,
  W1_SOURCE_RESOURCE,
  validateW1Envelope,
  verifyW1,
  type W1Observations,
} from "@/lib/work-orders/w1-contract"
import { envelopePermits } from "@/lib/work-orders/authority-surface"
import { verifyGeometryIntact } from "@/lib/work-orders/acceptance-verifier"
import type { TruthBindingLike } from "@/lib/work-orders/truth-binding"

const PROJECT_ID = 7
const REMOTE = "https://github.com/bsvalues/terragroq.git"
const HEAD = "0e4536ea9c1d4f77b2a3e5c6d7f8091a2b3c4d5e"
const STALE = "deadbeef00112233445566778899aabbccddeeff"
const RATIFIED = new Date("2026-08-01T00:00:00.000Z")
const T0 = new Date("2026-08-26T10:00:00.000Z")

function binding(over: Partial<TruthBindingLike> = {}): TruthBindingLike {
  return {
    projectId: PROJECT_ID,
    runtimeResourceKey: W1_RUNTIME_RESOURCE,
    resources: [
      {
        resourceKey: W1_SOURCE_RESOURCE,
        resourceType: "repo",
        canonicalIdentity: REMOTE,
        role: "source",
        ratifiedAt: RATIFIED,
      },
      {
        resourceKey: W1_RUNTIME_RESOURCE,
        resourceType: "service",
        canonicalIdentity: "williamos-workspace",
        role: "runtime",
        ratifiedAt: RATIFIED,
      },
    ],
    lineage: [
      { resourceKey: W1_SOURCE_RESOURCE, event: "bound", sha: HEAD, at: T0 },
    ],
    ...over,
  }
}

/** A run in which everything genuinely worked, against the right thing. */
function observations(over: Partial<W1Observations> = {}): W1Observations {
  return {
    spaceProjectId: PROJECT_ID,
    servedRepoRemote: REMOTE,
    servedHeadSha: HEAD,
    runtimeResourceKey: W1_RUNTIME_RESOURCE,
    runtimeAdmittedFromProjectId: PROJECT_ID,
    mutatedFilePath: "components/workspace-shell/window-frame.tsx",
    mutatedFileInsideBoundCheckout: true,
    contentBeforeSave: "const width = entry.contentRect.width",
    contentAfterSave: "const width = entry.borderBoxSize[0].inlineSize",
    runningProductReflectsChange: true,
    spaceIdBeforeReopen: "b01c957d-e5db-4147-8fe3-5e9394f0abf4",
    spaceIdAfterReopen: "b01c957d-e5db-4147-8fe3-5e9394f0abf4",
    geometryBeforeReopen: [{ id: "workspace-editor", width: 920, height: 700 }],
    geometryAfterReopen: [{ id: "workspace-editor", width: 920, height: 700 }],
    geometryConstraints: { minWidth: 360, minHeight: 260 },
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

describe("W1 as one outcome contract", () => {
  it("has a well-formed envelope", () => {
    expect(validateW1Envelope()).toEqual({ valid: true, problems: [] })
  })

  it("makes the diagnosed defects ordinary work, not new permits", () => {
    // window-frame.tsx, the corrupted Space geometry and the Project-binding defects are all
    // source:write on the bound repo. Under the old shape these were five separate work orders.
    expect(
      envelopePermits(W1_ENVELOPE, {
        resourceKey: W1_SOURCE_RESOURCE,
        surfaceClass: "source",
        capability: "write",
      }),
    ).toBe(true)
  })

  it("permits delivery of that work without a courier agent", () => {
    expect(
      envelopePermits(W1_ENVELOPE, {
        resourceKey: W1_SOURCE_RESOURCE,
        surfaceClass: "delivery",
        capability: "merge",
      }),
    ).toBe(true)
  })

  it("turns protected runtime config into a dependency, not a wall", () => {
    // propose is granted, write is not. That difference is the entire mechanism: the executor can
    // say what needs changing and keep working, without being able to change it.
    expect(
      envelopePermits(W1_ENVELOPE, {
        resourceKey: W1_RUNTIME_RESOURCE,
        surfaceClass: "runtime_config",
        capability: "propose",
      }),
    ).toBe(true)
    expect(
      envelopePermits(W1_ENVELOPE, {
        resourceKey: W1_RUNTIME_RESOURCE,
        surfaceClass: "runtime_config",
        capability: "write",
      }),
    ).toBe(false)
    expect(W1_EXPECTED_DEPENDENCIES[0]).toMatchObject({
      requiredClass: "runtime_config",
      requiredCapability: "write",
      blocksAcceptance: true,
    })
  })

  it("grants nothing on data, secrets or external", () => {
    for (const need of [
      { surfaceClass: "data" as const, capability: "additive" },
      { surfaceClass: "secrets" as const, capability: "read" },
      { surfaceClass: "external" as const, capability: "act" },
    ]) {
      expect(envelopePermits(W1_ENVELOPE, { resourceKey: ANY, ...need })).toBe(false)
    }
  })
  const ANY = "*"

  it("cannot restart the runtime it observes", () => {
    expect(
      envelopePermits(W1_ENVELOPE, {
        resourceKey: W1_RUNTIME_RESOURCE,
        surfaceClass: "runtime_control",
        capability: "control",
      }),
    ).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Acceptance — the happy path                                         */
/* ------------------------------------------------------------------ */

describe("W1 acceptance", () => {
  it("certifies when the whole sequence passes against the bound truth", () => {
    const r = verifyW1(binding(), observations())
    expect(r.disposition).toBe("PASS")
    expect(r.certifies).toBe(true)
    expect(r.steps).toHaveLength(W1_ACCEPTANCE_STEPS.length)
    expect(r.steps.every((s) => s.passed)).toBe(true)
  })

  it("certifies without a second agent — the evidence is what makes it independent", () => {
    expect(verifyW1(binding(), observations()).certifies).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Acceptance — premise failures                                       */
/* ------------------------------------------------------------------ */

describe("W1 premise failures short-circuit", () => {
  it("a stale checkout fails the premise even though every mechanic works", () => {
    // 2026-08-26 exactly: file tree, governed save with CAS, undo/redo, HMR round trip and
    // cross-origin framing all genuinely worked — thirteen commits behind main.
    const r = verifyW1(binding(), observations({ servedHeadSha: STALE }))
    expect(r.disposition).toBe("PREMISE_FAILED")
    expect(r.certifies).toBe(false)
    expect(r.divergences[0]).toMatchObject({ field: "revision", observed: STALE })
  })

  it("reports NO step results on a premise failure", () => {
    // The important half. A list of green steps against the wrong tree is worse than a red one,
    // because someone will quote it.
    const r = verifyW1(binding(), observations({ servedHeadSha: STALE }))
    expect(r.steps).toEqual([])
  })

  it("a different repository fails the premise", () => {
    const r = verifyW1(
      binding(),
      observations({ servedRepoRemote: "https://github.com/bsvalues/terrafusion_os_1.0.git" }),
    )
    expect(r.disposition).toBe("PREMISE_FAILED")
    expect(r.divergences[0].field).toBe("identity")
  })

  it("a runtime admitted from another Project fails the premise", () => {
    // An invented port serving somebody else's world.
    const r = verifyW1(binding(), observations({ runtimeAdmittedFromProjectId: 41 }))
    expect(r.disposition).toBe("PREMISE_FAILED")
    expect(r.reason).toMatch(/admitted from project 41/i)
  })

  it("a Space bound to another Project fails the premise", () => {
    const r = verifyW1(binding(), observations({ spaceProjectId: 41 }))
    expect(r.disposition).toBe("PREMISE_FAILED")
    expect(r.divergences[0].field).toBe("project")
  })

  it("an ssh-form remote is the same repository", () => {
    const r = verifyW1(
      binding(),
      observations({ servedRepoRemote: "git@github.com:bsvalues/terragroq.git" }),
    )
    expect(r.disposition).toBe("PASS")
  })

  it("an abbreviated HEAD is the same revision", () => {
    expect(verifyW1(binding(), observations({ servedHeadSha: HEAD.slice(0, 9) })).disposition).toBe(
      "PASS",
    )
  })
})

/* ------------------------------------------------------------------ */
/* Acceptance — operation failures                                     */
/* ------------------------------------------------------------------ */

describe("W1 operation failures do not certify", () => {
  it("a save that changed nothing fails", () => {
    const r = verifyW1(
      binding(),
      observations({ contentAfterSave: "const width = entry.contentRect.width" }),
    )
    expect(r.certifies).toBe(false)
    expect(r.steps.find((s) => s.step.includes("save"))?.passed).toBe(false)
  })

  it("an editor over a directory the product does not serve fails", () => {
    const r = verifyW1(binding(), observations({ runningProductReflectsChange: false }))
    expect(r.certifies).toBe(false)
    expect(r.reason).toMatch(/running application reflects the change/i)
  })

  it("a different Space coming back fails", () => {
    const r = verifyW1(binding(), observations({ spaceIdAfterReopen: "some-other-world" }))
    expect(r.certifies).toBe(false)
  })

  it("a file edited outside the bound checkout fails", () => {
    const r = verifyW1(binding(), observations({ mutatedFileInsideBoundCheckout: false }))
    expect(r.certifies).toBe(false)
  })

  it("partial passes report PARTIAL rather than FAIL", () => {
    const r = verifyW1(binding(), observations({ runningProductReflectsChange: false }))
    expect(r.disposition).toBe("PARTIAL")
  })

  it("an unconfirmed bound resource cannot certify even on a clean run", () => {
    const b = binding()
    const unratified = {
      ...b,
      resources: b.resources.map((r) => ({ ...r, ratifiedAt: null })),
    }
    const r = verifyW1(unratified, observations())
    expect(r.certifies).toBe(false)
    expect(r.unconfirmedResources).toContain(W1_SOURCE_RESOURCE)
  })
})

/* ------------------------------------------------------------------ */
/* Geometry — the actual defect                                        */
/* ------------------------------------------------------------------ */

describe("window geometry", () => {
  const constraints = { minWidth: 360, minHeight: 260 }

  it("intact geometry passes", () => {
    expect(
      verifyGeometryIntact(
        [{ id: "workspace-editor", width: 920, height: 700 }],
        [{ id: "workspace-editor", width: 920, height: 700 }],
        constraints,
      ).intact,
    ).toBe(true)
  })

  it("catches the border-box shrink across a reopen", () => {
    const v = verifyGeometryIntact(
      [{ id: "workspace-editor", width: 920, height: 700 }],
      [{ id: "workspace-editor", width: 918, height: 698 }],
      constraints,
    )
    expect(v.intact).toBe(false)
    expect(v.problems[0]).toMatch(/shrank across reopen/i)
  })

  it("catches geometry persisted BELOW the CSS minimum — the defect's fingerprint", () => {
    // 358x258 is what the live world actually held: contentRect stayed 2px under the 360x260 the
    // CSS enforces, which nothing measuring the same box could have produced.
    const v = verifyGeometryIntact(
      [{ id: "workspace-editor", width: 358, height: 258 }],
      [{ id: "workspace-editor", width: 358, height: 258 }],
      constraints,
    )
    expect(v.intact).toBe(false)
    expect(v.problems[0]).toMatch(/below its CSS minimum/i)
  })

  it("fails W1 acceptance when the Space comes back at 358x258", () => {
    const r = verifyW1(
      binding(),
      observations({
        geometryBeforeReopen: [{ id: "workspace-editor", width: 358, height: 258 }],
        geometryAfterReopen: [{ id: "workspace-editor", width: 358, height: 258 }],
      }),
    )
    expect(r.certifies).toBe(false)
    expect(r.steps.find((s) => s.step.includes("geometry"))?.passed).toBe(false)
  })

  it("catches a window that did not come back at all", () => {
    const v = verifyGeometryIntact(
      [{ id: "workspace-editor", width: 920, height: 700 }],
      [],
      constraints,
    )
    expect(v.intact).toBe(false)
    expect(v.problems[0]).toMatch(/did not return/i)
  })

  it("a window that grew is not corruption", () => {
    expect(
      verifyGeometryIntact(
        [{ id: "workspace-editor", width: 920, height: 700 }],
        [{ id: "workspace-editor", width: 1100, height: 800 }],
        constraints,
      ).intact,
    ).toBe(true)
  })
})
