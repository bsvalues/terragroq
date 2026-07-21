import { describe, expect, it } from "vitest"

import { sanitizeBridgeMessage } from "../scripts/hermes-bridge/cli.mjs"

describe("Hermes bridge CLI", () => {
  it("redacts credential-bearing database URLs from structured wall output", () => {
    expect(sanitizeBridgeMessage("connect failed for postgresql://owner:opaque-password@db.example.test/app"))
      .toBe("connect failed for postgresql://[REDACTED]@db.example.test/app")
  })
})
