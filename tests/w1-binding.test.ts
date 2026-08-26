import { describe, it, expect } from "vitest"

import { canonicalRepoIdentity, sameRepository } from "@/lib/loom/repo-identity"
import { bindW1Workspace, type W1BindingInput } from "@/lib/loom/w1-binding"
import type {
  ResourceCheckoutLike,
  WorkspaceResourceLike,
} from "@/lib/loom/project-workspace-root"

const REV = "731b15f082341b936cdc8710ec8229c4619a6486"
const RATIFIED = new Date("2026-08-01T00:00:00.000Z")

/* ------------------------------------------------------------------ */
/* Canonical identity — every supported form reduces to owner/repo     */
/* ------------------------------------------------------------------ */

describe("canonicalRepoIdentity", () => {
  it.each([
    "bsvalues/terrafusion_os_1.0",
    "https://github.com/bsvalues/terrafusion_os_1.0.git",
    "https://github.com/bsvalues/terrafusion_os_1.0",
    "git@github.com:bsvalues/terrafusion_os_1.0.git",
    "ssh://git@github.com/bsvalues/terrafusion_os_1.0.git",
    "git+https://github.com/bsvalues/terrafusion_os_1.0.git",
    "https://github.com/bsvalues/terrafusion_os_1.0/",
  ])("reduces %s to the canonical slug", (form) => {
    expect(canonicalRepoIdentity(form)).toBe("bsvalues/terrafusion_os_1.0")
  })

  it("lowercases for comparison", () => {
    expect(canonicalRepoIdentity("BSValues/TerraFusion_OS_1.0")).toBe("bsvalues/terrafusion_os_1.0")
  })

  it.each([
    ["empty", ""],
    ["null", null],
    ["a bare word", "terrafusion"],
    ["a path with extra segments", "https://github.com/bsvalues/group/repo.git"],
    ["a trailing slug fragment only", "/repo"],
  ])("refuses %s rather than half-parsing it", (_label, form) => {
    expect(canonicalRepoIdentity(form)).toBeNull()
  })

  it("matches all forms of the same repo and separates different repos", () => {
    expect(sameRepository("bsvalues/repo", "git@github.com:bsvalues/repo.git")).toBe(true)
    expect(sameRepository("ssh://git@github.com/bsvalues/repo.git", "https://github.com/bsvalues/repo")).toBe(
      true,
    )
    expect(sameRepository("bsvalues/terragroq", "bsvalues/terrafusion_os_1.0")).toBe(false)
  })

  it("refuses to match when either side is unrecognisable", () => {
    // "close enough" is exactly what lets a wrong checkout pass.
    expect(sameRepository("terrafusion", "bsvalues/terrafusion")).toBe(false)
    expect(sameRepository("", "bsvalues/repo")).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Strict W1 binding — no ambient fallback, cardinality enforced       */
/* ------------------------------------------------------------------ */

function repo(over: Partial<WorkspaceResourceLike> = {}): WorkspaceResourceLike {
  return {
    id: 2,
    resourceKey: null,
    relationship: "primary-repo",
    type: "repo",
    canonicalIdentity: "bsvalues/terrafusion_os_1.0",
    ratifiedAt: null,
    ...over,
  }
}

function checkout(over: Partial<ResourceCheckoutLike> = {}): ResourceCheckoutLike {
  return {
    projectResourceId: 2,
    node: "omen",
    path: "C:\\Users\\bsval\\terrafusion_os_1.0",
    observedIdentity: "git@github.com:bsvalues/terrafusion_os_1.0.git",
    observedRevision: REV,
    ratifiedAt: null,
    ...over,
  }
}

function bind(over: Partial<W1BindingInput> = {}) {
  return bindW1Workspace({
    projectId: 2,
    resources: [repo()],
    checkouts: [checkout()],
    node: "omen",
    ...over,
  })
}

describe("bindW1Workspace never falls back to ambient", () => {
  it("binds one specific checkout at one observed revision", () => {
    const r = bind()
    expect(r).toMatchObject({
      ok: true,
      root: "C:\\Users\\bsval\\terrafusion_os_1.0",
      node: "omen",
      identity: "bsvalues/terrafusion_os_1.0",
      observedRevision: REV,
    })
  })

  it("refuses with NO_PROJECT rather than using cwd", () => {
    const r = bind({ projectId: null })
    expect(r).toMatchObject({ ok: false, refusal: "NO_PROJECT" })
  })

  it("refuses NO_PRIMARY_REPO when the Project has none", () => {
    expect(bind({ resources: [] })).toMatchObject({ ok: false, refusal: "NO_PRIMARY_REPO" })
  })

  it("refuses AMBIGUOUS_PRIMARY_REPO when the Project has two", () => {
    // The cardinality assertion: the schema will not stop two, so the binder does.
    const r = bind({ resources: [repo(), repo({ id: 3 })] })
    expect(r).toMatchObject({ ok: false, refusal: "AMBIGUOUS_PRIMARY_REPO" })
    if (!r.ok) expect(r.detail).toMatch(/ids 2, 3/)
  })

  it("does not count a non-primary repo toward the cardinality", () => {
    const r = bind({ resources: [repo(), repo({ id: 3, relationship: "docs-repo" })] })
    expect(r.ok).toBe(true)
  })

  it("refuses NOT_CHECKED_OUT_ON_NODE for a node with no binding", () => {
    expect(bind({ node: "atlas" })).toMatchObject({ ok: false, refusal: "NOT_CHECKED_OUT_ON_NODE" })
  })

  it("refuses NO_OBSERVED_REVISION when the checkout was never observed at a SHA", () => {
    expect(bind({ checkouts: [checkout({ observedRevision: "" })] })).toMatchObject({
      ok: false,
      refusal: "NO_OBSERVED_REVISION",
    })
  })

  it("refuses REMOTE_MISMATCH when the checkout is a different repository", () => {
    const r = bind({ checkouts: [checkout({ observedIdentity: "git@github.com:bsvalues/terragroq.git" })] })
    expect(r).toMatchObject({ ok: false, refusal: "REMOTE_MISMATCH" })
    if (!r.ok) expect(r.detail).toMatch(/bsvalues\/terragroq.*not bsvalues\/terrafusion_os_1\.0/)
  })

  it("refuses RESOURCE_IDENTITY_UNRECOGNISED for a nonsense canonical identity", () => {
    expect(bind({ resources: [repo({ canonicalIdentity: "terrafusion" })] })).toMatchObject({
      ok: false,
      refusal: "RESOURCE_IDENTITY_UNRECOGNISED",
    })
  })

  it("binds even while unratified — binding and certification are different questions", () => {
    const r = bind()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ratified).toBe(false)
  })

  it("reports ratified only when BOTH levels are confirmed", () => {
    expect(bind({ resources: [repo({ ratifiedAt: RATIFIED })], checkouts: [checkout({ ratifiedAt: RATIFIED })] })).toMatchObject(
      { ok: true, ratified: true },
    )
    expect(bind({ resources: [repo({ ratifiedAt: RATIFIED })] })).toMatchObject({ ok: true, ratified: false })
  })
})

/* ------------------------------------------------------------------ */
/* Live divergence — one repo, two nodes, two revisions                */
/* ------------------------------------------------------------------ */

describe("the OMEN/HERMES divergence binds to one node, not both", () => {
  const resources = [repo()]
  const checkouts = [
    checkout({ node: "omen", path: "C:\\Users\\bsval\\terrafusion_os_1.0", observedRevision: "731b15f0" }),
    checkout({
      node: "hermes",
      path: "C:\\TF-wt-rel-001",
      observedIdentity: "https://github.com/bsvalues/terrafusion_os_1.0.git",
      observedRevision: "fd294dc3",
    }),
  ]

  it("binds OMEN at its revision", () => {
    const r = bindW1Workspace({ projectId: 2, resources, checkouts, node: "omen" })
    expect(r).toMatchObject({ ok: true, root: "C:\\Users\\bsval\\terrafusion_os_1.0", observedRevision: "731b15f0" })
  })

  it("binds HERMES at its DIFFERENT revision — not interchangeable", () => {
    const r = bindW1Workspace({ projectId: 2, resources, checkouts, node: "hermes" })
    expect(r).toMatchObject({ ok: true, root: "C:\\TF-wt-rel-001", observedRevision: "fd294dc3" })
  })
})
