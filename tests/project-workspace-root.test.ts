import { describe, it, expect } from "vitest"

import {
  resolveProjectWorkspaceRoot,
  rootCanCertify,
  type ResourceCheckoutLike,
  type WorkspaceResourceLike,
} from "@/lib/loom/project-workspace-root"

const RATIFIED = new Date("2026-08-01T00:00:00.000Z")
const CWD = "C:/Users/bsval/terragroq"
const AMBIENT = "C:/TF-wt-rel-001"
const REMOTE = "https://github.com/bsvalues/terrafusion_os_1.0.git"

const HERMES = "hermes"
const AEGIS = "aegis"
const OMEN = "omen"

function repo(over: Partial<WorkspaceResourceLike> = {}): WorkspaceResourceLike {
  return {
    resourceKey: "terrafusion-primary-repo",
    type: "repo",
    canonicalIdentity: REMOTE,
    ratifiedAt: RATIFIED,
    ...over,
  }
}

function checkout(over: Partial<ResourceCheckoutLike> = {}): ResourceCheckoutLike {
  return {
    resourceKey: "terrafusion-primary-repo",
    node: HERMES,
    path: "C:/williamos/terrafusion_os_1.0",
    observedIdentity: REMOTE,
    observedRevision: "0e4536ea9c1d4f77b2a3e5c6d7f8091a2b3c4d5e",
    ratifiedAt: RATIFIED,
    ...over,
  }
}

function resolve(over: Partial<Parameters<typeof resolveProjectWorkspaceRoot>[0]> = {}) {
  return resolveProjectWorkspaceRoot({
    projectId: 7,
    resources: [repo()],
    checkouts: [checkout()],
    node: HERMES,
    ambientRoot: AMBIENT,
    cwd: CWD,
    ...over,
  })
}

/* ------------------------------------------------------------------ */
/* A path is per-node, not a property of the repository                */
/* ------------------------------------------------------------------ */

describe("checkouts are node-scoped", () => {
  it("resolves the checkout on the serving node", () => {
    expect(resolve()).toMatchObject({
      root: "C:/williamos/terrafusion_os_1.0",
      provenance: "project",
      node: HERMES,
      projectId: 7,
    })
  })

  it("the same repository resolves differently on different nodes", () => {
    // The reason this is a table and not a column. One canonical repository, three real paths.
    const checkouts = [
      checkout({ node: HERMES, path: "C:/williamos/terrafusion_os_1.0" }),
      checkout({ node: AEGIS, path: "/srv/terrafusion_os_1.0" }),
      checkout({ node: OMEN, path: "C:/Users/bsval/terrafusion_os_1.0" }),
    ]
    expect(resolve({ checkouts, node: AEGIS }).root).toBe("/srv/terrafusion_os_1.0")
    expect(resolve({ checkouts, node: OMEN }).root).toBe("C:/Users/bsval/terrafusion_os_1.0")
    expect(resolve({ checkouts, node: HERMES }).root).toBe("C:/williamos/terrafusion_os_1.0")
  })

  it("a node with no checkout of that repo is unbound, not an error", () => {
    // Normal and meaningful: most resources are not checked out on most nodes. ATLAS is a database
    // host and has no business holding a repo.
    const r = resolve({ node: "atlas" })
    expect(r.provenance).toBe("ambient")
    expect(r.unboundReason).toMatch(/not checked out on atlas/)
    // The identity is still reported, so the record shows WHAT was unreachable.
    expect(r.canonicalIdentity).toBe(REMOTE)
  })

  it("never borrows another node's path", () => {
    // The failure mode a single path column would have produced.
    const r = resolve({ checkouts: [checkout({ node: AEGIS, path: "/srv/terrafusion_os_1.0" })] })
    expect(r.root).not.toBe("/srv/terrafusion_os_1.0")
    expect(r.provenance).toBe("ambient")
  })

  it("always reports which node it resolved for", () => {
    expect(resolve({ node: OMEN }).node).toBe(OMEN)
    expect(resolve({ projectId: null, node: OMEN }).node).toBe(OMEN)
  })
})

/* ------------------------------------------------------------------ */
/* Project-derived beats ambient                                       */
/* ------------------------------------------------------------------ */

