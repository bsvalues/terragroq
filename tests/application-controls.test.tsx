// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

type AppliedActivationResult = Readonly<{ outcome: "activated" | "start-required" | "failed"; message?: string }>
let activateAppliedCommit: ((appliedCommit: string) => Promise<AppliedActivationResult>) | undefined

vi.mock("@/components/workspace-shell/hello-application-assistant", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/workspace-shell/hello-application-assistant")>()
  return {
    ...original,
    ApplicationAssistant: ({
      project,
      onApplied,
    }: {
      project: { name: string }
      onApplied?: (appliedCommit: string) => Promise<AppliedActivationResult>
    }) => {
      activateAppliedCommit = onApplied
      return <div>Assistant for {project.name}</div>
    },
    HelloApplicationAssistant: ({ project }: { project: { name: string } }) => <div>Assistant for {project.name}</div>,
  }
})

import { ApplicationControls } from "@/components/workspace-shell/hello-application-controls"
import {
  adaptApplicationProposal,
  adaptApplicationRuntimePayload,
  parseApplicationManifestPayload,
} from "@/components/workspace-shell/application-ui-contract"
import type { ApplicationVisibleWorkspaceProject } from "@/lib/projects/workspace-project-key"
import { projectHelloApplicationRuntime } from "@/lib/hello-application/runtime-projection"

const project: ApplicationVisibleWorkspaceProject = {
  key: "focus-board",
  name: "Focus Board",
  kind: "application",
  preview: "contained",
  application: {
    contract: "generic-v4",
    manifestUrl: "/api/projects/focus-board/application-manifest",
    runtimeUrl: "/api/projects/focus-board/application-runtime",
    previewUrl: "/api/projects/focus-board/application-preview",
    executionRoutesUrl: "/api/projects/focus-board/application-execution-routes",
    proposalsUrl: "/api/projects/focus-board/application-proposals",
    rejectMethod: "PATCH",
    writablePaths: null,
    validationCommand: "node --test test/application.test.mjs",
  },
}

const legacyProject: ApplicationVisibleWorkspaceProject = {
  ...project,
  key: "legacy-sample",
  name: "Legacy sample",
  application: {
    ...project.application,
    contract: "legacy-v1-v3",
    manifestUrl: null,
    runtimeUrl: "/api/projects/legacy-sample/runtime",
    previewUrl: "/api/projects/legacy-sample/preview",
    executionRoutesUrl: "/api/projects/legacy-sample/execution-routes",
    proposalsUrl: "/api/projects/legacy-sample/proposals",
    writablePaths: ["legacy/app.js", "legacy/index.html", "legacy/styles.css"],
    validationCommand: "node --test legacy/test.mjs",
    rejectMethod: "DELETE",
  },
}

const manifest = {
  schemaVersion: 1,
  id: "focus-board",
  displayName: "Focus Board",
  adapter: "static-web-v1",
  source: {
    document: "src/index.html",
    styles: "src/styles.css",
    script: "src/app.js",
    test: "test/application.test.mjs",
  },
  ai: { writablePaths: ["src/index.html", "src/styles.css", "src/app.js"] },
} as const

function genericRuntimePayload(
  observed: "starting" | "running" | "stopped" | "unavailable" | "mismatch" | "failed",
  sourceHead = "d".repeat(40),
  error: string | null = null,
) {
  return {
    runtime: {
      schemaVersion: 1,
      applicationId: "focus-board",
      desired: observed === "running" || observed === "starting" ? "running" : "stopped",
      observed,
      policyDigest: "a".repeat(64),
      recipeDigest: "b".repeat(64),
      containerName: "williamos-application-focus-board",
      active: observed === "running" ? {
        generation: "c".repeat(64), sourceHead, manifestDigest: "e".repeat(64),
        sourceDigest: "f".repeat(64), artifactSha256: "1".repeat(64), imageId: `sha256:${"2".repeat(64)}`,
        staticImageId: `sha256:${"3".repeat(64)}`, containerId: "4".repeat(64), validated: true,
      } : null,
      retiring: null,
      updatedAt: "2026-09-21T00:00:00.000Z",
      error,
    },
    truth: { runtimeBuild: { sha: "5".repeat(40), builtAt: null }, activeProjectHead: sourceHead },
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  activateAppliedCommit = undefined
})

