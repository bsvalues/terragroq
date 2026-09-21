import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApplication } from "@/lib/applications/application-creation"
import { discoverApplications } from "@/lib/applications/application-catalog"
import { resolveCanonicalWorkspaceProjectBinding } from "@/lib/projects/workspace-project-binding"
import { resolveRequestedWorkspaceProjectKey, resolveVisibleWorkspaceProjects } from "@/lib/projects/workspace-project-key"

const roots: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
describe("catalog application project binding", () => {
  it("lists and selects external applications from the catalog and binds the selected independent root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "application-binding-")); roots.push(root)
    vi.stubEnv("WILLIAMOS_APPLICATIONS_ROOT", root)
    vi.stubEnv("WILLIAMOS_VISIBLE_PROJECTS", "williamos")
    const created = await createApplication({ id: "focus-board", displayName: "Focus Board" })
    const second = await createApplication({ id: "second-board", displayName: "Second Board" })
    const catalog = await discoverApplications()
    const projects = catalog.applications.map(({ manifest }) => ({ key: manifest.id, name: manifest.displayName }))
    expect(resolveVisibleWorkspaceProjects(projects)).toEqual([
      expect.objectContaining({ key: "williamos", name: "WilliamOS", kind: "core", preview: "neutral" }),
      expect.objectContaining({ key: "focus-board", name: "Focus Board", kind: "application", preview: "contained" }),
      expect.objectContaining({ key: "second-board", name: "Second Board", kind: "application", preview: "contained" }),
    ])
    expect(resolveRequestedWorkspaceProjectKey("focus-board", projects)).toBe("focus-board")
    const firstBinding = await resolveCanonicalWorkspaceProjectBinding("owner", "focus-board")
    expect(firstBinding).toEqual({ ok: true, binding: expect.objectContaining({ projectKey: "focus-board", workspaceRoot: created.repositoryRoot, observedRevision: created.head, workspaceAppUrl: "/api/projects/focus-board/application-preview" }) })
    if (!firstBinding.ok) throw new Error("binding unavailable")
    expect(firstBinding.binding.projectId).toBeLessThan(0)
    expect(Number.isSafeInteger(firstBinding.binding.projectId)).toBe(true)
    expect(await resolveCanonicalWorkspaceProjectBinding("owner", "focus-board")).toEqual(firstBinding)
    const secondBinding = await resolveCanonicalWorkspaceProjectBinding("owner", "second-board")
    if (!secondBinding.ok) throw new Error("binding unavailable")
    expect(secondBinding.binding.projectId).not.toBe(firstBinding.binding.projectId)
    expect(await resolveCanonicalWorkspaceProjectBinding("owner", "second-board")).toEqual({ ok: true, binding: expect.objectContaining({ workspaceRoot: second.repositoryRoot, repositoryIdentity: "application:second-board" }) })
    await expect(resolveCanonicalWorkspaceProjectBinding("owner", "unknown-app")).resolves.toEqual({ ok: false, error: "APPLICATION_NOT_FOUND" })
    await expect(resolveCanonicalWorkspaceProjectBinding("owner", "focus-board", undefined, "williamos")).resolves.toEqual({ ok: false, error: "WORKSPACE_REPOSITORY_UNKNOWN" })
  })
  it("preserves core defaults and never lists an unverified caller ID", () => {
    vi.stubEnv("WILLIAMOS_VISIBLE_PROJECTS", "unknown-app,terrafusion,williamos")
    expect(resolveVisibleWorkspaceProjects()).toEqual([
      { key: "terrafusion", name: "TerraFusion OS", kind: "core", preview: "terrafusion" },
      { key: "williamos", name: "WilliamOS", kind: "core", preview: "neutral" },
    ])
    expect(resolveRequestedWorkspaceProjectKey("unknown-app")).toBe("terrafusion")
    vi.stubEnv("WILLIAMOS_VISIBLE_PROJECTS", "unknown-app")
    expect(resolveVisibleWorkspaceProjects()).toEqual([
      { key: "terrafusion", name: "TerraFusion OS", kind: "core", preview: "terrafusion" },
      { key: "williamos", name: "WilliamOS", kind: "core", preview: "neutral" },
    ])
  })
})