describe("a Project-derived root is knowable as such", () => {
  it("prefers the Project over the environment", () => {
    // The environment variable is exactly what made the Space lie: it pointed at a stale worktree
    // while the header said TerraFusion.
    expect(resolve().root).not.toBe(AMBIENT)
  })

  it("carries the canonical identity a checkout must match", () => {
    expect(resolve().canonicalIdentity).toBe(REMOTE)
  })

  it("names which repo when a Project has several", () => {
    const r = resolve({
      resources: [repo(), repo({ resourceKey: "docs-repo" })],
      checkouts: [checkout(), checkout({ resourceKey: "docs-repo", path: "C:/docs" })],
      resourceKey: "docs-repo",
    })
    expect(r).toMatchObject({ root: "C:/docs", provenance: "project" })
  })

  it("refuses to GUESS between several repos", () => {
    const r = resolve({ resources: [repo(), repo({ resourceKey: "docs-repo" })] })
    expect(r.provenance).toBe("ambient")
    expect(r.unboundReason).toMatch(/2 repo resources and the Space names none/)
  })

  it("ignores non-repo resources when picking the default", () => {
    const r = resolve({
      resources: [
        repo(),
        { resourceKey: "atlas", type: "database", canonicalIdentity: "pg://atlas", ratifiedAt: RATIFIED },
      ],
    })
    expect(r.provenance).toBe("project")
  })
})

describe("an unbound root still works, but says so", () => {
  it("falls back to the environment when no Project is bound", () => {
    const r = resolve({ projectId: null })
    expect(r).toMatchObject({ root: AMBIENT, provenance: "ambient", projectId: null })
    expect(r.unboundReason).toMatch(/No Project bound/)
  })

  it("falls back to cwd when there is no environment root either", () => {
    expect(resolve({ projectId: null, ambientRoot: null })).toMatchObject({
      root: CWD,
      provenance: "cwd",
    })
  })

  it("does not silently succeed when the Project has no repo", () => {
    const r = resolve({ resources: [] })
    expect(r.provenance).toBe("ambient")
    expect(r.unboundReason).toMatch(/no repo resource/)
  })

  it("editing is never blocked by an unbound root — only certification is", () => {
    // Refusing to open an editor because a Project record is missing would be worse than the bug.
    expect(resolve({ projectId: null }).root).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ */
/* The stale-worktree case, caught at source                           */
/* ------------------------------------------------------------------ */

describe("observed identity is recorded separately from canonical identity", () => {
  it("catches a checkout that is a different repository than the resource claims", () => {
    // Only detectable because both are stored. This is the 2026-08-26 failure at its source: the
    // path resolved, the editor worked, and the tree was not the repository it claimed to be.
    const r = resolve({
      checkouts: [checkout({ observedIdentity: "https://github.com/bsvalues/terragroq.git" })],
    })
    expect(r.identityMismatch).toBe(true)
    expect(rootCanCertify(r).ok).toBe(false)
    expect(rootCanCertify(r).reason).toMatch(/reports .*terragroq.*but the resource is/)
  })

  it("tolerates cosmetic remote differences", () => {
    const r = resolve({
      checkouts: [checkout({ observedIdentity: "git@github.com:bsvalues/terrafusion_os_1.0.git" })],
    })
    expect(r.identityMismatch).toBe(false)
    expect(rootCanCertify(r)).toEqual({ ok: true })
  })

  it("an unobserved checkout is not a mismatch — it is simply unobserved", () => {
    const r = resolve({ checkouts: [checkout({ observedIdentity: null })] })
    expect(r.identityMismatch).toBe(false)
  })

  it("carries the observed revision for the premise check", () => {
    expect(resolve().observedRevision).toBe("0e4536ea9c1d4f77b2a3e5c6d7f8091a2b3c4d5e")
  })
})

/* ------------------------------------------------------------------ */
/* Certification                                                       */
/* ------------------------------------------------------------------ */

describe("certification follows provenance", () => {
  it("a ratified Project-derived checkout can certify", () => {
    expect(rootCanCertify(resolve())).toEqual({ ok: true })
  })

  it("an ambient root cannot certify", () => {
    const verdict = rootCanCertify(resolve({ projectId: null }))
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/not Project-derived/)
  })

  it("a ratified resource with an UNRATIFIED checkout cannot certify", () => {
    // Both levels matter: a confirmed repository pointed at a guessed directory is still a guess.
    const r = resolve({ checkouts: [checkout({ ratifiedAt: null })] })
    expect(r.provenance).toBe("project")
    expect(r.ratified).toBe(false)
    expect(rootCanCertify(r).reason).toMatch(/not owner-ratified/)
  })

  it("an unratified resource cannot certify even with a ratified checkout", () => {
    const r = resolve({ resources: [repo({ ratifiedAt: null })] })
    expect(rootCanCertify(r).ok).toBe(false)
  })

  it("an identity mismatch outranks ratification in the reason given", () => {
    // Being told the directory is unconfirmed would send someone to ratify the wrong repository.
    const r = resolve({
      checkouts: [checkout({ observedIdentity: "https://github.com/other/repo.git", ratifiedAt: null })],
    })
    expect(rootCanCertify(r).reason).toMatch(/but the resource is/)
  })
})
