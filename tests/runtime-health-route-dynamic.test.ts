import { describe, expect, it } from "vitest"

import { dynamic as healthDynamic } from "@/app/api/health/route"
import { dynamic as localStatusDynamic } from "@/app/api/local/runtime/status/route"

describe("runtime health route freshness", () => {
  it("forces both live proof routes to evaluate at request time", () => {
    expect(healthDynamic).toBe("force-dynamic")
    expect(localStatusDynamic).toBe("force-dynamic")
  })
})
