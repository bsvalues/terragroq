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
function proposal(
  proposalId: string,
  turnId: string,
  status: "READY_FOR_REVIEW" | "APPLIED" | "REJECTED" = "READY_FOR_REVIEW",
  options: Readonly<{ reviewPatch?: string | null }> = {},
) {
  const requestText = `Change requested for ${turnId}`
  const reviewedPatch = "diff --git a/src/app.js b/src/app.js\n+reset();\n"
  const reviewPatch = options.reviewPatch === undefined ? reviewedPatch : options.reviewPatch
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
    const onApplied = vi.fn().mockResolvedValue({ outcome: "activated" })
    render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} onApplied={onApplied} />)

    expect(await screen.findByText("turn-one")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Applied")).toBeTruthy()
    expect(screen.getByText("turn-one")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Review next proposal" })).toBeTruthy()
    expect(listReads).toBe(1)
    expect(onApplied).toHaveBeenCalledWith("d".repeat(40))
    expect(screen.getByText("Proposal applied. Running application rebuilt from the applied commit.")).toBeTruthy()
  })

  it("retains Apply success and tells the owner to Start when the runtime was not running", async () => {
    const ready = proposal(firstId, "turn-one")
    const applied = proposal(firstId, "turn-one", "APPLIED")
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (url === project.application.proposalsUrl && !init?.method) return Response.json({ proposals: [ready] })
      if (url === `${project.application.proposalsUrl}/${firstId}/apply` && init?.method === "POST") return Response.json({ proposal: applied })
      return Response.json({ error: "UNEXPECTED_TEST_REQUEST" }, { status: 500 })
    })
    const onApplied = vi.fn().mockResolvedValue({ outcome: "start-required" })
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} onApplied={onApplied} />)

    expect(await screen.findByText("turn-one")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Proposal applied. Start application to build and open the applied commit.")).toBeTruthy()
    expect(screen.getByText("Applied")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Review next proposal" })).toBeTruthy()
  })

  it("retains the APPLIED receipt and reports a separate actionable rebuild failure", async () => {
    const ready = proposal(firstId, "turn-one")
    const applied = proposal(firstId, "turn-one", "APPLIED")
    let applyCalls = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (url === project.application.proposalsUrl && !init?.method) return Response.json({ proposals: [ready] })
      if (url === `${project.application.proposalsUrl}/${firstId}/apply` && init?.method === "POST") {
        applyCalls += 1
        return Response.json({ proposal: applied })
      }
      return Response.json({ error: "UNEXPECTED_TEST_REQUEST" }, { status: 500 })
    })
    const onApplied = vi.fn().mockResolvedValue({
      outcome: "failed",
      message: "The source change is applied, but the contained runtime could not be rebuilt. Use Start application to retry.",
    })
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} onApplied={onApplied} />)

    expect(await screen.findByText("turn-one")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Applied")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("source change is applied")
    expect(screen.getByRole("button", { name: "Review next proposal" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    expect(applyCalls).toBe(1)
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

  it("accepts an applied retained-patch receipt when an uncertain action reconciles by GET", async () => {
    const ready = proposal(firstId, "turn-one")
    const applied = proposal(firstId, "turn-one", "APPLIED")
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (url === project.application.proposalsUrl && !init?.method) return Response.json({ proposals: [ready] })
      if (url === `${project.application.proposalsUrl}/${firstId}/apply` && init?.method === "POST") {
        return Response.json({ error: "APPLICATION_PROPOSAL_UNAVAILABLE" }, { status: 503 })
      }
      if (url === `${project.application.proposalsUrl}/${firstId}` && !init?.method) return Response.json({ proposal: applied })
      return Response.json({ error: "UNEXPECTED_TEST_REQUEST" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} />)

    expect(await screen.findByText("turn-one")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Applied")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Review next proposal" })).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith(`${project.application.proposalsUrl}/${firstId}`, { cache: "no-store" })
  })

  it("accepts a rejected retained-patch receipt when an uncertain action reconciles by GET", async () => {
    const ready = proposal(firstId, "turn-one")
    const rejected = proposal(firstId, "turn-one", "REJECTED")
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (url === project.application.proposalsUrl && !init?.method) return Response.json({ proposals: [ready] })
      if (url === `${project.application.proposalsUrl}/${firstId}` && init?.method === "PATCH") {
        return Response.json({ error: "APPLICATION_PROPOSAL_UNAVAILABLE" }, { status: 503 })
      }
      if (url === `${project.application.proposalsUrl}/${firstId}` && !init?.method) return Response.json({ proposal: rejected })
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
    expect(screen.getByRole("button", { name: "Review next proposal" })).toBeTruthy()
  })

  it.each(["APPLIED", "REJECTED"] as const)(
    "loads a saved %s retained-patch terminal receipt",
    async (terminalStatus) => {
      const terminal = proposal(firstId, `turn-${terminalStatus.toLowerCase()}`, terminalStatus)
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
        if (url === project.application.executionRoutesUrl) return Response.json({
          schemaVersion: 1,
          defaultRoute: "hermes-local",
          routes: [{ id: "hermes-local", label: "Local HERMES", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
        })
        if (url === project.application.proposalsUrl) return Response.json({ proposals: [terminal] })
        return Response.json({ error: "UNEXPECTED_TEST_REQUEST" }, { status: 500 })
      })
      vi.stubGlobal("fetch", fetcher)
      render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} />)

      expect(await screen.findByText(terminalStatus === "APPLIED" ? "Applied" : "Rejected / discarded")).toBeTruthy()
      expect(screen.getByLabelText("Proposed patch").textContent).toContain("reset();")
      expect(screen.getByRole("button", { name: "Review next proposal" })).toBeTruthy()
    },
  )

  it.each(["APPLIED", "REJECTED"] as const)(
    "accepts a degraded saved %s terminal receipt whose patch is unavailable",
    async (terminalStatus) => {
      const terminal = proposal(firstId, `turn-${terminalStatus.toLowerCase()}`, terminalStatus, { reviewPatch: null })
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
        if (url === project.application.executionRoutesUrl) return Response.json({
          schemaVersion: 1,
          defaultRoute: "hermes-local",
          routes: [{ id: "hermes-local", label: "Local HERMES", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
        })
        if (url === project.application.proposalsUrl) return Response.json({ proposals: [terminal] })
        return Response.json({ error: "UNEXPECTED_TEST_REQUEST" }, { status: 500 })
      })
      vi.stubGlobal("fetch", fetcher)
      render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} />)

      expect(await screen.findByText(terminalStatus === "APPLIED" ? "Applied" : "Rejected / discarded")).toBeTruthy()
      expect(screen.getByText("Patch unavailable in this retained receipt.")).toBeTruthy()
    },
  )

  it("rejects a retained terminal patch whose bytes do not match its receipt digest", async () => {
    const terminal = proposal(firstId, "turn-applied", "APPLIED", {
      reviewPatch: "diff --git a/src/app.js b/src/app.js\n+tampered();\n",
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (url === project.application.proposalsUrl) return Response.json({ proposals: [terminal] })
      return Response.json({ error: "UNEXPECTED_TEST_REQUEST" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} />)

    expect(await screen.findByText("The Focus Board development instrument is unavailable.")).toBeTruthy()
    expect(screen.queryByText("Applied")).toBeNull()
    expect(screen.queryByText(/tampered/)).toBeNull()
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

  it.each([
    ["EXTERNAL_API_AUTH_FAILURE", /authenticate the Cerebras request/i],
    ["EXTERNAL_API_COST_EVIDENCE_MISSING", /cost evidence was incomplete/i],
    ["EXTERNAL_API_INCOMPLETE_RESPONSE", /incomplete response/i],
    ["EXTERNAL_API_INSUFFICIENT_CREDIT", /insufficient credit/i],
    ["EXTERNAL_API_KEY_MISSING", /Cerebras credentials are unavailable/i],
    ["EXTERNAL_API_MALFORMED_RESPONSE", /response could not be verified/i],
    ["EXTERNAL_API_OUTAGE", /Cerebras is temporarily unavailable/i],
    ["EXTERNAL_API_RATE_LIMIT", /rate limit/i],
    ["EXTERNAL_API_TIMEOUT", /timed out/i],
    ["EXTERNAL_API_UNSUPPORTED_CAPABILITY", /does not support the required application change capability/i],
  ] as const)("maps admitted provider terminal %s to safe actionable copy", async (errorCode, expectedCopy) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [
          { id: "hermes-local", label: "Local HERMES — williamos-qwen3-4b:64k (default)", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true },
          { id: "cerebras-gpt-oss-120b", label: "Cerebras — gpt-oss-120b (external, metered)", provider: "cerebras", model: "gpt-oss-120b", external: true, metered: true, available: true },
        ],
      })
      if (url === project.application.proposalsUrl && !init?.method) return Response.json({ proposals: [] })
      if (url === project.application.proposalsUrl && init?.method === "POST") {
        return new Response(`${JSON.stringify({ type: "error", error: errorCode })}\n`, {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        })
      }
      return Response.json({ error: "UNEXPECTED" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} />)

    const route = await screen.findByRole("combobox", { name: "AI execution route" })
    await waitFor(() => expect((route as HTMLSelectElement).options).toHaveLength(2))
    fireEvent.change(route, { target: { value: "cerebras-gpt-oss-120b" } })
    fireEvent.change(screen.getByRole("textbox", { name: "Ask HERMES to change Focus Board" }), {
      target: { value: "Add a safe visible marker" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this request contains only public or sanitized content/i }))
    fireEvent.click(screen.getByRole("button", { name: "Ask HERMES via Cerebras" }))

    expect(await screen.findByText(expectedCopy)).toBeTruthy()
    expect(screen.queryByText(errorCode)).toBeNull()
  })

  it("rejects an arbitrary stream terminal error without rendering it verbatim", async () => {
    const arbitrary = "internal provider detail with customer-secret-value"
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === project.application.manifestUrl) return Response.json({ manifest, manifestDigest: "a".repeat(64), head: "c".repeat(40) })
      if (url === project.application.executionRoutesUrl) return Response.json({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [{ id: "hermes-local", label: "Local HERMES", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true }],
      })
      if (url === project.application.proposalsUrl && !init?.method) return Response.json({ proposals: [] })
      if (url === project.application.proposalsUrl && init?.method === "POST") {
        return new Response(`${JSON.stringify({ type: "error", error: arbitrary })}\n`, {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        })
      }
      return Response.json({ error: "UNEXPECTED" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationAssistant project={project} onPreviewRefresh={vi.fn()} />)

    const request = await screen.findByRole("textbox", { name: "Ask HERMES to change Focus Board" })
    fireEvent.change(request, { target: { value: "Add a safe visible marker" } })
    fireEvent.click(screen.getByRole("button", { name: "Ask HERMES" }))

    expect(await screen.findByText("The HERMES response contained an invalid terminal record.")).toBeTruthy()
    expect(screen.queryByText(arbitrary)).toBeNull()
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
