// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HelloApplicationControls } from "@/components/workspace-shell/hello-application-controls"

const requestText = "Make the footer explain the local AI loop"
const validationCommand = "node --test examples/hello-application/test/hello.test.mjs"
const executionRoutes = {
  schemaVersion: 1,
  defaultRoute: "hermes-local",
  routes: [
    { id: "hermes-local", label: "Local HERMES — williamos-qwen3-4b:64k (default)", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true },
    { id: "cerebras-gpt-oss-120b", label: "Cerebras — gpt-oss-120b (external, metered)", provider: "cerebras", model: "gpt-oss-120b", external: true, metered: true, available: true },
    { id: "cerebras-qwen-3-8-27b", label: "Cerebras — qwen-3.8-27b (external, metered)", provider: "cerebras", model: "qwen-3.8-27b", external: true, metered: true, available: true },
  ],
} as const
const progress = [
  { stage: "accepted", detail: "Request accepted", at: "2026-09-19T17:00:00.000Z" },
  { stage: "workspace_ready", detail: "Isolated workspace ready", at: "2026-09-19T17:00:01.000Z" },
  { stage: "resident_started", detail: "HERMES is editing the isolated workspace", at: "2026-09-19T17:00:02.000Z" },
  { stage: "resident_finished", detail: "HERMES editing finished", at: "2026-09-19T17:00:03.000Z" },
  { stage: "validation_started", detail: "Contained validation started", at: "2026-09-19T17:00:04.000Z" },
  { stage: "ready_for_review", detail: "Proposal ready for review", at: "2026-09-19T17:00:05.000Z" },
] as const

const externalProgress = [
  { stage: "accepted", detail: "Request accepted", at: "2026-09-19T17:00:00.000Z" },
  { stage: "workspace_ready", detail: "Isolated workspace ready", at: "2026-09-19T17:00:01.000Z" },
  { stage: "resident_started", detail: "HERMES sent the bounded request to Cerebras", at: "2026-09-19T17:00:02.000Z" },
  { stage: "resident_finished", detail: "Cerebras returned a bounded change", at: "2026-09-19T17:00:03.000Z" },
  { stage: "validation_started", detail: "Contained validation started", at: "2026-09-19T17:00:04.000Z" },
  { stage: "ready_for_review", detail: "Proposal ready for review", at: "2026-09-19T17:00:05.000Z" },
] as const

