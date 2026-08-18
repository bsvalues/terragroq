import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { assertThreadResume } from "../lib/loom/threads"

describe("resuming a workroom thread", () => {
  const userId = "user-1"

  it("lets an operator resume their own thread", () => {
    expect(assertThreadResume({ resuming: true, owner: userId, userId })).toEqual({ ok: true })
  })

  it("refuses another operator's thread, because a valid id is not proof of ownership", () => {
    const verdict = assertThreadResume({ resuming: true, owner: "user-2", userId })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("THREAD_NOT_YOURS")
  })

  it("refuses a thread that was never started, rather than quietly beginning a new one", () => {
    // Starting fresh would make a request for someone else's thread indistinguishable from a typo.
    const verdict = assertThreadResume({ resuming: true, owner: null, userId })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("THREAD_NOT_FOUND")
  })

  it("does not ask about ownership when the caller is not resuming", () => {
    expect(assertThreadResume({ resuming: false, owner: null, userId })).toEqual({ ok: true })
  })
})

/**
 * The gate has to cover every route that can change the checkout, not the ones someone remembered.
 *
 * /api/loom/agent spawns the CLI with acceptEdits against the real project directory -- strictly more
 * capable than /api/loom/edit, which was gated when #831 landed. It was missed anyway, which left a
 * lane refused a one-line edit free to ask the agent for the same change. Enumerating the routes is
 * the only version of this check that keeps holding as routes are added.
 */
describe("work-context coverage across the workroom API", () => {
  const loomRoot = path.join(__dirname, "..", "app", "api", "loom")

  const routes = readdirSync(loomRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, file: path.join(loomRoot, entry.name, "route.ts") }))
    .map((route) => ({ ...route, source: readFileSync(route.file, "utf8") }))

  it("finds the workroom routes", () => {
    expect(routes.length).toBeGreaterThan(0)
  })

  for (const route of routes) {
    const mutates = /export async function (POST|PUT|PATCH|DELETE)/.test(route.source)
    it(`${route.name}: ${mutates ? "enforces" : "needs no"} work context`, () => {
      expect(route.source.includes("requireWorkContext")).toBe(mutates)
    })
  }
})
