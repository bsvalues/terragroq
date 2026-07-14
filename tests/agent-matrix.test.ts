import { describe, expect, it } from "vitest"

import { AGENTS, agent, checkAgentPermission } from "@/lib/goal/agent-matrix"

describe("agent capacity matrix", () => {
  it("separates catalog registration from executable provider proof", () => {
    const codex = agent("codex")
    const claude = agent("claude-code")

    expect(codex).toMatchObject({
      catalogStatus: "registered",
      executionStatus: "hosted_transport_unproven",
      requiresWorkOrderGrant: true,
      maxAuthority: "A8_PUSH",
    })
    expect(claude).toMatchObject({
      catalogStatus: "registered",
      executionStatus: "provider_lane_unproven",
      requiresWorkOrderGrant: true,
      maxAuthority: "A8_PUSH",
    })
  })

  it("supports the legacy claude id without keeping a second catalog entry", () => {
    expect(agent("claude")).toBe(agent("claude-code"))
    expect(AGENTS.filter((candidate) => candidate.id.startsWith("claude"))).toHaveLength(1)
  })

  it("allows bounded commit, PR, and merge grants but not release authority", () => {
    expect(checkAgentPermission("codex", "A8_PUSH").allowed).toBe(true)
    expect(checkAgentPermission("claude-code", "A8_PUSH").allowed).toBe(true)
    expect(checkAgentPermission("codex", "A9_RELEASE")).toMatchObject({ allowed: false })
    expect(agent("codex")?.allowed).toContain("merge granted pull requests")
    expect(agent("claude-code")?.blocked).toContain("release")
  })

  it("fails closed for unknown agents and authority levels", () => {
    expect(checkAgentPermission("unregistered", "A0_READ_ONLY")).toMatchObject({ allowed: false })
    expect(checkAgentPermission("codex", "A99_AMBIENT")).toMatchObject({ allowed: false })
  })
})