describe("shared application UI contracts", () => {
  it("strictly adapts generic runtime and manifest payloads", () => {
    const runtime = adaptApplicationRuntimePayload(project, {
      runtime: {
        schemaVersion: 1,
        applicationId: "focus-board",
        desired: "running",
        observed: "running",
        policyDigest: "a".repeat(64),
        recipeDigest: "b".repeat(64),
        containerName: "williamos-application-focus-board",
        active: {
          generation: "c".repeat(64), sourceHead: "d".repeat(40), manifestDigest: "e".repeat(64),
          sourceDigest: "f".repeat(64), artifactSha256: "1".repeat(64), imageId: `sha256:${"2".repeat(64)}`,
          staticImageId: `sha256:${"3".repeat(64)}`, containerId: "4".repeat(64), validated: true,
        },
        retiring: null,
        updatedAt: "2026-09-21T00:00:00.000Z",
        error: null,
      },
      truth: { runtimeBuild: { sha: "5".repeat(40), builtAt: null }, activeProjectHead: "d".repeat(40) },
    })
    expect(runtime).toMatchObject({
      state: "running",
      previewAvailable: true,
      activeProjectHead: "d".repeat(40),
      activeSourceHead: "d".repeat(40),
    })
    expect(parseApplicationManifestPayload(project, { manifest, manifestDigest: "e".repeat(64), head: "d".repeat(40) }))
      .toMatchObject({ displayName: "Focus Board", writablePaths: manifest.ai.writablePaths })
    expect(() => adaptApplicationRuntimePayload(project, {
      runtime: { state: "running", pid: 42, url: "/legacy" },
      truth: { runtimeBuild: { sha: "5".repeat(40), builtAt: null }, activeProjectHead: "d".repeat(40) },
    })).toThrow("APPLICATION_RUNTIME_RESPONSE_INVALID")
    expect(adaptApplicationRuntimePayload(legacyProject, {
      runtime: { state: "running", pid: 42, url: "/legacy", error: null },
      truth: { runtimeBuild: { sha: "5".repeat(40), builtAt: null }, activeProjectHead: "d".repeat(40) },
    })).toMatchObject({ state: "running", previewAvailable: true })
  })

  it("strictly adapts generic v4 and legacy v1-v3 receipts into one presentation", async () => {
    const generic = {
      schemaVersion: 4,
      proposalId: "11111111-1111-4111-8111-111111111111",
      applicationId: "focus-board",
      manifestDigest: "a".repeat(64), repositoryDigest: "b".repeat(64),
      writablePaths: [...manifest.ai.writablePaths], status: "READY_FOR_REVIEW",
      requestedBy: "owner", requestText: "Add reset behavior", requestSha256: "c".repeat(64),
      executionRoute: "hermes-local", executionProvider: "hermes-local", executionNode: "hermes-node",
      model: "williamos-qwen3-4b:64k", threadId: "thread-1", turnId: "turn-1", providerExecution: null,
      progress: [
        ["accepted", "Request accepted"],
        ["workspace_ready", "Isolated application workspace ready"],
        ["resident_started", "HERMES AI is editing the isolated application workspace"],
        ["resident_finished", "HERMES AI editing finished"],
        ["validation_started", "Contained application validation started"],
        ["ready_for_review", "Application proposal ready for review"],
      ].map(([stage, detail], index) => ({ stage, detail, at: `2026-09-21T00:00:0${index}.000Z` })),
      createdAt: "2026-09-21T00:00:00.000Z", baseSha: "d".repeat(40), candidateSha: "e".repeat(40),
      baseRef: "refs/heads/main", branch: "codex/williamos-app-focus-board-11111111-1111-4111-8111-111111111111",
      changedPaths: ["src/app.js"], patchSha256: "f".repeat(64),
      validation: { status: "passed", command: "node --test test/application.test.mjs", output: "ok" },
      appliedAt: null, appliedCommit: null, rejectedAt: null, rejectionReason: null,
      applyStartedAt: null, applyToken: null, applyProcessId: null, quarantinedAt: null, quarantineReason: null,
      reviewPatch: "diff --git a/src/app.js b/src/app.js\n",
    }
    // The digest fields are intentionally wrong for the human-readable strings; the strict adapter
    // validates structure synchronously and the assistant separately verifies browser digests.
    expect(adaptApplicationProposal(project, generic)).toMatchObject({
      schemaVersion: 4,
      applicationId: "focus-board",
      status: "READY_FOR_REVIEW",
      requestText: "Add reset behavior",
      changedPaths: ["src/app.js"],
    })
    expect(() => adaptApplicationProposal(project, { ...generic, model: "unverified-model" }))
      .toThrow("APPLICATION_PROPOSAL_RESPONSE_INVALID")
    expect(() => adaptApplicationProposal(legacyProject, generic)).toThrow("APPLICATION_PROPOSAL_RESPONSE_INVALID")
    const applied = {
      ...generic,
      status: "APPLIED",
      appliedAt: "2026-09-21T00:00:06.000Z",
      appliedCommit: generic.candidateSha,
    }
    const rejected = {
      ...generic,
      status: "REJECTED",
      rejectedAt: "2026-09-21T00:00:06.000Z",
      rejectionReason: "Superseded by a new request.",
    }
    expect(adaptApplicationProposal(project, applied)).toMatchObject({ status: "APPLIED", reviewPatch: generic.reviewPatch })
    expect(adaptApplicationProposal(project, rejected)).toMatchObject({ status: "REJECTED", reviewPatch: generic.reviewPatch })
    expect(adaptApplicationProposal(project, { ...applied, reviewPatch: null })).toMatchObject({ status: "APPLIED", reviewPatch: null })
    expect(adaptApplicationProposal(project, { ...rejected, reviewPatch: null })).toMatchObject({ status: "REJECTED", reviewPatch: null })
    const legacy = {
      schemaVersion: 2,
      proposalId: "22222222-2222-4222-8222-222222222222",
      status: "READY_FOR_REVIEW",
      requestedBy: "owner",
      requestText: "Change the legacy sample",
      requestSha256: "1".repeat(64),
      executionNode: "hermes-node",
      progress: [
        ["accepted", "Request accepted"],
        ["workspace_ready", "Isolated workspace ready"],
        ["resident_started", "HERMES is editing the isolated workspace"],
        ["resident_finished", "HERMES editing finished"],
        ["validation_started", "Contained validation started"],
        ["ready_for_review", "Proposal ready for review"],
      ].map(([stage, detail], index) => ({ stage, detail, at: `2026-09-21T00:00:0${index}.000Z` })),
      createdAt: "2026-09-21T00:00:00.000Z",
      appliedAt: null,
      appliedCommit: null,
      baseSha: "2".repeat(40),
      proposalCommit: "3".repeat(40),
      branch: "codex/hermes-hello-22222222-2222-4222-8222-222222222222",
      changedPaths: ["legacy/index.html", "legacy/styles.css"],
      patchSha256: "4".repeat(64),
      threadId: "thread-legacy",
      turnId: "turn-legacy",
      model: "williamos-qwen3-4b:64k",
      validation: { status: "passed", command: "node --test legacy/test.mjs", output: "ok" },
      reviewPatch: "diff --git a/legacy/index.html b/legacy/index.html\n",
    }
    expect(adaptApplicationProposal(legacyProject, legacy)).toMatchObject({
      schemaVersion: 2,
      status: "READY_FOR_REVIEW",
      changedPaths: ["legacy/index.html", "legacy/styles.css"],
    })
  })
})

