// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE, type WilliamJudgment } from "@/lib/environment/working-world"

vi.mock("next/dynamic", () => ({
  default: () => function TestSourceEditor(props: { value: string }) {
    return <textarea aria-label="Source content" value={props.value} readOnly />
  },
}))

const firstJudgment: WilliamJudgment = {
  recommendation: "Keep the save path revision-bound.",
  rationale: "The selected file has concurrent writers, so the exact saved revision is the safe editing basis.",
  basis: [
    { key: "selected-path", label: "Selected path", value: "src/workspace-shell.tsx" },
    { key: "preview", label: "Developer preview", value: "Attached and frameable" },
  ],
  confidence: 0.84,
  generatedAt: "2026-08-30T07:00:00.000Z",
  basisFingerprint: "a".repeat(64),
  provenance: { provider: "williamos-inference", model: "local-grounded-model" },
}

const nextJudgment: WilliamJudgment = {
  recommendation: "Review the exact diff before another change.",
  rationale: "A new persisted patch is now the strongest current signal.",
  basis: [{ key: "diff", label: "Current patch", value: "src/workspace-shell.tsx · modified" }],
  confidence: 0.91,
  generatedAt: "2026-08-30T07:05:00.000Z",
  basisFingerprint: "b".repeat(64),
  provenance: { provider: "williamos-inference", model: "local-grounded-model-v2" },
}

const fnvCollisionFirst: WilliamJudgment = {
  ...firstJudgment,
  rationale: "First collision-bound snapshot.",
  basisFingerprint: "0000000000000000000000000000000000000000000000000000000000019f8a",
}

const fnvCollisionNext: WilliamJudgment = {
  ...firstJudgment,
  rationale: "Second collision-bound snapshot.",
  basisFingerprint: "0000000000000000000000000000000000000000000000000000000000089aa0",
}

function envelope(judgment: unknown = firstJudgment, storage: "server" | "browser" = "server") {
  const space = defaultSpace(1440, 900, "world-a", "TerraFusion")
  return {
    worldId: "world-a",
    space: spaceToServer({ ...space, selectedPath: "src/workspace-shell.tsx" }),
    spine: EMPTY_SPINE,
    judgment,
    project: { identity: "c:/repos/terrafusion", name: "TerraFusion" },
    storage,
    ...(storage === "browser" ? { browserStorageKey: "judgment-inspector-test" } : {}),
  }
}

