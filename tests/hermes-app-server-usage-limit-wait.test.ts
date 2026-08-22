import { describe, expect, it } from "vitest"

import {
  AppServerTurnEndedError,
  isAppServerUsageLimitDetail,
  parseAppServerUsageLimitRetryAfter,
} from "../scripts/hermes-bridge/app-server-client.mjs"

/**
 * A provider usage/credit exhaustion is a WAIT, not a wall to retry.
 *
 * Diagnosed live 2026-08-22: every Hermes dispatch died in ~3s with the App Server reporting
 * "You've hit your usage limit… or try again at <date>" (codex_error_info: usage_limit_exceeded,
 * credit balance 0). Classified as a generic APP_SERVER_TURN_FAILED it became a RETRYABLE_WALL, so
 * each cycle abandoned the lease and re-dispatched into the identical wall — GOAL-0025 reached
 * attempt 15 against a limit that could not lift for five days, and it held the queue's single
 * active slot the whole time.
 *
 * The provider states exactly when the limit lifts, so the fix waits until that instant instead of
 * guessing a cooldown that would just re-dispatch into the same wall.
 */
describe("parseAppServerUsageLimitRetryAfter", () => {
  it("parses the real observed message, ordinal and all", () => {
    // Deliberately far-future: the parser rejects a lapsed time, so pinning the real 2026 date would
    // invert this assertion the moment the wall clock passed it (a time bomb this repo has already
    // been bitten by). The behaviour under test is the parse, not the date.
    const iso = parseAppServerUsageLimitRetryAfter(
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 27th, 2099 4:36 AM.",
    )
    expect(iso).not.toBeNull()
    expect(new Date(iso as string).getFullYear()).toBe(2099)
  })

  it("returns null for a limit time that has already passed — a lapsed limit is not a wait", () => {
    expect(parseAppServerUsageLimitRetryAfter(
      "You've hit your usage limit. Try again at Aug 27th, 2020 4:36 AM.",
    )).toBeNull()
  })

  it("returns null rather than guessing when the message states no resume time", () => {
    expect(parseAppServerUsageLimitRetryAfter("You've hit your usage limit.")).toBeNull()
    expect(parseAppServerUsageLimitRetryAfter("usage_limit_exceeded")).toBeNull()
  })

  it("never claims a usage-limit wait for an unrelated failure", () => {
    for (const other of [
      "stream disconnected before completion",
      "sandbox denied write to /etc",
      "model returned an invalid tool call",
      "", null, undefined,
    ]) {
      expect(parseAppServerUsageLimitRetryAfter(other as string)).toBeNull()
      expect(isAppServerUsageLimitDetail(other as string)).toBe(false)
    }
  })
})

describe("AppServerTurnEndedError classifies the wait", () => {
  it("marks a usage-limit turn failure and carries the resume instant", () => {
    const error = new AppServerTurnEndedError(
      "failed",
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 27th, 2099 4:36 AM.",
    )
    expect(error.code).toBe("APP_SERVER_TURN_FAILED")
    expect(error.usageLimit).toBe(true)
    expect(error.usageLimitRetryAfter).not.toBeNull()
    expect(new Date(error.usageLimitRetryAfter as string).getFullYear()).toBe(2099)
  })

  it("classifies BEFORE truncation — the resume time sits at the end of a long message", () => {
    // detail is truncated for the checkpoint; parsing the truncated copy would silently drop the
    // resume time and downgrade a precise wait into a blind cooldown.
    const padded = `You've hit your usage limit. ${"x".repeat(4000)} or try again at Aug 27th, 2099 4:36 AM.`
    const error = new AppServerTurnEndedError("failed", padded)
    expect(error.usageLimit).toBe(true)
    expect(new Date(error.usageLimitRetryAfter as string).getFullYear()).toBe(2099)
    expect((error.detail ?? "").length).toBeLessThan(padded.length)
  })

  it("leaves an ordinary turn failure unmarked, so it keeps its existing retry behaviour", () => {
    const error = new AppServerTurnEndedError("failed", "stream disconnected before completion")
    expect(error.usageLimit).toBe(false)
    expect(error.usageLimitRetryAfter).toBeNull()
  })

  it("marks an interrupted turn's usage limit too, without changing its code", () => {
    const error = new AppServerTurnEndedError("interrupted", "You've hit your usage limit.")
    expect(error.code).toBe("APP_SERVER_TURN_INTERRUPTED")
    expect(error.usageLimit).toBe(true)
    // No stated resume time → null, so the caller falls back to its own cooldown rather than inventing one.
    expect(error.usageLimitRetryAfter).toBeNull()
  })
})
