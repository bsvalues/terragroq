// @vitest-environment jsdom
import fs from "node:fs"
import path from "node:path"

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Desk } from "@/components/desk/desk"

/**
 * The mechanical guard the owner ordered (2026-08-20): do not rely on anyone remembering the
 * prohibition. The replacement root must have no accidental dependency on the rejected product model
 * — not in its rendered DOM, not in its module graph. These tests fail the build the moment the
 * legacy ontology leaks back in, however it gets there.
 */
afterEach(cleanup)

const FORBIDDEN_VOCABULARY = [
  "HOME",
  "PROJECTS",
  "ACTIVITY",
  "SYSTEM",
  "Explorer",
  "Execution",
  "Choose a Project",
  "CURRENT THREAD",
  "WORK RECORD",
]

const REFUSED_IMPORTS = [
  "components/workbench",
  "components/intent",
  "components/chat",
  "components/loom/workspace",
  "components/loom/agent-thread",
  "components/environment/environment",
  "app/(shell)",
  "lib/workbench/thread-projection",
  "lib/workbench/load-threads",
]

const NEW_ROOT_FILES = [
  // `app/page.tsx`, not `app/environment/page.tsx`: the environment owns `/` now, and the two
  // predecessor roots redirect to it. Checking a file that no longer exists would have made this
  // guard throw rather than guard.
  "app/page.tsx",
  "components/desk/desk.tsx",
  "app/api/environment/line/route.ts",
]

describe("the replacement root refuses the legacy product model", () => {
  it("renders normal work with none of the rejected vocabulary in the DOM", () => {
    const { container } = render(<Desk />)
    const text = container.textContent ?? ""
    for (const word of FORBIDDEN_VOCABULARY) {
      expect(text).not.toContain(word)
    }
  })

  it("keeps William present while The Line remains a separate transient input", () => {
    render(<Desk />)
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Open William conversation" }))
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
    expect(screen.getByRole("textbox", { name: "Message William" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /The Line/ }))
    expect(screen.getAllByRole("textbox")).toHaveLength(2)
    expect(screen.getByRole("textbox", { name: "The Line" })).toBeTruthy()
  })

  it("starts in a useful Space without project-selection ceremony", () => {
    render(<Desk />)
    expect(screen.getByRole("region", { name: "Source window" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Developer preview · TerraFusion window" })).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "Workspace files" })).toBeTruthy()
    expect(screen.queryByText("Choose a Project")).toBeNull()
  })

  it("imports nothing from the refused legacy modules — checked in source, not trusted to review", () => {
    for (const file of NEW_ROOT_FILES) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8")
      for (const refused of REFUSED_IMPORTS) {
        expect(source.includes(refused), `${file} must not reference ${refused}`).toBe(false)
      }
    }
  })

  it("frames the admitted running app directly instead of using the inert document proxy", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components/workspace-shell/workspace-shell.tsx"), "utf8")
    expect(source.includes("credentialless")).toBe(false)
    expect(source.includes("src={space.runningAppUrl}")).toBe(true)
    expect(source.includes("/api/environment/view")).toBe(false)
    expect(source).toContain("allow-scripts allow-forms")
  })
})
