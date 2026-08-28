import fs from "node:fs/promises"
import path from "node:path"

import { db } from "@/lib/db"
import { governanceEvent } from "@/lib/db/schema"
import { requireWorkContext } from "@/lib/governance/work-context-gate"
import type { WorkContextVerdict } from "@/lib/governance/work-context-receipt"
import { workroomFileScope } from "@/lib/governance/workroom-file-scope"
import { withPathWriteSerialization } from "@/lib/loom/path-write-serialization"
import { resolveRealWorkspacePath, type WorkspacePathResult } from "@/lib/loom/workspace"

const MAX_FILE_BYTES = 2_000_000

type AuditStartInput = Readonly<{ userId: string; path: string; bytes: number }>
type AuditFinishInput = AuditStartInput & Readonly<{
  startedAuditId: number
  outcome: "SAVED" | "WRITE_FAILED"
  modifiedAt?: string
}>

export type WorkspaceFileWriteDependencies = Readonly<{
  authorize: (requestedPath: string) => Promise<WorkContextVerdict>
  resolve: (requested: unknown) => Promise<WorkspacePathResult>
  auditStart: (input: AuditStartInput) => Promise<number>
  auditFinish: (input: AuditFinishInput) => Promise<void>
  serialize?: <T>(requested: unknown, work: (lockedAbsolute?: string) => Promise<T>) => Promise<T>
  writeFile?: typeof fs.writeFile
}>

export type WorkspaceFileWriteResult =
  | Readonly<{ ok: true; path: string; modifiedAt: string; name: string }>
  | Readonly<{ ok: false; error: string; status: number; detail?: string; modifiedAt?: string }>

async function strictAuditStart(input: AuditStartInput): Promise<number> {
  const rows = await db.insert(governanceEvent).values({
    userId: input.userId,
    eventType: "LOOP_STARTED",
    entityType: "loom_manual_file_write",
    entityId: input.path,
    actor: "loom",
    reason: `manual workspace save started: ${input.path}`,
    metadata: { operation: "manual_file_write", path: input.path, bytes: input.bytes },
  }).returning({ id: governanceEvent.id })
  if (!rows[0]?.id) throw new Error("AUDIT_START_NOT_DURABLE")
  return rows[0].id
}

async function strictAuditFinish(input: AuditFinishInput): Promise<void> {
  const rows = await db.insert(governanceEvent).values({
    userId: input.userId,
    eventType: "LOOP_STOPPED",
    entityType: "loom_manual_file_write",
    entityId: input.path,
    actor: "loom",
    reason: input.outcome === "SAVED"
      ? `manual workspace save completed: ${input.path}`
      : `manual workspace save failed: ${input.path}`,
    metadata: {
      operation: "manual_file_write",
      path: input.path,
      bytes: input.bytes,
      modifiedAt: input.modifiedAt,
      startedAuditId: input.startedAuditId,
      result: input.outcome,
    },
  }).returning({ id: governanceEvent.id })
  if (!rows[0]?.id) throw new Error("AUDIT_FINISH_NOT_DURABLE")
}

export function workspaceFileWriteDependencies(projectRoot: string): WorkspaceFileWriteDependencies {
  return {
    authorize: requireWorkContext,
    resolve: (requested) => resolveRealWorkspacePath(projectRoot, requested, fs.realpath),
    auditStart: strictAuditStart,
    auditFinish: strictAuditFinish,
    writeFile: fs.writeFile,
  }
}

/**
 * The single manual-save seam: authority and a durable start receipt both precede the first byte.
 * Completion is returned only after the matching durable completion receipt exists.
 */
