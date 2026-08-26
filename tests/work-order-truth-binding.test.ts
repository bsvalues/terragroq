import { describe, it, expect } from "vitest"

import {
  ACCEPTANCE_DISPOSITIONS,
  baseRevision,
  checkBindingReadiness,
  checkPremise,
  dispositionFor,
  expectedRevision,
  identityMatches,
  premiseFailureIsTerminal,
  revisionLineage,
  revisionMatches,
  successorRevision,
  validateLineage,
  type BindingEventLike,
  type BoundResourceLike,
  type TruthBindingLike,
} from "@/lib/work-orders/truth-binding"

const RATIFIED = new Date("2026-08-01T00:00:00.000Z")
const T0 = new Date("2026-08-26T10:00:00.000Z")
const T1 = new Date("2026-08-26T11:00:00.000Z")
const T2 = new Date("2026-08-26T12:00:00.000Z")

const BASE_SHA = "0e4536ea9c1d4f77b2a3e5c6d7f8091a2b3c4d5e"
const MOVED_SHA = "aa11bb22cc33dd44ee55ff66007788990011223a"
const STALE_SHA = "deadbeef00112233445566778899aabbccddeeff"

function resource(over: Partial<BoundResourceLike> = {}): BoundResourceLike {
  return {
    resourceKey: "terrafusion-primary-repo",
    resourceType: "repo",
    canonicalIdentity: "https://github.com/bsvalues/terrafusion_os_1.0.git",
    role: "source",
    ratifiedAt: RATIFIED,
    ...over,
  }
}