const readyProposal = {
  schemaVersion: 2,
  proposalId: "11111111-1111-4111-8111-111111111111",
  status: "READY_FOR_REVIEW",
  requestedBy: "owner-1",
  requestText,
  requestSha256: "f8c16506770233e4c242e96988550f5eecbfda580127c1e80d80f765c5856b7c",
  executionNode: "hermes-node",
  progress,
  createdAt: "2026-09-19T16:59:59.000Z",
  appliedAt: null,
  appliedCommit: null,
  baseSha: "d".repeat(40),
  proposalCommit: "e".repeat(40),
  branch: "codex/hermes-hello-11111111-1111-4111-8111-111111111111",
  model: "williamos-qwen3-4b:64k",
  threadId: "thread-1",
  turnId: "turn-1",
  patchSha256: "d7be2b03ee7f50b00da380124193797e7fe5546bdb90400db94cb931bd1df3f8",
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

const externalReadyProposal = {
  ...readyProposal,
  schemaVersion: 3,
  executionNode: "cerebras-api",
  progress: externalProgress,
  model: "qwen-3.8-27b",
  threadId: "cerebras-thread-1",
  turnId: "cerebras-turn-1",
  providerExecution: {
    route: "external",
    provider: "cerebras",
    bridgeNode: "hermes-node",
    inferenceNode: "cerebras-api",
    mode: "credential-bridge-one-shot",
    requestedModel: "qwen-3.8-27b",
    actualModel: "qwen-3.8-27b",
    externalEgress: true,
    promptTokens: 1_100,
    completionTokens: 212,
    totalTokens: 1_312,
    calculatedCostUsd: 0.00013192,
    maxCostUsd: 0.03,
    contextDigest: `sha256:${"a".repeat(64)}`,
    durationMs: 517,
  },
} as const

const appliedProposal = {
  ...readyProposal,
  status: "APPLIED",
  appliedAt: "2026-09-19T17:00:06.000Z",
  appliedCommit: "b".repeat(40),
  validation: {
    ...readyProposal.validation,
    output: "TAP version 13\n# apply validation\n# pass 3\n# fail 0",
  },
} as const

const applyingProposal = {
  ...readyProposal,
  status: "APPLY_IN_PROGRESS",
  applyStartedAt: "2026-09-19T17:00:06.000Z",
} as const

const rejectedProposal = {
  ...readyProposal,
  status: "REJECTED",
  rejectedAt: "2026-09-19T17:00:06.000Z",
  rejectionReason: "Superseded by a clearer owner request.",
} as const

const rejectingProposal = {
  ...readyProposal,
  status: "REJECT_IN_PROGRESS",
  rejectStartedAt: "2026-09-19T17:00:06.000Z",
  rejectionReason: "Superseded by a clearer owner request.",
} as const

const {
  appliedCommit: _missingAppliedCommit,
  ...appliedWithoutCommit
} = appliedProposal

const {
  appliedAt: _missingAppliedAt,
  ...appliedWithoutAt
} = appliedProposal

const {
  requestText: _malformedRequest,
  executionNode: _malformedNode,
  progress: _malformedProgress,
  ...malformedV2Proposal
} = readyProposal

const {
  schemaVersion: _missingSchemaVersion,
  ...missingSchemaProposal
} = readyProposal

const {
  requestText: _schemaOneRequest,
  requestSha256: _schemaOneRequestHash,
  executionNode: _schemaOneNode,
  progress: _schemaOneProgress,
  appliedCommit: _schemaOneAppliedCommit,
  ...schemaOneBase
} = readyProposal
const { output: _schemaOneOutput, ...schemaOneValidation } = schemaOneBase.validation
const schemaOneProposal = {
  ...schemaOneBase,
  schemaVersion: 1,
  validation: schemaOneValidation,
} as const

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
  executionRoutesGet?: Response | Promise<Response>
  proposals?: readonly unknown[]
  proposalsGet?: Response | Promise<Response>
  proposalGets?: readonly (Response | Promise<Response>)[]
  proposalPosts?: readonly (Response | Promise<Response>)[]
  applyResponse?: Response | Promise<Response>
  applyError?: Error
  rejectResponse?: Response | Promise<Response>
  rejectError?: Error
  runtimeMutationError?: string
}> = {}) {
  let proposalGetIndex = 0
  let proposalPostIndex = 0
  let runtimeState: "stopped" | "running" = "stopped"
  const runtimeSnapshot = () => ({
    runtime: runtimeState === "running"
      ? { state: "running", pid: 42, url: "http://127.0.0.1:4317/" }
      : { state: "stopped", pid: null, url: null },
    truth: {
      runtimeBuild: { sha: "a".repeat(40), builtAt: "2026-09-20T12:00:00.000Z" },
      activeProjectHead: "b".repeat(40),
    },
  })
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url.endsWith("/execution-routes") && method === "GET") {
      return Promise.resolve(options.executionRoutesGet ?? Response.json(executionRoutes))
    }
    if (url.endsWith("/runtime") && method === "GET") {
      return Promise.resolve(Response.json(runtimeSnapshot()))
    }
    if (url.endsWith("/proposals") && method === "GET") {
      const sequenced = options.proposalGets?.[proposalGetIndex]
      proposalGetIndex += 1
      if (sequenced) return Promise.resolve(sequenced)
      if (options.proposalsGet) return Promise.resolve(options.proposalsGet)
      return Promise.resolve(Response.json({ proposals: options.proposals ?? [] }))
    }
    if (url.endsWith("/runtime") && (method === "POST" || method === "DELETE")) {
      if (options.runtimeMutationError) {
        return Promise.resolve(Response.json({ error: options.runtimeMutationError }, { status: 503 }))
      }
      runtimeState = method === "POST" ? "running" : "stopped"
      return Promise.resolve(Response.json({ runtime: runtimeSnapshot().runtime }))
    }
    if (url.endsWith("/proposals") && method === "POST") {
      const response = options.proposalPosts?.[proposalPostIndex]
      proposalPostIndex += 1
      if (!response) throw new Error("missing proposal response")
      return Promise.resolve(response)
    }
    if (url.endsWith("/apply") && method === "POST") {
      if (options.applyError) return Promise.reject(options.applyError)
      return Promise.resolve(options.applyResponse ?? Response.json({
        proposal: appliedProposal,
      }))
    }
    if (/\/proposals\/[^/]+$/.test(url) && method === "DELETE") {
      if (options.rejectError) return Promise.reject(options.rejectError)
      return Promise.resolve(options.rejectResponse ?? Response.json({ proposal: rejectedProposal }))
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

  it("keeps local HERMES as default and requires explicit disclosure approval before an exact Cerebras route", async () => {
    const fetcher = baseFetch({
      proposalPosts: [streamResponse([{ type: "error", error: "EXTERNAL_API_OUTAGE" }])],
    })
    await renderReady(fetcher)
    const user = userEvent.setup()
    const route = await screen.findByRole("combobox", { name: "AI execution route" })
    expect((route as HTMLSelectElement).value).toBe("hermes-local")
    expect(screen.getByText("Runs inside HERMES. The request and application source stay in the lab.")).toBeTruthy()

    await user.selectOptions(route, "cerebras-qwen-3-8-27b")
    expect(screen.getByText(/External and metered.*No local fallback\./)).toBeTruthy()
    const approval = screen.getByRole("checkbox", { name: /I confirm this request contains only public or sanitized content/i })
    const ask = screen.getByRole("button", { name: "Ask HERMES via Cerebras" })
    expect((ask as HTMLButtonElement).disabled).toBe(true)
    const input = screen.getByRole("textbox", { name: "Ask HERMES to change this application" })
    await user.type(input, requestText)
    await user.click(approval)
    await user.type(input, " safely")
    expect((approval as HTMLInputElement).checked).toBe(false)
    expect((ask as HTMLButtonElement).disabled).toBe(true)
    await user.click(approval)
    await user.click(ask)

    await screen.findByText("HERMES request failed: EXTERNAL_API_OUTAGE")
    const proposalPost = fetcher.mock.calls.find(([url, init]) => String(url).endsWith("/proposals") && init?.method === "POST")
    expect(proposalPost?.[1]?.body).toBe(JSON.stringify({
      requestText: `${requestText} safely`,
      executionRoute: "cerebras-qwen-3-8-27b",
      externalEgressApproved: true,
    }))
    expect((route as HTMLSelectElement).value).toBe("cerebras-qwen-3-8-27b")
    expect((approval as HTMLInputElement).checked).toBe(false)
    expect((ask as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/local fallback succeeded/i)).toBeNull()
  })

  it("restores external provider, model, usage, and cost truth from a schema-v3 receipt", async () => {
    const fetcher = baseFetch({ proposals: [externalReadyProposal] })
    await renderReady(fetcher)

    const evidence = await screen.findByLabelText("Governed execution evidence")
    expect(within(evidence).getByText("Cerebras (external)")).toBeTruthy()
    expect(within(evidence).getByText("qwen-3.8-27b")).toBeTruthy()
    expect(within(evidence).getByText("1,312 tokens")).toBeTruthy()
    expect(within(evidence).getByText("$0.00013192")).toBeTruthy()
    expect(within(evidence).getByText("$0.03")).toBeTruthy()
    expect(within(evidence).getByText("517 ms")).toBeTruthy()
  })

  it("reads arbitrarily split NDJSON, shows only observed milestones and complete execution evidence, then applies and accepts a second request", async () => {
    const secondRequest = "Give the pulse button a calmer label"
    const secondProposal = {
      ...readyProposal,
      proposalId: "22222222-2222-4222-8222-222222222222",
      requestText: secondRequest,
      requestSha256: "9033df60a978eaa2ce4b1a3135453b7e0ec6d3d2f16cc486a55c008a75a41502",
      branch: "codex/hermes-hello-22222222-2222-4222-8222-222222222222",
      turnId: "turn-2",
    } as const
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

    const evidence = screen.getByLabelText("Governed execution evidence")
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
    expect(screen.getByText("d7be2b03ee7f50b00da380124193797e7fe5546bdb90400db94cb931bd1df3f8")).toBeTruthy()
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
    {
      name: "a progress envelope with an unexpected field",
      response: streamResponse([{ type: "progress", ...progress[0], percent: 10 }]),
      message: "HERMES stream failed: malformed progress record.",
    },
    {
      name: "a proposal envelope with an unexpected field",
      response: streamResponse([{ type: "proposal", proposal: readyProposal, debug: true }]),
      message: "HERMES stream failed: malformed proposal record.",
    },
    {
      name: "an error envelope with an unexpected field",
      response: streamResponse([{ type: "error", error: "HELLO_PROPOSAL_FAILED", detail: "internal" }]),
      message: "HERMES stream failed: malformed error record.",
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

  it.each([
    {
      name: "zero observed milestones",
      observed: [],
    },
    {
      name: "a missing observed milestone",
      observed: progress.slice(0, -1),
    },
    {
      name: "a duplicate observed milestone",
      observed: [progress[0], progress[0], ...progress.slice(1)],
    },
    {
      name: "out-of-order observed milestones",
      observed: [progress[1], progress[0], ...progress.slice(2)],
    },
    {
      name: "a fabricated observed milestone detail",
      observed: progress.map((entry, index) => index === 2
        ? { ...entry, detail: "Fabricated resident reasoning" }
        : entry),
    },
    {
      name: "an observed timestamp that differs from the receipt",
      observed: progress.map((entry, index) => index === 2
        ? { ...entry, at: "2026-09-19T17:00:02.500Z" }
        : entry),
    },
  ])("rejects $name before exposing Apply", async ({ observed }) => {
    const fetcher = baseFetch({
      proposalPosts: [streamResponse([
        ...observed.map((entry) => ({ type: "progress", ...entry })),
        { type: "proposal", proposal: readyProposal },
      ])],
    })
    await renderReady(fetcher)

    const input = await submitRequest()

    expect((await screen.findByRole("alert")).textContent).toContain("HERMES stream failed: milestone sequence mismatch.")
    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    expect(screen.getByText(requestText, { selector: "blockquote" })).toBeTruthy()
    expect(screen.getByRole("log", { name: "HERMES activity" }).textContent).not.toContain("Fabricated resident reasoning")
    expect(screen.queryByLabelText("HERMES proposal")).toBeNull()
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

  it("rejects a schema-v2 terminal for a different request while retaining the owner transcript and milestones", async () => {
    const differentRequest = "Replace the footer with an unrelated request"
    const fetcher = baseFetch({
      proposalPosts: [streamResponse([
        ...progress.map((entry) => ({ type: "progress", ...entry })),
        { type: "proposal", proposal: { ...readyProposal, requestText: differentRequest } },
      ])],
    })
    await renderReady(fetcher)

    const input = await submitRequest()

    expect((await screen.findByRole("alert")).textContent).toContain("HERMES stream failed: proposal request mismatch.")
    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    expect(screen.getByText(requestText, { selector: "blockquote" })).toBeTruthy()
    expect(screen.queryByText(differentRequest)).toBeNull()
    const log = screen.getByRole("log", { name: "HERMES activity" })
    expect(within(log).getByText("Request accepted")).toBeTruthy()
    expect(within(log).getByText("Proposal ready for review")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
  })

  it.each([
    {
      name: "request digest",
      proposal: { ...readyProposal, requestSha256: "0".repeat(64) },
    },
    {
      name: "patch digest",
      proposal: { ...readyProposal, patchSha256: "0".repeat(64) },
    },
  ])("rejects a streamed READY proposal with the wrong $name", async ({ proposal }) => {
    const fetcher = baseFetch({
      proposalPosts: [streamResponse([
        ...progress.map((entry) => ({ type: "progress", ...entry })),
        { type: "proposal", proposal },
      ])],
    })
    await renderReady(fetcher)

    const input = await submitRequest()

    expect((await screen.findByRole("alert")).textContent).toContain("HERMES stream failed: proposal evidence hash mismatch.")
    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    expect(screen.getByText(requestText, { selector: "blockquote" })).toBeTruthy()
    expect(within(screen.getByRole("log", { name: "HERMES activity" })).getByText("Proposal ready for review")).toBeTruthy()
    expect(screen.queryByLabelText("HERMES proposal")).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
  })

  it.each([
    {
      name: "a schema-v1 proposal",
      proposal: schemaOneProposal,
    },
    {
      name: "an already-applied schema-v2 proposal",
      proposal: appliedProposal,
    },
    {
      name: "a quarantined schema-v2 proposal",
      proposal: {
        ...readyProposal,
        status: "QUARANTINED_ROLLBACK_FAILED",
        quarantinedAt: "2026-09-19T17:00:06.000Z",
      },
    },
  ])("rejects a creation stream terminal containing $name", async ({ proposal }) => {
    const fetcher = baseFetch({
      proposalPosts: [streamResponse([
        ...progress.map((entry) => ({ type: "progress", ...entry })),
        { type: "proposal", proposal },
      ])],
    })
    await renderReady(fetcher)

    const input = await submitRequest()

    expect((await screen.findByRole("alert")).textContent).toContain("HERMES stream failed: invalid proposal terminal.")
    expect((input as HTMLTextAreaElement).value).toBe(requestText)
    expect(screen.getByText(requestText, { selector: "blockquote" })).toBeTruthy()
    expect(within(screen.getByRole("log", { name: "HERMES activity" })).getByText("Proposal ready for review")).toBeTruthy()
    expect(screen.queryByLabelText("HERMES proposal")).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
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

    resolveResponse(streamResponse([
      ...progress.map((entry) => ({ type: "progress", ...entry })),
      { type: "proposal", proposal: readyProposal },
    ]))
    await screen.findByText("Ready for review")
    expect((ask as HTMLButtonElement).disabled).toBe(false)
  })

  it("restores the newest pending proposal on mount and replays persisted schema-v2 milestones", async () => {
    const older = {
      ...readyProposal,
      proposalId: "00000000-0000-4000-8000-000000000000",
      branch: "codex/hermes-hello-00000000-0000-4000-8000-000000000000",
      threadId: "older-thread",
      turnId: "older-turn",
    }
    const fetcher = baseFetch({ proposals: [readyProposal, older] })
    await renderReady(fetcher)

    expect(await screen.findByText(requestText, { selector: "blockquote" })).toBeTruthy()
    expect(screen.queryByText("older-turn")).toBeNull()
    expect(within(screen.getByRole("log", { name: "HERMES activity" })).getByText("Proposal ready for review")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
  })

  it("restores an older pending proposal instead of hiding it behind newer terminal history", async () => {
    const olderPending = {
      ...readyProposal,
      proposalId: "00000000-0000-4000-8000-000000000000",
      branch: "codex/hermes-hello-00000000-0000-4000-8000-000000000000",
      createdAt: "2026-09-19T16:59:58.000Z",
      threadId: "older-thread",
      turnId: "older-turn",
    }
    const fetcher = baseFetch({ proposals: [appliedProposal, olderPending] })
    await renderReady(fetcher)

    expect(await screen.findByText("Ready for review")).toBeTruthy()
    expect(screen.getByText("older-turn")).toBeTruthy()
    expect(screen.queryByText("Applied")).toBeNull()
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reject proposal" })).toBeTruthy()
  })

  it("restores an authoritative APPLY_IN_PROGRESS receipt without exposing Apply", async () => {
    const fetcher = baseFetch({ proposals: [applyingProposal] })
    await renderReady(fetcher)

    expect(await screen.findByText("Apply in progress")).toBeTruthy()
    expect(screen.getByLabelText("Proposed patch").textContent).toContain("The local AI loop")
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
  })

  it("requires confirmation and an audit reason, then refreshes the proposal into rejected state without Apply", async () => {
    const fetcher = baseFetch({ proposals: [readyProposal] })
    await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }))

    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0)
    const confirmation = screen.getByRole("group", { name: "Confirm proposal rejection" })
    const reason = within(confirmation).getByRole("textbox", { name: "Rejection reason" })
    const confirm = within(confirmation).getByRole("button", { name: "Confirm rejection" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: "first\u2028second" } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: "\u2028leading separator" } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: "trailing separator\u2029" } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: "  Superseded by a clearer owner request.  " } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    expect(await screen.findByText("Rejected / discarded")).toBeTruthy()
    const audit = screen.getByLabelText("Proposal rejection audit")
    expect(within(audit).getByText("Superseded by a clearer owner request.")).toBeTruthy()
    expect(within(audit).getByText("2026-09-19T17:00:06.000Z")).toBeTruthy()
    expect(screen.queryByText("Ready for review")).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Reject proposal" })).toBeNull()
    const rejection = fetcher.mock.calls.find(([url, init]) => /\/proposals\/[^/]+$/.test(String(url)) && init?.method === "DELETE")
    expect(rejection?.[1]?.body).toBe(JSON.stringify({ reason: "Superseded by a clearer owner request." }))
  })

  it("restores a rejected proposal with its audit label and never presents READY or Apply", async () => {
    const fetcher = baseFetch({ proposals: [rejectedProposal] })
    await renderReady(fetcher)

    expect(await screen.findByText("Rejected / discarded")).toBeTruthy()
    expect(screen.getByLabelText("Proposal rejection audit").textContent).toContain("Superseded by a clearer owner request.")
    expect(screen.queryByText("Ready for review")).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Reject proposal" })).toBeNull()
  })

  it("keeps a terminal rejection visible until the owner explicitly reviews the next proposal", async () => {
    const nextPending = {
      ...readyProposal,
      proposalId: "22222222-2222-4222-8222-222222222222",
      branch: "codex/hermes-hello-22222222-2222-4222-8222-222222222222",
      createdAt: "2026-09-19T16:59:58.000Z",
      threadId: "next-thread",
      turnId: "next-turn",
    }
    const fetcher = baseFetch({
      proposalGets: [
        Response.json({ proposals: [readyProposal] }),
        Response.json({ proposals: [rejectedProposal, nextPending] }),
      ],
    })
    await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Rejection reason" }), {
      target: { value: "Superseded by a clearer owner request." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }))

    expect(await screen.findByText("Rejected / discarded")).toBeTruthy()
    expect(screen.queryByText("next-turn")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Review next proposal" }))
    expect(await screen.findByText("next-turn")).toBeTruthy()
    expect(screen.getByText("Next pending proposal ready for review.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reject proposal" })).toBeTruthy()
  })

  it("reconciles a lost Reject response to the exact terminal rejection", async () => {
    const fetcher = baseFetch({
      proposalGets: [
        Response.json({ proposals: [readyProposal] }),
        Response.json({ proposals: [rejectedProposal] }),
      ],
      rejectError: new TypeError("response lost after rejection"),
    })
    await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Rejection reason" }), {
      target: { value: "Superseded by a clearer owner request." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }))

    expect(await screen.findByText("Rejected / discarded")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Reject proposal" })).toBeNull()
  })

  it("reconciles a lost Reject response to an authoritative in-progress claim", async () => {
    const fetcher = baseFetch({
      proposalGets: [
        Response.json({ proposals: [readyProposal] }),
        Response.json({ proposals: [rejectingProposal] }),
      ],
      rejectError: new TypeError("response lost while rejection finalizes"),
    })
    await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Rejection reason" }), {
      target: { value: "Superseded by a clearer owner request." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }))

    expect(await screen.findByText("Reject in progress")).toBeTruthy()
    expect(screen.getByText("Proposal rejection is in progress. Resume it to finish discarding the proposal.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Reject proposal" })).toBeNull()
    expect(screen.getByRole("button", { name: "Resume rejection" })).toBeTruthy()
  })

  it("lets the owner resume a durable rejection left in progress by a server restart", async () => {
    const fetcher = baseFetch({ proposals: [rejectingProposal] })
    await renderReady(fetcher)

    expect(await screen.findByText("Reject in progress")).toBeTruthy()
    const resume = screen.getByRole("button", { name: "Resume rejection" })
    fireEvent.click(resume)

    expect(await screen.findByText("Rejected / discarded")).toBeTruthy()
    expect(screen.getByLabelText("Proposal rejection audit").textContent)
      .toContain("Superseded by a clearer owner request.")
    expect(fetcher.mock.calls.find(([url, init]) => /\/proposals\/[^/]+$/.test(String(url)) && init?.method === "DELETE")?.[1]?.body)
      .toBe(JSON.stringify({ reason: "Superseded by a clearer owner request." }))
    expect(screen.queryByRole("button", { name: "Resume rejection" })).toBeNull()
  })

  it("blocks both review actions when a lost Reject outcome cannot be verified", async () => {
    const fetcher = baseFetch({
      proposalGets: [
        Response.json({ proposals: [readyProposal] }),
        Response.json({ proposals: [] }),
      ],
      rejectError: new TypeError("response lost with no authoritative receipt"),
    })
    await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Rejection reason" }), {
      target: { value: "Superseded by a clearer owner request." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }))

    expect(await screen.findByText("Reject outcome could not be verified. Apply and Reject are blocked.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Confirm rejection" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("textbox", { name: "Rejection reason" }) as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
  })

  it.each([
    {
      name: "a missing schema version",
      proposal: missingSchemaProposal,
    },
    {
      name: "an unsupported status",
      proposal: { ...readyProposal, status: "REVIEWABLE_ENOUGH" },
    },
    {
      name: "an invalid proposal UUID",
      proposal: { ...readyProposal, proposalId: "proposal-1" },
    },
    {
      name: "an invalid patch hash",
      proposal: { ...readyProposal, patchSha256: "not-a-sha256" },
    },
    {
      name: "a valid-format request digest that does not bind the request text",
      proposal: { ...readyProposal, requestSha256: "0".repeat(64) },
    },
    {
      name: "a valid-format patch digest that does not bind the review patch",
      proposal: { ...readyProposal, patchSha256: "0".repeat(64) },
    },
    {
      name: "a schema-v1 patch digest that does not bind the review patch",
      proposal: { ...schemaOneProposal, patchSha256: "0".repeat(64) },
    },
    {
      name: "a path outside the three writable files",
      proposal: { ...readyProposal, changedPaths: ["examples/hello-application/server.mjs"] },
    },
    {
      name: "a duplicate changed path",
      proposal: { ...readyProposal, changedPaths: [readyProposal.changedPaths[0], readyProposal.changedPaths[0]] },
    },
    {
      name: "out-of-order changed paths",
      proposal: { ...readyProposal, changedPaths: [...readyProposal.changedPaths].reverse() },
    },
    {
      name: "failed validation",
      proposal: { ...readyProposal, validation: { ...readyProposal.validation, status: "failed" } },
    },
    {
      name: "the wrong validation command",
      proposal: { ...readyProposal, validation: { ...readyProposal.validation, command: "npm test" } },
    },
    {
      name: "non-string validation output",
      proposal: { ...readyProposal, validation: { ...readyProposal.validation, output: 42 } },
    },
    {
      name: "an empty READY patch",
      proposal: { ...readyProposal, reviewPatch: "" },
    },
    {
      name: "empty schema-v2 progress",
      proposal: { ...readyProposal, progress: [] },
    },
    {
      name: "out-of-order schema-v2 stages",
      proposal: { ...readyProposal, progress: [progress[1], progress[0], ...progress.slice(2)] },
    },
    {
      name: "a noncanonical schema-v2 milestone detail",
      proposal: { ...readyProposal, progress: progress.map((entry, index) => index === 2 ? { ...entry, detail: "Resident work maybe started" } : entry) },
    },
    {
      name: "an invalid schema-v2 timestamp",
      proposal: { ...readyProposal, progress: progress.map((entry, index) => index === 2 ? { ...entry, at: "not-a-timestamp" } : entry) },
    },
    {
      name: "decreasing schema-v2 timestamps",
      proposal: { ...readyProposal, progress: progress.map((entry, index) => index === 2 ? { ...entry, at: "2026-09-19T16:59:59.000Z" } : entry) },
    },
    {
      name: "a schema-v2 APPLIED receipt without an applied commit",
      proposal: appliedWithoutCommit,
    },
    {
      name: "a schema-v2 APPLIED receipt with an invalid applied commit",
      proposal: { ...appliedProposal, appliedCommit: "not-a-commit" },
    },
    {
      name: "a schema-v2 receipt missing immutable provenance",
      proposal: (() => {
        const { requestedBy: _requestedBy, ...proposal } = readyProposal
        return proposal
      })(),
    },
    {
      name: "a schema-v2 receipt with an injected field",
      proposal: { ...readyProposal, unexpectedEvidence: "not part of the receipt schema" },
    },
  ])("does not expose Apply for $name", async ({ proposal }) => {
    const fetcher = baseFetch({ proposals: [proposal] })
    await renderReady(fetcher)

    expect((await screen.findByRole("alert")).textContent).toContain("HERMES status failed: HELLO_PROPOSAL_RESPONSE_INVALID")
    expect(screen.queryByLabelText("HERMES proposal")).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
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

    resolvePost(streamResponse([
      ...progress.map((entry) => ({ type: "progress", ...entry })),
      { type: "proposal", proposal: readyProposal },
    ]))
    expect(await screen.findByText("turn-1")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
  })

  it("restores schema-v1 proposals with unavailable additions instead of crashing", async () => {
    const fetcher = baseFetch({ proposals: [schemaOneProposal] })
    await renderReady(fetcher)

    expect(await screen.findByText("Ready for review")).toBeTruthy()
    expect(screen.getAllByText("Unavailable in schema v1")).toHaveLength(2)
    expect(screen.getByText("Milestones unavailable in schema v1.")).toBeTruthy()
    expect(screen.getByRole("log", { name: "HERMES activity" }).textContent).toBe("")
    expect(screen.getByText("Executing model")).toBeTruthy()
    expect(screen.getByText("williamos-qwen3-4b:64k")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
  })

  it("rejects forged external-provider evidence on a legacy schema before rendering it", async () => {
    const fetcher = baseFetch({ proposals: [{ ...schemaOneProposal, providerExecution: {} }] })
    await renderReady(fetcher)

    expect((await screen.findByRole("alert")).textContent).toContain("HELLO_PROPOSAL_RESPONSE_INVALID")
    expect(screen.queryByLabelText("HERMES proposal")).toBeNull()
    expect(screen.queryByText("Cerebras (external)")).toBeNull()
  })

  it("fails closed when browser digest verification is unavailable", async () => {
    vi.stubGlobal("crypto", {})
    const fetcher = baseFetch({ proposals: [readyProposal] })
    await renderReady(fetcher)

    expect((await screen.findByRole("alert")).textContent).toContain("HERMES status failed: HELLO_PROPOSAL_RESPONSE_INVALID")
    expect(screen.queryByLabelText("HERMES proposal")).toBeNull()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
  })

  it("reconciles a lost Apply response to the exact APPLIED receipt and refreshes once", async () => {
    const fetcher = baseFetch({
      proposalGets: [
        Response.json({ proposals: [readyProposal] }),
        Response.json({ proposals: [appliedProposal] }),
      ],
      applyError: new TypeError("response lost after request"),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Applied")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(onPreviewRefresh).toHaveBeenCalledOnce()
  })

  it("reconciles a lost Apply response to authoritative APPLY_IN_PROGRESS without re-enabling Apply", async () => {
    const fetcher = baseFetch({
      proposalGets: [
        Response.json({ proposals: [readyProposal] }),
        Response.json({ proposals: [applyingProposal] }),
      ],
      applyError: new TypeError("response lost while validation continues"),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Apply in progress")).toBeTruthy()
    expect(screen.getByText("Proposal apply is in progress. Apply is unavailable.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    expect(screen.getByLabelText("Proposed patch").textContent).toContain("The local AI loop")
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it("reconciles a lost Apply response to an authoritative rejection claim with Resume available", async () => {
    const fetcher = baseFetch({
      proposalGets: [
        Response.json({ proposals: [readyProposal] }),
        Response.json({ proposals: [rejectingProposal] }),
      ],
      applyError: new TypeError("response lost while a peer rejects"),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Reject in progress")).toBeTruthy()
    expect(screen.getByText("Proposal rejection is in progress. Resume it to finish discarding the proposal.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Resume rejection" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it("reconciles a malformed HTTP-200 Apply response to exact READY and keeps retry available", async () => {
    const fetcher = baseFetch({
      proposalGets: [
        Response.json({ proposals: [readyProposal] }),
        Response.json({ proposals: [readyProposal] }),
      ],
      applyResponse: new Response("{malformed", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect((await screen.findByRole("alert")).textContent).toContain("Apply failed: HELLO_PROPOSAL_RESPONSE_INVALID")
    expect(screen.getByText("Proposal remains ready for review.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Apply proposal" }) as HTMLButtonElement).disabled).toBe(false)
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).endsWith("/proposals") && (init?.method ?? "GET") === "GET")).toHaveLength(2)
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it("reconciles an invalid HTTP-200 Apply response to exact QUARANTINED and blocks Apply", async () => {
    const quarantinedProposal = {
      ...readyProposal,
      status: "QUARANTINED_ROLLBACK_FAILED",
      quarantinedAt: "2026-09-19T17:00:06.000Z",
    } as const
    const fetcher = baseFetch({
      proposalGets: [
        Response.json({ proposals: [readyProposal] }),
        Response.json({ proposals: [quarantinedProposal] }),
      ],
      applyResponse: Response.json({ proposal: { ...appliedProposal, patchSha256: "c".repeat(64) } }),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Quarantined")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Apply proposal" })).toBeNull()
    expect(screen.queryByText("Proposal remains ready for review.")).toBeNull()
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: "the reconciliation request is unavailable",
      reconcile: Response.json({ error: "HELLO_PROPOSAL_UNAVAILABLE" }, { status: 503 }),
    },
    {
      name: "the reconciliation receipt is not the reviewed proposal",
      reconcile: Response.json({ proposals: [{
        ...readyProposal,
        proposalId: "22222222-2222-4222-8222-222222222222",
        branch: "codex/hermes-hello-22222222-2222-4222-8222-222222222222",
      }] }),
    },
  ])("fails closed with Apply disabled when $name", async ({ reconcile }) => {
    const fetcher = baseFetch({
      proposalGets: [Response.json({ proposals: [readyProposal] }), reconcile],
      applyError: new TypeError("response lost after request"),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect((await screen.findByRole("alert")).textContent).toContain("Apply failed: HELLO_PROPOSAL_OUTCOME_UNVERIFIED")
    expect(screen.getByText("Apply outcome could not be verified. Apply is blocked.")).toBeTruthy()
    expect(screen.queryByText("Proposal remains ready for review.")).toBeNull()
    expect(screen.getByText("Apply state unconfirmed")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Apply proposal" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByLabelText("Proposed patch").textContent).toContain("The local AI loop")
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it("preserves a ready proposal when Apply fails and refreshes the preview only after success", async () => {
    const failedApply = Response.json({ error: "HELLO_PROPOSAL_STALE_BASE" }, { status: 409 })
    let resolveReconciliation!: (response: Response) => void
    const reconciliation = new Promise<Response>((resolve) => { resolveReconciliation = resolve })
    const fetcher = baseFetch({
      proposalGets: [Response.json({ proposals: [readyProposal] }), reconciliation],
      applyResponse: failedApply,
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))
    expect(await screen.findByText("Applying the reviewed proposal.")).toBeTruthy()
    const applying = screen.getByRole("button", { name: "Apply proposal" }) as HTMLButtonElement
    expect(applying.textContent).toBe("Applying proposal…")
    expect(applying.disabled).toBe(true)
    expect(onPreviewRefresh).not.toHaveBeenCalled()

    await act(async () => {
      resolveReconciliation(Response.json({ proposals: [readyProposal] }))
      await reconciliation
    })
    expect((await screen.findByRole("alert")).textContent).toContain("Apply failed: HELLO_PROPOSAL_STALE_BASE")
    expect(screen.getByLabelText("Proposed patch").textContent).toContain("The local AI loop")
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it("accepts a schema-v2 APPLIED receipt with a 64-character commit", async () => {
    const fetcher = baseFetch({
      proposals: [readyProposal],
      applyResponse: Response.json({
        proposal: { ...appliedProposal, appliedCommit: "b".repeat(64) },
      }),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect(await screen.findByText("Applied")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(onPreviewRefresh).toHaveBeenCalledOnce()
  })

  it("reverifies evidence hashes before accepting Apply", async () => {
    const fetcher = baseFetch({
      proposals: [readyProposal],
      applyResponse: Response.json({ proposal: appliedProposal }),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")
    vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(new Error("digest unavailable"))

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect((await screen.findByRole("alert")).textContent).toContain("Apply failed: HELLO_PROPOSAL_OUTCOME_UNVERIFIED")
    expect(screen.getByText("Apply outcome could not be verified. Apply is blocked.")).toBeTruthy()
    expect(screen.getByText("Apply state unconfirmed")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Apply proposal" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByLabelText("Proposed patch").textContent).toContain("The local AI loop")
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it("requires fresh validation output when applying a restored schema-v1 proposal", async () => {
    const fetcher = baseFetch({
      proposals: [schemaOneProposal],
      applyResponse: Response.json({
        proposal: {
          ...schemaOneProposal,
          status: "APPLIED",
          appliedAt: "2026-09-19T17:00:06.000Z",
          appliedCommit: "b".repeat(40),
        },
      }),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect((await screen.findByRole("alert")).textContent).toContain("Apply failed: HELLO_PROPOSAL_RESPONSE_INVALID")
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: "a still-ready proposal",
      proposal: readyProposal,
    },
    {
      name: "a quarantined proposal",
      proposal: {
        ...readyProposal,
        status: "QUARANTINED_ROLLBACK_FAILED",
        quarantinedAt: "2026-09-19T17:00:06.000Z",
      },
    },
    {
      name: "the wrong proposal ID",
      proposal: {
        ...appliedProposal,
        proposalId: "22222222-2222-4222-8222-222222222222",
        branch: "codex/hermes-hello-22222222-2222-4222-8222-222222222222",
      },
    },
    {
      name: "the wrong owner request",
      proposal: { ...appliedProposal, requestText: "Change something else" },
    },
    {
      name: "the wrong execution node",
      proposal: { ...appliedProposal, executionNode: "not-the-reviewed-node" },
    },
    {
      name: "the wrong resident model",
      proposal: { ...appliedProposal, model: "different-model:latest" },
    },
    {
      name: "the wrong resident turn",
      proposal: { ...appliedProposal, turnId: "turn-2" },
    },
    {
      name: "different changed paths",
      proposal: { ...appliedProposal, changedPaths: ["examples/hello-application/src/app.js"] },
    },
    {
      name: "a different patch hash",
      proposal: { ...appliedProposal, patchSha256: "c".repeat(64) },
    },
    {
      name: "a different reviewed patch",
      proposal: { ...appliedProposal, reviewPatch: "diff --git a/different b/different\n" },
    },
    {
      name: "different progress provenance",
      proposal: { ...appliedProposal, progress: progress.map((entry, index) => index === 0 ? { ...entry, detail: "Different accepted detail" } : entry) },
    },
    {
      name: "a different request digest",
      proposal: { ...appliedProposal, requestSha256: "c".repeat(64) },
    },
    {
      name: "a different requesting owner",
      proposal: { ...appliedProposal, requestedBy: "owner-2" },
    },
    {
      name: "a different creation timestamp",
      proposal: { ...appliedProposal, createdAt: "2026-09-19T16:59:58.000Z" },
    },
    {
      name: "a different base commit",
      proposal: { ...appliedProposal, baseSha: "1".repeat(40) },
    },
    {
      name: "a different proposal commit",
      proposal: { ...appliedProposal, proposalCommit: "2".repeat(40) },
    },
    {
      name: "a different branch",
      proposal: { ...appliedProposal, branch: "codex/hermes-hello-not-the-reviewed-proposal" },
    },
    {
      name: "failed fresh validation",
      proposal: { ...appliedProposal, validation: { ...appliedProposal.validation, status: "failed" } },
    },
    {
      name: "a different fresh validation command",
      proposal: { ...appliedProposal, validation: { ...appliedProposal.validation, command: "npm test" } },
    },
    {
      name: "non-string fresh validation output",
      proposal: { ...appliedProposal, validation: { ...appliedProposal.validation, output: 42 } },
    },
    {
      name: "a missing applied commit",
      proposal: appliedWithoutCommit,
    },
    {
      name: "an invalid applied commit",
      proposal: { ...appliedProposal, appliedCommit: "not-a-commit" },
    },
    {
      name: "a missing applied timestamp",
      proposal: appliedWithoutAt,
    },
    {
      name: "an invalid applied timestamp",
      proposal: { ...appliedProposal, appliedAt: "not-a-timestamp" },
    },
  ])("rejects an HTTP-200 Apply response containing $name", async ({ proposal }) => {
    const fetcher = baseFetch({
      proposals: [readyProposal],
      applyResponse: Response.json({ proposal }),
    })
    const { onPreviewRefresh } = await renderReady(fetcher)
    await screen.findByText("Ready for review")

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))

    expect((await screen.findByRole("alert")).textContent).toContain("Apply failed: HELLO_PROPOSAL_RESPONSE_INVALID")
    expect(screen.getByRole("button", { name: "Apply proposal" })).toBeTruthy()
    expect(within(screen.getByLabelText("Governed execution evidence")).getByText(requestText)).toBeTruthy()
    expect(screen.getByLabelText("Proposed patch").textContent).toContain("The local AI loop")
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
