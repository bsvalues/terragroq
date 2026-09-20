import { describe, expect, it } from "vitest"

import {
  DEFAULT_HELLO_EXECUTION_ROUTE,
  listHelloExecutionRoutes,
  resolveHelloExecutionRoute,
} from "@/lib/hello-application/execution-routing.mjs"

describe("Hello Application execution routing", () => {
  it("defaults stale clients to the local HERMES route", () => {
    expect(DEFAULT_HELLO_EXECUTION_ROUTE).toBe("hermes-local")
    expect(resolveHelloExecutionRoute(undefined, {
      externalEnabled: false,
      externalEgressApproved: false,
    })).toEqual({
      id: "hermes-local",
      provider: "hermes-local",
      model: "williamos-qwen3-4b:64k",
      external: false,
      metered: false,
    })
  })

  it("maps only admitted explicit Cerebras route ids to pinned models", () => {
    expect(resolveHelloExecutionRoute("cerebras-qwen-3-8-27b", {
      externalEnabled: true,
      externalEgressApproved: true,
    })).toEqual({
      id: "cerebras-qwen-3-8-27b",
      provider: "cerebras",
      model: "qwen-3.8-27b",
      external: true,
      metered: true,
    })
    expect(resolveHelloExecutionRoute("cerebras-gpt-oss-120b", {
      externalEnabled: true,
      externalEgressApproved: true,
    }).model).toBe("gpt-oss-120b")
  })

  it.each([
    ["unknown route", "cerebras-anything", true, true, "HELLO_EXECUTION_ROUTE_INVALID"],
    ["disabled route", "cerebras-gpt-oss-120b", false, true, "HELLO_EXECUTION_ROUTE_UNAVAILABLE"],
    ["missing approval", "cerebras-gpt-oss-120b", true, false, "HELLO_EXTERNAL_EGRESS_APPROVAL_REQUIRED"],
  ])("refuses %s without substituting a local model", (_label, route, enabled, approved, error) => {
    expect(() => resolveHelloExecutionRoute(route, {
      externalEnabled: enabled,
      externalEgressApproved: approved,
    })).toThrow(error)
  })

  it("publishes bounded option metadata without credential state", () => {
    const routes = listHelloExecutionRoutes({ externalEnabled: true })
    expect(routes).toEqual([
      {
        id: "hermes-local",
        label: "Local HERMES — williamos-qwen3-4b:64k (default)",
        provider: "hermes-local",
        model: "williamos-qwen3-4b:64k",
        external: false,
        metered: false,
        available: true,
      },
      {
        id: "cerebras-gpt-oss-120b",
        label: "Cerebras — gpt-oss-120b (external, metered)",
        provider: "cerebras",
        model: "gpt-oss-120b",
        external: true,
        metered: true,
        available: true,
      },
      {
        id: "cerebras-qwen-3-8-27b",
        label: "Cerebras — qwen-3.8-27b (external, metered)",
        provider: "cerebras",
        model: "qwen-3.8-27b",
        external: true,
        metered: true,
        available: true,
      },
    ])
    expect(JSON.stringify(routes)).not.toMatch(/credential|api.?key|secret/i)
  })
})
