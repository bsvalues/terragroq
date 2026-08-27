import path from "node:path"

import { describe, expect, it } from "vitest"

import { admitW1LocalFixtureRequest, w1LocalFixtureConfig } from "@/lib/environment/w1-local-fixture"

const root = path.resolve("work/w1-fixture-root")
const stateFile = path.resolve("work/w1-fixture-state.json")
const enabled = {
  NODE_ENV: "development",
  WILLIAMOS_W1_LOCAL_FIXTURE: "1",
  WILLIAMOS_W1_FIXTURE_ROOT: root,
  WILLIAMOS_W1_FIXTURE_STATE: stateFile,
}

describe("W1 local fixture admission", () => {
  it("is development-only, explicit, and requires absolute isolated paths", () => {
    expect(w1LocalFixtureConfig(enabled)).toEqual({ root, stateFile })
    expect(w1LocalFixtureConfig({ ...enabled, NODE_ENV: "production" })).toBeNull()
    expect(w1LocalFixtureConfig({ ...enabled, WILLIAMOS_W1_LOCAL_FIXTURE: "0" })).toBeNull()
    expect(w1LocalFixtureConfig({ ...enabled, WILLIAMOS_W1_FIXTURE_ROOT: "relative" })).toBeNull()
  })

  it("admits only loopback requests even when the fixture flag is enabled", () => {
    expect(admitW1LocalFixtureRequest(new Request("http://127.0.0.1:3202/api/w1-fixture/files"), enabled)).toEqual({ root, stateFile })
    expect(admitW1LocalFixtureRequest(new Request("http://localhost:3202/api/w1-fixture/files"), enabled)).toEqual({ root, stateFile })
    expect(admitW1LocalFixtureRequest(new Request("https://williamos.example/api/w1-fixture/files"), enabled)).toBeNull()
  })
})