function binding(over: Partial<TruthBindingLike> = {}): TruthBindingLike {
  return {
    projectId: 7,
    resources: [resource()],
    lineage: [
      { resourceKey: "terrafusion-primary-repo", event: "bound", sha: BASE_SHA, at: T0 },
    ],
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* Rule 1 — bound at activation, not at acceptance                     */
/* ------------------------------------------------------------------ */

describe("activation requires a binding", () => {
  it("a complete binding is ready", () => {
    expect(checkBindingReadiness(binding())).toEqual({ ready: true, missing: [] })
  })

  it("no binding at all is refused", () => {
    const r = checkBindingReadiness(null)
    expect(r.ready).toBe(false)
    expect(r.missing[0]).toMatch(/bind before activation/i)
  })

  it("a source resource with no bound revision is refused", () => {
    // The stale-branch failure in one assertion: a contract that will change code but cannot say
    // which revision must not be allowed to start.
    const r = checkBindingReadiness(binding({ lineage: [] }))
    expect(r.ready).toBe(false)
    expect(r.missing.join(" ")).toMatch(/no bound revision/i)
  })

  it("a non-source resource needs no revision", () => {
    // Databases and nodes are canonical without being versioned; demanding a SHA would be theatre.
    const r = checkBindingReadiness({
      projectId: 7,
      resources: [resource({ resourceKey: "atlas-db", resourceType: "database", role: "data" })],
      lineage: [],
    })
    expect(r.ready).toBe(true)
  })

  it("no Project is refused", () => {
    expect(checkBindingReadiness(binding({ projectId: 0 })).ready).toBe(false)
  })

  it("no resources is refused", () => {
    expect(checkBindingReadiness(binding({ resources: [] })).ready).toBe(false)
  })

  it("a runtime that is not a bound resource is refused", () => {
    // The runtime has to be derived from the Project, not from an ambient env var pointing at
    // whatever happened to be listening.
    const r = checkBindingReadiness(binding({ runtimeResourceKey: "some-port-i-invented" }))
    expect(r.ready).toBe(false)
    expect(r.missing.join(" ")).toMatch(/not a bound resource/i)
  })

  it("an unconfirmed resource still activates — it only blocks certification", () => {
    expect(checkBindingReadiness(binding({ resources: [resource({ ratifiedAt: null })] })).ready).toBe(
      true,
    )
  })
})

/* ------------------------------------------------------------------ */
/* Lineage                                                             */
/* ------------------------------------------------------------------ */

describe("revision lineage", () => {
  const key = "terrafusion-primary-repo"
  const moved: BindingEventLike[] = [
    { resourceKey: key, event: "bound", sha: BASE_SHA, at: T0 },
    { resourceKey: key, event: "rebound", sha: MOVED_SHA, at: T1 },
  ]

  it("base stays the activation revision after movement", () => {
    expect(baseRevision(moved, key)).toBe(BASE_SHA)
  })

  it("expected follows the latest recorded movement", () => {
    expect(expectedRevision(moved, key)).toBe(MOVED_SHA)
  })

  it("a successor this contract produced is recorded explicitly", () => {
    const withSuccessor: BindingEventLike[] = [
      ...moved,
      { resourceKey: key, event: "successor", sha: STALE_SHA, at: T2 },
    ]
    expect(successorRevision(withSuccessor, key)).toBe(STALE_SHA)
    expect(revisionLineage(withSuccessor, key)).toEqual([BASE_SHA, MOVED_SHA, STALE_SHA])
  })

  it("has no successor until one is recorded — it is never assumed", () => {
    expect(successorRevision(moved, key)).toBeNull()
  })

  it("orders by time, not by insertion", () => {
    const scrambled: BindingEventLike[] = [
      { resourceKey: key, event: "rebound", sha: MOVED_SHA, at: T1 },
      { resourceKey: key, event: "bound", sha: BASE_SHA, at: T0 },
    ]
    expect(baseRevision(scrambled, key)).toBe(BASE_SHA)
    expect(expectedRevision(scrambled, key)).toBe(MOVED_SHA)
  })

  it("keeps resources separate", () => {
    const two: BindingEventLike[] = [
      { resourceKey: "repo-a", event: "bound", sha: BASE_SHA, at: T0 },
      { resourceKey: "repo-b", event: "bound", sha: MOVED_SHA, at: T0 },
    ]
    expect(expectedRevision(two, "repo-a")).toBe(BASE_SHA)
    expect(expectedRevision(two, "repo-b")).toBe(MOVED_SHA)
  })

  it("rejects a lineage that does not begin with a base binding", () => {
    const orphan: BindingEventLike[] = [
      { resourceKey: key, event: "rebound", sha: MOVED_SHA, at: T1 },
    ]
    expect(validateLineage(orphan, key).valid).toBe(false)
    expect(expectedRevision(orphan, key)).toBeNull()
  })

  it("rejects two base bindings", () => {
    const doubled: BindingEventLike[] = [
      { resourceKey: key, event: "bound", sha: BASE_SHA, at: T0 },
      { resourceKey: key, event: "bound", sha: MOVED_SHA, at: T1 },
    ]
    expect(validateLineage(doubled, key)).toMatchObject({ valid: false })
  })
})

/* ------------------------------------------------------------------ */
/* Identity and revision matching                                      */
/* ------------------------------------------------------------------ */

describe("identity matching tolerates cosmetics, not substance", () => {
  it.each([
    ["https://github.com/bsvalues/terragroq.git", "git@github.com:bsvalues/terragroq.git"],
    ["https://github.com/bsvalues/terragroq", "https://github.com/bsvalues/terragroq.git"],
    ["https://github.com/bsvalues/terragroq/", "https://github.com/BSValues/terragroq"],
  ])("%s matches %s", (a, b) => {
    expect(identityMatches(a, b)).toBe(true)
  })

  it("a different repository never matches", () => {
    expect(
      identityMatches(
        "https://github.com/bsvalues/terragroq.git",
        "https://github.com/bsvalues/terrafusion_os_1.0.git",
      ),
    ).toBe(false)
  })
})

describe("revision matching", () => {
  it("an abbreviated SHA is the same revision", () => {
    expect(revisionMatches(BASE_SHA, BASE_SHA.slice(0, 8))).toBe(true)
    expect(revisionMatches(BASE_SHA.slice(0, 12), BASE_SHA)).toBe(true)
  })

  it("a different revision does not match", () => {
    expect(revisionMatches(BASE_SHA, MOVED_SHA)).toBe(false)
  })

  it("refuses to guess from a too-short prefix", () => {
    expect(revisionMatches(BASE_SHA, BASE_SHA.slice(0, 3))).toBe(false)
  })

  it("an empty revision never matches", () => {
    expect(revisionMatches(BASE_SHA, "")).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Rule 2 — observed vs bound                                          */
/* ------------------------------------------------------------------ */

describe("premise check", () => {
  const key = "terrafusion-primary-repo"

  it("observing exactly what was bound passes", () => {
    const p = checkPremise(binding(), {
      projectId: 7,
      identities: { [key]: "git@github.com:bsvalues/terrafusion_os_1.0.git" },
      revisions: { [key]: BASE_SHA },
    })
    expect(p.ok).toBe(true)
    expect(p.divergences).toEqual([])
  })

  it("a stale checkout is caught", () => {
    // 2026-08-26, exactly: the editor mechanics all worked, thirteen commits behind main.
    const p = checkPremise(binding(), { revisions: { [key]: STALE_SHA } })
    expect(p.ok).toBe(false)
    expect(p.divergences[0]).toMatchObject({ field: "revision", observed: STALE_SHA })
  })

  it("the wrong repository is caught even at a valid-looking revision", () => {
    const p = checkPremise(binding(), {
      identities: { [key]: "https://github.com/bsvalues/some-other-repo.git" },
      revisions: { [key]: BASE_SHA },
    })
    expect(p.ok).toBe(false)
    expect(p.divergences[0].field).toBe("identity")
  })

  it("the wrong Project is caught", () => {
    const p = checkPremise(binding(), { projectId: 41 })
    expect(p.ok).toBe(false)
    expect(p.divergences[0]).toMatchObject({ field: "project", expected: "7", observed: "41" })
  })

  it("the wrong runtime is caught", () => {
    const b = binding({ runtimeResourceKey: "terrafusion-runtime" })
    const p = checkPremise(b, { runtimeResourceKey: "invented-port-5199" })
    expect(p.ok).toBe(false)
    expect(p.divergences[0].field).toBe("runtime")
  })

  it("a recorded rebind is a legitimate place to be", () => {
    const b = binding({
      lineage: [
        { resourceKey: key, event: "bound", sha: BASE_SHA, at: T0 },
        { resourceKey: key, event: "rebound", sha: MOVED_SHA, at: T1 },
      ],
    })
    expect(checkPremise(b, { revisions: { [key]: MOVED_SHA } }).ok).toBe(true)
    // and so is the base it moved from
    expect(checkPremise(b, { revisions: { [key]: BASE_SHA } }).ok).toBe(true)
  })

  it("an UNRECORDED move is not", () => {
    // This is the difference between a rebase and a drift.
    expect(checkPremise(binding(), { revisions: { [key]: MOVED_SHA } }).ok).toBe(false)
  })

  it("reports unconfirmed resources without failing the premise", () => {
    const p = checkPremise(binding({ resources: [resource({ ratifiedAt: null })] }), {
      revisions: { [key]: BASE_SHA },
    })
    expect(p.ok).toBe(true)
    expect(p.unconfirmed).toEqual([key])
  })

  it("observing nothing asserts nothing", () => {
    expect(checkPremise(binding(), {}).ok).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Disposition                                                         */
/* ------------------------------------------------------------------ */

describe("acceptance disposition", () => {
  const key = "terrafusion-primary-repo"
  const goodPremise = checkPremise(binding(), { revisions: { [key]: BASE_SHA } })
  const badPremise = checkPremise(binding(), { revisions: { [key]: STALE_SHA } })

  it("passing operations against the bound truth certifies", () => {
    const o = dispositionFor({ operationsPassed: true, premise: goodPremise })
    expect(o).toMatchObject({ disposition: "PASS", certifies: true })
  })

  it("working mechanics against the WRONG thing is PREMISE_FAILED, not PASS", () => {
    // The whole point. operationsPassed is true and it still does not certify.
    const o = dispositionFor({ operationsPassed: true, premise: badPremise })
    expect(o.disposition).toBe("PREMISE_FAILED")
    expect(o.certifies).toBe(false)
    expect(o.reason).toMatch(/revision/i)
  })

  it("PREMISE_FAILED outranks a genuine failure — you cannot judge work against the wrong ground", () => {
    expect(dispositionFor({ operationsPassed: false, premise: badPremise }).disposition).toBe(
      "PREMISE_FAILED",
    )
  })

  it("failing operations against the right thing is FAIL", () => {
    expect(dispositionFor({ operationsPassed: false, premise: goodPremise }).disposition).toBe(
      "FAIL",
    )
  })

  it("some paths passing is PARTIAL", () => {
    expect(
      dispositionFor({ operationsPassed: false, partial: true, premise: goodPremise }).disposition,
    ).toBe("PARTIAL")
  })

  it("an unconfirmed resource cannot certify", () => {
    const unconfirmed = checkPremise(binding({ resources: [resource({ ratifiedAt: null })] }), {
      revisions: { [key]: BASE_SHA },
    })
    const o = dispositionFor({ operationsPassed: true, premise: unconfirmed })
    expect(o.certifies).toBe(false)
    expect(o.reason).toMatch(/unconfirmed/i)
  })

  it("the implementing agent cannot certify itself", () => {
    const o = dispositionFor({
      operationsPassed: true,
      premise: goodPremise,
      verifierIsIndependent: false,
    })
    expect(o.certifies).toBe(false)
    expect(o.reason).toMatch(/cannot certify its own/i)
  })

  it("every disposition is a known one", () => {
    for (const input of [
      { operationsPassed: true, premise: goodPremise },
      { operationsPassed: false, premise: goodPremise },
      { operationsPassed: true, premise: badPremise },
    ]) {
      expect(ACCEPTANCE_DISPOSITIONS).toContain(dispositionFor(input).disposition)
    }
  })
})

describe("a failed premise normally continues the contract", () => {
  it("is not terminal by default — rebind and keep working", () => {
    expect(premiseFailureIsTerminal({})).toBe(false)
  })

  it("is terminal when the bound resource is gone", () => {
    expect(premiseFailureIsTerminal({ boundResourceMissing: true })).toBe(true)
  })

  it("is terminal when the outcome no longer describes anything real", () => {
    expect(premiseFailureIsTerminal({ outcomeNoLongerValid: true })).toBe(true)
  })
})