function workspaceFetch(options: { regenerated?: boolean; regeneratedJudgment?: WilliamJudgment; initial?: unknown; storage?: "server" | "browser" } = {}) {
  let current = Object.prototype.hasOwnProperty.call(options, "initial") ? options.initial : firstJudgment
  const calls: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? "GET"} ${url}`)
    if (url === "/api/environment/space" && !init?.method) return Response.json(envelope(current, options.storage))
    if (url === "/api/environment/space" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
      return Response.json({ ...envelope(current, options.storage), worldId: body.worldId, space: body.space })
    }
    if (url === "/api/environment/judgment" && init?.method === "POST" && options.regenerated) {
      current = options.regeneratedJudgment ?? nextJudgment
      return Response.json({ judgment: current })
    }
    if (url === "/api/loom/files?path=" && !init?.method) return Response.json({ kind: "directory", entries: [] })
    if (url === "/api/loom/files?path=src%2Fworkspace-shell.tsx" && !init?.method) {
      return Response.json({ kind: "file", path: "src/workspace-shell.tsx", content: "export const shell = true\n" })
    }
    if (url === "/api/loom/diff?path=src%2Fworkspace-shell.tsx" && !init?.method) {
      return Response.json({ path: "src/workspace-shell.tsx", state: "clean", fingerprint: "clean", diff: "", status: "", untracked: false })
    }
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
  })
  return { fetcher, calls }
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 })
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 })
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe("William judgment Inspector", () => {
  it("opens, deduplicates, focuses, and closes an exact immutable basis snapshot without inference", async () => {
    const { fetcher, calls } = workspaceFetch()
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await screen.findByText(firstJudgment.recommendation)
    const source = screen.getByRole("region", { name: "Source window" })
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))

    const inspector = await screen.findByRole("region", { name: "Inspector · William judgment window" })
    expect(inspector.textContent).toContain("Snapshot generated then · not current live truth")
    expect(inspector.textContent).toContain(firstJudgment.recommendation)
    expect(inspector.textContent).toContain(firstJudgment.rationale)
    expect(inspector.textContent).toContain("Selected path")
    expect(inspector.textContent).toContain("src/workspace-shell.tsx")
    expect(inspector.textContent).toContain("Developer preview")
    expect(inspector.textContent).toContain("Attached and frameable")
    expect(inspector.textContent).toContain("84%")
    expect(inspector.textContent).toContain(firstJudgment.generatedAt)
    expect(inspector.textContent).toContain("williamos-inference")
    expect(inspector.textContent).toContain("local-grounded-model")
    expect(inspector.textContent).toContain(firstJudgment.basisFingerprint)

    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    expect(screen.getAllByRole("region", { name: "Inspector · William judgment window" })).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Focus Source" }))
    const beforeCloseStyle = source.getAttribute("style")
    const beforeCloseClass = source.getAttribute("class")
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    fireEvent.click(screen.getByRole("button", { name: "Close Inspector · William judgment" }))
    expect(screen.queryByRole("region", { name: "Inspector · William judgment window" })).toBeNull()
    expect(source.getAttribute("style")).toBe(beforeCloseStyle)
    expect(source.getAttribute("class")).toBe(beforeCloseClass)

    expect(calls.filter((call) => /environment\/(?:judgment|line|council)|api\/loom\/(?:agent|codex)/.test(call))).toEqual([])
  })

  it("keeps an open generated snapshot immutable and gives a newly generated judgment its own Inspector", async () => {
    const { fetcher } = workspaceFetch({ regenerated: true })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await screen.findByText(firstJudgment.recommendation)
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    await screen.findByText(firstJudgment.rationale)

    fireEvent.click(screen.getByRole("button", { name: "Think again" }))
    await screen.findByText(nextJudgment.recommendation)
    expect(screen.getByText(firstJudgment.rationale)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    await screen.findByText(nextJudgment.rationale)
    expect(screen.getAllByRole("region", { name: "Inspector · William judgment window" })).toHaveLength(2)
    expect(screen.getByText(firstJudgment.rationale)).toBeTruthy()
    expect(screen.getByText(nextJudgment.rationale)).toBeTruthy()
  })

  it("keeps exact judgments distinct when their legacy 32-bit inspector hashes collide", async () => {
    const { fetcher, calls } = workspaceFetch({
      initial: fnvCollisionFirst,
      regenerated: true,
      regeneratedJudgment: fnvCollisionNext,
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await screen.findByText(fnvCollisionFirst.recommendation)
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    await screen.findByText(fnvCollisionFirst.rationale)
    fireEvent.click(screen.getByRole("button", { name: "Think again" }))
    await waitFor(() => expect(calls).toContain("POST /api/environment/judgment"))
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))

    expect(await screen.findByText(fnvCollisionNext.basisFingerprint)).toBeTruthy()
    expect(screen.getAllByRole("region", { name: "Inspector · William judgment window" })).toHaveLength(2)
    expect(screen.getByText(fnvCollisionFirst.rationale)).toBeTruthy()
    expect(screen.getByText(fnvCollisionNext.rationale)).toBeTruthy()
  })

  it("returns from an exact Inspector refocus to the immediately prior Tests window", async () => {
    const { fetcher } = workspaceFetch()
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await screen.findByText(firstJudgment.recommendation)
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    await screen.findByRole("region", { name: "Inspector · William judgment window" })
    fireEvent.click(screen.getByRole("button", { name: "Focus Tests" }))
    const testsWindow = screen.getByRole("region", { name: "Tests window" })
    const focusedTestsClass = testsWindow.getAttribute("class")
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    fireEvent.click(screen.getByRole("button", { name: "Close Inspector · William judgment" }))

    expect(testsWindow.getAttribute("class")).toBe(focusedTestsClass)
  })

  it("does not reuse an Inspector return target across a Space transition", async () => {
    const alpha = defaultSpace(1440, 900, "world-a", "Alpha")
    const beta = defaultSpace(1440, 900, "world-b", "Beta")
    const spaces = [
      { worldId: "world-a", name: "Alpha", space: spaceToServer(alpha), updatedAt: "2026-08-30T07:00:00.000Z" },
      { worldId: "world-b", name: "Beta", space: spaceToServer(beta), updatedAt: "2026-08-30T07:01:00.000Z" },
    ]
    const spaceEnvelope = (worldId: "world-a" | "world-b") => ({
      worldId,
      name: worldId === "world-a" ? "Alpha" : "Beta",
      space: worldId === "world-a" ? spaces[0].space : spaces[1].space,
      spaces,
      multiSpaceAvailable: true,
      collectionAvailable: true,
      preferenceStorageKey: "judgment-inspector-space-preference",
      project: { identity: "c:/repos/terrafusion", name: "TerraFusion" },
      spine: EMPTY_SPINE,
      judgment: firstJudgment,
      storage: "server" as const,
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope("world-a"))
      if (url === "/api/environment/space?worldId=world-b" && !init?.method) return Response.json(spaceEnvelope("world-b"))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: "world-a" | "world-b"; space: unknown }
        return Response.json({ ...spaceEnvelope(body.worldId), space: body.space })
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await screen.findByText(firstJudgment.recommendation)
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    await screen.findByRole("region", { name: "Inspector · William judgment window" })
    fireEvent.click(screen.getByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(await screen.findByRole("button", { name: "Enter Beta" }))
    await waitFor(() => expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/environment/space?worldId=world-b")).toBe(true))
    await screen.findByRole("button", { name: "Enter Beta, current Space" })
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Focus Tests" }))
    const testsWindow = screen.getByRole("region", { name: "Tests window" })
    const focusedTestsClass = testsWindow.getAttribute("class")
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    fireEvent.click(screen.getByRole("button", { name: "Close Inspector · William judgment" }))

    expect(testsWindow.getAttribute("class")).toBe(focusedTestsClass)
  })

  it("renders the exact stored confidence without rounding loss", async () => {
    const exactConfidence = { ...firstJudgment, confidence: 0.8449 }
    const { fetcher } = workspaceFetch({ initial: exactConfidence })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await screen.findByText(exactConfidence.recommendation)
    fireEvent.click(screen.getByRole("button", { name: "Inspect judgment basis" }))
    const inspector = await screen.findByRole("region", { name: "Inspector · William judgment window" })
    expect(inspector.textContent).toContain("0.8449")
  })

  it.each([null, { ...firstJudgment, basis: [] }, { ...firstJudgment, basisFingerprint: "not-a-fingerprint" }])(
    "does not offer Inspect basis for missing or invalid judgment %#",
    async (invalid) => {
      const { fetcher } = workspaceFetch({ initial: invalid, storage: "browser" })
      vi.stubGlobal("fetch", fetcher)
      render(<WorkspaceShell />)
      await screen.findByRole("complementary", { name: "William conversation" })
      await waitFor(() => expect(screen.queryByRole("button", { name: "Inspect judgment basis" })).toBeNull())
    },
  )
})
