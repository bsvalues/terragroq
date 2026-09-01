import { beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  deriveCodexAssignment: vi.fn(),
  deriveCodexAssignmentForVerifiedRootAlias: vi.fn(),
  revalidateCodexAssignment: vi.fn(),
  createIsolatedWorkspace: vi.fn(),
  inspectIsolatedWorkspace: vi.fn(),
  cleanupIsolatedWorkspace: vi.fn(),
  writeGovernedWorkspaceFile: vi.fn(),
  workspaceFileWriteDependencies: vi.fn(),
  recordLoomStart: vi.fn(),
  recordLoomEnd: vi.fn(),
  recordLoomCodexAssignment: vi.fn(),
  commitLoomCodexSuccess: vi.fn(),
  prepareCodexContinuation: vi.fn(),
  readCodexContinuation: vi.fn(),
  acquireCodexContinuationClaim: vi.fn(),
  dependenciesForProjectRoot: vi.fn(),
  poolQuery: vi.fn(),
  connect: vi.fn(),
  readAccount: vi.fn(),
  startThread: vi.fn(),
  resumeThread: vi.fn(),
  runTurn: vi.fn(),
  close: vi.fn(),
  closeAndWait: vi.fn(),
  sanitize: vi.fn(),
  onConstruct: vi.fn(),
  resolveProjectBinding: vi.fn(),
  clientOptions: [] as unknown[],
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveTerraFusionWorkspaceBinding: seams.resolveProjectBinding,
}))
vi.mock("@/lib/loom/codex-assignment", () => ({
  deriveCodexAssignment: seams.deriveCodexAssignment,
  deriveCodexAssignmentForVerifiedRootAlias: seams.deriveCodexAssignmentForVerifiedRootAlias,
  revalidateCodexAssignment: seams.revalidateCodexAssignment,
}))
vi.mock("@/lib/loom/codex-isolated-workspace", () => ({
  createCodexIsolatedWorkspace: seams.createIsolatedWorkspace,
  inspectCodexIsolatedWorkspace: seams.inspectIsolatedWorkspace,
  cleanupCodexIsolatedWorkspace: seams.cleanupIsolatedWorkspace,
}))
vi.mock("@/lib/loom/workspace-file-write", () => ({
  writeGovernedWorkspaceFile: seams.writeGovernedWorkspaceFile,
  workspaceFileWriteDependencies: seams.workspaceFileWriteDependencies,
}))
vi.mock("@/lib/loom/receipts", () => ({
  recordLoomStart: seams.recordLoomStart,
  recordLoomEnd: seams.recordLoomEnd,
  recordLoomCodexAssignment: seams.recordLoomCodexAssignment,
  commitLoomCodexSuccess: seams.commitLoomCodexSuccess,
}))
vi.mock("@/lib/loom/codex-continuation", () => ({
  prepareCodexContinuation: seams.prepareCodexContinuation,
  readCodexContinuation: seams.readCodexContinuation,
}))
vi.mock("@/lib/loom/codex-continuation-runtime", () => ({
  codexContinuationDependenciesForProjectRoot: seams.dependenciesForProjectRoot,
  acquireCodexContinuationClaim: seams.acquireCodexContinuationClaim,
}))
vi.mock("@/lib/db", () => ({ pool: { query: seams.poolQuery } }))
vi.mock("@/scripts/hermes-bridge/app-server-client.mjs", () => ({
  CodexAppServerClient: class {
    constructor(options: unknown) {
      seams.clientOptions.push(options)
      seams.onConstruct(options)
    }
    connect = seams.connect
    readAccount = seams.readAccount
    startThread = seams.startThread
    resumeThread = seams.resumeThread
    runTurn = seams.runTurn
    close = seams.close
    closeAndWait = () => {
      seams.close()
      return seams.closeAndWait()
    }
  },
  sanitizeAppServerText: (value: unknown) => seams.sanitize(value),
}))

import { POST } from "@/app/api/loom/codex/route"
import { loomCodexThreadDescriptor } from "@/lib/loom/threads"

const ASSIGNMENT_HASH = "a".repeat(64)
const STALE_ASSIGNMENT_HASH = "b".repeat(64)
const CONFIGURED_ALIAS_ASSIGNMENT_HASH = "c".repeat(64)

function request(body: Record<string, unknown>, signal?: AbortSignal) {
  return new Request("http://williamos.test/api/loom/codex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ worldId: "world-1", ...body }),
    signal,
  })
}

