import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GET as filesGet } from "@/app/api/w1-fixture/files/route"
import { GET as spaceGet, PUT as spacePut } from "@/app/api/w1-fixture/space/route"
import { createDefaultSpace } from "@/lib/environment/space-persistence"
import {
  admitW1LocalFixtureRequest,
  validateW1LocalFixtureHome,
  w1FixtureRunningUrl,
  w1LocalFixtureConfig,
  withW1FixtureStateLock,
  writeW1FixtureStateAtomically,
} from "@/lib/environment/w1-local-fixture"

const token = "w1_fixture_0123456789abcdef0123456789abcdef"
let home = ""
let root = ""
let stateFile = ""
let enabled: Record<string, string>

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-w1-fixture-"))
  root = path.join(home, "workspace")
  stateFile = path.join(home, "space-state.json")
  await fs.mkdir(root)
  await fs.writeFile(path.join(home, ".williamos-w1-fixture.json"), JSON.stringify({
    schemaVersion: 1,
    purpose: "disposable-w1-acceptance",
  }))
  enabled = {
    NODE_ENV: "development",
    WILLIAMOS_W1_LOCAL_FIXTURE: "1",
    WILLIAMOS_W1_FIXTURE_HOME: home,
    WILLIAMOS_W1_FIXTURE_TOKEN: token,
  }
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(home, { recursive: true, force: true })
})

function applyEnabledEnvironment() {
  for (const [name, value] of Object.entries(enabled)) vi.stubEnv(name, value)
}

function fixtureRequest(pathname: string, init?: RequestInit) {
  const separator = pathname.includes("?") ? "&" : "?"
  return new Request(`http://localhost:3202${pathname}${separator}token=${token}`, init)
}

describe("W1 local fixture admission", () => {
  it("is development-only, explicit, and derives storage from one absolute scratch home", () => {
    expect(w1LocalFixtureConfig(enabled)).toEqual({
      home,
      root,
      stateFile,
      markerFile: path.join(home, ".williamos-w1-fixture.json"),
      token,
    })
    expect(w1LocalFixtureConfig({ ...enabled, NODE_ENV: "production" })).toBeNull()
    expect(w1LocalFixtureConfig({ ...enabled, WILLIAMOS_W1_LOCAL_FIXTURE: "0" })).toBeNull()
    expect(w1LocalFixtureConfig({ ...enabled, WILLIAMOS_W1_FIXTURE_HOME: "relative" })).toBeNull()
    expect(w1LocalFixtureConfig({ ...enabled, WILLIAMOS_W1_FIXTURE_TOKEN: "too-short" })).toBeNull()
  })

  it("requires both loopback addressing and the high-entropy capability", () => {
    const config = w1LocalFixtureConfig(enabled)
    expect(admitW1LocalFixtureRequest(fixtureRequest("/api/w1-fixture/files"), enabled)).toEqual(config)
    expect(admitW1LocalFixtureRequest(new Request(`http://127.0.0.1:3202/api/w1-fixture/files?token=${token}`), enabled)).toEqual(config)
    expect(admitW1LocalFixtureRequest(new Request(`https://williamos.example/api/w1-fixture/files?token=${token}`), enabled)).toBeNull()
    expect(admitW1LocalFixtureRequest(new Request("http://localhost:3202/api/w1-fixture/files"), enabled)).toBeNull()
    expect(admitW1LocalFixtureRequest(new Request("http://localhost:3202/api/w1-fixture/files?token=wrong"), enabled)).toBeNull()
  })

  it("never turns an untrusted Host header into the Running iframe origin", () => {
    const maliciousHost = fixtureRequest("/api/w1-fixture/space", {
      headers: { host: "evil.example", referer: `http://127.0.0.1:3202/w1-fixture?token=${token}` },
    })
    expect(w1FixtureRunningUrl(maliciousHost)).toBe(`http://127.0.0.1:3202/api/w1-fixture/running?token=${token}`)
    expect(w1FixtureRunningUrl(fixtureRequest("/api/w1-fixture/space", {
      headers: { host: "evil.example" },
    }))).toBe(`http://localhost:3202/api/w1-fixture/running?token=${token}`)
    expect(w1FixtureRunningUrl(fixtureRequest("/api/w1-fixture/space", {
      headers: { referer: "http://127.0.0.1:9999/unrelated" },
    }))).toBe(`http://localhost:3202/api/w1-fixture/running?token=${token}`)
  })

  it("requires the exact disposable marker and refuses linked storage", async () => {
    const config = w1LocalFixtureConfig(enabled)!
    expect(await validateW1LocalFixtureHome(config)).toBe(true)
    await fs.writeFile(config.markerFile, JSON.stringify({ schemaVersion: 1, purpose: "production" }))
    expect(await validateW1LocalFixtureHome(config)).toBe(false)
  })
})

describe("W1 local fixture routes", () => {
  it("keeps production disabled even when the other fixture variables are present", async () => {
    applyEnabledEnvironment()
    vi.stubEnv("NODE_ENV", "production")
    expect((await filesGet(fixtureRequest("/api/w1-fixture/files"))).status).toBe(404)
  })

  it("reads only inside the designated workspace and refuses traversal", async () => {
    applyEnabledEnvironment()
    await fs.writeFile(path.join(root, "fixture.ts"), "export const fixture = true\n")
    const read = await filesGet(fixtureRequest("/api/w1-fixture/files?path=fixture.ts"))
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ kind: "file", path: "fixture.ts" })
    expect((await filesGet(fixtureRequest("/api/w1-fixture/files?path=../outside.ts"))).status).toBe(400)
  })

  it("serializes revision checks so a late lower revision cannot replace a higher one", async () => {
    applyEnabledEnvironment()
    const initial = await spaceGet(fixtureRequest("/api/w1-fixture/space"))
    expect(initial.status).toBe(200)
    const high = { ...createDefaultSpace("http://localhost:3202/api/w1-fixture/running"), revision: 2 }
    const low = { ...high, revision: 1 }
    const makePut = (space: typeof high) => fixtureRequest("/api/w1-fixture/space", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worldId: "w1-local-fixture", space }),
    })
    const highResult = await spacePut(makePut(high))
    const lowResult = await spacePut(makePut(low))
    expect(highResult.status).toBe(200)
    expect(lowResult.status).toBe(409)
    expect(JSON.parse(await fs.readFile(stateFile, "utf8"))).toMatchObject({ revision: 2 })
  })
})

describe("W1 local fixture persistence primitives", () => {
  it("executes overlapping operations in arrival order", async () => {
    const events: string[] = []
    let unblock!: () => void
    const gate = new Promise<void>((resolve) => { unblock = resolve })
    const first = withW1FixtureStateLock(stateFile, async () => {
      events.push("first:start")
      await gate
      events.push("first:end")
    })
    const second = withW1FixtureStateLock(stateFile, async () => { events.push("second") })
    await Promise.resolve()
    expect(events).toEqual(["first:start"])
    unblock()
    await Promise.all([first, second])
    expect(events).toEqual(["first:start", "first:end", "second"])
  })

  it("atomically replaces state without leaving temporary files", async () => {
    await writeW1FixtureStateAtomically(stateFile, "{\"revision\":1}\n")
    await writeW1FixtureStateAtomically(stateFile, "{\"revision\":2}\n")
    expect(await fs.readFile(stateFile, "utf8")).toBe("{\"revision\":2}\n")
    expect((await fs.readdir(home)).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })
})
