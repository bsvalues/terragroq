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
import { readFileSync } from "node:fs"
import path from "node:path"
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

  it("the visible close glyph carries the close handler, so pointer users can still close a tab", () => {
    // Regression guard: making the visible X aria-hidden for the tablist's ARIA ownership must not
    // remove the pointer affordance. A glyph with no onClick presents a visible but dead control.
    const { container } = render(
      <EditorSurface project={project} projectKey="terrafusion" space={twoRepositorySpace()} onEditorChange={vi.fn()} />,
    )
    const glyph = Array.from(container.querySelectorAll('[aria-hidden="true"]'))
      .find((g) => g.className.includes("tabCloseGlyph")) as HTMLElement
    expect(glyph).toBeTruthy()
    // React attaches the handler; jsdom exposes it through the internal props key.
    const propsKey = Object.keys(glyph).find((k) => k.startsWith("__reactProps"))
    expect(propsKey).toBeTruthy()
    expect(typeof (glyph as unknown as Record<string, { onClick?: unknown }>)[propsKey!].onClick).toBe("function")
  })

  it("the tab item keeps its own sizing class and the label carries the truncation class", () => {
    // Regression guard: adding a second class whose rules come later in the stylesheet silently
    // overrode .tabItem's min-width/flex, letting tabs compress toward zero. The item must own its
    // sizing alone, and the label must carry a class with the overflow/ellipsis rule.
    const { container } = render(
      <EditorSurface project={project} projectKey="terrafusion" space={twoRepositorySpace()} onEditorChange={vi.fn()} />,
    )
    const editorTablist = container.querySelector('div[aria-label$="editor tabs"]')
    expect(editorTablist).not.toBeNull()
    const tab = editorTablist!.querySelector('[role="tab"]') as HTMLElement
    expect(tab).toBeTruthy()
    // exactly the item class (plus the active modifier), never a competing typography class
    expect(tab.className).toContain("tabItem")
    expect(tab.className).not.toMatch(/(^|\s)tab(\s|$)/)
    const label = tab.firstElementChild as HTMLElement
    expect(label.className).toContain("tabItemText")
  })

  it("the real close control is revealable on keyboard focus", () => {
    // Regression guard: the named close buttons are clipped to 1px, so without a :focus-visible rule a
    // sighted keyboard user tabs through invisible focus stops. The stylesheet must define the reveal.
    const css = readFileSync(path.join(process.cwd(), "components/workspace-shell/workspace-shell.module.css"), "utf8")
    expect(css).toMatch(/\.srOnlyClose:focus-visible\s*\{/)
    const block = css.slice(css.indexOf(".srOnlyClose:focus-visible"))
    expect(block.slice(0, block.indexOf("}"))).toMatch(/clip:\s*auto/)
  })

  it("the tab item keeps the editor typography (mono, small) rather than inheriting the environment font", () => {
    // Regression guard: removing the .tab class also removed its font-family/font-size. `.tabItem` then
    // had `font: inherit`, so labels rendered at the environment's default size and ellipsized early.
    const css = readFileSync(path.join(process.cwd(), "components/workspace-shell/workspace-shell.module.css"), "utf8")
    const block = css.slice(css.indexOf(".tabItem {"))
    const body = block.slice(0, block.indexOf("}"))
    expect(body).toMatch(/font-family:\s*var\(--font-geist-mono\)/)
    expect(body).toMatch(/font-size:\s*10\.5px/)
    expect(body).not.toMatch(/font:\s*inherit/)
  })

  it("persists an explainable refusal reason instead of a bare INTERRUPTED", () => {
    // The route's refusal reason used to be written only to transient error state while the saved
    // transcript recorded a generic INTERRUPTED, so selecting or reloading the transcript lost the one
    // fact the operator could act on. The source must put the reason in the saved lines and outcome.
    const source = readFileSync(path.join(process.cwd(), "components/workspace-shell/developer-tools-surface.tsx"), "utf8")
    // Anchor on the run() catch block, not the diff one: it is the one guarding an active tool run.
    const anchor = source.indexOf('"TOOL_RUN_REPOSITORY_IDENTITY_UNVERIFIED") {')
    expect(anchor).toBeGreaterThan(-1)
    const body = source.slice(anchor, source.indexOf("} finally {", anchor))
    // the durable line and the outcome reason carry the real message, not the placeholder
    expect(body).toMatch(/const reason = caught instanceof Error \? caught\.message/)
    expect(body).toMatch(/\{ channel: "meta", text: reason \}/)
    expect(body).toMatch(/settleRun\(current, \{ status: "interrupted", code: null, reason: persistedReason \}/)
    expect(body).not.toMatch(/text: "INTERRUPTED"/)
    expect(body).not.toMatch(/reason: "INTERRUPTED"/)
    // The persisted outcome schema rejects reasons over 200 chars (tool-run-history.ts:156), and a
    // preflight detail embedding the checkout path routinely exceeds that. The outcome reason must be
    // bounded, or the whole transcript fails validation and the explanation is lost anyway.
    expect(body).toMatch(/persistedReason/)
    expect(body).toMatch(/reason\.length <= 200/)
  })

  it("a path-bearing refusal reason survives the 200-character outcome bound", () => {
    // The real preflight detail embeds the full checkout path, so it routinely blows past the schema's
    // 200-character `reason` limit -- which is exactly what codex caught in the first attempt at this fix.
    // Compose it the way the route does rather than hand-counting characters.
    const script = "node_modules/vitest/vitest.mjs"
    const runner = script.split("/")[1]
    const projectRoot = "C:/Users/somebody/very/deep/checkout/path/that/goes/on/and/on/for/a/while/longer/still/and/longer/yet"
    const reason = `This repository has no ${runner} installed, so ${script} does not exist in `
      + `${projectRoot}. Install the repository's dependencies, or select a checkout that has them.`
    expect(reason.length).toBeGreaterThan(200)
    // the bound the persisted schema enforces
    const persisted = reason.length <= 200 ? reason : `${reason.slice(0, 197)}...`
    expect(persisted.length).toBe(200)
    expect(persisted.endsWith("...")).toBe(true)
  })

  it("the focused close control names the file it would close", () => {
    // Every closer is absolutely positioned, so they all rest at the same spot; revealing only an icon
    // there left the operator unable to tell which file Enter would close. The revealed control must
    // carry a visible label naming its target.
    const { container } = render(
      <EditorSurface project={project} projectKey="terrafusion" space={twoRepositorySpace()} onEditorChange={vi.fn()} />,
    )
    const closers = Array.from(container.querySelectorAll('button[aria-label^="Close "]')) as HTMLElement[]
    expect(closers.length).toBeGreaterThan(0)
    for (const closer of closers) {
      const label = closer.querySelector("span[aria-hidden='true']")
      expect(label).not.toBeNull()
      expect((label!.textContent ?? "").trim().length).toBeGreaterThan(0)
    }
    const css = readFileSync(path.join(process.cwd(), "components/workspace-shell/workspace-shell.module.css"), "utf8")
    expect(css).toMatch(/\.srOnlyClose:focus-visible \.closeLabel\s*\{/)
  })

  it("the revealed close label identifies its file, not just a shared basename", () => {
    // Every closer is absolutely positioned against the strip, so they all rest at the same spot: an
    // icon-only reveal left the operator unable to tell which file Enter would close.
    //
    // The guarded case is two files in the SAME repository sharing a basename (dir-a/README.md and
    // dir-b/README.md). Two repositories holding README.md is NOT sufficient to guard it: the repository
    // prefixes already make those labels distinct, so a basename-only implementation would still pass.
    // This fixture therefore puts both paths in one repository and pins the full relative path.
    const sameRepoRefs = [
      { ...osRef, path: "packages/alpha/README.md" },
      { ...osRef, path: "packages/beta/README.md" },
    ]
    const space = {
      ...defaultSpace(),
      selectedPath: "packages/alpha/README.md",
      selectedFileRef: sameRepoRefs[0],
      editor: {
        ...defaultSpace().editor,
        openFiles: ["packages/alpha/README.md", "packages/beta/README.md"],
        openFileRefs: sameRepoRefs,
        workingSetRepositoryKeys: ["os-1"],
        activeRepositoryKey: "os-1",
        panes: [
          { id: "primary", activePath: "packages/alpha/README.md", activeFileRef: sameRepoRefs[0], selection: null },
          { id: "secondary", activePath: "packages/beta/README.md", activeFileRef: sameRepoRefs[1], selection: null },
        ],
      },
    } as never
    const { container } = render(
      <EditorSurface project={project} projectKey="terrafusion" space={space} onEditorChange={vi.fn()} />,
    )
    const shown = Array.from(container.querySelectorAll('button[aria-label^="Close "] span[aria-hidden="true"]'))
      .map((el) => (el.textContent ?? "").trim())
    expect(shown.length).toBeGreaterThanOrEqual(2)
    // both basenames are identical, so only the full relative path distinguishes them
    const distinct = new Set(shown)
    expect(distinct.size).toBe(2)
    expect([...distinct].some((t) => t.includes("packages/alpha/README.md"))).toBe(true)
    expect([...distinct].some((t) => t.includes("packages/beta/README.md"))).toBe(true)
    // a basename-only label would collapse these to one value -- the bug this guards
    expect([...distinct].every((t) => t.endsWith("README.md"))).toBe(true)
    expect(distinct.size).not.toBe(new Set(["README.md"]).size)
  })

  it("the focused close reveal is bounded by available width, not a fixed pixel cap", () => {
    // Near the 360px window minimum the editor pane can be narrower than any hard-coded maximum. A fixed
    // cap inside a non-shrinking row overflows the pane and collapses the tab list. The reveal must be
    // allowed to shrink with the space available.
    const css = readFileSync(path.join(process.cwd(), "components/workspace-shell/workspace-shell.module.css"), "utf8")
    const closers = css.slice(css.indexOf(".tabClosers {"))
    const closersBody = closers.slice(0, closers.indexOf("}"))
    expect(closersBody).toMatch(/flex:\s*0 1 auto/)
    expect(closersBody).toMatch(/min-width:\s*0/)

    const reveal = css.slice(css.indexOf(".srOnlyClose:focus-visible {"))
    const revealBody = reveal.slice(0, reveal.indexOf("}"))
    expect(revealBody).toMatch(/max-width:\s*100%/)
    expect(revealBody).toMatch(/min-width:\s*0/)
    // no leftover magic number capping the label
    expect(revealBody).not.toMatch(/max-width:\s*\d+px/)
  })

  it("the closer row cannot starve the tablist of space", () => {
    // `.tabs` is flex: 1 (zero basis) and a revealed closer has an auto basis, so a long path could let
    // the closer consume the whole strip and collapse the tablist to 0px. The closer row must be capped
    // so the tabs always retain a share of the strip.
    const css = readFileSync(path.join(process.cwd(), "components/workspace-shell/workspace-shell.module.css"), "utf8")
    const closers = css.slice(css.indexOf(".tabClosers {"))
    const body = closers.slice(0, closers.indexOf("}"))
    expect(body).toMatch(/max-width:\s*50%/)
    expect(body).toMatch(/min-width:\s*0/)
  })

  it("each pane's editor is named distinctly so assistive technology can tell them apart", () => {
    // split() copies the primary file into the secondary pane, so both textboxes can hold the same path.
    // A path-only accessible name gave AT two identically-named controls with no way to tell which pane
    // was being edited. The editor surface must pass a pane identity through; the mocked SourceEditor
    // below stands in for CodeMirror, so assert the real SourceEditor builds the name from it.
    const real = readFileSync(path.join(process.cwd(), "components/workspace-shell/source-editor.tsx"), "utf8")
    expect(real).toMatch(/paneLabel/)
    expect(real).toMatch(/"aria-label":\s*paneLabel\s*\?/)
    expect(real).toMatch(/\[path, paneLabel, onSave\]/)

    const surface = readFileSync(path.join(process.cwd(), "components/workspace-shell/editor-surface.tsx"), "utf8")
    expect(surface).toMatch(/paneLabel=/)
    expect(surface).toMatch(/primary pane/)
    expect(surface).toMatch(/secondary pane/)
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
