// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { HelloApplicationControls } from "@/components/workspace-shell/hello-application-controls"

const readyProposal = {
  proposalId: "11111111-1111-4111-8111-111111111111",
  status: "READY_FOR_REVIEW",
  model: "williamos-qwen3-4b:64k",
  threadId: "thread-1",
  turnId: "turn-1",
  patchSha256: "a".repeat(64),
  changedPaths: [
    "examples/hello-application/src/index.html",
    "examples/hello-application/src/styles.css",
  ],
  validation: { status: "passed", command: "node --test examples/hello-application/test/hello.test.mjs" },
  reviewPatch: "diff --git a/examples/hello-application/src/index.html b/examples/hello-application/src/index.html\n+<span>Governed by HERMES</span>\n",
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("HelloApplicationControls", () => {
  it("shows runtime truth and preserves review as a separate step before apply", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/runtime") && (!init?.method || init.method === "GET")) {
        return Response.json({ runtime: { state: "stopped", pid: null, url: null } })
      }
      if (url.endsWith("/proposals") && (!init?.method || init.method === "GET")) {
        return Response.json({ proposals: [] })
      }
      if (url.endsWith("/runtime") && init?.method === "POST") {
        return Response.json({ runtime: { state: "running", pid: 42, url: "http://127.0.0.1:4317/" } })
      }
      if (url.endsWith("/proposals") && init?.method === "POST") {
        return Response.json({ proposal: readyProposal }, { status: 201 })
      }
      if (url.endsWith("/apply") && init?.method === "POST") {
        return Response.json({ proposal: { ...readyProposal, status: "APPLIED" } })
      }
      throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`)
    })
    vi.stubGlobal("fetch", fetcher)
    const onPreviewRefresh = vi.fn()

    render(<HelloApplicationControls onPreviewRefresh={onPreviewRefresh} />)
    await screen.findByText("Runtime stopped")

    fireEvent.click(screen.getByRole("button", { name: "Start application" }))
    await screen.findByText("Runtime running")

    fireEvent.click(screen.getByRole("button", { name: "Prepare governed change" }))
    await screen.findByText("Ready for review")
    expect(screen.getByText("index.html")).toBeTruthy()
    expect(screen.getByText("styles.css")).toBeTruthy()
    expect(screen.getByText(/williamos-qwen3-4b/)).toBeTruthy()
    expect(screen.getByLabelText("Proposed patch").textContent).toContain("Governed by HERMES")
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "Apply proposal" }))
    await screen.findByText("Applied")
    await waitFor(() => expect(onPreviewRefresh).toHaveBeenCalledTimes(2))
  })
})
