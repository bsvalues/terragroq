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

/**
 * Resolve a path AND follow every link on the way, then check containment again.
 *
 * The lexical check above is necessary and not sufficient. `path.resolve` reasons about strings, so
 * a symlink or Windows junction sitting inside the workspace and pointing anywhere on the host
 * passes it cleanly -- the string never leaves the root even though the file does. That is not
 * theoretical: a junction planted in the checkout let this API read the private key of the CA that
 * signs every device certificate in the lab, which is enough to mint a credential and sign in as the
 * owner. An agent with edit permission can create such a link, so this cannot rest on trusting
 * whatever is already in the tree.
 *
 * Both sides are resolved to their real locations before comparison, so the check is about where the
 * file actually is rather than how it was spelled. For a path that does not exist yet -- a new file
 * being written -- the nearest existing ancestor is resolved and the remaining segments appended, so
 * creation is still possible without letting a linked parent smuggle the target out of the workspace.
 */
export async function resolveRealWorkspacePath(
  root: string,
  requested: unknown,
  realpath: (p: string) => Promise<string>,
): Promise<WorkspacePathResult> {
  const lexical = resolveWorkspacePath(root, requested)
  if (!lexical.ok || !lexical.absolute) return lexical

  let realRoot: string
  try {
    realRoot = await realpath(path.resolve(root))
  } catch {
    return { ok: false, refusal: "PATH_INVALID" }
  }

  // Walk up to the nearest ancestor that exists, remembering what was missing below it.
  const missing: string[] = []
  let probe = lexical.absolute
  for (;;) {
    try {
      probe = await realpath(probe)
      break
    } catch {
      const parent = path.dirname(probe)
      if (parent === probe) return { ok: false, refusal: "PATH_INVALID" }
      missing.unshift(path.basename(probe))
      probe = parent
    }
  }

  const real = missing.length > 0 ? path.resolve(probe, ...missing) : probe
  const withSeparator = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep
  if (real !== realRoot && !real.startsWith(withSeparator)) {
    return { ok: false, refusal: "PATH_ESCAPES_WORKSPACE" }
  }

  return { ok: true, absolute: real, relative: path.relative(realRoot, real).replace(/\\/g, "/") }
}

/** Directories that are never worth showing and would swamp the tree if they were. */
export function isIgnoredEntry(name: string): boolean {
  return WORKSPACE_IGNORED.has(name) || isSensitiveWorkspacePath(name)
}

/** Secret-bearing environment and private-key files are never available through the browser API. */
export function isSensitiveWorkspacePath(relativePath: string): boolean {
  const name = relativePath.replace(/\\/g, "/").split("/").filter(Boolean).at(-1)?.toLowerCase() ?? ""
  if (name === ".env.example") return false
  return name === ".env"
    || name.endsWith(".env")
    || name.startsWith(".env.")
    || name.endsWith(".env.local")
    || [".pem", ".key", ".p12", ".pfx"].some((extension) => name.endsWith(extension))
    || name === "id_rsa"
    || name === "id_ed25519"
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
