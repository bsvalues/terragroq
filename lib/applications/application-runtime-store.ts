import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { containsPath, readApplicationFile, rejectLinkedPath } from "./application-catalog"
import { isApplicationId } from "./application-manifest"

export type RuntimeStoreOptions = Readonly<{ runtimeRoot?: string; applicationsRoot?: string; platformRoot?: string; deploymentRoot?: string; assetRoot?: string }>
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT"
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
    await rejectLinkedPath(target, undefined, true)
    const data = JSON.stringify(value)
    if (Buffer.byteLength(data) > 2_000_000) throw new Error("APPLICATION_RUNTIME_RECORD_INVALID")
    const temporary = path.join(directory, `.write-${randomUUID()}`)
    const handle = await fs.open(temporary, "wx", 0o600)
    try {
      try { await handle.writeFile(data, "utf8"); await handle.sync(); event?.("synced") }
      finally { await handle.close() }
      await rejectLinkedPath(target, undefined, true)
      await fs.rename(temporary, target); event?.("renamed")
      // POSIX directory fsync persists the rename. Windows does not expose directory fsync
      // through Node; the synced file + same-volume atomic rename is the supported primitive.
      if (process.platform !== "win32") { const parent = await fs.open(directory, "r"); try { await parent.sync() } finally { await parent.close() } }
    } finally { await fs.unlink(temporary).catch((error) => { if (!absent(error)) throw error }) }
  }
  async withLock<T>(id: string, action: () => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
    const directory = await this.directory(id), target = path.join(directory, ".lock"), reaper = path.join(directory, ".reap")
    const token = randomUUID(), deadline = Date.now() + (options.timeoutMs ?? 5000)
    while (true) {
      await rejectLinkedPath(target, undefined, true); await rejectLinkedPath(reaper, undefined, true)
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined
      try {
        try { await fs.lstat(reaper); throw Object.assign(new Error("reaping"), { code: "EEXIST" }) } catch (error) { if (!absent(error)) throw error }
        handle = await fs.open(target, "wx", 0o600)
        await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() })); await handle.sync(); await handle.close(); handle = undefined
        // A reaper has exclusive stale-removal authority. A new acquirer yields to it so a
        // competing stale scan can never unlink a new owner's lock (the ABA race).
        let reaping = false
        try { await fs.lstat(reaper); reaping = true } catch (error) { if (!absent(error)) throw error }
        if (reaping) { await fs.unlink(target); await sleep(20); continue }
        break
      } catch (error) {
        await handle?.close()
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        let lease: Awaited<ReturnType<typeof fs.open>> | undefined
        try {
          lease = await fs.open(reaper, "wx", 0o600)
          const current = JSON.parse(await readApplicationFile(directory, ".lock", 4096)) as { pid: number; createdAt: number }
          if (Number.isInteger(current.pid) && current.pid > 0 && Number.isFinite(current.createdAt) && Date.now() - current.createdAt > 120000) {
            let dead = false
            try { process.kill(current.pid, 0) } catch (error) { dead = (error as NodeJS.ErrnoException).code === "ESRCH" }
            if (dead) await fs.unlink(target)
          }
        } catch { /* Malformed, live, inaccessible, and reaper locks fail closed with a bounded wait. */ }
        finally { if (lease) { await lease.close(); await fs.unlink(reaper) } }
        if (Date.now() >= deadline) throw new Error("APPLICATION_RUNTIME_LOCKED")
        await sleep(20)
      }
    }
    try { return await action() }
    finally {
      const current = JSON.parse(await readApplicationFile(directory, ".lock", 4096)) as { token: string }
      if (current.token !== token) throw new Error("APPLICATION_RUNTIME_LOCK_LOST")
      await fs.unlink(target)
    }
  }
}
