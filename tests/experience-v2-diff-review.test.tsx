// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { diffReviewInspectorId, encodeDiffReviewInspectorPayload, inspectorSurfaceWindowTitle } from "@/components/workspace-shell/inspector-surface"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE, validateSpaceState } from "@/lib/environment/working-world"

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000"
const WORLD_ID = "world-diff-review"
const PATH = "src/app.ts"
const FINGERPRINT = JSON.stringify({
  path: PATH,
  state: "modified",
  status: " M src/app.ts",
  baseHash: "a".repeat(40),
  indexHash: "b".repeat(64),
  patchHash: "c".repeat(64),
})
const BASE_HASH = "a".repeat(40)
const INDEX_HASH = "b".repeat(64)
const PATCH_HASH = "c".repeat(64)
const COMPLETED_AT = "2026-08-30T09:00:00.000Z"
const REVISION = "d".repeat(40)
const REPOSITORY = { key: "os-1", identity: "bsvalues/terrafusion_os_1.0", label: "OS 1.0", role: "integrated-runtime" as const, suite: null, previewSource: true, defaultRepository: true, mount: { key: "terrafusion:os-1:configured", configured: true, verified: true, branch: "main", revision: REVISION, refusal: null } }
const FILE_REF = { projectIdentity: "c:/repos/terrafusion", repositoryResourceKey: "os-1", repositoryMountKey: "terrafusion:os-1:configured", worktreeKey: null, observedRevision: REVISION, path: PATH } as const

const diffReviewBinding = {
  worldId: WORLD_ID,
  path: PATH,
  fingerprint: FINGERPRINT,
  baseHash: BASE_HASH,
  indexHash: INDEX_HASH,
  patchHash: PATCH_HASH,
  completedAt: COMPLETED_AT,
} as const

vi.mock("next/dynamic", () => ({
  default: () => function TestSourceEditor(props: { value: string }) {
    return <textarea aria-label="Source content" value={props.value} readOnly />
  },
}))

function initialSpace() {
  const space = defaultSpace(1440, 900, WORLD_ID, "TerraFusion")
  return {
    ...space,
    activeWindowId: "diff" as const,
    selectedPath: PATH,
    selectedFileRef: FILE_REF,
    editor: {
      openFiles: [PATH],
      openFileRefs: [FILE_REF],
      panes: [{ id: "primary" as const, activePath: PATH, activeFileRef: FILE_REF, selection: { anchor: 0, head: 0 } }],
      activePaneId: "primary" as const,
    },
  }
}

function spaceEnvelope(storage: "server" | "browser" = "server") {
  const space = initialSpace()
  return {
    worldId: WORLD_ID,
    name: "TerraFusion",
    space: spaceToServer(space),
    spaces: [{ worldId: WORLD_ID, name: "TerraFusion", space: spaceToServer(space), updatedAt: COMPLETED_AT }],
    spine: EMPTY_SPINE,
    project: { identity: "c:/repos/terrafusion", name: "TerraFusion", repositories: [REPOSITORY] },
    storage,
    ...(storage === "browser" ? { browserStorageKey: "diff-review-browser" } : {}),
  }
}

function ndjson(...events: readonly Record<string, unknown>[]) {
  return new Response(`${events.map(JSON.stringify).join("\n")}\n`, {
    headers: { "content-type": "application/x-ndjson" },
  })
}

function successfulReview(result = "P1 · The changed authorization check is too late.") {
  return ndjson(
    {
      type: "session",
      sessionId: SESSION_ID,
      provider: "Claude",
      mode: "diff-review",
      resumed: false,
      worldId: WORLD_ID,
      path: PATH,
      fingerprint: FINGERPRINT,
      baseHash: BASE_HASH,
      indexHash: INDEX_HASH,
      patchHash: PATCH_HASH,
      completedAt: COMPLETED_AT,
      repositoryResourceKey: "os-1",
      repositoryIdentity: REPOSITORY.identity,
      repositoryMountKey: REPOSITORY.mount.key,
      observedRevision: REVISION,
    },
    { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: SESSION_ID, result } },
    { type: "done", code: 0, reason: null },
  )
}

