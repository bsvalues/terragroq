import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  HERMES_DISPATCH_LANE,
  USAGE_LIMIT_EXHAUSTION_REASON,
  readProviderStatus,
  recordLaneExhaustion,
  resolveProviderStatusPath,
} from "../scripts/hermes-bridge/provider-status.mjs"

/**
 * Provider exhaustion has to become a LANE fact, not just this outcome's fact.
 *
 * `selectLane` in scripts/runtime-operator/worker-lanes.mjs already reroutes past an exhausted lane —
 * but only past one whose `unavailableUntil` somebody wrote down. The hermes-bridge dispatch path
 * observed the exhaustion and never wrote it, so the shared status file said "codex, until
 * 2026-08-20" while the real limit sat days out and every dispatch kept parking. These tests pin the
 * write, and pin that it can never cost a dispatch.
 */
describe("recordLaneExhaustion", () => {
  let root: string
  let statusPath: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-provider-status-"))
    statusPath = resolveProviderStatusPath({ root })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("stores the parsed retryAfter as the lane's unavailableUntil with a typed reason", () => {
    const result = recordLaneExhaustion({
      unavailableUntil: "2099-08-27T11:36:00.000Z",
      statusPath,
    })

    expect(result.persisted).toBe(true)
    expect(result.outcome).toBe("LANE_EXHAUSTION_RECORDED")
    expect(JSON.parse(fs.readFileSync(statusPath, "utf8"))).toEqual({
      [HERMES_DISPATCH_LANE]: {
        unavailableUntil: "2099-08-27T11:36:00.000Z",
        reason: USAGE_LIMIT_EXHAUSTION_REASON,
      },
    })
  })

  it("merges into the existing document rather than clobbering lastDispatch or other lanes", () => {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true })
    fs.writeFileSync(statusPath, JSON.stringify({
      claude: { unavailableUntil: "2020-01-01T00:00:00.000Z", reason: "RATE_LIMITED" },
      codex: { unavailableUntil: "2026-08-20T00:00:00.000Z", reason: "RATE_LIMITED" },
      lastDispatch: { workOrderId: "WO-0028", lane: "codex", rerouted: false, reason: "ASSIGNED_LANE_AVAILABLE" },
    }, null, 2), "utf8")

    recordLaneExhaustion({ unavailableUntil: "2099-08-27T11:36:00.000Z", statusPath })

    expect(JSON.parse(fs.readFileSync(statusPath, "utf8"))).toEqual({
      claude: { unavailableUntil: "2020-01-01T00:00:00.000Z", reason: "RATE_LIMITED" },
      codex: { unavailableUntil: "2099-08-27T11:36:00.000Z", reason: USAGE_LIMIT_EXHAUSTION_REASON },
      lastDispatch: { workOrderId: "WO-0028", lane: "codex", rerouted: false, reason: "ASSIGNED_LANE_AVAILABLE" },
    })
  })

  it("writes through a temp file and renames it, so no reader can see a half-written document", () => {
    const writes: string[] = []
    const renames: Array<[string, string]> = []
    const fileSystem = {
      readFileSync: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }) },
      mkdirSync: () => undefined,
      writeFileSync: (target: string) => { writes.push(target) },
      renameSync: (from: string, to: string) => { renames.push([from, to]) },
      rmSync: () => undefined,
    }

    const result = recordLaneExhaustion({
      unavailableUntil: "2099-08-27T11:36:00.000Z",
      statusPath,
      fileSystem,
    })

    expect(result.persisted).toBe(true)
    // The destination is never written directly; it only ever appears as a rename target.
    expect(writes).toHaveLength(1)
    expect(writes[0]).not.toBe(statusPath)
    expect(writes[0].startsWith(statusPath)).toBe(true)
    expect(writes[0].endsWith(".tmp")).toBe(true)
    expect(renames).toEqual([[writes[0], statusPath]])
  })

  it("treats an unreadable status file as carrying no availability claims, and still records", () => {
    const fileSystem = {
      readFileSync: () => { throw new Error("EACCES") },
      mkdirSync: () => undefined,
      writeFileSync: () => undefined,
      renameSync: () => undefined,
      rmSync: () => undefined,
    }

    const result = recordLaneExhaustion({
      unavailableUntil: "2099-08-27T11:36:00.000Z",
      statusPath,
      fileSystem,
    })

    expect(result.persisted).toBe(true)
    expect(result.status).toEqual({
      [HERMES_DISPATCH_LANE]: {
        unavailableUntil: "2099-08-27T11:36:00.000Z",
        reason: USAGE_LIMIT_EXHAUSTION_REASON,
      },
    })
  })

  it("fails soft when the file cannot be written — it reports, it does not throw", () => {
    const removed: string[] = []
    const fileSystem = {
      readFileSync: () => JSON.stringify({ lastDispatch: { lane: "codex" } }),
      mkdirSync: () => undefined,
      writeFileSync: () => { throw Object.assign(new Error("EROFS"), { code: "EROFS" }) },
      renameSync: () => { throw new Error("never reached") },
      rmSync: (target: string) => { removed.push(target) },
    }

    const result = recordLaneExhaustion({
      unavailableUntil: "2099-08-27T11:36:00.000Z",
      statusPath,
      fileSystem,
    })

    expect(result.persisted).toBe(false)
    expect(result.outcome).toBe("LANE_EXHAUSTION_WRITE_FAILED")
    // The intended document still comes back, so the caller can consult lane policy on what it saw.
    expect(result.status.codex).toEqual({
      unavailableUntil: "2099-08-27T11:36:00.000Z",
      reason: USAGE_LIMIT_EXHAUSTION_REASON,
    })
    expect(result.status.lastDispatch).toEqual({ lane: "codex" })
    expect(removed).toHaveLength(1)
  })

  it("refuses to invent an instant when the provider stated no resume time", () => {
    for (const unavailableUntil of [null, undefined, "", "soon", "not-a-date"]) {
      const result = recordLaneExhaustion({
        unavailableUntil: unavailableUntil as string,
        statusPath,
      })
      expect(result.persisted).toBe(false)
      expect(result.outcome).toBe("INVALID_LANE_EXHAUSTION")
    }
    expect(fs.existsSync(statusPath)).toBe(false)
  })
})

describe("readProviderStatus", () => {
  it("returns an empty status for a missing, unparseable, or non-object file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-provider-status-read-"))
    try {
      const statusPath = resolveProviderStatusPath({ root })
      expect(readProviderStatus({ statusPath })).toEqual({})

      fs.mkdirSync(path.dirname(statusPath), { recursive: true })
      for (const content of ["{ not json", "[]", "null", "\"codex\""]) {
        fs.writeFileSync(statusPath, content, "utf8")
        expect(readProviderStatus({ statusPath })).toEqual({})
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("resolves the same file the runtime operator's own dispatcher uses", () => {
    expect(resolveProviderStatusPath({ homedir: path.join("HOME") }))
      .toBe(path.join("HOME", ".williamos", "runtime-operator", "state", "provider-status.json"))
  })
})
