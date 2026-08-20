import { describe, expect, it } from "vitest"

import { isFrameablePath } from "@/app/api/environment/anon/[[...path]]/route"

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
