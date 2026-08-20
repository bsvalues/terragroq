import { describe, expect, it } from "vitest"

import { isFrameablePath } from "@/lib/environment/frameable"

/**
 * The public cookieless proxy enumerates what it serves. A character-class check alone let an
 * unauthenticated caller relay GETs to internal /api/* routes from loopback (review P1 on #923) —
 * these cases keep that door closed.
 */
describe("the anon proxy serves only frameable pages", () => {
  it("serves the pages surfaces actually frame", () => {
    expect(isFrameablePath([])).toBe(true)
    expect(isFrameablePath(["sign-in"])).toBe(true)
  })

  it("refuses the api tree outright, however the path is spelled", () => {
    expect(isFrameablePath(["api", "setup", "local-status"])).toBe(false)
    expect(isFrameablePath(["api"])).toBe(false)
  })

  it("refuses everything not enumerated, including harmless-looking pages", () => {
    expect(isFrameablePath(["environment"])).toBe(false)
    expect(isFrameablePath(["_next", "static", "x"])).toBe(false)
    expect(isFrameablePath(["sign-in", "deep"])).toBe(false)
  })

  it("refuses traversal and scheme shapes at the character level too", () => {
    expect(isFrameablePath([".."])).toBe(false)
    expect(isFrameablePath(["sign-in%2f..%2fapi"])).toBe(false)
  })
})

describe("the anon proxy strips scripts for real", () => {
  // The strip regex shipped once with a literal backspace where  belonged and double-escaped
  // classes -- a no-op that nothing tested. Review caught it (P2 on #925) AFTER merge, which is its
  // own recorded failure. This test reads the shipped route source, extracts the exact regexes, and
  // runs them against real-shaped markup, so broken escaping can never ship silently again.
  it("removes script tags and keeps content and styles, using the shipped regexes", async () => {
    const fs = await import("node:fs")
    const source = fs.readFileSync("app/api/environment/anon/[[...path]]/route.ts", "utf8")
    const patterns = [...source.matchAll(/\.replace\(\/(.+?)\/gi, ""\)/g)].map((m) => new RegExp(m[1], "gi"))
    expect(patterns.length).toBeGreaterThanOrEqual(2)
    const html = `<html><head><script src="/a.js" defer></script><link rel="stylesheet" href="/x.css"></head><body><h1>Primary Operator</h1><script>window.boot()</script></body></html>`
    let out = html
    for (const pattern of patterns) out = out.replace(pattern, "")
    expect(out.includes("<script")).toBe(false)
    expect(out).toContain("Primary Operator")
    expect(out).toContain("stylesheet")
  })
})
