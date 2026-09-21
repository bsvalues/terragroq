import { describe, expect, it } from "vitest"

import {
  DEFAULT_APPLICATION_EXECUTION_ROUTE,
  listApplicationExecutionRoutes,
  resolveApplicationExecutionRoute,
} from "@/lib/applications/execution-routing.mjs"

describe("application execution routing", () => {
  it("reports route and literal model truth without silently enabling external egress", () => {
    expect(DEFAULT_APPLICATION_EXECUTION_ROUTE).toBe("hermes-local")
    expect(listApplicationExecutionRoutes({ externalEnabled: false })).toEqual([
      expect.objectContaining({ id: "hermes-local", provider: "hermes-local", model: "williamos-qwen3-4b:64k", available: true }),
      expect.objectContaining({ id: "cerebras-gpt-oss-120b", provider: "cerebras", model: "gpt-oss-120b", available: false }),
      expect.objectContaining({ id: "cerebras-qwen-3-8-27b", provider: "cerebras", model: "qwen-3.8-27b", available: false }),
    ])
    expect(resolveApplicationExecutionRoute(undefined, { externalEnabled: false })).toEqual({
      id: "hermes-local",
      provider: "hermes-local",
      model: "williamos-qwen3-4b:64k",
      external: false,
      metered: false,
    })
    expect(() => resolveApplicationExecutionRoute("cerebras-qwen-3-8-27b", {
      externalEnabled: true,
      externalEgressApproved: false,
    })).toThrow("APPLICATION_EXTERNAL_EGRESS_APPROVAL_REQUIRED")
  })

  it("requires an exact known route and exposes no caller-controlled model", () => {
    expect(() => resolveApplicationExecutionRoute("qwen-3.8-27b", {
      externalEnabled: true,
      externalEgressApproved: true,
    })).toThrow("APPLICATION_EXECUTION_ROUTE_INVALID")
    expect(resolveApplicationExecutionRoute("cerebras-qwen-3-8-27b", {
      externalEnabled: true,
      externalEgressApproved: true,
    })).toEqual({
      id: "cerebras-qwen-3-8-27b",
      provider: "cerebras",
      model: "qwen-3.8-27b",
      external: true,
      metered: true,
    })
  })
})
