// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HelloApplicationControls } from "@/components/workspace-shell/hello-application-controls"

const requestText = "Make the footer explain the local AI loop"
const validationCommand = "node --test examples/hello-application/test/hello.test.mjs"
const progress = [
  { stage: "accepted", detail: "Request accepted", at: "2026-09-19T17:00:00.000Z" },
  { stage: "workspace_ready", detail: "Isolated workspace ready", at: "2026-09-19T17:00:01.000Z" },
  { stage: "resident_started", detail: "HERMES is editing the isolated workspace", at: "2026-09-19T17:00:02.000Z" },
  { stage: "resident_finished", detail: "HERMES editing finished", at: "2026-09-19T17:00:03.000Z" },
  { stage: "validation_started", detail: "Contained validation started", at: "2026-09-19T17:00:04.000Z" },
  { stage: "ready_for_review", detail: "Proposal ready for review", at: "2026-09-19T17:00:05.000Z" },
] as const

const readyProposal = {
  schemaVersion: 2,
  proposalId: "11111111-1111-4111-8111-111111111111",
  status: "READY_FOR_REVIEW",
  requestText,
  executionNode: "hermes-node",
  progress,
  model: "williamos-qwen3-4b:64k",
  threadId: "thread-1",
  turnId: "turn-1",
  patchSha256: "a".repeat(64),
  changedPaths: [
    "examples/hello-application/src/index.html",
    "examples/hello-application/src/styles.css",
  ],
  validation: {
    status: "passed",
    command: validationCommand,
    output: "TAP version 13\n# tests 3\n# pass 3\n# fail 0",
  },
  reviewPatch: "diff --git a/examples/hello-application/src/index.html b/examples/hello-application/src/index.html\n+<footer>The local AI loop</footer>\n",
} as const

const {
  requestText: _malformedRequest,
  executionNode: _malformedNode,
  progress: _malformedProgress,
  ...malformedV2Proposal
} = readyProposal

type ProposalFixture = typeof readyProposal | (Omit<typeof readyProposal, "proposalId" | "requestText" | "turnId"> & {
  proposalId: string
  requestText: string
  turnId: string
})

