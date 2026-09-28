import { createHash } from "node:crypto"
import path from "node:path"

import { getSession } from "@/lib/session"
import {
  commitLoomCodexSuccess,
  recordLoomCodexAssignment,
  recordLoomEnd,
} from "@/lib/loom/receipts"
import { loomCodexThreadDescriptor } from "@/lib/loom/threads"
import {
  deriveCodexAssignment,
  deriveCodexAssignmentForVerifiedRootAlias,
  revalidateCodexAssignment,
  type CodexAssignment,
} from "@/lib/loom/codex-assignment"
import {
  createAssignmentDispatchContextPackage,
  createCodexAssignmentContextManifest,
} from "@/lib/loom/assignment-context-runtime"
import {
  assessActiveRepositoryAssignment,
  deriveRepositoryAssignmentReservationClaims,
  type RepositoryAssignmentReservationClaims,
} from "@/lib/loom/repository-assignment-runtime"
import type { AssignmentReservationSet } from "@/lib/loom/repository-reservations"
import {
  prepareCodexContinuation,
  readCodexContinuation,
  type CodexContinuationRepositoryIdentity,
} from "@/lib/loom/codex-continuation"
import {
  acquireCodexContinuationClaim,
  codexContinuationDependenciesForProjectRoot,
} from "@/lib/loom/codex-continuation-runtime"
import {
  cleanupCodexIsolatedWorkspace,
  createCodexIsolatedWorkspace,
  inspectCodexIsolatedWorkspace,
  type CodexIsolatedWorkspace,
} from "@/lib/loom/codex-isolated-workspace"
import {
  workspaceFileWriteDependencies,
  writeGovernedWorkspaceFile,
} from "@/lib/loom/workspace-file-write"
import {
  deriveSpaceMutationAuthority,
  SpaceMutationAuthorityError,
  type SpaceMutationAuthority,
} from "@/lib/governance/space-mutation-authority"
import {
  CodexAppServerClient,
  sanitizeAppServerText,
} from "@/scripts/hermes-bridge/app-server-client.mjs"
import {
  resolveCanonicalWorkspaceProjectBinding,
  type WorkspaceProjectBinding,
} from "@/lib/projects/workspace-project-binding"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const MAX_PROMPT_CHARS = 32_000
const MAX_DELTA_CHARS = 16_000
const MAX_STREAM_CHARS = 128_000
const MAX_RESULT_CHARS = 128_000
const TURN_TIMEOUT_MS = 60 * 60_000
const FORCED_CLOSE_MS = 1_000
const PROVIDER_CLOSE_TIMEOUT_MS = 5_000

type CodexClient = InstanceType<typeof CodexAppServerClient>

function repositoryMutationBinding(binding: WorkspaceProjectBinding) {
  return {
    projectId: binding.projectId,
    projectKey: binding.projectKey,
    repositoryResourceKey: binding.repositoryKey,
    repositoryIdentity: binding.repositoryIdentity,
    repositoryMountKey: binding.repositoryMountKey,
    observedRevision: binding.observedRevision,
    spaceIdentity: binding.project.identity,
  }
}

function sameResolvedRepository(left: WorkspaceProjectBinding, right: WorkspaceProjectBinding): boolean {
  return left.projectId === right.projectId
    && left.projectKey === right.projectKey
    && left.repositoryKey === right.repositoryKey
    && left.repositoryIdentity === right.repositoryIdentity
    && left.repositoryMountKey === right.repositoryMountKey
    && left.observedRevision === right.observedRevision
    && left.workspaceRoot === right.workspaceRoot
    && left.project.identity === right.project.identity
}

function continuationRepositoryMatches(
  repository: CodexContinuationRepositoryIdentity,
  binding: WorkspaceProjectBinding,
): boolean {
  return repository.projectIdentity === binding.project.identity
    && repository.repositoryResourceKey === binding.repositoryKey
    && repository.repositoryIdentity === binding.repositoryIdentity
    && repository.repositoryMountKey === binding.repositoryMountKey
    && repository.observedRevision === binding.observedRevision
}

function sameRepositoryAuthority(left: SpaceMutationAuthority, right: SpaceMutationAuthority): boolean {
  return left.worldRevision === right.worldRevision
    && left.outcomeKey === right.outcomeKey
    && left.workOrderId === right.workOrderId
    && left.grantId === right.grantId
    && left.selectedPath === right.selectedPath
    && left.repositoryResourceKey === right.repositoryResourceKey
    && left.repositoryIdentity === right.repositoryIdentity
    && left.repositoryMountKey === right.repositoryMountKey
    && left.observedRevision === right.observedRevision
}

