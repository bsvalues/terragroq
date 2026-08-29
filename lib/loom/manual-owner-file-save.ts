import fs from "node:fs/promises"
import path from "node:path"

import { workroomFileScope } from "@/lib/governance/workroom-file-scope"
import { withPathWriteSerialization } from "@/lib/loom/path-write-serialization"
import { isSensitiveWorkspacePath, resolveRealWorkspacePath, resolveWorkspacePath } from "@/lib/loom/workspace"

const MAX_FILE_BYTES = 2_000_000

export { withPathWriteSerialization } from "@/lib/loom/path-write-serialization"

function sameFile(left: Awaited<ReturnType<typeof fs.stat>>, right: Awaited<ReturnType<typeof fs.stat>>): boolean {
  // Node exposes stable file IDs on supported Windows and POSIX filesystems. A zero ID is not
  // trustworthy, so fall back to the already repeated realpath equality in that rare case.
  return left.ino === 0 || right.ino === 0 || (left.dev === right.dev && left.ino === right.ino)
}

async function replaceHandleContents(handle: Awaited<ReturnType<typeof fs.open>>, bytes: Uint8Array): Promise<void> {
  await handle.truncate(0)
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset)
    if (bytesWritten <= 0) throw new Error("WRITE_STALLED")
    offset += bytesWritten
  }
  await handle.sync()
}

export type ManualOwnerFileSaveResult =
  | Readonly<{ ok: true; path: string; modifiedAt: string; name: string }>
  | Readonly<{ ok: false; error: string; status: number; detail?: string; modifiedAt?: string }>

/** Save one existing text file after the route has authenticated the human owner. */
export async function writeManualOwnerWorkspaceFile(
  input: Readonly<{ path: unknown; content: string; modifiedAt?: unknown }>,
  projectRoot: string,
  dependencies: Readonly<{ beforeWrite?: () => Promise<void> }> = {},
): Promise<ManualOwnerFileSaveResult> {
  if (Buffer.byteLength(input.content, "utf8") > MAX_FILE_BYTES) {
    return { ok: false, error: "FILE_TOO_LARGE", status: 413 }
  }
  const lexical = resolveWorkspacePath(projectRoot, input.path)
  if (!lexical.ok || !lexical.absolute) {
    return { ok: false, error: lexical.refusal ?? "PATH_INVALID", status: 400 }
  }
  if (isSensitiveWorkspacePath(lexical.relative ?? "")) {
    return { ok: false, error: "SENSITIVE_PATH", status: 403 }
  }
  const preliminary = await resolveRealWorkspacePath(projectRoot, input.path, fs.realpath)
  if (!preliminary.ok || !preliminary.absolute) {
    return { ok: false, error: preliminary.refusal ?? "PATH_INVALID", status: 400 }
  }

  return withPathWriteSerialization(preliminary.absolute, async () => {
    const resolved = await resolveRealWorkspacePath(projectRoot, input.path, fs.realpath)
    if (!resolved.ok || !resolved.absolute || resolved.relative === undefined) {
      return { ok: false, error: resolved.refusal ?? "PATH_INVALID", status: 400 }
    }
    if (resolved.absolute !== preliminary.absolute) {
      return { ok: false, error: "CHANGED_ON_DISK", status: 409 }
    }
    const scope = workroomFileScope(resolved.relative)
    if (!scope.ok) return { ok: false, error: "FAILED_SCOPE_COLLISION", detail: scope.detail, status: 409 }

    let handle
    try {
      handle = await fs.open(resolved.absolute, "r+")
    } catch {
      return { ok: false, error: "NOT_FOUND", status: 404 }
    }

    let original: Buffer | undefined
    try {
      const current = await handle.stat()
      if (!current.isFile()) return { ok: false, error: "NOT_A_FILE", status: 400 }
      // Bound both sides of the replacement. The original bytes are retained for rollback, so an
      // oversized existing file must be refused before readFile can allocate it.
      if (current.size > MAX_FILE_BYTES) return { ok: false, error: "FILE_TOO_LARGE", status: 413 }
      if (typeof input.modifiedAt === "string" && current.mtime.toISOString() !== input.modifiedAt) {
        return { ok: false, error: "CHANGED_ON_DISK", status: 409, modifiedAt: current.mtime.toISOString() }
      }

      // Re-resolve after opening, then compare the pathname with the already-open file descriptor.
      // A target or ancestor swap can change the name, but it cannot redirect writes through this
      // handle to a file outside the admitted workspace.
      const confirmed = await resolveRealWorkspacePath(projectRoot, input.path, fs.realpath)
      if (!confirmed.ok || confirmed.absolute !== resolved.absolute) {
        return { ok: false, error: "CHANGED_ON_DISK", status: 409 }
      }
      const named = await fs.stat(confirmed.absolute)
      if (!sameFile(current, named)) return { ok: false, error: "CHANGED_ON_DISK", status: 409 }

      original = await handle.readFile()
      const beforeWrite = await handle.stat()
      if (!sameFile(current, beforeWrite)
        || beforeWrite.mtimeMs !== current.mtimeMs || beforeWrite.size !== current.size) {
        return { ok: false, error: "CHANGED_ON_DISK", status: 409, modifiedAt: beforeWrite.mtime.toISOString() }
      }
      await dependencies.beforeWrite?.()
      const lastMoment = await handle.stat()
      if (!sameFile(beforeWrite, lastMoment)
        || lastMoment.mtimeMs !== beforeWrite.mtimeMs || lastMoment.size !== beforeWrite.size) {
        return { ok: false, error: "CHANGED_ON_DISK", status: 409, modifiedAt: lastMoment.mtime.toISOString() }
      }
      await replaceHandleContents(handle, Buffer.from(input.content, "utf8"))
      const saved = await handle.stat()

      const finalTarget = await resolveRealWorkspacePath(projectRoot, input.path, fs.realpath)
      if (!finalTarget.ok || finalTarget.absolute !== resolved.absolute) {
        throw new Error("CHANGED_ON_DISK")
      }
      const finalNamed = await fs.stat(finalTarget.absolute)
      if (!sameFile(saved, finalNamed)) throw new Error("CHANGED_ON_DISK")
      return {
        ok: true,
        path: resolved.relative,
        modifiedAt: saved.mtime.toISOString(),
        name: path.basename(resolved.absolute),
      }
    } catch (error) {
      if (original) {
        try {
          await replaceHandleContents(handle, original)
        } catch {
          return { ok: false, error: "ROLLBACK_FAILED", status: 500 }
        }
      }
      if (error instanceof Error && error.message === "CHANGED_ON_DISK") {
        return { ok: false, error: "CHANGED_ON_DISK", status: 409 }
      }
      return { ok: false, error: "WRITE_FAILED", status: 500 }
    } finally {
      await handle.close().catch(() => undefined)
    }
  })
}
