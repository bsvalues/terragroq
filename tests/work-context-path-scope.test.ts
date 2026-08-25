import { describe, expect, it } from "vitest"

import { reservationCoversRequestedPath } from "@/lib/governance/work-context-gate"

describe("work-context receipt path scope", () => {
  it("refuses a different file than the one the receipt reserved", () => {
    expect(reservationCoversRequestedPath("src/b.ts", ["src/a.ts"]))
      .toEqual({ ok: false, failure: "FAILED_SCOPE_COLLISION", detail: "src/b.ts is outside the receipt path reservation" })
  })

  it("accepts an exact file reservation with normalized separators", () => {
    expect(reservationCoversRequestedPath("src\\a.ts", ["./src/a.ts"])).toEqual({ ok: true })
  })

  it("accepts an explicit directory-prefix reservation without confusing sibling prefixes", () => {
    expect(reservationCoversRequestedPath("src/work/a.ts", ["src/"])).toEqual({ ok: true })
    expect(reservationCoversRequestedPath("src2/work/a.ts", ["src/"]))
      .toMatchObject({ ok: false, failure: "FAILED_SCOPE_COLLISION" })
  })

  it("fails closed on absolute paths and traversal-shaped reservations", () => {
    expect(reservationCoversRequestedPath("C:\\outside.ts", ["C:/"])).toMatchObject({ ok: false })
    expect(reservationCoversRequestedPath("src/a.ts", ["../src/"])).toMatchObject({ ok: false })
  })
})
