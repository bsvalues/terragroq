import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { createHash } from "node:crypto"
import { applicationManifestDigest, isApplicationId, MAX_APPLICATION_FILE_BYTES, MAX_APPLICATION_MANIFEST_BYTES, parseApplicationManifest, type ApplicationManifest } from "./application-manifest"

const exec = promisify(execFile)
export type ApplicationHostOptions = Readonly<{ applicationsRoot?: string; platformRoot?: string }>
export type CatalogApplication = Readonly<{ manifest: ApplicationManifest; manifestDigest: string; repositoryRoot: string; head: string; projectId: number }>
export type ApplicationCatalog = Readonly<{ applications: readonly CatalogApplication[]; invalid: readonly Readonly<{ id: string; error: string }>[] }>
export const applicationFileSystem = fs
export type ApplicationFileSystem = Pick<typeof fs, "lstat" | "realpath" | "open" | "readdir">

export function applicationProjectId(id: string): number {
  if (!isApplicationId(id)) throw new Error("APPLICATION_ID_INVALID")
  return -Number.parseInt(createHash("sha256").update(`williamos:application-project:v1:${id}`).digest("hex").slice(0, 13), 16) - 1
}

export function containsPath(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

/** Check every existing component, including the root's ancestors, so junctions cannot redirect it. */
export async function rejectLinkedPath(target: string, io: ApplicationFileSystem = fs, allowMissing = false): Promise<void> {
  const absolute = path.resolve(target)
  const base = path.parse(absolute).root
  let current = base
  for (const part of absolute.slice(base.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      if ((await io.lstat(current)).isSymbolicLink()) throw new Error("APPLICATION_PATH_INVALID")
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
  }
}

export async function resolveApplicationsRoot(options: ApplicationHostOptions = {}, io: ApplicationFileSystem = fs): Promise<string | null> {
  const configured = options.applicationsRoot ?? process.env.WILLIAMOS_APPLICATIONS_ROOT?.trim()
  if (!configured) return null
  const platform = path.resolve(options.platformRoot ?? process.env.WILLIAMOS_PROJECT_ROOT?.trim() ?? process.cwd())
  if (!path.isAbsolute(configured) || configured.includes("\0")) throw new Error("APPLICATIONS_ROOT_INVALID")
  const root = path.resolve(configured)
  const excludedRoots = [platform, process.cwd()]
  for (const configured of [process.env.WILLIAMOS_APPLICATION_ASSET_ROOT, process.env.WILLIAMOS_APPLICATION_DEPLOYMENT_ROOT]) {
    if (configured) excludedRoots.push(path.resolve(configured))
  }
  // A runtime may point at a worktree nested inside the primary platform checkout. Its siblings
  // are still platform source, so locating only the innermost worktree is not sufficient.
  for (let ancestor = path.dirname(platform); ancestor !== path.dirname(ancestor); ancestor = path.dirname(ancestor)) {
    try {
      if ((await io.lstat(path.join(ancestor, ".git"))).isDirectory()) excludedRoots.push(ancestor)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("APPLICATIONS_ROOT_INVALID") }
  }
  if (excludedRoots.some((excluded) => containsPath(excluded, root) || containsPath(root, excluded))) throw new Error("APPLICATIONS_ROOT_INVALID")
  try { await rejectLinkedPath(root, io, true) } catch { throw new Error("APPLICATIONS_ROOT_INVALID") }
  return root
}

export async function readApplicationFile(root: string, relative: string, max = MAX_APPLICATION_FILE_BYTES, io: ApplicationFileSystem = fs): Promise<string> {
  const target = path.resolve(root, relative)
  if (!containsPath(root, target) || target === root) throw new Error("APPLICATION_PATH_INVALID")
  await rejectLinkedPath(target, io)
  const before = await io.lstat(target)
  if (!before.isFile() || before.size > max || before.nlink !== 1 || !containsPath(root, await io.realpath(target))) throw new Error("APPLICATION_FILE_INVALID")
  const handle = await io.open(target, "r")
  try {
    const opened = await handle.stat()
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size > max || !opened.isFile()) throw new Error("APPLICATION_FILE_INVALID")
    const bytes = Buffer.alloc(max + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > max) throw new Error("APPLICATION_FILE_TOO_LARGE")
    await rejectLinkedPath(target, io)
    const after = await io.lstat(target)
    if (after.dev !== before.dev || after.ino !== before.ino) throw new Error("APPLICATION_FILE_INVALID")
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))
  } finally { await handle.close() }
}