export async function writeGovernedWorkspaceFile(
  input: Readonly<{ userId: string; path: unknown; content: string; modifiedAt?: unknown }>,
  dependencies: WorkspaceFileWriteDependencies,
): Promise<WorkspaceFileWriteResult> {
  const requestedPath = typeof input.path === "string" ? input.path : ""
  const serialize = dependencies.serialize
    ?? (async <T>(requested: unknown, work: (lockedAbsolute?: string) => Promise<T>) => {
      const preliminary = await dependencies.resolve(requested)
      if (!preliminary.ok || !preliminary.absolute) return work(undefined)
      return withPathWriteSerialization(preliminary.absolute, () => work(preliminary.absolute))
    })
  return serialize(input.path, async (lockedAbsolute) => {
  const authority = await dependencies.authorize(requestedPath)
  if (!authority.ok) {
    return {
      ok: false,
      error: authority.failure ?? "FAILED_CONTEXT_NOT_PROVEN",
      detail: authority.detail,
      status: 409,
    }
  }
  const bytes = Buffer.byteLength(input.content, "utf8")
  if (bytes > MAX_FILE_BYTES) return { ok: false, error: "FILE_TOO_LARGE", status: 413 }

  const resolved = await dependencies.resolve(input.path)
  if (!resolved.ok || !resolved.absolute) {
    return { ok: false, error: resolved.refusal ?? "PATH_INVALID", status: 400 }
  }
  if (lockedAbsolute && resolved.absolute !== lockedAbsolute) {
    return { ok: false, error: "CHANGED_ON_DISK", status: 409 }
  }
  const relative = resolved.relative
  if (relative === undefined) return { ok: false, error: "PATH_INVALID", status: 400 }
  if (relative !== requestedPath.replace(/\\/g, "/").replace(/^\.\//, "")) {
    const resolvedAuthority = await dependencies.authorize(relative)
    if (!resolvedAuthority.ok) {
      return {
        ok: false,
        error: resolvedAuthority.failure ?? "FAILED_CONTEXT_NOT_PROVEN",
        detail: resolvedAuthority.detail,
        status: 409,
      }
    }
  }
  const scope = workroomFileScope(relative)
  if (!scope.ok) return { ok: false, error: "FAILED_SCOPE_COLLISION", detail: scope.detail, status: 409 }
  let current
  try {
    current = await fs.lstat(resolved.absolute)
  } catch {
    return { ok: false, error: "NOT_FOUND", status: 404 }
  }
  if (!current.isFile()) return { ok: false, error: "NOT_A_FILE", status: 400 }
  if (current.isSymbolicLink() || current.nlink !== 1) {
    return { ok: false, error: "LINK_NOT_ALLOWED", status: 409 }
  }
  if (current.size > MAX_FILE_BYTES) return { ok: false, error: "FILE_TOO_LARGE", status: 413 }
  if (typeof input.modifiedAt === "string" && current.mtime.toISOString() !== input.modifiedAt) {
    return { ok: false, error: "CHANGED_ON_DISK", status: 409, modifiedAt: current.mtime.toISOString() }
  }

  let original: Buffer
  try {
    original = await fs.readFile(resolved.absolute)
  } catch {
    return { ok: false, error: "WRITE_FAILED", status: 500 }
  }

  let startedAuditId: number
  try {
    startedAuditId = await dependencies.auditStart({ userId: input.userId, path: relative, bytes })
  } catch {
    return { ok: false, error: "AUDIT_UNAVAILABLE", status: 503 }
  }

  const writeFile = dependencies.writeFile ?? fs.writeFile
  try {
    await writeFile(resolved.absolute, input.content, "utf8")
  } catch {
    let rollbackFailed = false
    try { await fs.writeFile(resolved.absolute, original) } catch { rollbackFailed = true }
    try {
      await dependencies.auditFinish({
        userId: input.userId, path: relative, bytes, startedAuditId, outcome: "WRITE_FAILED",
      })
    } catch {
      return { ok: false, error: "AUDIT_UNAVAILABLE", status: 503 }
    }
    return rollbackFailed
      ? { ok: false, error: "ROLLBACK_FAILED", status: 500 }
      : { ok: false, error: "WRITE_FAILED", status: 500 }
  }
  let saved
  try {
    saved = await fs.lstat(resolved.absolute)
    if (!saved.isFile() || saved.isSymbolicLink() || saved.nlink !== 1) {
      throw new Error("TARGET_REPLACED_WITH_LINK")
    }
    await dependencies.auditFinish({
      userId: input.userId,
      path: relative,
      bytes,
      startedAuditId,
      outcome: "SAVED",
      modifiedAt: saved.mtime.toISOString(),
    })
  } catch {
    try {
      await fs.writeFile(resolved.absolute, original)
    } catch {
      return { ok: false, error: "ROLLBACK_FAILED", status: 500 }
    }
    return { ok: false, error: "AUDIT_UNAVAILABLE", status: 503 }
  }
  return {
    ok: true,
    path: relative,
    modifiedAt: saved.mtime.toISOString(),
    name: path.basename(resolved.absolute),
  }
  })
}
