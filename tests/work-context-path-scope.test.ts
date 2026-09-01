import { describe, expect, it } from "vitest"

import {
  receiptCoversMutationScope,
  reservationCoversRequestedPath,
} from "@/lib/governance/work-context-gate"

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

  it("refuses a legacy path-only receipt for a TerraFusion mutation", () => {
    expect(receiptCoversMutationScope(
      { reservedPaths: ["src/app.ts"] },
      {
        requestedPath: "src/app.ts",
        projectKey: "terrafusion",
        repository: "bsvalues/terrafusion_os_1.0",
      },
    )).toEqual({
      ok: false,
      failure: "FAILED_SCOPE_COLLISION",
      detail: "the receipt has no exact project and repository binding",
    })
  })

  it("accepts only the exact bound project, repository, and requested path", () => {
    const receipt = {
      projectKey: "terrafusion",
      repository: "bsvalues/terrafusion_os_1.0",
      reservedPaths: ["src/app.ts"],
    }
    expect(receiptCoversMutationScope(receipt, {
      requestedPath: "src/app.ts",
      projectKey: "terrafusion",
      repository: "bsvalues/terrafusion_os_1.0",
    })).toEqual({ ok: true })
    expect(receiptCoversMutationScope(receipt, {
      requestedPath: "src/app.ts",
      projectKey: "williamos",
      repository: "bsvalues/terragroq",
    })).toMatchObject({ ok: false, failure: "FAILED_SCOPE_COLLISION" })
    expect(receiptCoversMutationScope(receipt, {
      requestedPath: "src/other.ts",
      projectKey: "terrafusion",
      repository: "bsvalues/terrafusion_os_1.0",
    })).toMatchObject({ ok: false, failure: "FAILED_SCOPE_COLLISION" })
  })
})
