// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ExternalWorkOrderAdmission } from "@/components/workspace-shell/external-work-order-admission"
import { DeliveryAdoption } from "@/components/workspace-shell/delivery-adoption"

const worldId = "space-adoption"
const headSha = "8df3d10a2060abe6f51282c5391c7b5723f788da"
const previewDigest = "a".repeat(64)

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("prospective delivery adoption UI", () => {
  it("continues from admitted work into exact-artifact delivery without editable authority inputs", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: "DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND" }, 409))
      .mockResolvedValueOnce(response({
        status: "READY_FOR_CONFIRMATION",
        worldId,
        provenanceDigest: "b".repeat(64),
        externalWorkOrder: {
          source: "github",
          externalRef: "https://github.com/bsvalues/terragroq/issues/1117",
          title: "Deliver seamless continuation",
          objective: "Deliver the exact reviewed WilliamOS artifact.",
          repository: "bsvalues/terragroq",
          authorityEvidence: ["owner-authorized:1117"],
          reservedPaths: ["components/workspace-shell/example.tsx"],
          validators: ["pnpm test"],
          acceptanceCriteria: ["Exact reviewed head is delivered."],
          pullRequest: { number: 1117, headSha },
        },
      }))
      .mockResolvedValueOnce(response({
        status: "ADMITTED",
        replayed: false,
        worldId,
        outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
        workOrder: { id: 1117, ref: "WO-1117", externalRef: "https://github.com/bsvalues/terragroq/issues/1117" },
        authority: { level: "A2_WRITE_OWN", grantRef: "grant-1117" },
        reservedPaths: ["components/workspace-shell/example.tsx"],
        provenanceDigest: "b".repeat(64),
      }, 201))
      .mockResolvedValueOnce(response({
        status: "READY_FOR_CONFIRMATION",
        worldId,
        pullRequest: 1117,
        headSha,
        paths: ["components/workspace-shell/example.tsx"],
        previewDigest,
      }))
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" })

    render(<ExternalWorkOrderAdmission worldId={worldId} persisted />)
    await user.click(screen.getByRole("button", { name: "Admit external work" }))
    await screen.findByLabelText("External Work Order reference")
    fireEvent.change(screen.getByLabelText("External Work Order reference"), { target: { value: "https://github.com/bsvalues/terragroq/issues/1117" } })
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Deliver seamless continuation" } })
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Deliver the exact reviewed WilliamOS artifact." } })
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "bsvalues/terragroq" } })
    fireEvent.change(screen.getByLabelText(/Authority evidence/), { target: { value: "owner-authorized:1117" } })
    fireEvent.change(screen.getByLabelText(/Reserved paths/), { target: { value: "components/workspace-shell/example.tsx" } })
    fireEvent.change(screen.getByLabelText(/Pull request number/), { target: { value: "1117" } })
    fireEvent.change(screen.getByLabelText("Exact head SHA"), { target: { value: headSha } })
    fireEvent.change(screen.getByLabelText(/Validators/), { target: { value: "pnpm test" } })
    fireEvent.change(screen.getByLabelText(/Acceptance criteria/), { target: { value: "Exact reviewed head is delivered." } })

    await user.click(screen.getByRole("button", { name: "Review packet" }))
    await user.click(await screen.findByRole("button", { name: "Admit to this Space" }))

    expect(await screen.findByText("Adopt an existing exact artifact")).toBeTruthy()
    expect(screen.getByText(/does not claim the historical edits were assigned/i)).toBeTruthy()
    expect(screen.queryByLabelText(/head sha|reserved paths|grant|validation|review/i)).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({ mode: "PREVIEW", worldId })
  })

  it("authorizes, validates, and seals without sending browser-authored artifact or authority fields", async () => {
    const user = userEvent.setup()
    const idempotencyKey = "11111111-1111-4111-8111-111111111111"
    const adoptionHash = "c".repeat(64)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: "READY_FOR_CONFIRMATION", worldId, pullRequest: 1117, headSha, paths: ["app/a.ts", "lib/b.ts"], previewDigest }))
      .mockResolvedValueOnce(response({ status: "AUTHORIZED", worldId, pullRequest: 1117, headSha, paths: ["app/a.ts", "lib/b.ts"], previewDigest, idempotencyKey, adoptionHash, authorizationEventId: 101 }, 201))
      .mockResolvedValueOnce(response({ status: "SEALED", worldId, pullRequest: 1117, headSha, paths: ["app/a.ts", "lib/b.ts"], previewDigest, adoptionHash, seal: { payload: { version: "williamos-delivery-seal.v2" }, signature: "signed" } }))
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("crypto", { randomUUID: () => idempotencyKey })

    render(<DeliveryAdoption worldId={worldId} />)
    await user.click(await screen.findByRole("button", { name: "Authorize exact artifact" }))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      mode: "AUTHORIZE",
      worldId,
      confirmedPreviewDigest: previewDigest,
      idempotencyKey,
    })

    await user.click(await screen.findByRole("button", { name: "Validate exact head and issue seal" }))
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      mode: "ISSUE",
      worldId,
      idempotencyKey,
    })
    expect(await screen.findByText(/delivery seal is issued/i)).toBeTruthy()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("restores persisted authorization from preview after reload and resumes at exact-head validation", async () => {
    const user = userEvent.setup()
    const idempotencyKey = "22222222-2222-4222-8222-222222222222"
    const adoptionHash = "d".repeat(64)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        status: "AUTHORIZED",
        worldId,
        pullRequest: 1117,
        headSha,
        paths: ["app/a.ts", "lib/b.ts"],
        previewDigest,
        idempotencyKey,
        adoptionHash,
        authorizationEventId: 101,
      }))
      .mockResolvedValueOnce(response({ status: "SEALED", worldId, pullRequest: 1117, headSha, paths: ["app/a.ts", "lib/b.ts"], previewDigest, adoptionHash, seal: { payload: { version: "williamos-delivery-seal.v2" }, signature: "signed" } }))
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("crypto", { randomUUID: () => idempotencyKey })

    render(<DeliveryAdoption worldId={worldId} />)
    expect(await screen.findByRole("button", { name: "Validate exact head and issue seal" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Authorize exact artifact" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Validate exact head and issue seal" }))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      mode: "ISSUE",
      worldId,
      idempotencyKey,
    })
  })

  it("restores a persisted seal from preview without issuing it again", async () => {
    const adoptionHash = "e".repeat(64)
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      status: "SEALED",
      worldId,
      pullRequest: 1117,
      headSha,
      paths: ["app/a.ts", "lib/b.ts"],
      previewDigest,
      adoptionHash,
      seal: { payload: { version: "williamos-delivery-seal.v2" }, signature: "signed" },
    }))
    vi.stubGlobal("fetch", fetchMock)

    render(<DeliveryAdoption worldId={worldId} />)
    expect(await screen.findByText(/delivery seal is issued/i)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(screen.queryByRole("button", { name: /authorize|issue seal/i })).toBeNull()
  })

  it("restores an admitted artifact when the dialog reopens after a page reload", async () => {
    const adoptionHash = "f".repeat(64)
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      status: "AUTHORIZED",
      worldId,
      pullRequest: 1117,
      headSha,
      paths: ["app/a.ts", "lib/b.ts"],
      previewDigest,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      adoptionHash,
      authorizationEventId: 101,
    }))
    vi.stubGlobal("fetch", fetchMock)

    render(<ExternalWorkOrderAdmission worldId={worldId} persisted />)
    await userEvent.click(screen.getByRole("button", { name: "Admit external work" }))

    expect(await screen.findByRole("button", { name: "Validate exact head and issue seal" })).toBeTruthy()
    expect(screen.getByText(headSha)).toBeTruthy()
    expect(screen.queryByLabelText("External Work Order reference")).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ mode: "PREVIEW", worldId })
  })
})
