import fs from "node:fs/promises"
import path from "node:path"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import ts from "typescript"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApplicationRuntimeStore } from "@/lib/applications/application-runtime-store"
import { fixture } from "./application-runtime-fixture"
const roots: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })
async function setup() { const f = await fixture(); roots.push(f.root); const store = new ApplicationRuntimeStore({ runtimeRoot: f.runtimeRoot, applicationsRoot: f.apps, platformRoot: process.cwd() }); return { ...f, store } }
async function compileStore(root: string) {
  const harness = path.join(root, "harness"); await fs.mkdir(harness)
  for (const name of ["application-runtime-store", "application-catalog", "application-manifest"]) {
    const source = await fs.readFile(path.resolve(`lib/applications/${name}.ts`), "utf8")
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
      .replace(/from "\.\/([^"]+)"/g, (_match, dependency: string) => `from "./${dependency.endsWith(".mjs") ? dependency : `${dependency}.mjs`}"`)
    await fs.writeFile(path.join(harness, `${name}.mjs`), compiled)
  }
  await fs.copyFile(path.resolve("lib/applications/application-identity.mjs"), path.join(harness, "application-identity.mjs"))
  return harness
}
describe("durable runtime records and process locks", () => {
  it("atomically syncs and renames records without exposing partial writes", async () => {
    const { store, runtimeRoot } = await setup()
    const events: string[] = []; await store.withLock("first-board", async () => {
      await store.writeJson("first-board", "receipt.json", { desired: "running", sequence: 1 }, (event) => { events.push(event) })
      expect(await store.readJson("first-board", "receipt.json")).toEqual({ desired: "running", sequence: 1 })
    })
    expect(events).toEqual(["synced", "renamed"])
    expect(await fs.readdir(path.join(runtimeRoot, "first-board"))).toEqual(["receipt.json"])
  })
  it("serializes independent instances and cleans locks after thrown operations", async () => {
    const { store, ...f } = await setup(); const other = new ApplicationRuntimeStore({ runtimeRoot: f.runtimeRoot, applicationsRoot: f.apps, platformRoot: process.cwd() })
    const order: number[] = []
    let entered!: () => void
    const acquired = new Promise<void>((resolve) => { entered = resolve })
    const first = store.withLock("first-board", async () => { order.push(1); entered(); await new Promise((r) => setTimeout(r, 60)); order.push(2) })
    await acquired
    await Promise.all([first, other.withLock("first-board", async () => { order.push(3) })])
    expect(order).toEqual([1, 2, 3])
    await expect(store.withLock("first-board", async () => { throw new Error("crash") })).rejects.toThrow("crash")
    await other.withLock("first-board", async () => { order.push(4) }); expect(order).toEqual([1, 2, 3, 4])
  })
  it("retains the previous receipt and cleans temporary files when a write crashes before rename", async () => {
    const { store, runtimeRoot } = await setup()
    await store.writeJson("first-board", "receipt.json", { desired: "stopped" })
    await expect(store.writeJson("first-board", "receipt.json", { desired: "running" }, () => { throw new Error("crash") })).rejects.toThrow("crash")
    expect(await store.readJson("first-board", "receipt.json")).toEqual({ desired: "stopped" })
    expect(await fs.readdir(path.join(runtimeRoot, "first-board"))).toEqual(["receipt.json"])
  })
  it("recovers only stale locks whose process is proven dead; live locks time out", async () => {
    const { store, runtimeRoot } = await setup(); await store.withLock("first-board", async () => {})
    const lock = path.join(runtimeRoot, "first-board", ".lock")
    await fs.writeFile(lock, JSON.stringify({ pid: 2147483647, token: "dead", createdAt: Date.now() - 600000 }))
    await store.withLock("first-board", async () => {})
    await fs.writeFile(lock, JSON.stringify({ pid: process.pid, token: "live", createdAt: Date.now() - 600000 }))
    await expect(store.withLock("first-board", async () => {}, { timeoutMs: 60 })).rejects.toThrow("APPLICATION_RUNTIME_LOCKED")
    expect(JSON.parse(await fs.readFile(lock, "utf8")).token).toBe("live")
  })
  it("serializes two real independent Node processes against the same durable app lock", async () => {
    const { root, apps, runtimeRoot } = await setup(); const harness = await compileStore(root)
    // Compile the actual store and its imports for an independent Node process; assertions
    // below inspect critical-section writes, not implementation source strings.
    const events = path.join(root, "events.txt"), script = path.join(harness, "contender.mjs")
    await fs.writeFile(script, `import fs from 'node:fs/promises'; import { ApplicationRuntimeStore } from './application-runtime-store.mjs'; const store = new ApplicationRuntimeStore(${JSON.stringify({ applicationsRoot: apps, runtimeRoot, platformRoot: process.cwd() })}); await store.withLock('first-board', async () => { await fs.appendFile(${JSON.stringify(events)}, 'start:' + process.pid + '\\n'); await new Promise(r => setTimeout(r, 80)); await fs.appendFile(${JSON.stringify(events)}, 'end:' + process.pid + '\\n'); });`)
    await Promise.all([promisify(execFile)(process.execPath, [script], { windowsHide: true }), promisify(execFile)(process.execPath, [script], { windowsHide: true })])
    const lines = (await fs.readFile(events, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(4)
    expect(lines[0].replace("start:", "end:")).toBe(lines[1]); expect(lines[2].replace("start:", "end:")).toBe(lines[3])
    expect(lines[0]).not.toBe(lines[2])
  })
  it("recovers an abruptly killed independent reaper while excluding its live ownership", async () => {
    const { root, apps, runtimeRoot, store } = await setup(); const harness = await compileStore(root)
    const script = path.join(harness, "reaper.mjs")
    await fs.writeFile(script, `import { ApplicationRuntimeStore } from './application-runtime-store.mjs'; const store = new ApplicationRuntimeStore(${JSON.stringify({ applicationsRoot: apps, runtimeRoot, platformRoot: process.cwd() })}); await store.withReaper('first-board', async () => { process.send('acquired'); await new Promise(() => setInterval(() => {}, 1000)); });`)
    const child = spawn(process.execPath, [script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] })
    let stderr = ""; child.stderr!.on("data", (chunk) => { stderr += chunk })
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`reaper acquisition timed out: ${stderr}`)), 2000)
        child.once("message", (message) => { clearTimeout(timer); message === "acquired" ? resolve() : reject(new Error("invalid reaper event")) })
        child.once("exit", () => { clearTimeout(timer); reject(new Error(`reaper exited before acquisition: ${stderr}`)) })
      })
      const directory = path.join(runtimeRoot, "first-board")
      const claims = (await fs.readdir(directory)).filter((name) => name.startsWith(".reap-") && name.endsWith(".json"))
      expect(claims).toHaveLength(1)
      expect(JSON.parse(await fs.readFile(path.join(directory, claims[0]), "utf8"))).toMatchObject({ pid: child.pid, createdAt: expect.any(Number), token: expect.any(String), ticket: 1 })
      await expect(store.withLock("first-board", async () => {}, { timeoutMs: 80 })).rejects.toThrow("APPLICATION_RUNTIME_LOCKED")
      child.kill("SIGKILL"); await exited
      await store.withLock("first-board", async () => {}, { timeoutMs: 1500 })
      expect(await fs.readdir(directory)).toEqual([])
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited }
  })
  it("fails closed on corrupt reaper ownership without creating an empty shared marker", async () => {
    const { store, runtimeRoot } = await setup(); const directory = await store.directory("first-board")
    const claim = ".reap-12345678-1234-4234-8234-123456789abc.json"
    await fs.writeFile(path.join(directory, claim), "{}"); await fs.utimes(path.join(directory, claim), 1, 1)
    await expect(store.withLock("first-board", async () => {}, { timeoutMs: 80 })).rejects.toThrow("APPLICATION_RUNTIME_LOCKED")
    expect(await fs.readFile(path.join(directory, claim), "utf8")).toBe("{}")
    expect(await fs.readdir(path.join(runtimeRoot, "first-board"))).toEqual([claim])
  })
  it("serializes simultaneous reaper elections and record increments without losing contenders", async () => {
    const { store } = await setup()
    await store.writeJson("first-board", "counter.json", { count: 0 })
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => store.withLock("first-board", async () => {
      const record = await store.readJson<{ count: number }>("first-board", "counter.json")
      await new Promise((resolve) => setTimeout(resolve, 5))
      await store.writeJson("first-board", "counter.json", { count: record!.count + 1 })
    })))
    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true)
    expect(await store.readJson("first-board", "counter.json")).toEqual({ count: 12 })
  })
  it("refuses overlapping roots, escaped filenames, linked roots, and linked state records", async () => {
    const { store, root, apps } = await setup()
    const bad = new ApplicationRuntimeStore({ runtimeRoot: apps, applicationsRoot: apps, platformRoot: process.cwd() })
    await expect(bad.withLock("first-board", async () => {})).rejects.toThrow("APPLICATION_RUNTIME_ROOT_INVALID")
    await expect(store.writeJson("first-board", "../escape", {})).rejects.toThrow()
    await fs.mkdir(path.join(root, "external")); await fs.symlink(path.join(root, "external"), path.join(root, "link"), "junction")
    await expect(new ApplicationRuntimeStore({ runtimeRoot: path.join(root, "link"), applicationsRoot: apps }).withLock("first-board", async () => {})).rejects.toThrow()
  })
  it("excludes deployment stages and rollback archives through the host-only deployment boundary", async () => {
    const { root, apps } = await setup(); const deploy = path.join(root, "deploy")
    vi.stubEnv("WILLIAMOS_APPLICATION_DEPLOYMENT_ROOT", deploy)
    const bad = new ApplicationRuntimeStore({ runtimeRoot: path.join(deploy, "rollback", "runtime-state"), applicationsRoot: apps })
    await expect(bad.withLock("first-board", async () => {})).rejects.toThrow("APPLICATION_RUNTIME_ROOT_INVALID")
  })
  it("accepts intended sibling source/assets/deployment/apps/state layout and refuses state inside assets", async () => {
    const { root } = await setup(); const platform = path.join(root, "source"), assets = path.join(root, "assets"), deployment = path.join(root, "deployment")
    vi.stubEnv("WILLIAMOS_APPLICATION_ASSET_ROOT", assets); vi.stubEnv("WILLIAMOS_APPLICATION_DEPLOYMENT_ROOT", deployment)
    const options = { applicationsRoot: path.join(root, "apps"), platformRoot: platform }
    await new ApplicationRuntimeStore({ ...options, runtimeRoot: path.join(root, "durable-state") }).withLock("first-board", async () => {})
    await expect(new ApplicationRuntimeStore({ ...options, runtimeRoot: path.join(assets, "state") }).withLock("first-board", async () => {})).rejects.toThrow("APPLICATION_RUNTIME_ROOT_INVALID")
  })
})
