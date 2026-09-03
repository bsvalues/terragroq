import { describe, expect, it } from "vitest"

import {
  canonicalWorkspaceObjectKey,
  parseWorkspaceFileRef,
  sameWorkspaceObject,
} from "@/lib/projects/workspace-object-ref"

const atlasReadme = {
  projectIdentity: "project:terrafusion",
  repositoryResourceKey: "repo:terrafusion-atlas",
  repositoryMountKey: "mount:hermes:terrafusion-atlas:protected-main",
  worktreeKey: null,
  observedRevision: "a".repeat(40),
  path: "README.md",
} as const

describe("repository-qualified workspace object identity", () => {
  it("keeps identical relative paths in different repositories distinct", () => {
    const osReadme = {
      ...atlasReadme,
      repositoryResourceKey: "repo:terrafusion-os-1",
      repositoryMountKey: "mount:hermes:terrafusion-os-1:protected-main",
    }

    expect(canonicalWorkspaceObjectKey(atlasReadme)).not.toBe(canonicalWorkspaceObjectKey(osReadme))
    expect(sameWorkspaceObject(atlasReadme, osReadme)).toBe(false)
  })

  it("keeps the same repository path in protected main and an assignment worktree distinct", () => {
    const assignmentFile = {
      ...atlasReadme,
      repositoryMountKey: "mount:omen:terrafusion-atlas:worktrees",
      worktreeKey: "worktree:wo-atlas-001",
      observedRevision: "b".repeat(40),
    }

    expect(canonicalWorkspaceObjectKey(atlasReadme)).not.toBe(canonicalWorkspaceObjectKey(assignmentFile))
    expect(sameWorkspaceObject(atlasReadme, assignmentFile)).toBe(false)
  })

  it("normalizes safe relative paths but never accepts host paths or traversal", () => {
    expect(parseWorkspaceFileRef({ ...atlasReadme, path: "src\\projection\\index.ts" })).toEqual({
      ...atlasReadme,
      path: "src/projection/index.ts",
    })

    for (const path of ["C:\\repo\\secret.ts", "/etc/passwd", "../outside.ts", "src/../../outside.ts", ""])
      expect(() => parseWorkspaceFileRef({ ...atlasReadme, path })).toThrow("WORKSPACE_FILE_REF_PATH_INVALID")
  })

  it("fails closed when repository, mount, worktree, or revision identity is ambiguous", () => {
    const invalid = [
      { ...atlasReadme, repositoryResourceKey: "" },
      { ...atlasReadme, repositoryMountKey: "" },
      { ...atlasReadme, worktreeKey: "../other" },
      { ...atlasReadme, observedRevision: "main" },
    ]

    for (const value of invalid) expect(() => parseWorkspaceFileRef(value)).toThrow(/WORKSPACE_FILE_REF_/)
  })

  it("treats revision as observed verification state rather than changing stable tab identity", () => {
    const laterRevision = { ...atlasReadme, observedRevision: "c".repeat(40) }

    expect(canonicalWorkspaceObjectKey(atlasReadme)).toBe(canonicalWorkspaceObjectKey(laterRevision))
    expect(sameWorkspaceObject(atlasReadme, laterRevision)).toBe(true)
    expect(parseWorkspaceFileRef(laterRevision).observedRevision).toBe("c".repeat(40))
  })
})