function workspaceFetch({
  storage = "server",
  diffState = "modified",
  review = () => successfulReview(),
}: {
  storage?: "server" | "browser"
  diffState?: "modified" | "clean" | "oversize" | "error"
  review?: (init: RequestInit) => Response | Promise<Response>
} = {}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace("&repositoryKey=os-1", "")
    if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json(spaceEnvelope(storage)))
    if (url === "/api/environment/space" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
      return Promise.resolve(Response.json({ ...spaceEnvelope(storage), worldId: body.worldId, space: body.space, updatedAt: COMPLETED_AT }))
    }
    if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
    if (url === `/api/loom/files?path=${encodeURIComponent(PATH)}` && !init?.method) {
      return Promise.resolve(Response.json({ kind: "file", path: PATH, content: "export const app = true\n", repository: { key: "os-1", identity: REPOSITORY.identity, mountKey: REPOSITORY.mount.key, observedRevision: REVISION } }))
    }
    if (url === `/api/loom/diff?path=${encodeURIComponent(PATH)}` && !init?.method) {
      if (diffState === "error") return Promise.resolve(Response.json({ error: "GIT_UNAVAILABLE" }, { status: 503 }))
      if (diffState === "oversize") return Promise.resolve(Response.json({ path: PATH, state: "oversize", fingerprint: FINGERPRINT, diff: "", status: " M src/app.ts", reason: "PATCH_TOO_LARGE" }))
      if (diffState === "clean") return Promise.resolve(Response.json({ path: PATH, state: "clean", fingerprint: FINGERPRINT, diff: "", status: "", untracked: false }))
      return Promise.resolve(Response.json({
        path: PATH,
        state: "modified",
        fingerprint: FINGERPRINT,
        baseHash: BASE_HASH,
        indexHash: INDEX_HASH,
        patchHash: PATCH_HASH,
        diff: "-before\n+after",
        status: " M src/app.ts",
        untracked: false,
      }))
    }
    if (url === "/api/loom/agent" && init?.method === "POST") return Promise.resolve(review(init))
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
  })
}

