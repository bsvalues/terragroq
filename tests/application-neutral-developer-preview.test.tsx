// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

import {
  DeveloperPreviewSurface,
  developerPreviewWindowTitle,
} from "@/components/workspace-shell/developer-preview-surface"
import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const neutralProject = (key: string, name: string) => ({ key, name, kind: "core" as const, preview: "neutral" as const })
const terraFusionProject = { key: "terrafusion", name: "TerraFusion", kind: "core" as const, preview: "terrafusion" as const }

vi.mock("next/dynamic", () => ({
  default: () => function Editor() { return <textarea aria-label="Source content" readOnly /> },
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const attachedEvidence = {
  schemaVersion: 1 as const,
  status: "attached" as const,
  reason: null,
  configuredUrl: "http://target.test/app",
  admittedUrl: "http://target.test/app",
  origin: "http://target.test",
  identity: "TerraFusion" as const,
  reachable: true,
  frameable: true,
  composition: null,
  checkedAt: "2026-09-19T16:00:00.000Z",
  limitations: { dom: "unavailable" as const, console: "unavailable" as const, network: "unavailable" as const },
  fingerprint: "a".repeat(64),
}

function installWorkspaceFetch({
  projectKey,
  projectName,
  projectIdentity,
  space,
  previewEvidence,
}: Readonly<{
  projectKey: "terrafusion" | "williamos"
  projectName: string
  projectIdentity: string
  space: ReturnType<typeof spaceToServer>
  previewEvidence?: typeof attachedEvidence
}>) {
  const endpoint = projectKey === "williamos"
    ? "/api/environment/space?projectKey=williamos"
    : "/api/environment/space"
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === endpoint && !init?.method) return Response.json({
      worldId: "world-a",
      name: projectName,
      space,
      project: { identity: projectIdentity, name: projectName },
      storage: "server",
      spine: EMPTY_SPINE,
    })
    if (url === endpoint && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
      return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-19T16:00:01.000Z" })
    }
    if (url === "/api/environment/preview" && previewEvidence) return Response.json({ evidence: previewEvidence })
    if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
    return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
  })
}

describe("application-neutral developer Preview", () => {
  it("names the window from the active Project instead of a fixed workload", () => {
    expect(developerPreviewWindowTitle("WilliamOS")).toBe("Developer preview · WilliamOS")
    expect(developerPreviewWindowTitle("Atlas Studio")).toBe("Developer preview · Atlas Studio")
  })

  it("keeps product work interactive with a truthful neutral fixture when no runtime is attached", () => {
    render(
      <DeveloperPreviewSurface
        project={neutralProject("williamos", "WilliamOS")}
        runningAppUrl={null}
      />,
    )

    expect(screen.getByRole("region", { name: "WilliamOS application-neutral developer fixture" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "WilliamOS application fixture" })).toBeTruthy()
    expect(screen.getByText("No target runtime attached")).toBeTruthy()
    expect(screen.queryByText(/TerraFusion/i)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Run interaction check" }))
    expect(screen.getByRole("status").textContent).toContain("Interaction 1 received")
  })

  it("keeps an unattached Project's fixture copy tied to that Project", () => {
    render(
      <DeveloperPreviewSurface
        project={neutralProject("atlas-studio", "Atlas Studio")}
        runningAppUrl={null}
      />,
    )

    expect(screen.getByText(/building Atlas Studio when the Project's own runtime is not attached/)).toBeTruthy()
    expect(screen.queryByText(/WilliamOS/)).toBeNull()
  })

  it("keeps every fixture control reachable when its resizable Preview window is short", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "components/workspace-shell/developer-preview-surface.module.css"),
      "utf8",
    )

    expect(css).toMatch(/\.previewHost\s*\{[\s\S]*?overflow:\s*auto;/)
    expect(css).not.toMatch(/@media \(max-width: 560px\)[\s\S]*?\.fixtureFacts\s*\{[^}]*display:\s*none;/)
  })

  it("frames any admitted Project runtime with that Project's identity", () => {
    render(
      <DeveloperPreviewSurface
        project={neutralProject("williamos", "Atlas Studio")}
        runningAppUrl="https://atlas-studio.example.test/"
      />,
    )

    expect(screen.getByTitle("Running Atlas Studio application").getAttribute("src"))
      .toBe("https://atlas-studio.example.test/")
    expect(screen.queryByText(/TerraFusion/i)).toBeNull()
  })

  it("retains the exact composition inspection affordance only for the TerraFusion runtime contract", () => {
    const onInspectComposition = vi.fn()
    render(
      <DeveloperPreviewSurface
        project={terraFusionProject}
        runningAppUrl="https://terrafusion.example.test/"
        onInspectComposition={onInspectComposition}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Inspect Preview composition" }))
    expect(onInspectComposition).toHaveBeenCalledOnce()
  })

  it("does not restore TerraFusion Preview evidence inside the WilliamOS Project", async () => {
    const sharedIdentity = "c:/repos/shared-legacy-identity"
    const terraFusionSpace = spaceToServer({
      ...defaultSpace(1440, 900, "world-a", "TerraFusion"),
      activeWindowId: "running-app",
      runningAppUrl: "http://target.test/app",
    })
    vi.stubGlobal("fetch", installWorkspaceFetch({
      projectKey: "terrafusion",
      projectName: "TerraFusion",
      projectIdentity: sharedIdentity,
      space: terraFusionSpace,
      previewEvidence: attachedEvidence,
    }))
    const terraFusion = render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }))
    await screen.findByRole("heading", { name: "Preview evidence · TerraFusion developer preview" })
    expect(window.localStorage.length).toBe(1)
    terraFusion.unmount()

    const williamSpace = spaceToServer({
      ...defaultSpace(1440, 900, "world-a", "WilliamOS"),
      activeWindowId: "running-app",
      runningAppUrl: null,
    })
    vi.stubGlobal("fetch", installWorkspaceFetch({
      projectKey: "williamos",
      projectName: "WilliamOS",
      projectIdentity: sharedIdentity,
      space: williamSpace,
    }))
    render(<WorkspaceShell projectKey="williamos" />)

    expect(await screen.findByRole("heading", { name: "WilliamOS application fixture" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Preview evidence · TerraFusion developer preview" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Refresh Preview evidence" })).toBeNull()
    expect(window.localStorage.length).toBe(0)
  })

  it("withholds TerraFusion-bound evidence actions from an attached WilliamOS runtime", async () => {
    const williamSpace = spaceToServer({
      ...defaultSpace(1440, 900, "world-a", "WilliamOS"),
      activeWindowId: "running-app",
      runningAppUrl: "https://williamos.example.test/app",
    })
    vi.stubGlobal("fetch", installWorkspaceFetch({
      projectKey: "williamos",
      projectName: "WilliamOS",
      projectIdentity: "c:/repos/william-os-devops",
      space: williamSpace,
    }))
    render(<WorkspaceShell projectKey="williamos" />)

    expect(await screen.findByTitle("Running WilliamOS application")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Debug" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Delegate" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Inspect" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull()
  })
})