function exactRepositoryReservation(
  assignmentId: string,
  contextManifest: Awaited<ReturnType<typeof createCodexAssignmentContextManifest>>,
  claims: RepositoryAssignmentReservationClaims,
): AssignmentReservationSet {
  return {
    assignmentId,
    repository: {
      repositoryResourceId: contextManifest.targetRepository.repositoryResourceId,
      repositoryKey: contextManifest.targetRepository.repositoryKey,
      repositoryIdentity: contextManifest.targetRepository.repositoryIdentity,
      repositoryMountKey: contextManifest.checkout.repositoryMountKey,
      worktreeKey: contextManifest.checkout.worktreeKey,
      baseRevision: contextManifest.checkout.baseRevision,
    },
    paths: contextManifest.mutationPosture.target.writablePaths,
    contracts: [...claims.contracts],
    environments: [...claims.environments],
  }
}

async function assertRepositoryReservationAvailable(input: Readonly<{
  userId: string
  worldId: string
  projectId: number
  workOrderId: number
  grantId: number
  candidate: AssignmentReservationSet
}>): Promise<void> {
  const currentClaims = await deriveRepositoryAssignmentReservationClaims(input)
  if (JSON.stringify(currentClaims) !== JSON.stringify({
    contracts: input.candidate.contracts,
    environments: input.candidate.environments,
  })) {
    throw Object.assign(new Error("the server-owned repository reservation claims changed"), {
      code: "CODEX_ASSIGNMENT_RESERVATION_UNAVAILABLE",
    })
  }
  const assessment = await assessActiveRepositoryAssignment(input)
  if (assessment.status === "COMPATIBLE") return
  throw Object.assign(new Error(assessment.status === "BLOCKED"
    ? "the exact repository assignment collides with active path, contract, or environment reservations"
    : "an active assignment has no exact collision-checkable reservation evidence"), {
    code: "CODEX_ASSIGNMENT_RESERVATION_UNAVAILABLE",
  })
}

function durableSessionMatchesRepository(
  descriptor: Record<string, unknown>,
  binding: WorkspaceProjectBinding,
): boolean {
  const values = [
    descriptor.repositoryResourceKey,
    descriptor.repositoryIdentity,
    descriptor.repositoryMountKey,
    descriptor.observedRevision,
  ]
  const present = values.filter((value) => value !== null && value !== undefined).length
  if (present === 0) {
    // Missing repository evidence is a legacy primary-repository session, never a secondary mount.
    return binding.repositoryKey === undefined
      || binding.repositoryKey === "os-1"
      || binding.repositoryKey === "williamos"
  }
  return present === values.length
    && descriptor.repositoryResourceKey === binding.repositoryKey
    && descriptor.repositoryIdentity === binding.repositoryIdentity
    && descriptor.repositoryMountKey === binding.repositoryMountKey
    && descriptor.observedRevision === binding.observedRevision
}