describe("ApplicationControls", () => {
  it("uses metadata endpoints and shows runtime state with full build and project identities", async () => {
    const onRuntimeStateChange = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      runtime: {
        schemaVersion: 1, applicationId: "focus-board", desired: "running", observed: "running",
        policyDigest: "a".repeat(64), recipeDigest: "b".repeat(64), containerName: "williamos-application-focus-board",
        active: { generation: "c".repeat(64), sourceHead: "d".repeat(40), manifestDigest: "e".repeat(64), sourceDigest: "f".repeat(64), artifactSha256: "1".repeat(64), imageId: `sha256:${"2".repeat(64)}`, staticImageId: `sha256:${"3".repeat(64)}`, containerId: "4".repeat(64), validated: true },
        retiring: null, updatedAt: "2026-09-21T00:00:00.000Z", error: null,
      },
      truth: { runtimeBuild: { sha: "5".repeat(40), builtAt: null }, activeProjectHead: "d".repeat(40) },
    }))
    vi.stubGlobal("fetch", fetcher)

    render(<ApplicationControls project={project} onPreviewRefresh={vi.fn()} onRuntimeStateChange={onRuntimeStateChange} />)

    const truth = await screen.findByLabelText("Focus Board runtime truth")
    expect(truth.textContent).toContain("5".repeat(40))
    expect(truth.textContent).toContain("d".repeat(40))
    expect(screen.getByText("Runtime running", { exact: false })).toBeTruthy()
    expect(screen.getByText("Assistant for Focus Board")).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith(project.application.runtimeUrl, { cache: "no-store" })
    await waitFor(() => expect(onRuntimeStateChange).toHaveBeenCalledWith("running"))
    fireEvent.click(screen.getByRole("button", { name: "Stop application" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(project.application.runtimeUrl, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
    }))
  })

  it("rebuilds a previously proven running runtime after Apply and only refreshes after the new head is active", async () => {
    const oldHead = "d".repeat(40)
    const appliedHead = "6".repeat(40)
    let resolveActivation!: (value: Response) => void
    const activationResponse = new Promise<Response>((resolve) => { resolveActivation = resolve })
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Response.json(genericRuntimePayload("running", oldHead))
      if (init.method === "POST") return activationResponse
      return Response.json({ error: "UNEXPECTED" }, { status: 500 })
    })
    const onPreviewRefresh = vi.fn()
    const onRuntimeStateChange = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationControls project={project} onPreviewRefresh={onPreviewRefresh} onRuntimeStateChange={onRuntimeStateChange} />)

    expect(await screen.findByText("Runtime running", { exact: false })).toBeTruthy()
    expect(activateAppliedCommit).toBeTypeOf("function")
    const activation = activateAppliedCommit!(appliedHead)
    await waitFor(() => expect(onRuntimeStateChange).toHaveBeenLastCalledWith("starting"))
    expect(screen.queryByLabelText("Focus Board runtime truth")).toBeNull()
    expect(onPreviewRefresh).not.toHaveBeenCalled()

    resolveActivation(Response.json(genericRuntimePayload("running", appliedHead)))
    await expect(activation).resolves.toEqual({ outcome: "activated" })
    await waitFor(() => expect(onRuntimeStateChange).toHaveBeenLastCalledWith("running"))
    expect(screen.getByLabelText("Focus Board runtime truth").textContent).toContain(appliedHead)
    expect(onPreviewRefresh).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(project.application.runtimeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
    })
  })

  it("does not silently start a stopped runtime after Apply", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(genericRuntimePayload("stopped")))
    const onPreviewRefresh = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationControls project={project} onPreviewRefresh={onPreviewRefresh} />)

    expect(await screen.findByText("Runtime stopped", { exact: false })).toBeTruthy()
    expect(await activateAppliedCommit!("6".repeat(40))).toEqual({ outcome: "start-required" })
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0)
    expect(onPreviewRefresh).not.toHaveBeenCalled()
  })

  it("keeps the Apply outcome separate when rebuilding the previously running runtime fails", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Response.json(genericRuntimePayload("running"))
      return Response.json({ error: "APPLICATION_RUNTIME_UNAVAILABLE" }, { status: 503 })
    })
    const onRuntimeStateChange = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<ApplicationControls project={project} onPreviewRefresh={vi.fn()} onRuntimeStateChange={onRuntimeStateChange} />)

    expect(await screen.findByText("Runtime running", { exact: false })).toBeTruthy()
    await expect(activateAppliedCommit!("6".repeat(40))).resolves.toEqual({
      outcome: "failed",
      message: "The source change is applied, but the contained runtime could not be rebuilt. Use Start application to retry.",
    })
    await waitFor(() => expect(onRuntimeStateChange).toHaveBeenLastCalledWith("unavailable"))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shows admitted runtime failure detail in safe human wording", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      genericRuntimePayload("mismatch", "d".repeat(40), "APPLICATION_RUNTIME_POLICY_MISMATCH"),
    )))
    render(<ApplicationControls project={project} onPreviewRefresh={vi.fn()} />)

    const detail = await screen.findByText(/runtime policy no longer matches/i)
    expect(detail.textContent).not.toContain("APPLICATION_RUNTIME_POLICY_MISMATCH")
  })

  it.each([
    ["HELLO_APPLICATION_EXITED:17", /Hello Application runtime exited unexpectedly/i],
    ["HELLO_APPLICATION_START_TIMEOUT", /Hello Application runtime did not become ready in time/i],
  ])("humanizes projected legacy failure %s without rendering its code or detail", async (supervisorError, expected) => {
    const runtime = projectHelloApplicationRuntime({
      state: "failed",
      host: "127.0.0.1",
      port: null,
      url: null,
      pid: null,
      workspaceRoot: "C:/runtime/source/examples/hello-application",
      startedAt: null,
      error: supervisorError,
      logs: ["C:/secret/runtime/source/server.mjs failed"],
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      runtime,
      truth: { runtimeBuild: { sha: "5".repeat(40), builtAt: null }, activeProjectHead: "d".repeat(40) },
    })))
    render(<ApplicationControls project={legacyProject} onPreviewRefresh={vi.fn()} />)

    expect(await screen.findByText(expected)).toBeTruthy()
    expect(screen.queryByText(runtime.error ?? "missing error")).toBeNull()
    expect(document.body.textContent).not.toContain("secret")
  })
})
