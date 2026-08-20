/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { EnvironmentRoot } from "@/components/environment-root/environment-root"
import { EnvironmentSignIn } from "@/components/environment-root/environment-sign-in"
import type { EnvironmentSurfaceDto, EnvironmentWorldDto } from "@/lib/environment/api-contract"
import type { WorldEndpointIdentity } from "@/lib/environment/world-projection"

const navigation = { replace: vi.fn(), refresh: vi.fn() }
const auth = vi.hoisted(() => ({ signInEmail: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => navigation }))
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { email: auth.signInEmail } } }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  navigation.replace.mockReset()
  navigation.refresh.mockReset()
  auth.signInEmail.mockReset()
})

describe("greenfield Environment rendered root", () => {
  it("starts empty with one Line and no Project selection or operator vocabulary", () => {
    render(<EnvironmentRoot initialWorld={null} />)

    expect(screen.getByRole("heading", { name: "What are we working on?" })).toBeTruthy()
    expect(screen.getAllByRole("textbox", { name: "The Line" })).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/Project|Work Order|Goal|queue|provider|branch/i)
  })

  it("renders the server-restored world immediately without a client restoration fetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const restored = world({
      intent: "Continue the release notes",
      conversation: [turn("owner", "Where were we?"), turn("williamos", "The release notes are open at the last reviewed paragraph.")],
    })

    render(<EnvironmentRoot initialWorld={restored} />)

    expect(screen.getByRole("heading", { name: "Continue the release notes" })).toBeTruthy()
    expect(screen.getByText("The release notes are open at the last reviewed paragraph.")).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("renders Job 1 only from bound browser, trace, diff, and test artifacts", () => {
    const app = endpoint("endpoint-app", "https://sandbox.example.test/app")
    const jobOne = world({
      endpoints: [app],
      surfaces: [
        surface("browser", app.appUrl, { title: "Reproduced application", content: { url: app.appUrl } }),
        surface("trace", "trace://auth-run", { title: "Observed request trace", content: { lines: ["GET /sign-in 200", "POST /session 303"] } }),
        surface("diff", "artifact://fix.diff", { title: "Observed fix", artifactRef: "artifact://fix.diff", content: { patch: "- return 500\n+ return 401" } }),
        surface("tests", "stream://tests/rerun", { title: "Observed rerun", status: "passed", artifactRef: "run://tests/42", content: { summary: "2 tests passed", cases: [{ name: "rejects anonymous request", status: "passed" }] } }),
      ],
      execution: { state: "observed_succeeded", summary: "Rerun passed on the admitted endpoint.", endpointId: app.id, evidenceRefs: ["evidence://rerun/42"] },
    })

    render(<EnvironmentRoot initialWorld={jobOne} />)

    const frame = screen.getByTitle("Reproduced application")
    expect(frame.getAttribute("src")).toBe(app.appUrl)
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin")
    expect(screen.getByText("GET /sign-in 200")).toBeTruthy()
    expect(screen.getByText("+ return 401")).toBeTruthy()
    expect(screen.getByText("Rerun passed on the admitted endpoint.")).toBeTruthy()
    expect(screen.getByText("Artifact run://tests/42")).toBeTruthy()
  })

  it("renders Job 4 as two isolated runnable applications with comparison and conflict truth", () => {
    const left = endpoint("endpoint-left", "https://sandbox.example.test/left")
    const right = endpoint("endpoint-right", "https://sandbox.example.test/right")
    const comparison = world({
      endpoints: [left, right],
      surfaces: [
        surface("compare", "comparison://left-right", { title: "Observed comparison", artifactRef: "artifact://comparison/7", content: { left: "baseline", right: "candidate", summary: "The candidate removes one unnecessary step." } }),
        surface("browser", left.appUrl, { title: "Baseline application", endpointId: left.id }),
        surface("browser", right.appUrl, { title: "Candidate application", endpointId: right.id }),
        surface("conflict", "conflict://left-right", { title: "Observed conflicts", artifactRef: "artifact://conflicts/7", content: { conflicts: ["Both change the account recovery sentence."] } }),
      ],
    })

    render(<EnvironmentRoot initialWorld={comparison} />)

    const surfaces = screen.getByRole("region", { name: "Working surfaces" })
    expect(within(surfaces).getAllByTitle(/application$/)).toHaveLength(2)
    expect(screen.getByText("The candidate removes one unnecessary step.")).toBeTruthy()
    expect(screen.getByText("Both change the account recovery sentence.")).toBeTruthy()
    expect(screen.getByText("Artifact artifact://comparison/7")).toBeTruthy()
    expect(screen.getByText("Artifact artifact://conflicts/7")).toBeTruthy()
  })

  it("preserves restored context and the draft when the Line request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"))
    const user = userEvent.setup()
    render(<EnvironmentRoot initialWorld={world({ intent: "Keep this context", conversation: [turn("williamos", "The current paragraph is still open.")] })} />)

    const line = screen.getByRole("textbox", { name: "The Line" }) as HTMLTextAreaElement
    await user.type(line, "Please continue from there")
    await user.click(screen.getByRole("button", { name: "Send" }))

    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Keep this context" })).toBeTruthy()
    expect(screen.getByText("The current paragraph is still open.")).toBeTruthy()
    expect(line.value).toBe("Please continue from there")
  })

  it("replaces its interaction cache only with the complete authoritative reply", async () => {
    const current = world({ intent: "First context", conversation: [turn("owner", "First sentence")] })
    const next = world({ worldId: "world-next", intent: "Updated context", conversation: [turn("owner", "Continue"), turn("williamos", "The observed update is ready.")] })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ state: "continued", say: "The observed update is ready.", world: next }), { status: 200, headers: { "content-type": "application/json" } }))
    const user = userEvent.setup()
    render(<EnvironmentRoot initialWorld={current} />)

    await user.type(screen.getByRole("textbox", { name: "The Line" }), "Continue")
    await user.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(screen.getByRole("heading", { name: "Updated context" })).toBeTruthy())
    expect(screen.queryByText("First sentence")).toBeNull()
    expect(screen.getByText("The observed update is ready.")).toBeTruthy()
  })

  it("learns about runtime progress without losing the owner's draft or focus", async () => {
    const current = world({ intent: "Waiting for the running copy", status: "waiting_for_execution_endpoint" })
    const next = world({
      intent: current.intent,
      status: "ready",
      lastUpdatedAt: "2026-08-20T18:01:00.000Z",
      conversation: [turn("williamos", "The verified running copy is ready.")],
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ world: next }), { status: 200, headers: { "content-type": "application/json" } }),
    )
    const user = userEvent.setup()
    render(<EnvironmentRoot initialWorld={current} />)
    const line = screen.getByRole("textbox", { name: "The Line" }) as HTMLTextAreaElement
    await user.type(line, "Keep this exact thought")

    window.dispatchEvent(new Event("online"))

    await waitFor(() => expect(screen.getByText("The verified running copy is ready.")).toBeTruthy())
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/environment/world?worldId=world-1",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    )
    expect(line.value).toBe("Keep this exact thought")
    expect(document.activeElement).toBe(line)
  })

  it("labels waiting surfaces honestly when no content or admitted endpoint exists", () => {
    const waiting = world({
      status: "waiting_for_execution_endpoint",
      surfaces: [surface("browser", "https://unadmitted.example.test", { status: "waiting", title: "Preview" }), surface("tests", "stream://pending", { status: "waiting", title: "Tests" })],
    })
    render(<EnvironmentRoot initialWorld={waiting} />)

    expect(screen.getByText("Waiting for an admitted, reachable preview.")).toBeTruthy()
    expect(screen.getByText("No test run has been observed for this endpoint.")).toBeTruthy()
    expect(screen.getByText("Preparing the working world")).toBeTruthy()
    expect(document.body.textContent).not.toContain("waiting for execution endpoint")
    expect(document.body.textContent).not.toMatch(/passed|succeeded/i)
  })

  it("keeps production imports and entry paths outside the legacy shell", () => {
    const files = [
      "app/environment/page.tsx",
      "app/environment/sign-in/page.tsx",
      "components/environment-root/environment-root.tsx",
      "components/environment-root/environment-surface.tsx",
      "components/environment-root/environment-sign-in.tsx",
    ]
    const source = files.map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n")

    expect(source).not.toMatch(/WorkbenchShell|components\/shell|components\/environment\/|AuthForm|AuthAside|credentialless/)
    expect(readFileSync(join(process.cwd(), "app/environment/page.tsx"), "utf8")).toContain('redirect("/environment/sign-in")')
    expect(readFileSync(join(process.cwd(), "app/environment/page.tsx"), "utf8")).toContain("loadCurrentEnvironmentWorld")
    expect(readFileSync(join(process.cwd(), "app/env/page.tsx"), "utf8")).toContain('redirect("/environment")')
    expect(existsSync(join(process.cwd(), "app/api/env/line/route.ts"))).toBe(false)
    expect(existsSync(join(process.cwd(), "components/environment/environment.tsx"))).toBe(false)
  })

  it("opens the Environment directly after greenfield sign-in", async () => {
    auth.signInEmail.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    render(<EnvironmentSignIn />)

    await user.type(screen.getByRole("textbox", { name: "Email" }), "owner@example.test")
    await user.type(screen.getByLabelText("Password"), "password123")
    await user.click(screen.getByRole("button", { name: "Open environment" }))

    await waitFor(() => expect(auth.signInEmail).toHaveBeenCalledWith({ email: "owner@example.test", password: "password123" }))
    expect(navigation.replace).toHaveBeenCalledWith("/environment")
    expect(navigation.refresh).toHaveBeenCalled()
  })
})

