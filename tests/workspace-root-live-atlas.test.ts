import { describe, it, expect } from "vitest"
import {
  resolveProjectWorkspaceRoot,
  rootCanCertify,
} from "@/lib/loom/project-workspace-root"

/**
 * The rows below are copied verbatim from the canonical ATLAS store after migrations 0014-0017
 * were applied, and from `git remote get-url` / `git rev-parse HEAD` on the real checkouts. This
 * asserts the resolver's behaviour on the data that actually exists, not on fixtures I invented --
 * which is how the resourceKey and slug-vs-URL defects both got through.
 */
const RESOURCES = [
  { id: 2, resourceKey: null, relationship: "primary-repo", type: "repo",
    canonicalIdentity: "bsvalues/terrafusion_os_1.0", ratifiedAt: null },
  { id: 14, resourceKey: null, relationship: "worker", type: "node",
    canonicalIdentity: "AEGIS", ratifiedAt: null },
  { id: 16, resourceKey: null, relationship: "state", type: "database",
    canonicalIdentity: "atlas/terrafusion", ratifiedAt: null },
]

const CHECKOUTS = [
  { projectResourceId: 2, node: "omen", path: "C:\Users\bsval\terrafusion_os_1.0",
    observedIdentity: "git@github.com:bsvalues/terrafusion_os_1.0.git",
    observedRevision: "731b15f082341b936cdc8710ec8229c4619a6486", ratifiedAt: null },
  { projectResourceId: 2, node: "hermes", path: "C:\TF-wt-rel-001",
    observedIdentity: "https://github.com/bsvalues/terrafusion_os_1.0.git",
    observedRevision: "fd294dc389f8f7f5821881fa2335b7d62bc630f0", ratifiedAt: null },
]

const base = { projectId: 2, resources: RESOURCES, checkouts: CHECKOUTS,
               ambientRoot: "C:/TF-wt-rel-001", cwd: "C:/Users/bsval/terragroq" }

describe("live ATLAS rows, project 2 (TerraFusion OS)", () => {
  it("resolves OMEN to its real checkout", () => {
    const r = resolveProjectWorkspaceRoot({ ...base, node: "omen" })
    expect(r).toMatchObject({
      root: "C:\Users\bsval\terrafusion_os_1.0",
      provenance: "project",
      resourceId: 2,
    })
    expect(r.identityMismatch).toBe(false)
  })

  it("resolves HERMES to a DIFFERENT path for the same repository", () => {
    const r = resolveProjectWorkspaceRoot({ ...base, node: "hermes" })
    expect(r.root).toBe("C:\TF-wt-rel-001")
    expect(r.identityMismatch).toBe(false)
  })

  it("shows the two nodes are on divergent revisions", () => {
    // 731b15f0 on OMEN vs fd294dc3 on HERMES. The launcher's WILLIAMOS_PROJECT_ROOT points at the
    // HERMES one; before this table nothing recorded that they differ.
    const omen = resolveProjectWorkspaceRoot({ ...base, node: "omen" })
    const hermes = resolveProjectWorkspaceRoot({ ...base, node: "hermes" })
    expect(omen.observedRevision).not.toBe(hermes.observedRevision)
  })

  it("selects by relationship, since these rows carry no resourceKey", () => {
    const r = resolveProjectWorkspaceRoot({ ...base, node: "omen", resourceSelector: "primary-repo" })
    expect(r.provenance).toBe("project")
  })

  it("ATLAS holds no checkout of this repo, and says so", () => {
    const r = resolveProjectWorkspaceRoot({ ...base, node: "atlas" })
    expect(r.provenance).toBe("ambient")
    expect(r.unboundReason).toMatch(/not checked out on atlas/)
  })

  it("cannot certify today, because nothing is ratified", () => {
    // The honest current state: the roots resolve, the identities match, and ratification is an
    // owner act that has not happened.
    const r = resolveProjectWorkspaceRoot({ ...base, node: "omen" })
    expect(rootCanCertify(r)).toMatchObject({ ok: false })
    expect(rootCanCertify(r).reason).toMatch(/not owner-ratified/)
  })
})
