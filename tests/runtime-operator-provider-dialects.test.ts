import { describe, expect, it } from "vitest"

import { parseCodexRetryAfter } from "../scripts/runtime-operator/williamos-adapters.mjs"

/**
 * Every provider states "my meter is empty, here is when it refills" in its own dialect. That sentence
 * is scheduling information, never an owner boundary, so the kernel must understand all of them or it
 * falls back to a guessed hour -- or worse, treats a refill time as a terminal failure.
 */
describe("provider refill dialects", () => {
  const future = Math.floor(Date.now() / 1000) + 3600

  it("reads the Claude CLI's epoch-after-a-pipe form exactly", () => {
    expect(parseCodexRetryAfter(`Claude AI usage limit reached|${future}`)).toBe(future)
    expect(parseCodexRetryAfter(`5-hour limit reached|${future}`)).toBe(future)
  })

  it("reads the Codex prose form", () => {
    const parsed = parseCodexRetryAfter("You have hit your usage limit. Try again at Dec 31st, 2099 8:33 PM.")
    expect(parsed).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it("ignores a refill time that has already passed rather than scheduling a wait into the past", () => {
    expect(parseCodexRetryAfter("limit reached|1600000000")).toBeNull()
  })

  it("returns null when the output carries no refill signal at all", () => {
    expect(parseCodexRetryAfter("TypeError: cannot read properties of undefined")).toBeNull()
    expect(parseCodexRetryAfter(undefined)).toBeNull()
  })
})