function endpoint(id: string, appUrl: string): WorldEndpointIdentity {
  return {
    id,
    worldId: "world-1",
    resourceIdentity: "resource://example",
    sandboxId: `sandbox-${id}`,
    probeUrl: appUrl,
    appUrl,
    branch: `sandbox/${id}`,
    head: `0123456789abcdef-${id}`,
    filesystemRoot: `/isolated/${id}`,
    terminalStreamRef: `stream://terminal/${id}`,
    testStreamRef: `stream://tests/${id}`,
    provenance: {
      source: "execution_receipt",
      evidenceRef: `evidence://${id}`,
      capturedAt: "2026-08-20T18:00:00.000Z",
      liveness: {
        status: "reachable", httpStatus: 200, observedAt: "2026-08-20T18:00:00.000Z", evidenceRef: `evidence://live/${id}`,
        publicRoute: {
          status: "reachable", httpStatus: 200, observedAt: "2026-08-20T18:00:00.000Z", evidenceRef: `evidence://live/${id}`,
        },
      },
    },
  }
}

function surface(
  kind: EnvironmentSurfaceDto["kind"],
  subject: string,
  options: Partial<EnvironmentSurfaceDto> & { artifactRef?: string } = {},
): EnvironmentSurfaceDto {
  const { artifactRef, ...surfaceOptions } = options
  return {
    id: `${kind}:${subject}`,
    kind,
    subject,
    endpointId: "endpoint-app",
    status: "ready",
    provenance: {
      source: "execution_evidence",
      observedAt: "2026-08-20T18:00:00.000Z",
      evidenceRef: `evidence://${kind}`,
      ...(artifactRef ? { artifactRef } : {}),
    },
    ...surfaceOptions,
  }
}

function turn(role: "owner" | "williamos", content: string): EnvironmentWorldDto["conversation"][number] {
  return { id: `${role}:${content}`, role, content, at: "2026-08-20T18:00:00.000Z" }
}

function world(overrides: Partial<EnvironmentWorldDto> = {}): EnvironmentWorldDto {
  return {
    worldId: "world-1",
    intent: "A restored working world",
    assumption: null,
    resource: { recordId: 1, candidateId: "candidate-1", canonicalIdentity: "resource://example", label: "The selected application" },
    conversation: [],
    surfaces: [],
    endpoints: [],
    status: "ready",
    execution: { state: "not_started", evidenceRefs: [] },
    lastUpdatedAt: "2026-08-20T18:00:00.000Z",
    ...overrides,
  }
}
