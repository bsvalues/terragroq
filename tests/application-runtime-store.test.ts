import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import ts from "typescript"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApplicationRuntimeStore } from "@/lib/applications/application-runtime-store"
import { fixture } from "./application-runtime-fixture"
const roots: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })
async function setup() { const f = await fixture(); roots.push(f.root); const store = new ApplicationRuntimeStore({ runtimeRoot: f.runtimeRoot, applicationsRoot: f.apps, platformRoot: process.cwd() }); return { ...f, store } }
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
    const { root, apps, runtimeRoot } = await setup(); const harness = path.join(root, "harness")
    await fs.mkdir(harness)
    // Compile the actual store and its imports for an independent Node process; assertions
    // below inspect critical-section writes, not implementation source strings.
    for (const name of ["application-runtime-store", "application-catalog", "application-manifest"]) {
      const source = await fs.readFile(path.resolve(`lib/applications/${name}.ts`), "utf8")
      const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "\.\/([^"]+)"/g, 'from "./$1.mjs"')
      await fs.writeFile(path.join(harness, `${name}.mjs`), compiled)
    }
    const events = path.join(root, "events.txt"), script = path.join(harness, "contender.mjs")
    await fs.writeFile(script, `import fs from 'node:fs/promises'; import { ApplicationRuntimeStore } from './application-runtime-store.mjs'; const store = new ApplicationRuntimeStore(${JSON.stringify({ applicationsRoot: apps, runtimeRoot, platformRoot: process.cwd() })}); await store.withLock('first-board', async () => { await fs.appendFile(${JSON.stringify(events)}, 'start:' + process.pid + '\\n'); await new Promise(r => setTimeout(r, 80)); await fs.appendFile(${JSON.stringify(events)}, 'end:' + process.pid + '\\n'); });`)
    await Promise.all([promisify(execFile)(process.execPath, [script], { windowsHide: true }), promisify(execFile)(process.execPath, [script], { windowsHide: true })])
    const lines = (await fs.readFile(events, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(4)
    expect(lines[0].replace("start:", "end:")).toBe(lines[1]); expect(lines[2].replace("start:", "end:")).toBe(lines[3])
    expect(lines[0]).not.toBe(lines[2])
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
