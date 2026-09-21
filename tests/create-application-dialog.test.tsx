// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CreateApplicationDialog } from "@/components/workspace-shell/create-application-dialog"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("CreateApplicationDialog", () => {
  it("explains the external starter destination and submits only the bounded application identity", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      application: {
        projectKey: "focus-board",
        manifest: { id: "focus-board", displayName: "Focus Board" },
      },
    }, { status: 201 }))
    vi.stubGlobal("fetch", fetcher)
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(<CreateApplicationDialog open onClose={onClose} onCreated={onCreated} />)

    const dialog = screen.getByRole("dialog", { name: "Create application" })
    expect(within(dialog).getByText(/separate Git repository on HERMES/i)).toBeTruthy()
    expect(dialog.textContent).toContain("static-web-v1 starter")
    await user.type(within(dialog).getByRole("textbox", { name: "Application name" }), "Focus Board")
    await user.type(within(dialog).getByRole("textbox", { name: /Application ID/ }), "focus-board")
    await user.click(within(dialog).getByRole("button", { name: "Create application" }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("focus-board"))
    expect(fetcher).toHaveBeenCalledWith("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "focus-board", displayName: "Focus Board" }),
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it("derives an optional slug, reports a useful conflict, and supports Escape", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "APPLICATION_EXISTS" }, { status: 409 }))
    vi.stubGlobal("fetch", fetcher)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<CreateApplicationDialog open onClose={onClose} onCreated={vi.fn()} />)

    const name = screen.getByRole("textbox", { name: "Application name" })
    expect(document.activeElement).toBe(name)
    await user.type(name, "Focus Board")
    await user.click(screen.getByRole("button", { name: "Create application" }))

    expect((await screen.findByRole("alert")).textContent).toMatch(/already exists/i)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      id: "focus-board",
      displayName: "Focus Board",
    })
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Create application" }), { key: "Escape" })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("keeps Tab and Shift+Tab focus inside the open modal", () => {
    render(<>
      <button type="button">Outside control</button>
      <CreateApplicationDialog open onClose={vi.fn()} onCreated={vi.fn()} />
    </>)

    const dialog = screen.getByRole("dialog", { name: "Create application" })
    const close = within(dialog).getByRole("button", { name: "Close Create application" })
    const submit = within(dialog).getByRole("button", { name: "Create application" })

    close.focus()
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(submit)

    fireEvent.keyDown(window, { key: "Tab" })
    expect(document.activeElement).toBe(close)
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Outside control" }))
  })
})
