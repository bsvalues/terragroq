import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { containsPath, readApplicationFile, rejectLinkedPath } from "./application-catalog"
import { isApplicationId } from "./application-manifest"

export type RuntimeStoreOptions = Readonly<{ runtimeRoot?: string; applicationsRoot?: string; platformRoot?: string; deploymentRoot?: string; assetRoot?: string }>
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT"
type ReaperClaim = { pid: number; token: string; createdAt: number; ticket: number }
const deadOwner = (pid: number) => {
  try { process.kill(pid, 0); return false } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" }
}
export class ApplicationRuntimeStore {
  constructor(private readonly options: RuntimeStoreOptions = {}) {}
  async directory(id: string): Promise<string> {
    if (!isApplicationId(id)) throw new Error("APPLICATION_ID_INVALID")
    const configured = this.options.runtimeRoot ?? process.env.WILLIAMOS_APPLICATION_RUNTIME_ROOT
    const apps = this.options.applicationsRoot ?? process.env.WILLIAMOS_APPLICATIONS_ROOT
    if (!configured || !path.isAbsolute(configured) || !apps || !path.isAbsolute(apps)) throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
    const root = path.resolve(configured)
    const platform = path.resolve(this.options.platformRoot ?? process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd())
    const excluded = [platform, process.cwd(), path.resolve(this.options.deploymentRoot ?? process.env.WILLIAMOS_APPLICATION_DEPLOYMENT_ROOT ?? process.cwd()), path.resolve(apps)]
    const assets = this.options.assetRoot ?? process.env.WILLIAMOS_APPLICATION_ASSET_ROOT
    if (assets) excluded.push(path.resolve(assets))
    for (let ancestor = path.dirname(platform); ancestor !== path.dirname(ancestor); ancestor = path.dirname(ancestor)) {
      try { if ((await fs.lstat(path.join(ancestor, ".git"))).isDirectory()) excluded.push(ancestor) } catch (error) { if (!absent(error)) throw error }
    }
    if (excluded.some((target) => containsPath(target, root) || containsPath(root, target))) throw new Error("APPLICATION_RUNTIME_ROOT_INVALID")
    await rejectLinkedPath(root, undefined, true)
    const directory = path.join(root, id)
    await rejectLinkedPath(directory, undefined, true)
    await fs.mkdir(directory, { recursive: true })
    await rejectLinkedPath(directory)
    return directory
  }
  private filename(name: string) {
    if (!/^[a-z0-9][a-z0-9.-]{0,160}\.json$/.test(name) || name.includes("..")) throw new Error("APPLICATION_RUNTIME_RECORD_INVALID")
    return name
  }
  async readJson<T>(id: string, name: string): Promise<T | null> {
    const directory = await this.directory(id)
    try { return JSON.parse(await readApplicationFile(directory, this.filename(name), 2_000_000)) as T }
    catch (error) { if (absent(error)) return null; throw new Error("APPLICATION_RUNTIME_RECORD_INVALID") }
  }
  async writeJson(id: string, name: string, value: unknown, event?: (event: "synced" | "renamed") => void): Promise<void> {
    const directory = await this.directory(id), target = path.join(directory, this.filename(name))
    await this.atomicJson(directory, target, value, event)
  }
  private async atomicJson(directory: string, target: string, value: unknown, event?: (event: "synced" | "renamed") => void, deadline = Date.now() + 5000) {
    await rejectLinkedPath(target, undefined, true)
    const data = JSON.stringify(value)
    if (Buffer.byteLength(data) > 2_000_000) throw new Error("APPLICATION_RUNTIME_RECORD_INVALID")
    const temporary = path.join(directory, `.write-${randomUUID()}`)
    const handle = await fs.open(temporary, "wx", 0o600)
    try {
      try { await handle.writeFile(data, "utf8"); await handle.sync(); event?.("synced") }
      finally { await handle.close() }
      await rejectLinkedPath(target, undefined, true)
      while (true) {
        try { await fs.rename(temporary, target); break }
        catch (error) {
          // Windows can briefly deny replacement while another contender reads the old
          // complete claim. Never truncate it; retry the atomic rename within our deadline.
          if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") || Date.now() >= deadline) throw error
          await sleep(Math.min(20, Math.max(1, deadline - Date.now())))
          await rejectLinkedPath(target, undefined, true)
        }
      }
      event?.("renamed")
      // POSIX directory fsync persists the rename. Windows does not expose directory fsync
      // through Node; the synced file + same-volume atomic rename is the supported primitive.
      if (process.platform !== "win32") { const parent = await fs.open(directory, "r"); try { await parent.sync() } finally { await parent.close() } }
    } finally { await fs.unlink(temporary).catch((error) => { if (!absent(error)) throw error }) }
  }
  private async reapers(directory: string): Promise<ReaperClaim[]> {
    const claims: ReaperClaim[] = []
    const names = await fs.readdir(directory)
    if (names.includes(".reap")) throw new Error("APPLICATION_RUNTIME_LOCKED") // Legacy/ambiguous ownership needs explicit repair.
    for (const name of names.filter((entry) => entry.startsWith(".reap-"))) {
      try {
        const value = JSON.parse(await readApplicationFile(directory, name, 4096)) as ReaperClaim
        if (!/^[a-f0-9-]{36}$/.test(value.token) || name !== `.reap-${value.token}.json`
          || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !Number.isFinite(value.createdAt) || value.createdAt <= 0
          || !Number.isSafeInteger(value.ticket) || value.ticket < 0 || value.ticket > 1_000_000_000) throw new Error("APPLICATION_RUNTIME_LOCKED")
        // Unique claim paths are never reused: concurrent dead-owner cleanup cannot unlink
        // a successor's ownership (unlike deleting and recreating one shared .reap file).
        if (deadOwner(value.pid)) await fs.unlink(path.join(directory, name))
        else claims.push(value)
      } catch (error) { if (!absent(error)) throw new Error("APPLICATION_RUNTIME_LOCKED") }
    }
    return claims
  }
  async withReaper<T>(id: string, action: () => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
    const directory = await this.directory(id), deadline = Date.now() + (options.timeoutMs ?? 5000)
    const claim: ReaperClaim = { pid: process.pid, token: randomUUID(), createdAt: Date.now(), ticket: 0 }
    const target = path.join(directory, `.reap-${claim.token}.json`)
    // Bakery election: publish a complete choosing record before reading tickets. A live
    // choosing owner is never skipped. Equal tickets are ordered by the unique token.
    const readClaims = async () => {
      while (true) {
        try { return await this.reapers(directory) }
        catch {
          // A reader can overlap an atomic ticket update. Corrupt/inaccessible ownership
          // also remains excluded: no critical section runs unless a full scan succeeds.
          if (Date.now() >= deadline) throw new Error("APPLICATION_RUNTIME_LOCKED")
          await sleep(Math.min(20, Math.max(1, deadline - Date.now())))
        }
      }
    }
    try {
      await this.atomicJson(directory, target, claim, undefined, deadline)
      claim.ticket = Math.max(0, ...(await readClaims()).map((entry) => entry.ticket)) + 1
      if (claim.ticket > 1_000_000_000) throw new Error("APPLICATION_RUNTIME_LOCKED")
      await this.atomicJson(directory, target, claim, undefined, deadline)
      while (true) {
        const others = (await readClaims()).filter((entry) => entry.token !== claim.token)
        if (!others.some((entry) => entry.ticket === 0 || entry.ticket < claim.ticket || (entry.ticket === claim.ticket && entry.token < claim.token))) break
        if (Date.now() >= deadline) throw new Error("APPLICATION_RUNTIME_LOCKED")
        await sleep(Math.min(20, Math.max(1, deadline - Date.now())))
      }
      return await action()
    } finally { await fs.unlink(target).catch((error) => { if (!absent(error)) throw error }) }
  }
  async withLock<T>(id: string, action: () => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
    const directory = await this.directory(id), target = path.join(directory, ".lock")
    const token = randomUUID(), deadline = Date.now() + (options.timeoutMs ?? 5000)
    while (true) {
      const acquired = await this.withReaper(id, async () => {
        await rejectLinkedPath(target, undefined, true)
        try {
          const current = JSON.parse(await readApplicationFile(directory, ".lock", 4096)) as { pid: number; createdAt: number }
          if (Number.isSafeInteger(current.pid) && current.pid > 0 && Number.isFinite(current.createdAt)
            && Date.now() - current.createdAt > 120000 && deadOwner(current.pid)) await fs.unlink(target)
          return false
        } catch (error) { if (!absent(error)) return false }
        // All acquisition/reaping is serialized; atomic publication avoids an empty-lock
        // crash window. Long-running application work does not hold the short reaper claim.
        await this.atomicJson(directory, target, { pid: process.pid, token, createdAt: Date.now() })
        return true
      }, { timeoutMs: Math.max(1, deadline - Date.now()) })
      if (acquired) break
      if (Date.now() >= deadline) throw new Error("APPLICATION_RUNTIME_LOCKED")
      await sleep(Math.min(20, Math.max(1, deadline - Date.now())))
    }
    try { return await action() }
    finally {
      const current = JSON.parse(await readApplicationFile(directory, ".lock", 4096)) as { token: string }
      if (current.token !== token) throw new Error("APPLICATION_RUNTIME_LOCK_LOST")
      await fs.unlink(target)
    }
  }
}
