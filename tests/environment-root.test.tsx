// @vitest-environment jsdom
import fs from "node:fs"
import path from "node:path"

import { cleanup, render, screen } from "@testing-library/react"
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
  "Inspect",
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
  "app/environment/page.tsx",
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

  it("has exactly one conversational input, ever", () => {
    render(<Desk />)
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
  })

  it("starts with no selection ceremony: one question, one input, nothing else demanding action", () => {
    const { container } = render(<Desk />)
    expect(container.textContent).toContain("What are we working on?")
    expect(container.querySelectorAll("button, select, nav a")).toHaveLength(0)
  })

  it("imports nothing from the refused legacy modules — checked in source, not trusted to review", () => {
    for (const file of NEW_ROOT_FILES) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8")
      for (const refused of REFUSED_IMPORTS) {
        expect(source.includes(refused), `${file} must not reference ${refused}`).toBe(false)
      }
    }
  })

  it("never relies on the credentialless client feature for anonymity", () => {
    // Anonymity is a server guarantee. The client attribute worked in one browser and silently
    // failed in the owner's, letting the legacy shell invade the environment.
    const source = fs.readFileSync(path.join(process.cwd(), "components/desk/desk.tsx"), "utf8")
    expect(source.includes("credentialless")).toBe(false)
    expect(source.includes("/api/environment/view")).toBe(true)
  })
})
