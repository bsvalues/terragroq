// @vitest-environment jsdom

import { createHash } from "node:crypto"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApplicationAssistant } from "@/components/workspace-shell/hello-application-assistant"
import { applicationWorkspaceProject, type ApplicationVisibleWorkspaceProject } from "@/lib/projects/workspace-project-key"

const project = applicationWorkspaceProject("focus-board", "Focus Board")
const manifest = {
  schemaVersion: 1,
  id: "focus-board",
  displayName: "Focus Board",
  adapter: "static-web-v1",
  source: { document: "src/index.html", styles: "src/styles.css", script: "src/app.js", test: "test/application.test.mjs" },
  ai: { writablePaths: ["src/index.html", "src/styles.css", "src/app.js"] },
}
const progress = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated application workspace ready"],
  ["resident_started", "HERMES AI is editing the isolated application workspace"],
  ["resident_finished", "HERMES AI editing finished"],
  ["validation_started", "Contained application validation started"],
  ["ready_for_review", "Application proposal ready for review"],
].map(([stage, detail], index) => ({ stage, detail, at: `2026-09-21T00:00:0${index}.000Z` }))

const digest = (value: string) => createHash("sha256").update(value).digest("hex")
function proposal(proposalId: string, turnId: string, status: "READY_FOR_REVIEW" | "APPLIED" | "REJECTED" = "READY_FOR_REVIEW") {
  const requestText = `Change requested for ${turnId}`
  const reviewedPatch = "diff --git a/src/app.js b/src/app.js\n+reset();\n"
  const reviewPatch = status === "READY_FOR_REVIEW" ? reviewedPatch : null
  return {
    schemaVersion: 4,
    proposalId,
    applicationId: "focus-board",
    manifestDigest: "a".repeat(64),
    repositoryDigest: "b".repeat(64),
    writablePaths: [...manifest.ai.writablePaths],
    status,
    requestedBy: "owner",
    requestText,
    requestSha256: digest(requestText),
    executionRoute: "hermes-local",
    executionProvider: "hermes-local",
    executionNode: "hermes-node",
    model: "williamos-qwen3-4b:64k",
    threadId: `thread-${turnId}`,
    turnId,
    providerExecution: null,
    progress,
    createdAt: "2026-09-21T00:00:00.000Z",
    baseSha: "c".repeat(40),
    candidateSha: "d".repeat(40),
    baseRef: "refs/heads/main",
    branch: `codex/williamos-app-focus-board-${proposalId}`,
    changedPaths: ["src/app.js"],
    patchSha256: digest(reviewedPatch),
    validation: { status: "passed", command: "node --test test/application.test.mjs", output: "ok" },
    appliedAt: status === "APPLIED" ? "2026-09-21T00:00:06.000Z" : null,
    appliedCommit: status === "APPLIED" ? "d".repeat(40) : null,
    rejectedAt: status === "REJECTED" ? "2026-09-21T00:00:06.000Z" : null,
    rejectionReason: status === "REJECTED" ? "Superseded by the next request." : null,
    applyStartedAt: null,
    applyToken: null,
    applyProcessId: null,
    quarantinedAt: null,
    quarantineReason: null,
    reviewPatch,
  }
}

