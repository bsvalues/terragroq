// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ProjectSwitcher } from "@/components/workspace-shell/project-switcher"
import { applicationWorkspaceProject } from "@/lib/projects/workspace-project-key"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("application project switcher", () => {
  it("uses server-resolved metadata and exposes Create application without an application-ID branch", () => {
    const onCreated = vi.fn()
    render(<ProjectSwitcher
      activeProjectKey="notes-pad"
      projects={[
        { key: "williamos", name: "WilliamOS", kind: "core", preview: "neutral" },
        applicationWorkspaceProject("notes-pad", "Notes Pad"),
      ]}
      onCreated={onCreated}
    />)

    expect(screen.getByRole("link", { name: "Notes Pad" }).getAttribute("aria-current")).toBe("page")
    expect(screen.getByRole("link", { name: "Notes Pad" }).getAttribute("href")).toBe("/?project=notes-pad")
    fireEvent.click(screen.getByRole("button", { name: "Create application" }))
    expect(screen.getByRole("dialog", { name: "Create application" })).toBeTruthy()
  })

  it("restores focus to the Create application opener after close and callback success", async () => {
    const onCreated = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      application: {
        projectKey: "focus-board",
        manifest: { id: "focus-board", displayName: "Focus Board" },
      },
    }, { status: 201 }))
    vi.stubGlobal("fetch", fetcher)
    const user = userEvent.setup()
    render(<ProjectSwitcher
      activeProjectKey="notes-pad"
      projects={[applicationWorkspaceProject("notes-pad", "Notes Pad")]}
      onCreated={onCreated}
    />)

    const opener = screen.getByRole("button", { name: "Create application" })
    await user.click(opener)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(document.activeElement).toBe(opener)

    await user.click(opener)
    const dialog = screen.getByRole("dialog", { name: "Create application" })
    await user.type(within(dialog).getByRole("textbox", { name: "Application name" }), "Focus Board")
    await user.click(within(dialog).getByRole("button", { name: "Create application" }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("focus-board"))
    expect(screen.queryByRole("dialog", { name: "Create application" })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