export async function readApplicationRepository(repositoryRoot: string, folderId = path.basename(repositoryRoot), io: ApplicationFileSystem = fs): Promise<CatalogApplication> {
  await rejectLinkedPath(repositoryRoot, io)
  if (!(await io.lstat(repositoryRoot)).isDirectory()) throw new Error("APPLICATION_INVALID")
  const manifest = parseApplicationManifest(JSON.parse(await readApplicationFile(repositoryRoot, ".williamos/application.json", MAX_APPLICATION_MANIFEST_BYTES, io)), folderId)
  for (const relative of Object.values(manifest.source)) await readApplicationFile(repositoryRoot, relative, MAX_APPLICATION_FILE_BYTES, io)
  const gitRoot = path.join(repositoryRoot, ".git")
  await rejectLinkedPath(gitRoot, io)
  if (!(await io.lstat(gitRoot)).isDirectory()) throw new Error("APPLICATION_REPOSITORY_INVALID")
  const git = async (args: string[]) => (await exec("git", ["-C", repositoryRoot, "--literal-pathspecs", ...args], { windowsHide: true, maxBuffer: 8192, timeout: 10000 })).stdout.trim()
  const top = await io.realpath(await git(["rev-parse", "--show-toplevel"]))
  if (path.relative(await io.realpath(repositoryRoot), top) !== "") throw new Error("APPLICATION_REPOSITORY_INVALID")
  const head = await git(["rev-parse", "--verify", "HEAD"])
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error("APPLICATION_REPOSITORY_INVALID")
  // Working files alone are insufficient: proposal worktrees and fresh checkouts use this commit.
  const requiredPaths = [".williamos/application.json", ...Object.values(manifest.source)]
  const entries = (await git(["ls-tree", "-r", "-z", "--full-tree", head, "--", ...requiredPaths])).split("\0").filter(Boolean)
  const committedPaths = entries.map((entry) => /^(?:100644|100755) blob [a-f0-9]{40,64}\t(.+)$/.exec(entry)?.[1])
  if (entries.length !== requiredPaths.length || !requiredPaths.every((relative) => committedPaths.includes(relative))) {
    throw new Error("APPLICATION_REPOSITORY_INCOMPLETE")
  }
  return { manifest, manifestDigest: applicationManifestDigest(manifest), repositoryRoot: await io.realpath(repositoryRoot), head, projectId: applicationProjectId(manifest.id) }
}

export async function discoverApplications(options: ApplicationHostOptions = {}, io: ApplicationFileSystem = fs, deriveProjectId = applicationProjectId): Promise<ApplicationCatalog> {
  const root = await resolveApplicationsRoot(options, io)
  if (!root) return { applications: [], invalid: [] }
  let names: string[]
  try { names = await io.readdir(root) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { applications: [], invalid: [] }
    throw new Error("APPLICATIONS_ROOT_UNAVAILABLE")
  }
  const applications: CatalogApplication[] = []
  const invalid: { id: string; error: string }[] = []
  for (const id of names.sort()) {
    if (id.startsWith(".creating-")) continue
    try {
      if (!isApplicationId(id)) throw new Error("APPLICATION_INVALID")
      applications.push(await readApplicationRepository(path.join(root, id), id, io))
    } catch { invalid.push({ id, error: "APPLICATION_INVALID" }) }
  }
  const identities = applications.map((application) => ({ ...application, projectId: deriveProjectId(application.manifest.id) }))
  const valid = identities.filter((application) => {
    if (!Number.isSafeInteger(application.projectId) || application.projectId >= 0
      || identities.filter((candidate) => candidate.projectId === application.projectId).length !== 1) {
      invalid.push({ id: application.manifest.id, error: "APPLICATION_IDENTITY_COLLISION" })
      return false
    }
    return true
  })
  return { applications: valid, invalid }
}

export function publicApplication(application: CatalogApplication) {
  return { manifest: application.manifest, manifestDigest: application.manifestDigest, head: application.head,
    projectKey: application.manifest.id, previewUrl: `/api/projects/${application.manifest.id}/application-preview` }
}
