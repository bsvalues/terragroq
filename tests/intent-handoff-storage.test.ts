import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  consumeIntentHandoff,
  INTENT_HANDOFF_KEY,
  storeIntentHandoff,
} from "@/components/intent/intent-handoff"

describe("same-tab intent handoff", () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it("clears a matching handoff after one read", () => {
    storeIntentHandoff("/", "Explain the activity feed")

    expect(consumeIntentHandoff("/")).toBe("Explain the activity feed")
    expect(consumeIntentHandoff("/")).toBe("")
  })

  it("does not disclose a handoff to the wrong destination", () => {
    storeIntentHandoff("/goal-console", "Draft an outcome")

    expect(consumeIntentHandoff("/")).toBe("")
    expect(consumeIntentHandoff("/goal-console")).toBe("Draft an outcome")
  })

  it("drops expired or malformed handoffs", () => {
    values.set(INTENT_HANDOFF_KEY, JSON.stringify({
      destination: "/",
      intent: "stale",
      createdAt: Date.now() - 6 * 60 * 1000,
    }))
    expect(consumeIntentHandoff("/")).toBe("")
    expect(values.has(INTENT_HANDOFF_KEY)).toBe(false)

    values.set(INTENT_HANDOFF_KEY, "not json")
    expect(consumeIntentHandoff("/")).toBe("")
    expect(values.has(INTENT_HANDOFF_KEY)).toBe(false)
  })
})
