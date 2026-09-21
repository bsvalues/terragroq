import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { exactKeys, isApplicationId, MAX_APPLICATION_FILE_BYTES, MAX_APPLICATION_MANIFEST_BYTES, parseApplicationManifest, validDisplayName } from "./application-manifest"
import { readApplicationFile, readApplicationRepository, rejectLinkedPath, resolveApplicationsRoot, type ApplicationHostOptions } from "./application-catalog"

const exec = promisify(execFile)
export type ApplicationCreationDependencies = Readonly<{ initializeRepository: (root: string) => Promise<void> }>
const dependencies: ApplicationCreationDependencies = {
  async initializeRepository(root) {
    for (const args of [["init", "-b", "main"], ["add", "--", "."], ["-c", "user.name=WilliamOS", "-c", "user.email=applications@williamos.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Create application from static-web-v1"]]) {
      await exec("git", ["-C", root, "-c", "core.hooksPath=", ...args], { windowsHide: true, timeout: 15000, maxBuffer: 16384 })
    }
  },
}

export async function createApplication(input: unknown, options: ApplicationHostOptions = {}, seams: ApplicationCreationDependencies = dependencies) {
  if (!exactKeys(input, ["id", "displayName"]) || !isApplicationId(input.id) || !validDisplayName(input.displayName)) throw new Error("APPLICATION_REQUEST_INVALID")
  const root = await resolveApplicationsRoot(options)
  if (!root) throw new Error("APPLICATIONS_ROOT_NOT_CONFIGURED")
  // The only starter is platform-owned. Neither request nor host options select an arbitrary template.
  const starter = path.join(process.env.WILLIAMOS_PROJECT_ROOT?.trim() || process.cwd(), "starters/static-web-v1")
  const template = parseApplicationManifest(JSON.parse(await readApplicationFile(starter, ".williamos/application.json", MAX_APPLICATION_MANIFEST_BYTES)), "starter-board")
  const files = new Map<string, string>()
  for (const relative of Object.values(template.source)) files.set(relative, await readApplicationFile(starter, relative, MAX_APPLICATION_FILE_BYTES))
  await fs.mkdir(root, { recursive: true })
  await rejectLinkedPath(root)
  const destination = path.join(root, input.id)
  // Exclusive per-ID sibling reservation prevents two creators racing the final rename.
  const reservation = path.join(root, `.creating-${input.id}.lock`)
  try { await fs.mkdir(reservation) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("APPLICATION_EXISTS")
    throw error
  }
  let temporary: string | undefined
  try {
    try { await fs.lstat(destination); throw new Error("APPLICATION_EXISTS") } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    temporary = await fs.mkdtemp(path.join(root, `.creating-${input.id}-`))
    const manifest = parseApplicationManifest({ ...template, id: input.id, displayName: input.displayName }, input.id)
    files.set(".williamos/application.json", `${JSON.stringify(manifest, null, 2)}\n`)
    for (const [relative, content] of files) {
      await fs.mkdir(path.dirname(path.join(temporary, relative)), { recursive: true })
      await fs.writeFile(path.join(temporary, relative), content, { flag: "wx" })
    }
    await seams.initializeRepository(temporary)
    const verified = await readApplicationRepository(temporary, input.id)
    await rejectLinkedPath(root)
    try { await fs.lstat(destination); throw new Error("APPLICATION_EXISTS") } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    await fs.rename(temporary, destination)
    temporary = undefined
    return { ...verified, repositoryRoot: destination }
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true })
    await fs.rmdir(reservation)
  }
}
