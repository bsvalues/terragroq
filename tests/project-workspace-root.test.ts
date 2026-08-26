import { describe, it, expect } from "vitest"

import {
  resolveProjectWorkspaceRoot,
  rootCanCertify,
  type WorkspaceResourceLike,
} from "@/lib/loom/project-workspace-root"

const RATIFIED = new Date("2026-08-01T00:00:00.000Z")
const CWD = "C:/Users/bsval/terragroq"
const AMBIENT = "C:/TF-wt-rel-001"
const CHECKOUT = "C:/Users/bsval/terrafusion_os_1.0"

function repo(over: Partial<WorkspaceResourceLike> = {}): WorkspaceResourceLike {
  return {
    resourceKey: "terrafusion-primary-repo",
    type: "repo",
    canonicalIdentity: "https://github.com/bsvalues/terrafusion_os_1.0.git",
    localPath: CHECKOUT,
    ratifiedAt: RATIFIED,
    ...over,
  }
}

describe("a Project-derived root is knowable as such", () => {
  it("resolves the Project's only repo", () => {
    const r = resolveProjectWorkspaceRoot({
      projectId: 7,
      resources: [repo()],
      ambientRoot: AMBIENT,
      cwd: CWD,
    })
    expect(r).toMatchObject({
      root: CHECKOUT,
      provenance: "project",
      projectId: 7,
      resourceKey: "terrafusion-primary-repo",
      ratified: true,
    })
  })

  it("prefers the Project over the environment", () => {
    // The environment variable is exactly what made the Space lie: it pointed at a stale worktree
    // while the header said TerraFusion.
    const r = resolveProjectWorkspaceRoot({
      projectId: 7,
      resources: [repo()],
      ambientRoot: AMBIENT,
      cwd: CWD,
    })
    expect(r.root).not.toBe(AMBIENT)
  })

  it("carries the canonical identity a checkout must match", () => {
    const r = resolveProjectWorkspaceRoot({ projectId: 7, resources: [repo()], cwd: CWD })
    expect(r.canonicalIdentity).toBe("https://github.com/bsvalues/terrafusion_os_1.0.git")
  })

  it("names which repo when a Project has several", () => {
    const r = resolveProjectWorkspaceRoot({
      projectId: 7,
      resources: [repo(), repo({ resourceKey: "docs-repo", localPath: "C:/docs" })],
      resourceKey: "docs-repo",
      cwd: CWD,
    })
    expect(r).toMatchObject({ root: "C:/docs", provenance: "project" })
  })

  it("refuses to GUESS between several repos", () => {
    // Picking one would reintroduce the exact ambiguity this exists to remove, silently.
    const r = resolveProjectWorkspaceRoot({
      projectId: 7,
      resources: [repo(), repo({ resourceKey: "docs-repo", localPath: "C:/docs" })],
      ambientRoot: AMBIENT,
      cwd: CWD,
    })
    expect(r.provenance).toBe("ambient")
    expect(r.unboundReason).toMatch(/2 repo resources and the Space names none/)
  })

  it("ignores non-repo resources when picking the default", () => {
    const r = resolveProjectWorkspaceRoot({
      projectId: 7,
      resources: [
        repo(),
        { resourceKey: "atlas", type: "database", canonicalIdentity: "pg://atlas", localPath: null, ratifiedAt: RATIFIED },
      ],
      cwd: CWD,
    })
    expect(r.provenance).toBe("project")
  })
})

describe("an unbound root still works, but says so", () => {
  it("falls back to the environment when no Project is bound", () => {
    const r = resolveProjectWorkspaceRoot({
      projectId: null,
      resources: [],
      ambientRoot: AMBIENT,
      cwd: CWD,
    })
    expect(r).toMatchObject({ root: AMBIENT, provenance: "ambient", projectId: null })
    expect(r.unboundReason).toMatch(/No Project bound/)
  })

  it("falls back to cwd when there is no environment root either", () => {
    const r = resolveProjectWorkspaceRoot({ projectId: null, resources: [], cwd: CWD })
    expect(r).toMatchObject({ root: CWD, provenance: "cwd" })
  })

  it("does not silently succeed when the Project has no repo", () => {
    const r = resolveProjectWorkspaceRoot({
      projectId: 7,
      resources: [],
      ambientRoot: AMBIENT,
      cwd: CWD,
    })
    expect(r.provenance).toBe("ambient")
    expect(r.unboundReason).toMatch(/no repo resource/)
  })

  it("does not silently succeed when the named repo has no checkout on this machine", () => {
    const r = resolveProjectWorkspaceRoot({
      projectId: 7,
      resources: [repo({ localPath: null })],
      ambientRoot: AMBIENT,
      cwd: CWD,
    })
    expect(r.provenance).toBe("ambient")
    expect(r.unboundReason).toMatch(/no local checkout path/)
    // The identity is still reported, so the record shows WHAT was unreachable.
    expect(r.canonicalIdentity).toBeTruthy()
  })

  it("editing is never blocked by an unbound root — only certification is", () => {
    // Refusing to open an editor because a Project record is missing would be worse than the bug.
    const r = resolveProjectWorkspaceRoot({ projectId: null, resources: [], ambientRoot: AMBIENT, cwd: CWD })
    expect(r.root).toBeTruthy()
  })
})

describe("certification follows provenance", () => {
  it("a ratified Project-derived root can certify", () => {
    const r = resolveProjectWorkspaceRoot({ projectId: 7, resources: [repo()], cwd: CWD })
    expect(rootCanCertify(r)).toEqual({ ok: true })
  })

  it("an ambient root cannot certify", () => {
    // There is no canonical identity to compare a checkout against, so "the right repository at
    // the right revision" is not a question the system can answer at all.
    const r = resolveProjectWorkspaceRoot({ projectId: null, resources: [], ambientRoot: AMBIENT, cwd: CWD })
    const verdict = rootCanCertify(r)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/not Project-derived/)
  })

  it("a cwd root cannot certify", () => {
    const r = resolveProjectWorkspaceRoot({ projectId: null, resources: [], cwd: CWD })
    expect(rootCanCertify(r).ok).toBe(false)
  })

  it("an unratified resource resolves but cannot certify", () => {
    const r = resolveProjectWorkspaceRoot({
      projectId: 7,
      resources: [repo({ ratifiedAt: null })],
      cwd: CWD,
    })
    expect(r.provenance).toBe("project")
    expect(rootCanCertify(r)).toMatchObject({ ok: false })
    expect(rootCanCertify(r).reason).toMatch(/not owner-ratified/)
  })
})