const firstId = "11111111-1111-4111-8111-111111111111"
const nextId = "22222222-2222-4222-8222-222222222222"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("generic ApplicationAssistant", () => {
  it("keeps an applied terminal receipt visible without silently selecting another proposal", async () => {
    const ready = proposal(firstId, "turn-one")
    const applied = proposal(firstId, "turn-one", "APPLIED")
    let listReads = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES — williamos-qwen3-4b:64k (default)", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (url === project.application.proposalsUrl && !init?.method) {
        listReads += 1
        return Response.json({ proposals: [ready] })
      }
      if (url === `${project.application.proposalsUrl}/${firstId}/apply` && init?.method === "POST") {
        return Response.json({ proposal: applied })
      }
      return Response.json({ error: "UNEXPECTED_TEST_REQUEST" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)
    const onPreviewRefresh = vi.fn()
    render(<ApplicationAssistant project={project} onPreviewRefresh={onPreviewRefresh} />)

    expect(await screen.findByText("turn-one")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Applied")).toBeTruthy()
    expect(screen.getByText("turn-one")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Review next proposal" })).toBeTruthy()
    expect(listReads).toBe(1)
    expect(onPreviewRefresh).toHaveBeenCalledOnce()
  })

  it("keeps a rejected terminal receipt visible until Review next proposal is explicit", async () => {
    const ready = proposal(firstId, "turn-one")
    const rejected = proposal(firstId, "turn-one", "REJECTED")
    const next = proposal(nextId, "turn-two")
    let listReads = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES — williamos-qwen3-4b:64k (default)", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (url === project.application.proposalsUrl && !init?.method) {
        listReads += 1
        return Response.json({ proposals: listReads === 1 ? [ready] : [rejected, next] })
      }
      if (url === `${project.application.proposalsUrl}/${firstId}` && init?.method === "PATCH") {
        return Response.json({ proposal: rejected })
      }
      return Response.json({ error: "UNEXPECTED_TEST_REQUEST" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} />)

    expect(await screen.findByText("turn-one")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }))
    const confirmation = screen.getByRole("group", { name: "Confirm proposal rejection" })
    fireEvent.change(within(confirmation).getByRole("textbox", { name: "Rejection reason" }), {
      target: { value: "Superseded by the next request." },
    })
    fireEvent.click(within(confirmation).getByRole("button", { name: "Confirm rejection" }))

    expect(await screen.findByText("Rejected / discarded")).toBeTruthy()
    expect(screen.getByText("turn-one")).toBeTruthy()
    expect(screen.queryByText("turn-two")).toBeNull()
    expect(listReads).toBe(1)
    fireEvent.click(screen.getByRole("button", { name: "Review next proposal" }))
    expect(await screen.findByText("turn-two")).toBeTruthy()
    expect(listReads).toBe(2)
  })

  it("shows the manifest path boundary and human route/model labels", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES — williamos-qwen3-4b:64k (default)", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (url === project.application.proposalsUrl) return Response.json({ proposals: [] })
      return Response.json({ error: "UNEXPECTED" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} />)

    expect(await screen.findByText(/3 writable files/)).toBeTruthy()
    expect(screen.getByText(/src\/index.html.*src\/styles.css.*src\/app.js/)).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "AI execution route" })).toHaveProperty("value", "hermes-local")
    await waitFor(() => expect(screen.getByText(/williamos-qwen3-4b:64k/)).toBeTruthy())
  })
})

describe("legacy ApplicationAssistant metadata adapter", () => {
  it("uses the resolved legacy API metadata and application labels instead of a literal project ID", async () => {
    const legacyProject: ApplicationVisibleWorkspaceProject = {
      key: "legacy-sample",
      name: "Legacy Sample",
      kind: "application",
      preview: "contained",
      application: {
        contract: "legacy-v1-v3",
        manifestUrl: null,
        runtimeUrl: "/legacy/runtime",
        previewUrl: "/legacy/preview",
        executionRoutesUrl: "/legacy/execution-routes",
        proposalsUrl: "/legacy/proposals",
        rejectMethod: "DELETE",
        writablePaths: ["legacy/index.html", "legacy/styles.css", "legacy/app.js"],
        validationCommand: "node --test legacy/test.mjs",
      },
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === legacyProject.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES — williamos-qwen3-4b:64k (default)", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (String(input) === legacyProject.application.proposalsUrl) return Response.json({ proposals: [] })
      return Response.json({ error: "UNEXPECTED" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)

    render(<ApplicationAssistant project={legacyProject} onPreviewRefresh={vi.fn()} />)

    expect(await screen.findByText("Ready for a development request.")).toBeTruthy()
    expect(screen.getByRole("region", { name: "Ask HERMES to develop Legacy Sample" })).toBeTruthy()
    expect(screen.getByText(/legacy\/index\.html.*legacy\/styles\.css.*legacy\/app\.js/)).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith(legacyProject.application.executionRoutesUrl, { cache: "no-store" })
    expect(fetcher).toHaveBeenCalledWith(legacyProject.application.proposalsUrl, { cache: "no-store" })
  })
})