async function events(response: Response) {
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

describe("durable Codex delegate route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.clientOptions.length = 0
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.resolveProjectBinding.mockResolvedValue({
      ok: true,
      binding: {
        projectId: 1,
        projectKey: "terrafusion",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        project: { identity: "c:/work/terrafusion_os_1.0", name: "TerraFusion OS" },
        workspaceRoot: process.cwd(),
        configuredWorkspaceRoot: process.cwd(),
      },
    })
    seams.connect.mockResolvedValue(undefined)
    seams.closeAndWait.mockResolvedValue(undefined)
    seams.sanitize.mockImplementation((value: unknown) => String(value ?? "")
      .replace(/token-[A-Za-z0-9._-]+/gi, "[REDACTED]"))
    seams.readAccount.mockResolvedValue({ authType: "chatgpt", email: "owner@example.test", requiresOpenaiAuth: true })
    seams.recordLoomStart.mockResolvedValue(undefined)
    seams.recordLoomEnd.mockResolvedValue(undefined)
    seams.recordLoomCodexAssignment.mockResolvedValue(undefined)
    seams.commitLoomCodexSuccess.mockResolvedValue(undefined)
    seams.prepareCodexContinuation.mockResolvedValue({ status: "WORK_ORDER_PATHS_COMPLETE" })
    seams.readCodexContinuation.mockResolvedValue({ status: "NO_ACTIVE_ASSIGNMENT" })
    seams.acquireCodexContinuationClaim.mockResolvedValue(vi.fn().mockResolvedValue(undefined))
    seams.dependenciesForProjectRoot.mockReturnValue({ verified: "physical-terrafusion" })
    seams.deriveCodexAssignment.mockResolvedValue({
      owner: "owner-1",
      worldId: "world-1",
      projectRoot: process.cwd(),
      outcomeKey: "OUTCOME-1",
      workOrderId: 41,
      grantId: 9,
      selectedPath: "src/selected.ts",
      allowed: ["src/selected.ts"],
      forbidden: ["src/forbidden.ts"],
      binding: {
        spaceRevision: 7,
        outcomeId: 5,
        outcomeVersion: 3,
        workOrderRef: "WO-0041",
        workOrderVersion: "2026-08-28T12:00:00.000Z",
        grantRef: "GRANT-0009",
        grantVersion: "grant-hash",
        reservationVersion: "f".repeat(64),
        projectId: 1,
        projectKey: "terrafusion",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        spaceIdentity: "c:/work/terrafusion_os_1.0",
      },
      assignmentHash: ASSIGNMENT_HASH,
      target: {
        content: "export const before = true\n",
        modifiedAt: "2026-08-28T12:00:00.000Z",
        digest: "before-digest",
      },
    })
    seams.revalidateCodexAssignment.mockResolvedValue(undefined)
    seams.deriveCodexAssignmentForVerifiedRootAlias.mockResolvedValue({
      assignmentHash: CONFIGURED_ALIAS_ASSIGNMENT_HASH,
    })
    seams.createIsolatedWorkspace.mockResolvedValue({
      projectRoot: process.cwd(),
      runtimeRoot: "C:/Users/owner/.williamos/loom/codex-worktrees",
      root: "C:/Users/owner/.williamos/loom/codex-worktrees/delegate-1",
      baseSha: "a".repeat(40),
      selectedPath: "src/selected.ts",
      initialContentDigest: "before-digest",
    })
    seams.inspectIsolatedWorkspace.mockResolvedValue({
      content: "export const after = true\n",
      digest: "after-digest",
    })
    seams.cleanupIsolatedWorkspace.mockResolvedValue(undefined)
    seams.workspaceFileWriteDependencies.mockReturnValue({
      authorize: vi.fn().mockResolvedValue({ ok: true }),
      resolve: vi.fn(),
      auditStart: vi.fn().mockResolvedValue(77),
      auditFinish: vi.fn().mockResolvedValue(undefined),
    })
    seams.writeGovernedWorkspaceFile.mockImplementation(async (_input: unknown, dependencies: {
      authorize: (path: string) => Promise<unknown>
      auditFinish: (input: Record<string, unknown>) => Promise<void>
    }) => {
      await dependencies.authorize("src/selected.ts")
      await dependencies.auditFinish({
        userId: "owner-1", path: "src/selected.ts", bytes: 26, startedAuditId: 77,
        outcome: "SAVED", modifiedAt: "2026-08-28T12:01:00.000Z",
      })
      return { ok: true, path: "src/selected.ts", name: "selected.ts", modifiedAt: "2026-08-28T12:01:00.000Z" }
    })
    seams.startThread.mockResolvedValue("codex-thread-1")
    seams.resumeThread.mockResolvedValue("codex-thread-1")
    seams.runTurn.mockResolvedValue({
      threadId: "codex-thread-1",
      turnId: "turn-1",
      status: "completed",
      finalText: "Implemented the selected change.",
    })
    seams.poolQuery.mockResolvedValue({
      rows: [{ userId: "owner-1", metadata: {
        provider: "Codex", mode: "delegate", workspace: process.cwd(), committed: true,
        worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9,
        assignmentHash: ASSIGNMENT_HASH, selectedPath: "src/selected.ts",
      } }],
    })
  })

  it("starts one exact-workspace non-ephemeral Codex Builder turn and emits one strict settlement", async () => {
    const response = await POST(request({ prompt: "Implement the selected change." }))
    const output = await events(response)

    expect(response.status).toBe(200)
    expect(seams.deriveCodexAssignment).toHaveBeenCalledWith({
      userId: "owner-1", worldId: "world-1", projectRoot: process.cwd(),
      projectBinding: {
        projectId: 1,
        projectKey: "terrafusion",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        spaceIdentity: "c:/work/terrafusion_os_1.0",
      },
    })
    expect(seams.connect).toHaveBeenCalledOnce()
    expect(seams.readAccount).toHaveBeenCalledOnce()
    expect(seams.startThread).toHaveBeenCalledWith({
      cwd: "C:/Users/owner/.williamos/loom/codex-worktrees/delegate-1",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      ephemeral: false,
    })
    expect(seams.recordLoomCodexAssignment).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1",
      threadId: "codex-thread-1",
      worldId: "world-1",
      spaceRevision: 7,
      outcomeId: 5,
      outcomeKey: "OUTCOME-1",
      outcomeVersion: 3,
      workOrderId: 41,
      workOrderRef: "WO-0041",
      workOrderVersion: "2026-08-28T12:00:00.000Z",
      grantId: 9,
      allowed: ["src/selected.ts"],
      forbidden: ["src/forbidden.ts"],
      reservationVersion: "f".repeat(64),
      selectedPath: "src/selected.ts",
      assignmentHash: ASSIGNMENT_HASH,
      taskText: "Implement the selected change.",
      isolatedBaseSha: "a".repeat(40),
      resumed: false,
    }))
    expect(seams.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "codex-thread-1",
      prompt: expect.stringContaining("Implement the selected change."),
      turn: expect.objectContaining({
        approvalPolicy: "never",
        sandboxPolicy: expect.objectContaining({
          type: "workspaceWrite",
          writableRoots: ["C:/Users/owner/.williamos/loom/codex-worktrees/delegate-1"],
        }),
      }),
    }))
    expect(output).toEqual([
      {
        type: "session", sessionId: "codex-thread-1", provider: "Codex", mode: "delegate", resumed: false,
        selectedPath: "src/selected.ts", assignmentHash: ASSIGNMENT_HASH,
      },
      { type: "continuation", status: "WORK_ORDER_PATHS_COMPLETE" },
      { type: "result", text: "Implemented the selected change." },
      { type: "done", reason: null, code: 0 },
    ])
    expect(seams.commitLoomCodexSuccess).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1",
      threadId: "codex-thread-1",
      workspace: process.cwd(),
      resumed: false,
      worldId: "world-1",
      assignmentHash: ASSIGNMENT_HASH,
      selectedPath: "src/selected.ts",
      promotionDigest: "after-digest",
    }))
    expect(seams.cleanupIsolatedWorkspace).toHaveBeenCalledOnce()
    expect(seams.writeGovernedWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1",
      path: "src/selected.ts",
      content: "export const after = true\n",
      modifiedAt: "2026-08-28T12:00:00.000Z",
    }), expect.any(Object))
    expect(seams.close).toHaveBeenCalledOnce()
  })

  it("emits the server-derived next assignment after the durable success commit", async () => {
    seams.prepareCodexContinuation.mockResolvedValueOnce({
      status: "NEXT_ASSIGNMENT",
      selectedPath: "src/next.ts",
      task: "Continue Work Order 41 in src/next.ts.",
    })

    const output = await events(await POST(request({ prompt: "Implement the selected change." })))

    expect(seams.prepareCodexContinuation).toHaveBeenCalledWith({
      userId: "owner-1",
      worldId: "world-1",
      outcomeKey: "OUTCOME-1",
      workOrderId: 41,
      grantId: 9,
      completedPath: "src/selected.ts",
    }, { verified: "physical-terrafusion" })
    expect(output).toContainEqual({
      type: "continuation",
      status: "NEXT_ASSIGNMENT",
      selectedPath: "src/next.ts",
      task: "Continue Work Order 41 in src/next.ts.",
    })
    expect(output.at(-1)).toEqual({ type: "done", reason: null, code: 0 })
  })

  it("starts an automatic turn only from the server-derived pending task", async () => {
    seams.readCodexContinuation.mockResolvedValueOnce({
      status: "NEXT_ASSIGNMENT",
      selectedPath: "src/selected.ts",
      task: "Server-derived continuation task.",
    })

    const output = await events(await POST(request({ automatic: true })))

    expect(output.at(-1)).toEqual({ type: "done", reason: null, code: 0 })
    expect(seams.readCodexContinuation).toHaveBeenCalledWith(
      "owner-1",
      "world-1",
      { verified: "physical-terrafusion" },
    )
    expect(seams.recordLoomCodexAssignment).toHaveBeenCalledWith(expect.objectContaining({
      taskText: "Server-derived continuation task.",
    }))
    expect(seams.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Server-derived continuation task."),
    }))
  })

  it("reapplies the prompt limit to a server-derived automatic task", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    seams.acquireCodexContinuationClaim.mockResolvedValue(release)
    seams.readCodexContinuation.mockResolvedValueOnce({
      status: "NEXT_ASSIGNMENT",
      selectedPath: "src/selected.ts",
      task: "x".repeat(32_001),
    })

    const response = await POST(request({ automatic: true }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "PROMPT_TOO_LONG" })
    expect(release).toHaveBeenCalledTimes(1)
    expect(seams.startThread).not.toHaveBeenCalled()
  })

  it("refuses a concurrent automatic dispatch when the exact Space claim is held", async () => {
    seams.acquireCodexContinuationClaim.mockResolvedValue(null)

    const response = await POST(request({ automatic: true }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "CODEX_CONTINUATION_IN_FLIGHT" })
    expect(seams.deriveCodexAssignment).not.toHaveBeenCalled()
    expect(seams.startThread).not.toHaveBeenCalled()
  })

  it("releases the automatic Space claim when continuation restoration fails", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    seams.acquireCodexContinuationClaim.mockResolvedValue(release)
    seams.readCodexContinuation.mockRejectedValue(new Error("database unavailable"))

    await expect(POST(request({ automatic: true }))).rejects.toThrow("database unavailable")

    expect(release).toHaveBeenCalledTimes(1)
    expect(seams.startThread).not.toHaveBeenCalled()
  })

  it("rejects browser prompt text on an automatic continuation request", async () => {
    const response = await POST(request({ automatic: true, prompt: "Widen the assignment." }))

    expect(response.status).toBe(400)
    expect(seams.readCodexContinuation).not.toHaveBeenCalled()
    expect(seams.connect).not.toHaveBeenCalled()
  })

  it("streams only bounded sanitized agent deltas before the canonical result", async () => {
    seams.runTurn.mockImplementationOnce(async () => {
      const options = seams.clientOptions[0]
      const notify = (options as { onNotification?: (frame: unknown) => void }).onNotification
      notify?.({ method: "item/agentMessage/delta", params: { delta: "token-supersecret" } })
      notify?.({ method: "item/commandExecution/outputDelta", params: { delta: "private command output" } })
      return {
        threadId: "codex-thread-1", turnId: "turn-1", status: "completed",
        finalText: "Implemented the selected change.",
      }
    })

    const response = await POST(request({ prompt: "Work." }))
    const output = await events(response)

    expect(output).toContainEqual({ type: "delta", text: "[REDACTED]" })
    expect(output[0]).toMatchObject({ type: "session" })
    expect(JSON.stringify(output)).not.toContain("private command output")
    expect(output.filter((event) => event.type === "result")).toHaveLength(1)
    expect(output.filter((event) => event.type === "done")).toHaveLength(1)
  })

  it("bounds both streamed deltas and the canonical result", async () => {
    seams.runTurn.mockImplementationOnce(async () => {
      const options = seams.clientOptions[0]
      const notify = (options as { onNotification?: (frame: unknown) => void }).onNotification
      for (let index = 0; index < 10; index += 1) {
        notify?.({ method: "item/agentMessage/delta", params: { delta: "d".repeat(20_000) } })
      }
      return {
        threadId: "codex-thread-1", turnId: "turn-1", status: "completed",
        finalText: "r".repeat(200_000),
      }
    })

    const output = await events(await POST(request({ prompt: "Work." })))
    const streamed = output.filter((event) => event.type === "delta").map((event) => event.text).join("")
    const result = output.find((event) => event.type === "result")

    expect(streamed).toHaveLength(128_000)
    expect(result.text).toHaveLength(128_000)
  })

  it("resumes only an owner-bound Codex delegate in the exact workspace", async () => {
    const response = await POST(request({
      prompt: "Continue.",
      sessionId: "codex-thread-1",
      resume: true,
    }))
    const output = await events(response)

    expect(response.status).toBe(200)
    expect(seams.poolQuery).toHaveBeenCalledWith(expect.stringContaining("loom_codex_ready"), ["codex-thread-1"])
    expect(seams.resumeThread).toHaveBeenCalledWith("codex-thread-1", {
      cwd: "C:/Users/owner/.williamos/loom/codex-worktrees/delegate-1",
      approvalPolicy: "never",
      sandbox: "workspace-write",
    })
    expect(seams.startThread).not.toHaveBeenCalled()
    expect(output[0]).toEqual({
      type: "session", sessionId: "codex-thread-1", provider: "Codex", mode: "delegate", resumed: true,
      selectedPath: "src/selected.ts", assignmentHash: ASSIGNMENT_HASH,
    })
  })

  it("resumes a durable session recorded against the verified configured workspace alias", async () => {
    const configuredAlias = path.resolve("C:/stable/terrafusion-alias")
    const currentAssignment = await seams.deriveCodexAssignment({})
    seams.deriveCodexAssignment.mockReset()
    seams.deriveCodexAssignment.mockImplementation(async (input: { projectRoot: string }) => ({
      ...currentAssignment,
      projectRoot: input.projectRoot,
      assignmentHash: ASSIGNMENT_HASH,
    }))
    seams.resolveProjectBinding.mockResolvedValueOnce({
      ok: true,
      binding: {
        projectId: 1,
        projectKey: "terrafusion",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        project: { identity: "c:/work/terrafusion_os_1.0", name: "TerraFusion OS" },
        workspaceRoot: process.cwd(),
        configuredWorkspaceRoot: configuredAlias,
      },
    })
    seams.poolQuery.mockResolvedValueOnce({
      rows: [{ userId: "owner-1", metadata: {
        provider: "Codex", mode: "delegate", workspace: configuredAlias, committed: true,
        worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9,
        assignmentHash: CONFIGURED_ALIAS_ASSIGNMENT_HASH, selectedPath: "src/selected.ts",
      } }],
    })

    const response = await POST(request({
      prompt: "Continue.",
      sessionId: "codex-thread-1",
      resume: true,
    }))

    expect(response.status).toBe(200)
    await events(response)
    expect(seams.deriveCodexAssignment).toHaveBeenCalledOnce()
    expect(seams.deriveCodexAssignmentForVerifiedRootAlias).toHaveBeenCalledWith({
      userId: "owner-1",
      worldId: "world-1",
      configuredProjectRoot: configuredAlias,
      verifiedProjectRoot: process.cwd(),
      projectBinding: {
        projectId: 1,
        projectKey: "terrafusion",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        spaceIdentity: "c:/work/terrafusion_os_1.0",
      },
    })
    expect(seams.resumeThread).toHaveBeenCalledWith("codex-thread-1", expect.objectContaining({
      cwd: "C:/Users/owner/.williamos/loom/codex-worktrees/delegate-1",
    }))
  })

  it.each([
    ["unknown", [], "THREAD_NOT_FOUND"],
    ["another owner", [{ userId: "owner-2", metadata: { provider: "Codex", mode: "delegate", workspace: process.cwd(), committed: true, worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9, assignmentHash: ASSIGNMENT_HASH, selectedPath: "src/selected.ts" } }], "THREAD_NOT_YOURS"],
    ["Claude", [{ userId: "owner-1", metadata: { provider: "Claude", mode: "delegate", workspace: process.cwd(), committed: true, worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9, assignmentHash: ASSIGNMENT_HASH, selectedPath: "src/selected.ts" } }], "THREAD_DESCRIPTOR_MISMATCH"],
    ["review", [{ userId: "owner-1", metadata: { provider: "Codex", mode: "review", workspace: process.cwd(), committed: true, worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9, assignmentHash: ASSIGNMENT_HASH, selectedPath: "src/selected.ts" } }], "THREAD_DESCRIPTOR_MISMATCH"],
    ["different workspace", [{ userId: "owner-1", metadata: { provider: "Codex", mode: "delegate", workspace: "C:/other", committed: true, worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9, assignmentHash: ASSIGNMENT_HASH, selectedPath: "src/selected.ts" } }], "THREAD_DESCRIPTOR_MISMATCH"],
    ["stale assignment", [{ userId: "owner-1", metadata: { provider: "Codex", mode: "delegate", workspace: process.cwd(), committed: true, worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9, assignmentHash: STALE_ASSIGNMENT_HASH, selectedPath: "src/selected.ts" } }], "THREAD_DESCRIPTOR_MISMATCH"],
  ])("refuses a %s descriptor before connecting", async (_label, rows, error) => {
    seams.poolQuery.mockResolvedValueOnce({ rows })

    const response = await POST(request({ prompt: "Continue.", sessionId: "codex-thread-1", resume: true }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error })
    expect(seams.connect).not.toHaveBeenCalled()
  })

  it("fails closed before connecting when authentication, prompt, or server assignment is absent", async () => {
    seams.getSession.mockResolvedValueOnce(null)
    expect((await POST(request({ prompt: "Work." }))).status).toBe(401)

    expect((await POST(request({ prompt: "  " }))).status).toBe(400)

    seams.deriveCodexAssignment.mockRejectedValueOnce(Object.assign(new Error("no authority"), {
      code: "CODEX_ASSIGNMENT_REFUSED",
    }))
    const refused = await POST(request({ prompt: "Work." }))
    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toEqual({
      error: "CODEX_ASSIGNMENT_REFUSED",
      detail: "no authority",
    })
    expect(seams.connect).not.toHaveBeenCalled()
  })

  it("rejects browser-supplied path or authority facts instead of treating them as assignment input", async () => {
    const selectedPath = await POST(request({ prompt: "Work.", selectedPath: "src/other.ts" }))
    const receipt = await POST(request({ prompt: "Work.", workContextReceipt: "browser-proof" }))

    expect(selectedPath.status).toBe(400)
    expect(receipt.status).toBe(400)
    expect(seams.deriveCodexAssignment).not.toHaveBeenCalled()
    expect(seams.connect).not.toHaveBeenCalled()
  })

  it("closes and removes the disposable checkout before exact-path revalidation and promotion", async () => {
    const order: string[] = []
    let revalidation = 0
    seams.close.mockImplementation(() => { order.push("close") })
    seams.recordLoomCodexAssignment.mockImplementationOnce(async () => { order.push("assignment-receipt") })
    seams.inspectIsolatedWorkspace.mockImplementationOnce(async () => {
      order.push("inspect")
      return { content: "export const after = true\n", digest: "after-digest" }
    })
    seams.cleanupIsolatedWorkspace.mockImplementationOnce(async () => { order.push("cleanup") })
    seams.revalidateCodexAssignment.mockImplementation(async () => {
      revalidation += 1
      order.push(revalidation === 1 ? "revalidate-run" : "revalidate-promotion")
    })
    seams.writeGovernedWorkspaceFile.mockImplementationOnce(async (_input: unknown, dependencies: {
      authorize: (path: string) => Promise<unknown>
      auditFinish: (input: Record<string, unknown>) => Promise<void>
    }) => {
      order.push("writer")
      await dependencies.authorize("src/selected.ts")
      order.push("write")
      await dependencies.auditFinish({
        userId: "owner-1", path: "src/selected.ts", bytes: 26, startedAuditId: 77,
        outcome: "SAVED", modifiedAt: "2026-08-28T12:01:00.000Z",
      })
      return { ok: true, path: "src/selected.ts", name: "selected.ts", modifiedAt: "2026-08-28T12:01:00.000Z" }
    })
    seams.commitLoomCodexSuccess.mockImplementationOnce(async () => { order.push("commit") })

    const output = await events(await POST(request({ prompt: "Work." })))

    expect(output.at(-1)).toEqual({ type: "done", reason: null, code: 0 })
    expect(order).toEqual([
      "revalidate-run", "assignment-receipt", "inspect", "close", "cleanup",
      "writer", "revalidate-promotion", "write", "commit",
    ])
  })

  it("does not clean or promote until the provider child confirms actual exit", async () => {
    let confirmExit!: () => void
    const exited = new Promise<void>((resolve) => { confirmExit = resolve })
    seams.closeAndWait.mockReturnValueOnce(exited)

    const response = await POST(request({ prompt: "Work." }))
    const outputPromise = events(response)
    await vi.waitFor(() => expect(seams.closeAndWait).toHaveBeenCalledOnce())

    expect(seams.cleanupIsolatedWorkspace).not.toHaveBeenCalled()
    expect(seams.writeGovernedWorkspaceFile).not.toHaveBeenCalled()
    confirmExit()

    const output = await outputPromise
    expect(output.at(-1)).toEqual({ type: "done", reason: null, code: 0 })
    expect(seams.cleanupIsolatedWorkspace).toHaveBeenCalledOnce()
    expect(seams.writeGovernedWorkspaceFile).toHaveBeenCalledOnce()
  })

  it.each([
    ["exit error", "APP_SERVER_CLOSE_FAILED"],
    ["exit timeout", "APP_SERVER_CLOSE_TIMEOUT"],
  ])("refuses cleanup and promotion when provider close confirmation has an %s", async (_label, code) => {
    seams.closeAndWait.mockRejectedValueOnce(Object.assign(new Error("provider did not exit"), { code }))

    const output = await events(await POST(request({ prompt: "Work." })))

    expect(output.at(-1)).toEqual({ type: "done", reason: "CODEX_PROVIDER_CLOSE_FAILED", code: null })
    expect(seams.cleanupIsolatedWorkspace).not.toHaveBeenCalled()
    expect(seams.writeGovernedWorkspaceFile).not.toHaveBeenCalled()
    expect(seams.commitLoomCodexSuccess).not.toHaveBeenCalled()
  })

  it("never runs the provider turn when the captured assignment drifts before execution", async () => {
    seams.revalidateCodexAssignment.mockRejectedValueOnce(Object.assign(new Error("Space changed"), {
      code: "CODEX_ASSIGNMENT_STALE",
    }))

    const output = await events(await POST(request({ prompt: "Work." })))

    expect(output.at(-1)).toEqual({ type: "done", reason: "CODEX_ASSIGNMENT_STALE", code: null })
    expect(seams.recordLoomCodexAssignment).not.toHaveBeenCalled()
    expect(seams.runTurn).not.toHaveBeenCalled()
    expect(seams.cleanupIsolatedWorkspace).toHaveBeenCalledOnce()
  })

  it("never runs the provider turn when the exact assignment receipt is not durable", async () => {
    seams.recordLoomCodexAssignment.mockRejectedValueOnce(new Error("ledger unavailable"))

    const output = await events(await POST(request({ prompt: "Work." })))

    expect(output.at(-1)).toEqual({ type: "done", reason: "CODEX_RECEIPT_FAILED", code: null })
    expect(output.some((frame) => frame.type === "session")).toBe(false)
    expect(seams.runTurn).not.toHaveBeenCalled()
    expect(seams.cleanupIsolatedWorkspace).toHaveBeenCalledOnce()
  })

  it("does not promote or persist ready when disposable cleanup cannot be verified", async () => {
    seams.cleanupIsolatedWorkspace.mockRejectedValueOnce(Object.assign(new Error("registered"), {
      code: "CODEX_CLEANUP_FAILED",
    }))

    const output = await events(await POST(request({ prompt: "Work." })))

    expect(output.at(-1)).toEqual({ type: "done", reason: "CODEX_CLEANUP_FAILED", code: null })
    expect(seams.writeGovernedWorkspaceFile).not.toHaveBeenCalled()
    expect(seams.commitLoomCodexSuccess).not.toHaveBeenCalled()
  })

  it("lets cancellation win while final authority revalidation is still pre-mutation", async () => {
    const abort = new AbortController()
    let validation = 0
    seams.revalidateCodexAssignment.mockImplementation(async () => {
      validation += 1
      if (validation === 2) abort.abort()
    })
    seams.writeGovernedWorkspaceFile.mockImplementationOnce(async (_input: unknown, dependencies: {
      authorize: (path: string) => Promise<{ ok: boolean }>
      auditStart: (input: Record<string, unknown>) => Promise<number>
    }) => {
      const authority = await dependencies.authorize("src/selected.ts")
      if (!authority.ok) return { ok: false, error: "FAILED_AUTHORITY_NOT_GRANTED", status: 409 }
      await dependencies.auditStart({ userId: "owner-1", path: "src/selected.ts", bytes: 26 })
      return { ok: false, error: "UNREACHABLE_WRITE", status: 500 }
    })

    const output = await events(await POST(request({ prompt: "Work." }, abort.signal)))

    expect(output.some((event) => event.type === "result")).toBe(false)
    expect(output.at(-1)).toEqual({ type: "done", reason: "CANCELLED", code: null })
    expect(seams.commitLoomCodexSuccess).not.toHaveBeenCalled()
  })

  it("reports missing Codex sign-in as a typed product failure without persisting a session", async () => {
    seams.readAccount.mockResolvedValueOnce({ authType: null, email: null, requiresOpenaiAuth: true })

    const response = await POST(request({ prompt: "Work." }))
    const output = await events(response)

    expect(output).toEqual([{ type: "done", reason: "CODEX_AUTH_REQUIRED", code: null }])
    expect(seams.startThread).not.toHaveBeenCalled()
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.close).toHaveBeenCalledOnce()
    expect(seams.cleanupIsolatedWorkspace).toHaveBeenCalledOnce()
    expect(seams.writeGovernedWorkspaceFile).not.toHaveBeenCalled()
  })

  it("interrupts the active turn on abort, emits no success result, settles once, and always closes", async () => {
    seams.runTurn.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      if (signal.aborted) {
        reject(Object.assign(new Error("cancelled"), { code: "APP_SERVER_CANCELLED" }))
        return
      }
      signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: "APP_SERVER_CANCELLED" })))
    }))
    const abort = new AbortController()
    const response = await POST(request({ prompt: "Work." }, abort.signal))
    abort.abort()

    const output = await events(response)
    expect(output.at(-1)).toEqual({ type: "done", reason: "CANCELLED", code: null })
    expect(output.some((event) => event.type === "result")).toBe(false)
    // An abort can win before thread/start returns. In that case there is no durable subject to
    // receipt, but the stream and provider process must still settle without inventing success.
    if (seams.recordLoomEnd.mock.calls.length > 0) {
      expect(seams.recordLoomEnd).toHaveBeenCalledOnce()
      expect(seams.recordLoomEnd.mock.calls[0][0].outcome).toMatchObject({ code: null, reason: "CANCELLED" })
    }
    expect(seams.close).toHaveBeenCalledOnce()
  })

  it("surfaces a leaked disposable checkout even when cleanup failure follows cancellation", async () => {
    seams.runTurn.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), {
        code: "APP_SERVER_CANCELLED",
      })))
    }))
    seams.cleanupIsolatedWorkspace.mockRejectedValueOnce(Object.assign(new Error("still registered"), {
      code: "CODEX_CLEANUP_FAILED",
    }))
    const abort = new AbortController()
    const response = await POST(request({ prompt: "Work." }, abort.signal))
    abort.abort()

    const output = await events(response)

    expect(output.at(-1)).toEqual({ type: "done", reason: "CODEX_CLEANUP_FAILED", code: null })
    expect(seams.writeGovernedWorkspaceFile).not.toHaveBeenCalled()
  })

  it("interrupts before closing when the response reader is cancelled", async () => {
    const order: string[] = []
    seams.runTurn.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      if (signal.aborted) {
        order.push("interrupt")
        reject(Object.assign(new Error("cancelled"), { code: "APP_SERVER_CANCELLED" }))
        return
      }
      signal.addEventListener("abort", () => {
        order.push("interrupt")
        queueMicrotask(() => reject(Object.assign(new Error("cancelled"), { code: "APP_SERVER_CANCELLED" })))
      })
    }))
    seams.close.mockImplementation(() => { order.push("close") })
    const response = await POST(request({ prompt: "Work." }))
    const reader = response.body!.getReader()

    // Read the session frame so turn/start has definitely installed its abort handler.
    await reader.read()
    await reader.cancel()
    await vi.waitFor(() => expect(seams.close).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(seams.recordLoomEnd).toHaveBeenCalledOnce())

    expect((seams.runTurn.mock.calls[0][0] as { signal: AbortSignal }).signal.aborted).toBe(true)
    expect(order).toEqual(["interrupt", "close"])
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
  })

  it("force-closes a provider that does not settle after response cancellation", async () => {
    vi.useFakeTimers()
    try {
      seams.runTurn.mockImplementationOnce(() => new Promise(() => {}))
      const response = await POST(request({ prompt: "Work." }))
      const reader = response.body!.getReader()
      await reader.read()

      await reader.cancel()
      expect(seams.close).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(seams.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not commit or report success when cancellation lands immediately before persistence", async () => {
    const abort = new AbortController()
    seams.sanitize.mockImplementationOnce((value: unknown) => {
      abort.abort()
      return String(value ?? "")
    })

    const output = await events(await POST(request({ prompt: "Work." }, abort.signal)))

    expect(output.some((event) => event.type === "result")).toBe(false)
    expect(output.at(-1)).toEqual({ type: "done", reason: "CANCELLED", code: null })
    expect(seams.poolQuery).not.toHaveBeenCalled()
  })

  it("does not enter receipt or success transitions when cancellation lands during sanitization", async () => {
    const abort = new AbortController()
    seams.sanitize.mockImplementationOnce((value: unknown) => {
      abort.abort()
      return String(value ?? "")
    })

    const output = await events(await POST(request({ prompt: "Work." }, abort.signal)))

    expect(output.some((event) => event.type === "result")).toBe(false)
    expect(output.at(-1)).toEqual({ type: "done", reason: "CANCELLED", code: null })
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.poolQuery).not.toHaveBeenCalled()
  })

  it("does not create a committed-ready descriptor when the strict success transaction rejects", async () => {
    seams.commitLoomCodexSuccess.mockRejectedValueOnce(new Error("transaction rolled back"))

    const output = await events(await POST(request({ prompt: "Work." })))

    expect(output.some((event) => event.type === "result")).toBe(false)
    expect(output.at(-1)).toEqual({ type: "done", reason: "CODEX_RECEIPT_FAILED", code: null })
    expect(seams.commitLoomCodexSuccess).toHaveBeenCalledOnce()
    expect(seams.poolQuery).not.toHaveBeenCalled()
  })

  it("treats a completed ready transaction as the irrevocable success point", async () => {
    const abort = new AbortController()
    seams.commitLoomCodexSuccess.mockImplementationOnce(async () => { abort.abort() })

    const output = await events(await POST(request({ prompt: "Work." }, abort.signal)))

    expect(output).toContainEqual({ type: "result", text: "Implemented the selected change." })
    expect(output.at(-1)).toEqual({ type: "done", reason: null, code: 0 })
    expect(seams.commitLoomCodexSuccess).toHaveBeenCalledOnce()
  })

  it.each([
    [Object.assign(new Error("approval"), { code: "APP_SERVER_APPROVAL_REQUIRED" }), "APP_SERVER_APPROVAL_REQUIRED"],
    [Object.assign(new Error("input"), { code: "APP_SERVER_USER_INPUT_REQUIRED" }), "APP_SERVER_USER_INPUT_REQUIRED"],
    [Object.assign(new Error("tool"), { code: "APP_SERVER_EXTERNAL_TOOL_WALL" }), "APP_SERVER_EXTERNAL_TOOL_WALL"],
    [Object.assign(new Error("You've hit your usage limit token-secret"), { code: "APP_SERVER_TURN_FAILED", usageLimit: true }), "USAGE_LIMIT_EXCEEDED"],
  ])("settles a provider wall truthfully without a result", async (failure, reason) => {
    seams.runTurn.mockRejectedValueOnce(failure)

    const response = await POST(request({ prompt: "Work." }))
    const output = await events(response)

    expect(output.filter((event) => event.type === "result")).toHaveLength(0)
    expect(output.at(-1)).toEqual({ type: "done", reason, code: null })
    expect(JSON.stringify(output)).not.toContain("token-secret")
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.close).toHaveBeenCalledOnce()
    expect(seams.cleanupIsolatedWorkspace).toHaveBeenCalledOnce()
    expect(seams.writeGovernedWorkspaceFile).not.toHaveBeenCalled()
  })
})

describe("Codex thread descriptor", () => {
  it("reads owner, provider, mode, workspace, and immutable assignment only from the committed-ready event", async () => {
    seams.poolQuery.mockResolvedValueOnce({
      rows: [{ userId: "owner-1", metadata: {
        provider: "Codex", mode: "delegate", workspace: "C:/workspace", committed: true,
        worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9,
        assignmentHash: ASSIGNMENT_HASH, selectedPath: "src/selected.ts",
      } }],
    })

    await expect(loomCodexThreadDescriptor("codex-thread-1")).resolves.toEqual({
      owner: "owner-1", provider: "Codex", mode: "delegate", workspace: "C:/workspace",
      worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9,
      assignmentHash: ASSIGNMENT_HASH, selectedPath: "src/selected.ts",
    })
    expect(seams.poolQuery.mock.calls.at(-1)?.[0]).toContain("loom_codex_ready")
  })

  it("refuses a malformed ready event that was never marked committed", async () => {
    seams.poolQuery.mockResolvedValueOnce({
      rows: [{ userId: "owner-1", metadata: { provider: "Codex", mode: "delegate", workspace: "C:/workspace" } }],
    })

    await expect(loomCodexThreadDescriptor("codex-thread-1")).resolves.toBeNull()
  })
})