async function openCurrentChangeReview(_focus = "") {
  const reviewButton = await screen.findByRole("button", { name: "Review" }) as HTMLButtonElement
  await waitFor(() => expect(reviewButton.disabled).toBe(false))
  fireEvent.click(reviewButton)
  expect(screen.getByText(`Review current change · ${PATH}`)).toBeTruthy()
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

describe("Experience V2 current Changes Review", () => {
  it.each([
    ["quote-heavy", '"'.repeat(100_000)],
    ["multibyte", "界".repeat(70_000)],
    ["near-boundary ASCII", "x".repeat(199_500)],
  ])("bounds the fully serialized %s Inspector payload by UTF-8 bytes and keeps it server-valid", (_label, report) => {
    const payload = encodeDiffReviewInspectorPayload(diffReviewBinding, report)
    const repeated = encodeDiffReviewInspectorPayload(diffReviewBinding, report)
    const decoded = JSON.parse(payload) as { report: string }
    const base = spaceToServer(initialSpace())
    const persisted = {
      ...base,
      windows: [...base.windows, {
        id: "inspector-diff-review-boundary",
        kind: "inspector" as const,
        title: `Inspector · Current changes · ${PATH}`,
        frame: { x: 100, y: 100, width: 560, height: 480 },
        z: 100,
        minimized: false,
        surfaceKind: "review",
        surfaceSubject: PATH,
        surfacePayload: payload,
      }],
    }

    expect(new TextEncoder().encode(payload).byteLength).toBeLessThanOrEqual(200_000)
    expect(payload).toBe(repeated)
    expect(decoded.report).toContain("[Report truncated in Inspector; full result remains in the durable Reviewer transcript.]")
    expect(() => validateSpaceState(persisted)).not.toThrow()
    expect(inspectorSurfaceWindowTitle({
      id: "boundary",
      kind: "review",
      subject: PATH,
      payload,
    })).toBe(`Inspector · Current changes · ${PATH}`)
  })

  it("truncates a large astral-emoji report at the maximal complete code-point boundary", () => {
    const emoji = "😀"
    const notice = "\n\n[Report truncated in Inspector; full result remains in the durable Reviewer transcript.]"
    const payload = encodeDiffReviewInspectorPayload(diffReviewBinding, emoji.repeat(60_000))
    const decoded = JSON.parse(payload) as { report: string }
    const prefix = decoded.report.slice(0, -notice.length)
    const oneMoreCodePoint = JSON.stringify({
      schemaVersion: 1,
      kind: "diff-review",
      binding: diffReviewBinding,
      report: `${prefix}${emoji}${notice}`,
    })

    expect(decoded.report.endsWith(notice)).toBe(true)
    expect(new TextEncoder().encode(payload).byteLength).toBeLessThanOrEqual(200_000)
    expect(new TextEncoder().encode(oneMoreCodePoint).byteLength).toBeGreaterThan(200_000)
    expect(prefix).not.toContain("\uFFFD")
    expect(Array.from(prefix).every((codePoint) => codePoint === emoji)).toBe(true)
  })

  it("uses collision-free exact Diff Review Inspector identity and dedupes only exact replay", () => {
    const legacyCollisionFirst = "14b2bb25c5"
    const legacyCollisionNext = "12c1fd6b15uj"

    expect(diffReviewInspectorId({ ...diffReviewBinding, fingerprint: legacyCollisionFirst }))
      .not.toBe(diffReviewInspectorId({ ...diffReviewBinding, fingerprint: legacyCollisionNext }))
    expect(diffReviewInspectorId(diffReviewBinding)).toBe(diffReviewInspectorId({ ...diffReviewBinding }))
    expect(diffReviewInspectorId({ ...diffReviewBinding, worldId: "world-other" }))
      .not.toBe(diffReviewInspectorId(diffReviewBinding))
  })

  it("starts the exact current patch Review in one click without a composer or second Start", async () => {
    const fetcher = workspaceFetch({ review: () => new Response(new ReadableStream({ start() { /* remain pending */ } }), {
      headers: { "content-type": "application/x-ndjson" },
    }) })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    const review = await screen.findByRole("button", { name: "Review" }) as HTMLButtonElement
    await waitFor(() => expect(review.disabled).toBe(false))
    fireEvent.click(review)

    expect(screen.getByText(`Review current change · ${PATH}`)).toBeTruthy()
    expect(screen.getByText("Starting read-only Review…")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Stop review" })).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "Review focus" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull()
    let request: (typeof fetcher.mock.calls)[number] | undefined
    await waitFor(() => {
      request = fetcher.mock.calls.find(([input, options]) => String(input) === "/api/loom/agent" && options?.method === "POST")
      expect(request).toBeTruthy()
    })
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      mode: "diff-review", worldId: WORLD_ID, path: PATH, expectedDiffFingerprint: FINGERPRINT,
      projectKey: "terrafusion",
      fileRef: FILE_REF,
      repositoryKey: "os-1",
      provider: "cloud", sessionId: null, resume: false,
    })
  })

  it("starts a durable exact-diff Reviewer and opens the grounded report in a movable Inspector", async () => {
    const baseFetcher = workspaceFetch()
    let persistedSpace: ReturnType<typeof spaceToServer> | null = null
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method && persistedSpace) {
        return Promise.resolve(Response.json({ ...spaceEnvelope(), space: persistedSpace }))
      }
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { space: ReturnType<typeof spaceToServer> }
        persistedSpace = body.space
      }
      return baseFetcher(input, init)
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await openCurrentChangeReview()

    const inspector = await screen.findByRole("region", { name: `Inspector · Current changes · ${PATH} window` })
    expect(inspector.textContent).toContain("P1 · The changed authorization check is too late.")
    expect(inspector.textContent).toContain(FINGERPRINT)
    expect(inspector.textContent).toContain(BASE_HASH)
    expect(inspector.textContent).toContain(INDEX_HASH)
    expect(inspector.textContent).toContain(PATCH_HASH)
    expect(inspector.textContent).toContain(COMPLETED_AT)
    expect(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review current changes · ${PATH}`) })).toBeTruthy()

    const request = fetcher.mock.calls.find(([input, options]) => String(input) === "/api/loom/agent" && options?.method === "POST")
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      mode: "diff-review",
      worldId: WORLD_ID,
      projectKey: "terrafusion",
      path: PATH,
      fileRef: FILE_REF,
      repositoryKey: "os-1",
      expectedDiffFingerprint: FINGERPRINT,
      provider: "cloud",
      sessionId: null,
      resume: false,
    })
    expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/environment/line")).toBe(false)
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(`williamos:agent-session:${WORLD_ID}:c%3A%2Frepos%2Fterrafusion`) ?? "null") as {
        sessions?: readonly { diffReview?: { fingerprint?: string } }[]
      } | null
      expect(stored?.sessions?.[0]?.diffReview?.fingerprint).toBe(FINGERPRINT)
    })
    await waitFor(() => expect(persistedSpace?.windows.some((window) => (
      window.kind === "inspector" && window.surfaceKind === "review" && window.surfaceSubject === PATH
        && typeof window.surfacePayload === "string" && window.surfacePayload.includes('"kind":"diff-review"')
    ))).toBe(true))

    cleanup()
    render(<WorkspaceShell />)
    const restored = await screen.findByRole("region", { name: `Inspector · Current changes · ${PATH} window` })
    expect(restored.textContent).toContain("P1 · The changed authorization check is too late.")
    expect(restored.textContent).toContain(FINGERPRINT)
  })

  it("resumes the same persisted diff Reviewer for Talk with its exact server-bound patch identity", async () => {
    let turn = 0
    const fetcher = workspaceFetch({ review: () => {
      turn += 1
      return turn === 1 ? successfulReview("Initial exact patch review.") : ndjson(
        {
          type: "session", sessionId: SESSION_ID, provider: "Claude", mode: "diff-review", resumed: true,
          worldId: WORLD_ID, path: PATH, fingerprint: FINGERPRINT, baseHash: BASE_HASH,
          indexHash: INDEX_HASH, patchHash: PATCH_HASH, completedAt: COMPLETED_AT,
          repositoryResourceKey: "os-1", repositoryIdentity: REPOSITORY.identity,
          repositoryMountKey: REPOSITORY.mount.key, observedRevision: REVISION,
        },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: SESSION_ID, result: "Follow-up stayed on the exact patch." } },
        { type: "done", code: 0, reason: null },
      )
    } })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    await openCurrentChangeReview("")
    await waitFor(() => expect(screen.getByRole("region", { name: `Inspector · Current changes · ${PATH} window` }).textContent).toContain("Initial exact patch review."))

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review current changes · ${PATH}`) }))
    fireEvent.click(screen.getByRole("button", { name: "Talk" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Recheck the failure mode." } })
    fireEvent.click(screen.getByRole("button", { name: "Send to Reviewer" }))
    await screen.findByText("Follow-up stayed on the exact patch.")

    const requests = fetcher.mock.calls.filter(([input, options]) => String(input) === "/api/loom/agent" && options?.method === "POST")
    expect(JSON.parse(String(requests[1]?.[1]?.body))).toEqual({
      mode: "diff-review",
      worldId: WORLD_ID,
      projectKey: "terrafusion",
      path: PATH,
      fileRef: FILE_REF,
      repositoryKey: "os-1",
      expectedDiffFingerprint: FINGERPRINT,
      focus: "Recheck the failure mode.",
      provider: "cloud",
      sessionId: SESSION_ID,
      resume: true,
    })
  })

  it.each([
    ["browser-only Space", { storage: "browser" as const, diffState: "modified" as const }, "server-bound"],
    ["clean selected file", { storage: "server" as const, diffState: "clean" as const }, "exact live modified patch"],
    ["oversize patch", { storage: "server" as const, diffState: "oversize" as const }, "exact live modified patch"],
    ["unavailable Git truth", { storage: "server" as const, diffState: "error" as const }, "exact live modified patch"],
  ])("truthfully disables Review for %s", async (_label, options, reason) => {
    vi.stubGlobal("fetch", workspaceFetch(options))
    render(<WorkspaceShell />)

    const review = await screen.findByRole("button", { name: "Review unavailable" }) as HTMLButtonElement
    expect(review.disabled).toBe(true)
    expect(review.title).toMatch(new RegExp(reason, "i"))
    expect(screen.queryByText(`Review current change · ${PATH}`)).toBeNull()
  })

  it("shows typed stale truth and materializes no report or session", async () => {
    const fetcher = workspaceFetch({ review: () => ndjson({ type: "done", code: null, reason: "DIFF_REVIEW_CONTEXT_STALE" }) })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await openCurrentChangeReview("")

    expect(await screen.findByText("The live change changed. Reopen Review from the current Changes surface.")).toBeTruthy()
    expect(screen.queryByRole("region", { name: /Inspector · Current changes/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Reviewer · Claude · Review current changes/ })).toBeNull()
  })

  it("stops the exact pending read-only review without persisting a partial session or report", async () => {
    const fetcher = workspaceFetch({ review: () => new Response(new ReadableStream({ start() { /* pending until reader.cancel */ } }), {
      headers: { "content-type": "application/x-ndjson" },
    }) })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await openCurrentChangeReview("")
    fireEvent.click(await screen.findByRole("button", { name: "Stop review" }))

    expect(await screen.findByText("Stop requested. Review outcome is unknown.")).toBeTruthy()
    expect(screen.queryByRole("region", { name: /Inspector · Current changes/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Reviewer · Claude · Review current changes/ })).toBeNull()
    expect(window.localStorage.getItem(`williamos:agent-session:${WORLD_ID}:c%3A%2Frepos%2Fterrafusion`)).toBeNull()
  })
})
