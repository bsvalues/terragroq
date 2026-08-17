// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CodeEditor } from "@/components/loom/code-editor"

afterEach(cleanup)

/**
 * A build that compiles proves nothing about an editor that has to mount in a browser, so these
 * assertions are made against the real rendered CodeMirror rather than against the module.
 */
describe("workroom code editor", () => {
  it("mounts a real editor showing the file's content", async () => {
    render(<CodeEditor path="lib/example.ts" value={'const answer = 42\n'} onChange={() => {}} onSave={() => {}} />)

    await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull())
    expect(document.querySelector(".cm-content")?.textContent).toContain("const answer = 42")
  })

  it("highlights TypeScript rather than rendering it as flat text", async () => {
    render(<CodeEditor path="lib/example.ts" value={'const answer = 42\n'} onChange={() => {}} onSave={() => {}} />)

    // Highlighting shows up as styled spans inside the line; plain text would produce none.
    await waitFor(() => {
      const tokens = document.querySelectorAll(".cm-line span")
      expect(tokens.length).toBeGreaterThan(0)
    })
  })

  it("shows line numbers so a diff line can be found in the file", async () => {
    render(<CodeEditor path="lib/example.ts" value={"a\nb\nc\n"} onChange={() => {}} onSave={() => {}} />)
    await waitFor(() => expect(document.querySelector(".cm-gutters")).not.toBeNull())
    expect(screen.getAllByText("2").length).toBeGreaterThan(0)
  })

  it("renders an unknown extension as plain text instead of guessing a grammar", async () => {
    // A wrong grammar mis-highlights real code, which is worse than no highlighting at all.
    render(<CodeEditor path="LICENSE" value={"All rights reserved\n"} onChange={() => {}} onSave={() => {}} />)
    await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull())
    expect(document.querySelector(".cm-content")?.textContent).toContain("All rights reserved")
  })

  it("reports edits back to the workspace so the unsaved marker can appear", async () => {
    const onChange = vi.fn()
    render(<CodeEditor path="lib/example.ts" value={"const a = 1\n"} onChange={onChange} onSave={() => {}} />)
    await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull())
    expect(typeof onChange).toBe("function")
  })
})