function sameWorkspace(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function failureReason(error: unknown): string {
  const candidate = error as { code?: unknown; usageLimit?: unknown } | null
  if (candidate?.usageLimit === true) return "USAGE_LIMIT_EXCEEDED"
  const code = typeof candidate?.code === "string" ? candidate.code : ""
  if (code === "APP_SERVER_CANCELLED") return "CANCELLED"
  if (code === "CODEX_AUTH_REQUIRED") return code
  if (code === "CODEX_RECEIPT_FAILED") return code
  if (/^ASSIGNMENT_CONTEXT_/.test(code)) return code
  if (code === "CODEX_ASSIGNMENT_RESERVATION_UNAVAILABLE") return code
  if (/^CODEX_(?:ASSIGNMENT|ISOLATION|CLEANUP|NO_CHANGE|PROMOTION|PROVIDER_CLOSE)/.test(code)) return code
  const allowed = new Set([
    "APP_SERVER_APPROVAL_REQUIRED",
    "APP_SERVER_USER_INPUT_REQUIRED",
    "APP_SERVER_UNSUPPORTED_REQUEST",
    "APP_SERVER_EXTERNAL_TOOL_WALL",
    "APP_SERVER_TIMEOUT",
    "APP_SERVER_FRAME_LIMIT",
    "APP_SERVER_TURN_FAILED",
    "APP_SERVER_TURN_INTERRUPTED",
  ])
  return allowed.has(code) ? code : "CODEX_UNAVAILABLE"
}

function delegatedPrompt(assignment: CodexAssignment, prompt: string, contextPackage: string): string {
  return [
    "Execute one bounded WilliamOS Delegate assignment in the disposable checkout.",
    "Only the exact selected file below is eligible for later promotion into the real checkout.",
    "Do not create, delete, rename, link, or modify any other path. The server will inspect the whole disposable diff and fail closed.",
    `World: ${assignment.worldId}`,
    `Outcome: ${assignment.outcomeKey}`,
    `Work Order: ${assignment.workOrderId}`,
    `Authority Grant: ${assignment.grantId}`,
    `Selected file: ${assignment.selectedPath}`,
    `Allowed reservation: ${JSON.stringify(assignment.allowed)}`,
    `Forbidden reservation: ${JSON.stringify(assignment.forbidden)}`,
    contextPackage,
    "Operator instruction:",
    prompt,
  ].join("\n")
}

/**
 * Run one real Codex App Server Builder turn in this exact checkout.
 *
 * The App Server client is reused directly because its request and tool walls are the accepted
 * provider boundary. This route adds only product-session identity, streaming and receipts; it does
 * not route the user through HERMES or create a second agent loop.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  let body: { worldId?: unknown; projectKey?: unknown; repositoryKey?: unknown; prompt?: unknown; sessionId?: unknown; resume?: unknown; automatic?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }
  if (!body || typeof body !== "object" || Object.keys(body).some((key) => !["worldId", "projectKey", "repositoryKey", "prompt", "sessionId", "resume", "automatic"].includes(key))) {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }
  const projectBinding = body.repositoryKey === undefined
    ? await resolveCanonicalWorkspaceProjectBinding(session.user.id, body.projectKey)
    : await resolveCanonicalWorkspaceProjectBinding(
      session.user.id,
      body.projectKey,
      undefined,
      body.repositoryKey,
    )
  if (!projectBinding.ok) return Response.json({ error: projectBinding.error }, { status: 503 })
  const projectRoot = path.resolve(projectBinding.binding.workspaceRoot)
  const configuredProjectRoot = path.resolve(projectBinding.binding.configuredWorkspaceRoot)
  const assignmentProjectBinding = {
    projectId: projectBinding.binding.projectId,
    projectKey: projectBinding.binding.projectKey,
    repositoryResourceKey: projectBinding.binding.repositoryKey,
    repositoryIdentity: projectBinding.binding.repositoryIdentity,
    repositoryMountKey: projectBinding.binding.repositoryMountKey,
    observedRevision: projectBinding.binding.observedRevision,
    spaceIdentity: projectBinding.binding.project.identity,
  }
  const continuationDependencies = codexContinuationDependenciesForProjectRoot(
    projectRoot,
    async (repository) => continuationRepositoryMatches(repository, projectBinding.binding)
      ? projectRoot
      : null,
  )
  const worldId = typeof body.worldId === "string" ? body.worldId.trim() : ""
  if (!worldId || worldId.length > 200 || worldId.includes("\0")) {
    return Response.json({ error: "WORLD_ID_REQUIRED" }, { status: 400 })
  }
  const automatic = body.automatic === true
  if (body.automatic !== undefined && body.automatic !== true) {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }
  let prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (automatic && prompt) return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  if (!automatic && !prompt) return Response.json({ error: "PROMPT_REQUIRED" }, { status: 400 })
  if (prompt.length > MAX_PROMPT_CHARS) {
    return Response.json({ error: "PROMPT_TOO_LONG" }, { status: 400 })
  }

  const resuming = body.resume === true
  const requestedId = typeof body.sessionId === "string" && SESSION_ID.test(body.sessionId)
    ? body.sessionId
    : null
  if (resuming && !requestedId) {
    return Response.json({ error: "SESSION_ID_REQUIRED" }, { status: 400 })
  }
  if (automatic && (resuming || requestedId)) {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }

  let repositoryAuthority: SpaceMutationAuthority | null = null
  if (body.repositoryKey !== undefined) {
    try {
      repositoryAuthority = await deriveSpaceMutationAuthority({
        userId: session.user.id,
        worldId,
        binding: repositoryMutationBinding(projectBinding.binding),
        expected: { actor: "codex", capability: "selected-file-change" },
        target: { kind: "selected-file" },
      })
    } catch (error) {
      return Response.json({
        error: error instanceof SpaceMutationAuthorityError
          ? error.code
          : "SPACE_MUTATION_AUTHORITY_UNAVAILABLE",
      }, { status: error instanceof SpaceMutationAuthorityError ? 403 : 503 })
    }
  }

  let releaseContinuationClaim: (() => Promise<void>) | null = null
  if (automatic) {
    releaseContinuationClaim = await acquireCodexContinuationClaim(session.user.id, worldId)
    if (!releaseContinuationClaim) {
      return Response.json(
        { error: "CODEX_CONTINUATION_IN_FLIGHT" },
        { status: 409, headers: { "cache-control": "no-store" } },
      )
    }
  }
  const releaseClaim = async () => {
    if (!releaseContinuationClaim) return
    const release = releaseContinuationClaim
    releaseContinuationClaim = null
    await release()
  }

  let assignment: CodexAssignment
  try {
    assignment = await deriveCodexAssignment({
      userId: session.user.id,
      worldId,
      projectRoot,
      projectBinding: assignmentProjectBinding,
    })
  } catch (error) {
    await releaseClaim()
    const code = typeof (error as { code?: unknown })?.code === "string"
      ? String((error as { code: string }).code)
      : "CODEX_ASSIGNMENT_REFUSED"
    const detail = sanitizeAppServerText((error as { message?: unknown })?.message).slice(0, 500)
    return Response.json(
      { error: code, ...(detail ? { detail } : {}) },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }

  if (repositoryAuthority && (assignment.worldId !== repositoryAuthority.worldId
    || assignment.outcomeKey !== repositoryAuthority.outcomeKey
    || assignment.workOrderId !== repositoryAuthority.workOrderId
    || assignment.grantId !== repositoryAuthority.grantId
    || assignment.selectedPath !== repositoryAuthority.selectedPath)) {
    await releaseClaim()
    return Response.json(
      { error: "CODEX_ASSIGNMENT_STALE" },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }

  let repositoryReservationClaims: RepositoryAssignmentReservationClaims
  try {
    repositoryReservationClaims = await deriveRepositoryAssignmentReservationClaims({
      userId: session.user.id,
      workOrderId: assignment.workOrderId,
      grantId: assignment.grantId,
    })
  } catch {
    await releaseClaim()
    return Response.json(
      { error: "CODEX_ASSIGNMENT_RESERVATION_UNAVAILABLE" },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }

  if (automatic) {
    let continuation
    try {
      continuation = await readCodexContinuation(
        session.user.id,
        worldId,
        continuationDependencies,
      )
    } catch (error) {
      await releaseClaim()
      throw error
    }
    if (continuation.status !== "NEXT_ASSIGNMENT"
      || continuation.selectedPath !== assignment.selectedPath
      || continuation.repositoryKey !== projectBinding.binding.repositoryKey) {
      await releaseClaim()
      return Response.json(
        { error: "CODEX_CONTINUATION_NOT_PENDING" },
        { status: 409, headers: { "cache-control": "no-store" } },
      )
    }
    prompt = continuation.task
    if (prompt.length > MAX_PROMPT_CHARS) {
      await releaseClaim()
      return Response.json({ error: "PROMPT_TOO_LONG" }, { status: 400 })
    }
  }

  if (resuming) {
    const descriptor = await loomCodexThreadDescriptor(requestedId!)
    if (!descriptor) {
      return Response.json(
        { error: "THREAD_NOT_FOUND" },
        { status: 403, headers: { "cache-control": "no-store" } },
      )
    }
    if (descriptor.owner !== session.user.id) {
      return Response.json(
        { error: "THREAD_NOT_YOURS" },
        { status: 403, headers: { "cache-control": "no-store" } },
      )
    }
    const workspaceMatchesPhysical = descriptor.workspace !== null
      && sameWorkspace(descriptor.workspace, projectRoot)
    const workspaceMatchesConfigured = descriptor.workspace !== null
      && sameWorkspace(descriptor.workspace, configuredProjectRoot)
    let assignmentHashMatches = descriptor.assignmentHash === assignment.assignmentHash
    if (!assignmentHashMatches
      && workspaceMatchesConfigured
      && !workspaceMatchesPhysical
      && !sameWorkspace(configuredProjectRoot, projectRoot)) {
      try {
        const configuredRootAssignment = await deriveCodexAssignmentForVerifiedRootAlias({
          userId: session.user.id,
          worldId,
          configuredProjectRoot,
          verifiedProjectRoot: projectRoot,
          projectBinding: assignmentProjectBinding,
        })
        assignmentHashMatches = descriptor.assignmentHash === configuredRootAssignment.assignmentHash
      } catch {
        assignmentHashMatches = false
      }
    }
    if (descriptor.provider !== "Codex"
      || descriptor.mode !== "delegate"
      || descriptor.workspace === null
      || (!workspaceMatchesPhysical && !workspaceMatchesConfigured)
      || descriptor.worldId !== assignment.worldId
      || descriptor.outcomeKey !== assignment.outcomeKey
      || descriptor.workOrderId !== assignment.workOrderId
      || descriptor.grantId !== assignment.grantId
      || !assignmentHashMatches
      || descriptor.selectedPath !== assignment.selectedPath
      || !durableSessionMatchesRepository(
        descriptor as unknown as Record<string, unknown>,
        projectBinding.binding,
      )) {
      return Response.json(
        { error: "THREAD_DESCRIPTOR_MISMATCH" },
        { status: 403, headers: { "cache-control": "no-store" } },
      )
    }
  }

  const encoder = new TextEncoder()
  let client: CodexClient | null = null
  let isolated: CodexIsolatedWorkspace | null = null
  const turnAbort = new AbortController()
  let streamedCharacters = 0
  let terminal = false
  let sessionSent = false
  let clientClosed = false
  let clientClosePromise: Promise<void> | null = null
  let isolatedCleaned = false
  let cancellationRequested = request.signal.aborted
  let promotionInFlight = false
  let successCommitInFlight = false
  let successCommitted = false
  let continuationFrame: Record<string, unknown> | null = null
  let forcedCloseTimer: ReturnType<typeof setTimeout> | null = null
  const closeClientAndWait = (): Promise<void> => {
    if (clientClosePromise) return clientClosePromise
    clientClosed = true
    if (forcedCloseTimer) clearTimeout(forcedCloseTimer)
    clientClosePromise = client
      ? client.closeAndWait(PROVIDER_CLOSE_TIMEOUT_MS)
      : Promise.resolve()
    return clientClosePromise
  }
  const closeClient = () => {
    if (clientClosed) return
    void closeClientAndWait().catch(() => undefined)
  }
  const cancelTurn = () => {
    // Once promotion begins, cancellation is too late to report as a refusal: the guarded writer
    // must either commit the matching success transaction or restore the original bytes.
    if (promotionInFlight || successCommitted) return
    if (cancellationRequested) {
      if (!turnAbort.signal.aborted) turnAbort.abort()
      return
    }
    cancellationRequested = true
    turnAbort.abort()
    forcedCloseTimer = setTimeout(closeClient, FORCED_CLOSE_MS)
    forcedCloseTimer.unref?.()
  }
  const assertNotCancelled = () => {
    if (cancellationRequested || turnAbort.signal.aborted) {
      throw Object.assign(new Error("Codex turn was cancelled"), { code: "APP_SERVER_CANCELLED" })
    }
  }
  if (cancellationRequested) turnAbort.abort()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: Record<string, unknown>) => {
        if (terminal && frame.type !== "done") return
        try { controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`)) } catch { /* reader left */ }
      }
      const done = (reason: string | null, code: number | null) => {
        if (terminal) return
        terminal = true
        send({ type: "done", reason, code })
        try { controller.close() } catch { /* already closed */ }
      }

      const onNotification = (notification: { method?: unknown; params?: unknown }) => {
        if (terminal || !sessionSent || notification.method !== "item/agentMessage/delta") return
        const params = notification.params && typeof notification.params === "object"
          ? notification.params as Record<string, unknown>
          : null
        const sanitized = sanitizeAppServerText(params?.delta).slice(0, MAX_DELTA_CHARS)
        const remaining = Math.max(0, MAX_STREAM_CHARS - streamedCharacters)
        const text = sanitized.slice(0, remaining)
        if (!text) return
        streamedCharacters += text.length
        send({ type: "delta", text })
      }

      void (async () => {
        let threadId: string | null = requestedId
        try {
          assertNotCancelled()
          if (repositoryAuthority) {
            const currentBinding = await resolveCanonicalWorkspaceProjectBinding(
              session.user.id,
              projectBinding.binding.projectKey,
              undefined,
              projectBinding.binding.repositoryKey,
            )
            if (!currentBinding.ok || !sameResolvedRepository(projectBinding.binding, currentBinding.binding)) {
              throw Object.assign(new Error("the selected repository revision changed before Codex execution"), {
                code: "CODEX_ASSIGNMENT_STALE",
              })
            }
            const currentAuthority = await deriveSpaceMutationAuthority({
              userId: session.user.id,
              worldId: repositoryAuthority.worldId,
              binding: repositoryMutationBinding(currentBinding.binding),
              expected: { actor: "codex", capability: "selected-file-change" },
              target: { kind: "selected-file", requestedPath: repositoryAuthority.selectedPath },
            })
            if (!sameRepositoryAuthority(repositoryAuthority, currentAuthority)) {
              throw Object.assign(new Error("the repository-qualified Space authority changed before Codex execution"), {
                code: "CODEX_ASSIGNMENT_STALE",
              })
            }
          }
          isolated = await createCodexIsolatedWorkspace({
            projectRoot,
            selectedPath: assignment.selectedPath,
            initialContent: assignment.target.content,
          })
          assertNotCancelled()
          client = new CodexAppServerClient({
            cwd: isolated.root,
            timeoutMs: TURN_TIMEOUT_MS,
            onNotification,
          })
          await client.connect()
          assertNotCancelled()
          const account = await client.readAccount()
          assertNotCancelled()
          // `requiresOpenaiAuth` describes the App Server's required account class; it is also true
          // for a healthy signed-in ChatGPT account. Authentication is unavailable only when the
          // server cannot return an actual account type.
          if (account.authType === null) {
            throw Object.assign(new Error("Codex authentication is unavailable"), { code: "CODEX_AUTH_REQUIRED" })
          }
          if (resuming) {
            const restored = await client.resumeThread(requestedId!, {
              cwd: isolated.root,
              approvalPolicy: "never",
              sandbox: "workspace-write",
            })
            if (restored !== requestedId) throw Object.assign(new Error("Codex resumed a different thread"), { code: "THREAD_DESCRIPTOR_MISMATCH" })
            threadId = restored
          } else {
            threadId = await client.startThread({
              cwd: isolated.root,
              approvalPolicy: "never",
              sandbox: "workspace-write",
              ephemeral: false,
            })
            if (typeof threadId !== "string" || !SESSION_ID.test(threadId)) {
              throw Object.assign(new Error("Codex returned an invalid thread id"), { code: "APP_SERVER_UNSUPPORTED_REQUEST" })
            }
          }
          assertNotCancelled()
          if (threadId === null) {
            throw Object.assign(new Error("Codex did not return a thread id"), { code: "APP_SERVER_UNSUPPORTED_REQUEST" })
          }
          const durableThreadId = threadId
          const assignmentCreatedAt = new Date().toISOString()
          const contextManifest = await createCodexAssignmentContextManifest({
            assignment,
            assignmentId: durableThreadId,
            assignmentCreatedAt,
            projectBinding: projectBinding.binding,
            isolatedWorkspace: isolated,
          })
          const dispatchContext = await createAssignmentDispatchContextPackage({
            manifest: contextManifest,
            projectBinding: projectBinding.binding,
            isolatedWorkspace: isolated,
          })
          const repositoryReservation = exactRepositoryReservation(
            durableThreadId,
            contextManifest,
            repositoryReservationClaims,
          )
          await assertRepositoryReservationAvailable({
            userId: session.user.id,
            worldId: assignment.worldId,
            projectId: assignment.binding.projectId,
            workOrderId: assignment.workOrderId,
            grantId: assignment.grantId,
            candidate: repositoryReservation,
          })
          assertNotCancelled()
          const taskDigest = createHash("sha256").update(prompt, "utf8").digest("hex")
          const taskText = sanitizeAppServerText(prompt).slice(0, MAX_PROMPT_CHARS)
          const executionBindingHash = createHash("sha256").update([
            assignment.assignmentHash,
            durableThreadId,
            taskDigest,
            isolated.baseSha,
          ].join("\0"), "utf8").digest("hex")

          // Authority is checked again after the provider session exists but before it can execute.
          // The durable receipt binds that actual session and task to the exact approved snapshot.
          await revalidateCodexAssignment(assignment)
          assertNotCancelled()
          try {
            await recordLoomCodexAssignment({
              userId: session.user.id,
              threadId: durableThreadId,
              workspace: projectRoot,
              worldId: assignment.worldId,
              spaceRevision: assignment.binding.spaceRevision,
              outcomeId: assignment.binding.outcomeId,
              outcomeKey: assignment.outcomeKey,
              outcomeVersion: assignment.binding.outcomeVersion,
              workOrderId: assignment.workOrderId,
              workOrderRef: assignment.binding.workOrderRef,
              workOrderVersion: assignment.binding.workOrderVersion,
              grantId: assignment.grantId,
              grantRef: assignment.binding.grantRef,
              grantVersion: assignment.binding.grantVersion,
              allowed: assignment.allowed,
              forbidden: assignment.forbidden,
              contracts: [...repositoryReservation.contracts],
              environments: [...repositoryReservation.environments],
              reservationVersion: assignment.binding.reservationVersion,
              selectedPath: assignment.selectedPath,
              assignmentHash: assignment.assignmentHash,
              taskDigest,
              taskText,
              executionBindingHash,
              isolatedBaseSha: isolated.baseSha,
              resumed: resuming,
              repositoryResourceKey: assignment.binding.repositoryResourceKey,
              repositoryIdentity: assignment.binding.repositoryResourceKey
                ? assignment.binding.repositoryIdentity
                : undefined,
              repositoryMountKey: assignment.binding.repositoryMountKey,
              observedRevision: assignment.binding.observedRevision,
              contextManifest,
            })
          } catch {
            throw Object.assign(new Error("Codex assignment receipt was not durable"), {
              code: "CODEX_RECEIPT_FAILED",
            })
          }
          assertNotCancelled()

          sessionSent = true
          send({
            type: "session",
            sessionId: durableThreadId,
            provider: "Codex",
            mode: "delegate",
            resumed: resuming,
            selectedPath: assignment.selectedPath,
            assignmentHash: assignment.assignmentHash,
            contextManifest,
            reservationClaims: {
              contracts: [...repositoryReservation.contracts],
              environments: [...repositoryReservation.environments],
            },
            ...(repositoryAuthority ? {
              repositoryResourceKey: repositoryAuthority.repositoryResourceKey,
              repositoryIdentity: repositoryAuthority.repositoryIdentity,
              repositoryMountKey: repositoryAuthority.repositoryMountKey,
              observedRevision: repositoryAuthority.observedRevision,
            } : {}),
          })
          const turn = await client.runTurn({
            threadId: durableThreadId,
            prompt: delegatedPrompt(assignment, prompt, dispatchContext),
            turn: {
              approvalPolicy: "never",
              runtimeWorkspaceRoots: [isolated.root],
              sandboxPolicy: {
                type: "workspaceWrite",
                writableRoots: [isolated.root],
                networkAccess: true,
                excludeTmpdirEnvVar: true,
                excludeSlashTmp: true,
              },
            },
            timeoutMs: TURN_TIMEOUT_MS,
            signal: turnAbort.signal,
          })
          assertNotCancelled()
          if (turn.threadId !== durableThreadId || turn.status !== "completed" || typeof turn.finalText !== "string") {
            throw Object.assign(new Error("Codex returned an invalid terminal result"), { code: "APP_SERVER_TURN_FAILED" })
          }
          const result = sanitizeAppServerText(turn.finalText).slice(0, MAX_RESULT_CHARS)
          assertNotCancelled()
          if (!result) {
            throw Object.assign(new Error("Codex completed without a result"), { code: "APP_SERVER_TURN_FAILED" })
          }

          const isolatedResult = await inspectCodexIsolatedWorkspace(isolated)
          const isolatedBaseSha = isolated.baseSha
          assertNotCancelled()

          // The provider must be gone and the exact disposable worktree cleanup verified before
          // the real checkout is eligible for its first mutation.
          try {
            await closeClientAndWait()
          } catch {
            throw Object.assign(new Error("Codex App Server could not be closed"), { code: "CODEX_PROVIDER_CLOSE_FAILED" })
          }
          await cleanupCodexIsolatedWorkspace(isolated)
          isolatedCleaned = true
          isolated = null
          assertNotCancelled()

          const baseWriterDependencies = workspaceFileWriteDependencies(projectRoot)
          let successReceiptFailed = false
          const writerDependencies = {
            ...baseWriterDependencies,
            authorize: async (requestedPath: string) => {
              if (requestedPath !== assignment.selectedPath) {
                return {
                  ok: false,
                  failure: "FAILED_SCOPE_COLLISION" as const,
                  detail: "promotion requested a path outside the immutable server assignment",
                }
              }
              try {
                if (repositoryAuthority) {
                  const currentBinding = await resolveCanonicalWorkspaceProjectBinding(
                    session.user.id,
                    projectBinding.binding.projectKey,
                    undefined,
                    projectBinding.binding.repositoryKey,
                  )
                  if (!currentBinding.ok || !sameResolvedRepository(projectBinding.binding, currentBinding.binding)) {
                    return {
                      ok: false,
                      failure: "FAILED_AUTHORITY_NOT_GRANTED" as const,
                      detail: "the selected repository revision changed before promotion",
                    }
                  }
                  const currentAuthority = await deriveSpaceMutationAuthority({
                    userId: session.user.id,
                    worldId: repositoryAuthority.worldId,
                    binding: repositoryMutationBinding(currentBinding.binding),
                    expected: { actor: "codex", capability: "selected-file-change" },
                    target: { kind: "selected-file", requestedPath },
                  })
                  if (!sameRepositoryAuthority(repositoryAuthority, currentAuthority)) {
                    return {
                      ok: false,
                      failure: "FAILED_AUTHORITY_NOT_GRANTED" as const,
                      detail: "the repository-qualified Space authority changed before promotion",
                    }
                  }
                }
                await revalidateCodexAssignment(assignment)
                await assertRepositoryReservationAvailable({
                  userId: session.user.id,
                  worldId: assignment.worldId,
                  projectId: assignment.binding.projectId,
                  workOrderId: assignment.workOrderId,
                  grantId: assignment.grantId,
                  candidate: repositoryReservation,
                })
                return { ok: true }
              } catch {
                return {
                  ok: false,
                  failure: "FAILED_AUTHORITY_NOT_GRANTED" as const,
                  detail: "the server assignment or selected target changed before promotion",
                }
              }
            },
            auditStart: async (audit: Parameters<typeof baseWriterDependencies.auditStart>[0]) => {
              // Final authority revalidation is still cancellable. The durable promotion-start
              // audit marks the point after which the writer must settle or restore the file.
              assertNotCancelled()
              promotionInFlight = true
              return baseWriterDependencies.auditStart(audit)
            },
            auditFinish: async (audit: Parameters<typeof baseWriterDependencies.auditFinish>[0]) => {
              if (audit.outcome === "WRITE_FAILED") {
                await baseWriterDependencies.auditFinish(audit)
                return
              }
              successCommitInFlight = true
              try {
                await commitLoomCodexSuccess({
                  userId: session.user.id,
                  threadId: durableThreadId,
                  workspace: projectRoot,
                  resumed: resuming,
                  worldId: assignment.worldId,
                  outcomeKey: assignment.outcomeKey,
                  workOrderId: assignment.workOrderId,
                  grantId: assignment.grantId,
                  assignmentHash: assignment.assignmentHash,
                  selectedPath: assignment.selectedPath,
                  promotionDigest: isolatedResult.digest,
                  baseSha: isolatedBaseSha,
                  taskDigest,
                  executionBindingHash,
                  repositoryResourceKey: assignment.binding.repositoryResourceKey,
                  repositoryIdentity: assignment.binding.repositoryResourceKey
                    ? assignment.binding.repositoryIdentity
                    : undefined,
                  repositoryMountKey: assignment.binding.repositoryMountKey,
                  observedRevision: assignment.binding.observedRevision,
                  contextManifest,
                  promotionAudit: {
                    ...audit,
                    outcome: "SAVED",
                  },
                })
                try {
                  const continuation = await prepareCodexContinuation({
                    userId: session.user.id,
                    worldId: assignment.worldId,
                    outcomeKey: assignment.outcomeKey,
                    workOrderId: assignment.workOrderId,
                    grantId: assignment.grantId,
                    completedPath: assignment.selectedPath,
                  }, continuationDependencies)
                  continuationFrame = { type: "continuation", ...continuation }
                } catch {
                  continuationFrame = { type: "continuation", status: "CONTINUATION_BLOCKED" }
                }
              } catch {
                successReceiptFailed = true
                throw Object.assign(new Error("Codex success transaction failed"), { code: "CODEX_RECEIPT_FAILED" })
              }
            },
          }

          // Cancellation can still win during the writer's exact-path/authority checks. The
          // auditStart override above installs the irreversible boundary immediately before the
          // first durable promotion side effect.
          assertNotCancelled()
          const promoted = await writeGovernedWorkspaceFile({
            userId: session.user.id,
            path: assignment.selectedPath,
            content: isolatedResult.content,
            modifiedAt: assignment.target.modifiedAt,
          }, writerDependencies)
          if (!promoted.ok) {
            if (successReceiptFailed) {
              throw Object.assign(new Error("Codex success transaction failed"), { code: "CODEX_RECEIPT_FAILED" })
            }
            throw Object.assign(new Error(`Codex promotion failed: ${promoted.error}`), {
              code: "CODEX_PROMOTION_FAILED",
            })
          }
          successCommitted = true
          if (continuationFrame) send(continuationFrame)
          send({ type: "result", text: result })
          done(null, 0)
        } catch (error) {
          let settledError = error
          let providerExitConfirmed = false
          try {
            await closeClientAndWait()
            providerExitConfirmed = true
          } catch {
            settledError = Object.assign(new Error("Codex App Server could not be closed"), {
              code: "CODEX_PROVIDER_CLOSE_FAILED",
            })
          }
          if (providerExitConfirmed && isolated && !isolatedCleaned) {
            try {
              await cleanupCodexIsolatedWorkspace(isolated)
              isolatedCleaned = true
              isolated = null
            } catch (cleanupError) {
              settledError = cleanupError
            }
          }
          const settledReason = failureReason(settledError)
          const reason = !successCommitted
            && cancellationRequested
            && settledReason !== "CODEX_CLEANUP_FAILED"
            ? "CANCELLED"
            : settledReason
          if (threadId) {
            try {
              await recordLoomEnd({
                userId: session.user.id,
                kind: "agent",
                subject: threadId,
                outcome: {
                  provider: "Codex",
                  mode: "delegate",
                  code: null,
                  reason,
                  successCommitInFlight,
                  descriptorPersisted: successCommitted,
                },
              })
            } catch { /* the NDJSON outcome must still settle truthfully */ }
          }
          done(reason, null)
        } finally {
          try { await closeClientAndWait() } catch { /* failure already settled above */ }
          try { await releaseClaim() } catch { /* the completed stream already carries terminal truth */ }
        }
      })()
    },
    cancel() {
      // Let runTurn send turn/interrupt and settle before closing. A hung provider is still bounded.
      cancelTurn()
    },
  })

  if (!request.signal.aborted) request.signal.addEventListener("abort", cancelTurn, { once: true })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  })
}
