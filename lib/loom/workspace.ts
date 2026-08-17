import path from "node:path"

/**
 * Path safety for everything the workroom reads or writes.
 *
 * Every file operation in the cockpit takes a path from the browser, which makes this the one place
 * a mistake turns the workspace into arbitrary read/write on the host. The rule is simple and
 * enforced here rather than at each call site: a request names a path RELATIVE to the project root,
 * and the resolved absolute path must still be inside that root. Anything else is refused rather
 * than clamped, because silently rewriting a path the operator asked for is its own kind of bug.
 */

export const WORKSPACE_IGNORED = new Set([".git", "node_modules", ".next", ".turbo", "dist", "coverage"])

export type WorkspacePathRefusal = "PATH_INVALID" | "PATH_ESCAPES_WORKSPACE"

export interface WorkspacePathResult {
  ok: boolean
  /** Absolute path on disk; present only when ok. */
  absolute?: string
  /** Normalised posix-style path relative to the root; present only when ok. */
  relative?: string
  refusal?: WorkspacePathRefusal
}

/**
 * Resolve a browser-supplied path against the workspace root.
 *
 * Absolute paths, drive letters, UNC paths, NUL bytes and anything that climbs out with `..` are all
 * refused. The containment check compares resolved paths with a separator appended, so a sibling
 * directory whose name merely starts with the root's name (`/repo-backup` next to `/repo`) cannot
 * pass as being inside it.
 */
export function resolveWorkspacePath(root: string, requested: unknown): WorkspacePathResult {
  if (typeof requested !== "string") return { ok: false, refusal: "PATH_INVALID" }
  const candidate = requested.trim()
  if (candidate.includes("\0")) return { ok: false, refusal: "PATH_INVALID" }
  // An empty path means the root itself, which is how the tree asks for the top level.
  const normalised = candidate === "" || candidate === "." ? "." : candidate.replace(/\\/g, "/")
  if (normalised.startsWith("/") || /^[A-Za-z]:/.test(normalised) || normalised.startsWith("//")) {
    return { ok: false, refusal: "PATH_INVALID" }
  }

  const absoluteRoot = path.resolve(root)
  const absolute = path.resolve(absoluteRoot, normalised)
  const withSeparator = absoluteRoot.endsWith(path.sep) ? absoluteRoot : absoluteRoot + path.sep
  if (absolute !== absoluteRoot && !absolute.startsWith(withSeparator)) {
    return { ok: false, refusal: "PATH_ESCAPES_WORKSPACE" }
  }

  const relative = path.relative(absoluteRoot, absolute).replace(/\\/g, "/")
  return { ok: true, absolute, relative }
}

/** Directories that are never worth showing and would swamp the tree if they were. */
export function isIgnoredEntry(name: string): boolean {
  return WORKSPACE_IGNORED.has(name)
}

/**
 * Whether a file should be opened as text.
 *
 * Guessing by extension would mislabel the many extensionless files in a repository, so this decides
 * from the bytes: a NUL in the first block means binary, which is the same heuristic git uses.
 */
export function looksBinary(sample: Uint8Array): boolean {
  const limit = Math.min(sample.length, 8000)
  for (let index = 0; index < limit; index += 1) {
    if (sample[index] === 0) return true
  }
  return false
}