function streamResponse(records: readonly unknown[], chunkPattern = [1, 2, 5, 3]): Response {
  const bytes = new TextEncoder().encode(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`)
  let offset = 0
  let chunk = 0
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const size = chunkPattern[chunk % chunkPattern.length]
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
      chunk += 1
    },
  }), {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  })
}

function rawStreamResponse(body: string): Response {
  const bytes = new TextEncoder().encode(body)
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const midpoint = Math.max(1, Math.floor(bytes.length / 2))
      controller.enqueue(bytes.slice(0, midpoint))
      controller.enqueue(bytes.slice(midpoint))
      controller.close()
    },
  }), {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  })
}

function baseFetch(options: Readonly<{
  proposals?: readonly unknown[]
  proposalsGet?: Response | Promise<Response>
  proposalPosts?: readonly (Response | Promise<Response>)[]
  applyResponse?: Response
  runtimeMutationError?: string
}> = {}) {
  let proposalPostIndex = 0
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url.endsWith("/runtime") && method === "GET") {
      return Promise.resolve(Response.json({ runtime: { state: "stopped", pid: null, url: null } }))
    }
    if (url.endsWith("/proposals") && method === "GET") {
      if (options.proposalsGet) return Promise.resolve(options.proposalsGet)
      return Promise.resolve(Response.json({ proposals: options.proposals ?? [] }))
    }
    if (url.endsWith("/runtime") && (method === "POST" || method === "DELETE")) {
      if (options.runtimeMutationError) {
        return Promise.resolve(Response.json({ error: options.runtimeMutationError }, { status: 503 }))
      }
      return Promise.resolve(Response.json({
        runtime: method === "POST"
          ? { state: "running", pid: 42, url: "http://127.0.0.1:4317/" }
          : { state: "stopped", pid: null, url: null },
      }))
    }
    if (url.endsWith("/proposals") && method === "POST") {
      const response = options.proposalPosts?.[proposalPostIndex]
      proposalPostIndex += 1
      if (!response) throw new Error("missing proposal response")
      return Promise.resolve(response)
    }
    if (url.endsWith("/apply") && method === "POST") {
      return Promise.resolve(options.applyResponse ?? Response.json({
        proposal: { ...readyProposal, status: "APPLIED", appliedCommit: "b".repeat(40) },
      }))
    }
    throw new Error(`unexpected fetch ${url} ${method}`)
  })
}

async function renderReady(fetcher: ReturnType<typeof baseFetch>, onPreviewRefresh = vi.fn()) {
  vi.stubGlobal("fetch", fetcher)
  render(<HelloApplicationControls onPreviewRefresh={onPreviewRefresh} />)
  await screen.findByText("Runtime stopped")
  return { onPreviewRefresh }
}

async function submitRequest(value = requestText) {
  const user = userEvent.setup()
  const input = screen.getByRole("textbox", { name: "Ask HERMES to change this application" })
  await user.clear(input)
  await user.type(input, value)
  await user.click(screen.getByRole("button", { name: "Ask HERMES" }))
  return input
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

afterEach(() => cleanup())

describe("HelloApplicationControls", () => {
  it("keeps runtime lifecycle controls independent and refreshes the preview after successful changes", async () => {
    const fetcher = baseFetch()
    const onPreviewRefresh = vi.fn()
    await renderReady(fetcher, onPreviewRefresh)

    fireEvent.click(screen.getByRole("button", { name: "Start application" }))
    await screen.findByText("Runtime running")
    expect(onPreviewRefresh).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Stop application" }))
    await screen.findByText("Runtime stopped")
    expect(onPreviewRefresh).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }))
    expect(onPreviewRefresh).toHaveBeenCalledTimes(3)
  })

  it("reads arbitrarily split NDJSON, shows only observed milestones and complete execution evidence, then applies and accepts a second request", async () => {
    const secondRequest = "Give the pulse button a calmer label"
    const secondProposal: ProposalFixture = {
      ...readyProposal,
      proposalId: "22222222-2222-4222-8222-222222222222",
      requestText: secondRequest,
      turnId: "turn-2",
    }
    const fetcher = baseFetch({
      proposalPosts: [
        streamResponse([...progress.map((entry) => ({ type: "progress", ...entry })), { type: "proposal", proposal: readyProposal }]),
        streamResponse([...progress.map((entry) => ({ type: "progress", ...entry })), { type: "proposal", proposal: secondProposal }], [1]),
      ],
    })
    const { onPreviewRefresh } = await renderReady(fetcher)

    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    const input = await submitRequest()

    await screen.findByText("Ready for review")
    const proposalPost = fetcher.mock.calls.find(([url, init]) => String(url).endsWith("/proposals") && init?.method === "POST")
    expect(proposalPost?.[1]?.body).toBe(JSON.stringify({ requestText }))
    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    expect(screen.getByText(requestText, { selector: "blockquote" })).toBeTruthy()

    const log = screen.getByRole("log", { name: "HERMES activity" })
    for (const event of progress) expect(within(log).getByText(event.detail)).toBeTruthy()
    expect(log.textContent).not.toMatch(/\b(?:percent|reasoning|tokens?|tools?)\b|%/i)

    const evidence = screen.getByLabelText("Resident execution evidence")
    expect(within(evidence).getByText("hermes-node")).toBeTruthy()
    expect(within(evidence).getByText("williamos-qwen3-4b:64k")).toBeTruthy()
    expect(within(evidence).getByText("thread-1")).toBeTruthy()
    expect(within(evidence).getByText("turn-1")).toBeTruthy()
    expect(within(evidence).getByText(requestText)).toBeTruthy()
    expect(screen.getByText("examples/hello-application/src/index.html")).toBeTruthy()
    expect(screen.getByText("examples/hello-application/src/styles.css")).toBeTruthy()
    expect(screen.getByText(validationCommand)).toBeTruthy()
    expect(screen.getByLabelText("Validation output").textContent).toContain("# pass 3")
    expect(screen.getByLabelText("Validation output").getAttribute("tabindex")).toBe("0")
    expect(screen.getByText("a".repeat(64))).toBeTruthy()
    expect(screen.getByLabelText("Proposed patch").textContent).toContain("The local AI loop")
    expect(screen.getByLabelText("Proposed patch").getAttribute("tabindex")).toBe("0")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))
    await screen.findByText("Applied")
    await waitFor(() => expect(onPreviewRefresh).toHaveBeenCalledTimes(1))

    await submitRequest(secondRequest)
    await screen.findByText("turn-2")
    expect(screen.getByText(secondRequest, { selector: "blockquote" })).toBeTruthy()
    const proposalPosts = fetcher.mock.calls.filter(([url, init]) => String(url).endsWith("/proposals") && init?.method === "POST")
    expect(proposalPosts).toHaveLength(2)
    expect(proposalPosts[1][1]?.body).toBe(JSON.stringify({ requestText: secondRequest }))
  })

  it.each([
    {
      name: "malformed JSON",
      response: rawStreamResponse(`${JSON.stringify({ type: "progress", ...progress[0] })}\n{not-json}\n`),
      message: "HERMES stream failed: malformed record.",
    },
    {
      name: "a malformed progress record",
      response: streamResponse([{ type: "progress", stage: "accepted", at: progress[0].at }]),
      message: "HERMES stream failed: malformed progress record.",
    },
    {
      name: "an unknown record",
      response: streamResponse([{ type: "telemetry", percent: 80 }]),
      message: "HERMES stream failed: unknown record type.",
    },
    {
      name: "EOF without a terminal",
      response: streamResponse([{ type: "progress", ...progress[0] }]),
      message: "HERMES stream failed: missing terminal record.",
    },
    {
      name: "duplicate terminals",
      response: streamResponse([
        { type: "proposal", proposal: readyProposal },
        { type: "proposal", proposal: readyProposal },
      ]),
      message: "HERMES stream failed: duplicate terminal record.",
    },
    {
      name: "a malformed proposal terminal",
      response: streamResponse([{ type: "proposal", proposal: { status: "READY_FOR_REVIEW" } }]),
      message: "HERMES stream failed: malformed proposal record.",
    },
    {
      name: "a schema-v2 proposal missing provenance additions",
      response: streamResponse([{ type: "proposal", proposal: malformedV2Proposal }]),
      message: "HERMES stream failed: malformed proposal record.",
    },
  ])("fails closed for $name while retaining the request and real transcript", async ({ response, message }) => {
    const fetcher = baseFetch({ proposalPosts: [response] })
    await renderReady(fetcher)

    const input = await submitRequest()
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain(message)
    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    expect(screen.getByText(requestText, { selector: "blockquote" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
  })

  it("renders a backend terminal error as an assistant failure while retaining observed milestones", async () => {
    const fetcher = baseFetch({
      proposalPosts: [streamResponse([
        { type: "progress", ...progress[0] },
        { type: "progress", ...progress[1] },
        { type: "error", error: "HELLO_PROPOSAL_FAILED" },
      ])],
    })
    await renderReady(fetcher)

    const input = await submitRequest()
    expect((await screen.findByRole("alert")).textContent).toContain("HERMES request failed: HELLO_PROPOSAL_FAILED")
    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    const log = screen.getByRole("log", { name: "HERMES activity" })
    expect(within(log).getByText("Request accepted")).toBeTruthy()
    expect(within(log).getByText("Isolated workspace ready")).toBeTruthy()
  })

  it("handles a non-stream HTTP error without parsing JSON as NDJSON and preserves the request", async () => {
    const fetcher = baseFetch({
      proposalPosts: [Response.json({ error: "HELLO_PROPOSAL_REQUEST_INVALID" }, { status: 400 })],
    })
    await renderReady(fetcher)

    const input = await submitRequest()
    expect((await screen.findByRole("alert")).textContent).toContain("HERMES request failed: HELLO_PROPOSAL_REQUEST_INVALID")
    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    expect(screen.getByText(requestText, { selector: "blockquote" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
  })

  it("rejects empty and over-limit requests locally and prevents a duplicate submission while busy", async () => {
    let resolveResponse!: (response: Response) => void
    const pendingResponse = new Promise<Response>((resolve) => { resolveResponse = resolve })
    const fetcher = baseFetch({ proposalPosts: [pendingResponse] })
    await renderReady(fetcher)
    const input = screen.getByRole("textbox", { name: "Ask HERMES to change this application" })
    const ask = screen.getByRole("button", { name: "Ask HERMES" })

    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.click(ask)
    expect((await screen.findByRole("alert")).textContent).toContain("Enter a request for HERMES.")
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith("/proposals") && init?.method === "POST")).toHaveLength(0)

    fireEvent.change(input, { target: { value: "x".repeat(2_001) } })
    fireEvent.click(ask)
    expect((await screen.findByRole("alert")).textContent).toContain("Keep the request to 2,000 characters or fewer.")
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith("/proposals") && init?.method === "POST")).toHaveLength(0)

    fireEvent.change(input, { target: { value: requestText } })
    fireEvent.click(ask)
    await waitFor(() => expect((ask as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(ask)
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith("/proposals") && init?.method === "POST")).toHaveLength(1)

    resolveResponse(streamResponse([{ type: "proposal", proposal: readyProposal }]))
    await screen.findByText("Ready for review")
    expect((ask as HTMLButtonElement).disabled).toBe(false)
  })

  it("restores only the newest proposal on mount and replays persisted schema-v2 milestones", async () => {
    const older = { ...readyProposal, proposalId: "00000000-0000-4000-8000-000000000000", requestText: "Older request" }
    const fetcher = baseFetch({ proposals: [readyProposal, older] })
    await renderReady(fetcher)

    expect(await screen.findByText(requestText, { selector: "blockquote" })).toBeTruthy()
    expect(screen.queryByText("Older request")).toBeNull()
    expect(within(screen.getByRole("log", { name: "HERMES activity" })).getByText("Proposal ready for review")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
  })

  it("does not let a delayed restore overwrite text the owner has typed", async () => {
    let resolveGet!: (response: Response) => void
    const proposalsGet = new Promise<Response>((resolve) => { resolveGet = resolve })
    const staleProposal = {
      ...readyProposal,
      proposalId: "33333333-3333-4333-8333-333333333333",
      requestText: "Stale restored request",
      threadId: "stale-thread",
      turnId: "stale-turn",
    }
    const fetcher = baseFetch({ proposalsGet })
    await renderReady(fetcher)

    const user = userEvent.setup()
    const input = screen.getByRole("textbox", { name: "Ask HERMES to change this application" })
    await user.type(input, requestText)
    await act(async () => {
      resolveGet(Response.json({ proposals: [staleProposal] }))
      await proposalsGet
      await Promise.resolve()
    })

    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    expect(screen.queryByText("Stale restored request")).toBeNull()
    expect(screen.queryByText("stale-turn")).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
  })

  it("does not let a delayed restore overwrite an in-flight request", async () => {
    let resolveGet!: (response: Response) => void
    let resolvePost!: (response: Response) => void
    const proposalsGet = new Promise<Response>((resolve) => { resolveGet = resolve })
    const proposalPost = new Promise<Response>((resolve) => { resolvePost = resolve })
    const staleProposal = {
      ...readyProposal,
      proposalId: "33333333-3333-4333-8333-333333333333",
      requestText: "Stale restored request",
      threadId: "stale-thread",
      turnId: "stale-turn",
    }
    const fetcher = baseFetch({ proposalsGet, proposalPosts: [proposalPost] })
    await renderReady(fetcher)

    const input = await submitRequest()
    await waitFor(() => expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith("/proposals") && init?.method === "POST")).toHaveLength(1))
    await act(async () => {
      resolveGet(Response.json({ proposals: [staleProposal] }))
      await proposalsGet
      await Promise.resolve()
    })

    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    expect(screen.queryByText("Stale restored request")).toBeNull()
    expect(screen.queryByText("stale-turn")).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()

    resolvePost(streamResponse([{ type: "proposal", proposal: readyProposal }]))
    expect(await screen.findByText("turn-1")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
  })

  it("restores schema-v1 proposals with unavailable additions instead of crashing", async () => {
    const { requestText: _requestText, executionNode: _executionNode, progress: _progress, ...schemaOne } = readyProposal
    const fetcher = baseFetch({ proposals: [{ ...schemaOne, schemaVersion: 1 }] })
    await renderReady(fetcher)

    expect(await screen.findByText("Ready for review")).toBeTruthy()
    expect(screen.getAllByText("Unavailable in schema v1")).toHaveLength(2)
    expect(screen.getByText("Milestones unavailable in schema v1.")).toBeTruthy()
    expect(screen.getByRole("log", { name: "HERMES activity" }).textContent).toBe("")
    expect(screen.getByText("williamos-qwen3-4b:64k")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
  })

  it("preserves a ready proposal when Apply fails and refreshes the preview only after success", async () => {
    const failedApply = Response.json({ error: "HELLO_PROPOSAL_STALE_BASE" }, { status: 409 })
    const fetcher = baseFetch({ proposals: [readyProposal], applyResponse: failedApply })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Apply failed: HELLO_PROPOSAL_STALE_BASE")
    expect(screen.getByLabelText("Proposed patch").textContent).toContain("The local AI loop")
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it("keeps runtime lifecycle errors separate from assistant failures", async () => {
    const fetcher = baseFetch({
      runtimeMutationError: "HELLO_APPLICATION_START_FAILED",
      proposalPosts: [streamResponse([{ type: "error", error: "HELLO_PROPOSAL_FAILED" }])],
    })
    await renderReady(fetcher)

    fireEvent.click(screen.getByRole("button", { name: "Start application" }))
    expect((await screen.findByText("Runtime error: HELLO_APPLICATION_START_FAILED")).getAttribute("role")).toBe("alert")

    await submitRequest()
    expect((await screen.findByText("HERMES request failed: HELLO_PROPOSAL_FAILED")).getAttribute("role")).toBe("alert")
    expect(screen.getAllByRole("alert")).toHaveLength(2)
  })
})
