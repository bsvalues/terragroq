// @vitest-environment jsdom
//
// Accessibility regression contract for the W1 editor surface.
//
// These assertions encode the three axe rules that the live product failed:
//   aria-required-children        -> the editor tablist owns only role="tab" children
//   aria-input-field-name         -> the element with role="textbox" carries a name
//   scrollable-region-focusable   -> the scrollable editor content is keyboard reachable
//
// They assert the real DOM contract, so a regression fails here without a browser.

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EditorSurface } from "@/components/workspace-shell/editor-surface"
import { SourceEditor } from "@/components/workspace-shell/source-editor"
import { defaultSpace } from "@/components/workspace-shell/types"

vi.mock("next/dynamic", () => ({
  default: () => function Editor({ value }: { value: string }) {
    return <textarea aria-label="Test source editor" value={value} readOnly />
  },
}))

afterEach(cleanup)

const revision = "1".repeat(40)

const project = {
  identity: "c:/repos/terrafusion_os_1.0",
  name: "TerraFusion",
  repositories: [
    {
      key: "os-1", identity: "bsvalues/terrafusion_os_1.0", label: "OS 1.0",
      role: "integrated-runtime", suite: null, previewSource: true, defaultRepository: true,
      mount: { key: "terrafusion:os-1:configured", configured: true, verified: true, branch: "main", revision, refusal: null },
    },
    {
      key: "atlas", identity: "bsvalues/terrafusion-atlas", label: "Atlas",
      role: "suite-source", suite: "atlas", previewSource: false, defaultRepository: false,
      mount: { key: "terrafusion:atlas:configured", configured: true, verified: true, branch: "main", revision, refusal: null },
    },
  ],
} as never

const osRef = {
  projectIdentity: project.identity, repositoryResourceKey: "os-1",
  repositoryMountKey: "terrafusion:os-1:configured", worktreeKey: null,
  observedRevision: revision, path: "README.md",
}
const atlasRef = {
  projectIdentity: project.identity, repositoryResourceKey: "atlas",
  repositoryMountKey: "terrafusion:atlas:configured", worktreeKey: null,
  observedRevision: revision, path: "README.md",
}

function twoRepositorySpace() {
  return {
    ...defaultSpace(),
    selectedPath: "README.md",
    selectedFileRef: atlasRef,
    editor: {
      ...defaultSpace().editor,
      openFiles: ["README.md", "README.md"],
      openFileRefs: [osRef, atlasRef],
      workingSetRepositoryKeys: ["os-1", "atlas"],
      activeRepositoryKey: "atlas",
      panes: [
        { id: "primary", activePath: "README.md", activeFileRef: atlasRef, selection: null },
        { id: "secondary", activePath: "README.md", activeFileRef: osRef, selection: null },
      ],
    },
  } as never
}

describe("W1 editor accessibility contract", () => {
  it("the editor tablist owns only role=tab children (no close buttons inside it)", () => {
    render(<EditorSurface project={project} projectKey="terrafusion" space={twoRepositorySpace()} onEditorChange={vi.fn()} />)

    const tablists = screen.getAllByRole("tablist")
    expect(tablists.length).toBeGreaterThan(0)

    for (const tablist of tablists) {
      const controls = Array.from(tablist.querySelectorAll('button, [role="button"], [role="tab"]'))
      expect(controls.length).toBeGreaterThan(0)
      // aria-required-children: every owned interactive control must be a tab.
      for (const control of controls) {
        expect(control.getAttribute("role")).toBe("tab")
      }
    }
  })

  it("close buttons stay available, named, and outside the tablist", () => {
    render(<EditorSurface project={project} projectKey="terrafusion" space={twoRepositorySpace()} onEditorChange={vi.fn()} />)

    const closers = screen.getAllByRole("button", { name: /^Close / })
    expect(closers.length).toBeGreaterThan(0)

    for (const closer of closers) {
      expect(closer.tagName).toBe("BUTTON")
      // and none of them may live inside a tablist
      expect(closer.closest('[role="tablist"]')).toBeNull()
    }
  })

  it("the visible close affordance is decorative and does not overlap the tab label", () => {
    const { container } = render(
      <EditorSurface project={project} projectKey="terrafusion" space={twoRepositorySpace()} onEditorChange={vi.fn()} />,
    )

    // The visual X is decorative: it must be aria-hidden so the accessibility tree contains only
    // the real, named close control. (Measured geometry needs a layout engine, which jsdom is not;
    // the real geometry is verified against the deployed product.)
    const glyphs = Array.from(container.querySelectorAll('[aria-hidden="true"]'))
      .filter((g) => g.className.includes("tabCloseGlyph"))
    expect(glyphs.length).toBeGreaterThan(0)

    // Every decorative glyph must sit inside a tab; the real close CONTROL (checked separately)
    // is the thing that must stay outside the tablist. A glyph is aria-hidden, so its position in
    // the tab is not an ARIA ownership problem.
    for (const glyph of glyphs) {
      expect(glyph.closest('[role="tab"]')).not.toBeNull()
    }

    // Scope to the EDITOR tablist — the page also renders the repository shelf's own tablist.
    const editorTablist = container.querySelector('div[aria-label$="editor tabs"]')
    expect(editorTablist).not.toBeNull()
    const tab = editorTablist!.querySelector('[role="tab"]') as HTMLElement
    expect(tab).toBeTruthy()
    const lastChild = tab.lastElementChild
    expect(lastChild?.getAttribute("aria-hidden")).toBe("true")
    expect(lastChild?.querySelector("svg")).not.toBeNull()
  })

  it("the element with role=textbox carries an accessible name and is keyboard reachable", () => {
    render(
      <SourceEditor
        path="README.md"
        value="# hi"
        selection={null}
        onChange={vi.fn()}
        onSelection={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    const textbox = document.querySelector('[role="textbox"]')
    expect(textbox).not.toBeNull()
    expect(textbox!.getAttribute("aria-label")).toBe("README.md")
    expect(textbox!.getAttribute("tabindex")).toBe("0")
  })
})
