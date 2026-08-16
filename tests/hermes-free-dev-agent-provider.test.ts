import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const repoRoot = path.resolve(import.meta.dirname, "..")
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8")
const policy = () => JSON.parse(read("config/execution-fabric/hermes-free-dev-agent-v1.policy.json"))
const policyV2 = () => JSON.parse(read("config/execution-fabric/hermes-free-dev-agent-v2.policy.json"))

describe("Hermes free development agent provider", () => {
  it("places execution on Hermes and keeps the canonical repository out of the container", () => {
    const value = policy()
    expect(value.placement).toMatchObject({ controlNode: "omen", executionNode: "hermes-node" })
    expect(value.containment).toMatchObject({ canonicalRepositoryMounted: false, dockerSocketMounted: false })
    expect(read("runtime-hermes-agent/compose.yaml")).not.toContain("william-os-devops:/workspace")
  })

  it("pins the open-source runtime, local model, and image identity without cloud fallback", () => {
    const value = policy()
    expect(value.runtime).toBe("NousResearch/hermes-agent@fa83af3f9a42790730b8966ff67e7d9fb627899f")
    expect(value.build.imageId).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(value.model).toMatchObject({ id: "williamos-qwen3-4b:64k", cloudFallbackAllowed: false })
  })

  it("exposes only an inference allowlist proxy to the agent", () => {
    const source = read("runtime-hermes-agent/inference_proxy.py")
    expect(policy().containment).toMatchObject({ onlyNetworkPeer: "inference-proxy", ollamaManagementApiReachable: false })
    expect(source).toContain('self.path != "/v1/models"')
    expect(source).toContain('self.path != "/v1/chat/completions"')
    expect(source).not.toContain('"/api/delete"')
  })

  it("uses a read-only one-shot container with ephemeral agent state and a safe workspace root", () => {
    const compose = read("runtime-hermes-agent/compose.yaml")
    expect(compose).toContain("read_only: true")
    expect(compose).toContain("HERMES_WRITE_SAFE_ROOT: /workspace")
    expect(compose).toContain("/opt/data:rw,nosuid")
    expect(compose).not.toContain("/var/run/docker.sock")
  })

  it("enforces exact packets, concurrency, timeout, promotion, and network membership", () => {
    const script = read("scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1")
    for (const wall of ["PACKET_FIELDS_WALL", "CONCURRENCY_WALL", "TIMEOUT_WALL", "PROMOTION_WALL", "NETWORK_MEMBERSHIP_WALL"]) {
      expect(script).toContain(`HERMES_FREE_AGENT_${wall}`)
    }
    expect(script).toContain('Global\\WilliamOSHermesFreeDevAgentV1')
  })

  it("fails closed through exact-container cleanup and durable quarantine", () => {
    const script = read("scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1")
    expect(script).toContain("function Remove-ExactAgentContainer")
    expect(script).toContain('name=^/$([regex]::Escape($Name))$')
    expect(script).toContain("HERMES_FREE_AGENT_QUARANTINE_WALL")
    expect(script).toContain("HERMES_FREE_AGENT_CLEANUP_WALL")
    expect(script).toContain("finally {")
  })
})

describe("Hermes free development agent provider — v2 owned-worktree mode", () => {
  it("keeps every v1 containment and identity pin", () => {
    const v1 = policy(); const v2 = policyV2()
    expect(v2.schemaVersion).toBe(2)
    expect(v2.packetSchemaVersion).toBe(2)
    expect(v2.workOrderId).toBe(v1.workOrderId)
    expect(v2.providerId).toBe("hermes-agent-local-qwen-v2")
    expect(v2.runtime).toBe(v1.runtime)
    expect(v2.model).toEqual(v1.model)
    expect(v2.build).toEqual(v1.build)
    expect(v2.containment).toEqual(v1.containment)
    expect(v2.deniedActions).toEqual(v1.deniedActions)
    expect(v2.execution.allowedToolsets).toEqual(v1.execution.allowedToolsets)
    expect(v2.execution.maximumTurns).toBe(v1.execution.maximumTurns)
    expect(v2.execution.timeoutSeconds).toBe(v1.execution.timeoutSeconds)
  })
  it("admits only the orchestrator's owned worktrees as the run workspace", () => {
    const v2 = policyV2()
    expect(v2.placement).toMatchObject({
      controlNode: "omen",
      executionNode: "hermes-node",
      workspaceMode: "OWNED_WORKTREE",
      allowedWorkspaceRoots: ["C:\\Users\\bs\\.williamos\\hermes-bridge\\worktrees"],
    })
    expect(v2.placement.workspaceRoot).toBe(policy().placement.workspaceRoot)
  })
  it("raises the prompt budget for remediation prompts and keeps resume fail-closed", () => {
    const v2 = policyV2()
    expect(v2.execution.promptMaxChars).toBe(60000)
    expect(v2.execution.sessionResumeProven).toBe(false)
    expect(v2.containment.agentStatePersistence).toBe(false)
  })
  it("stays pilot-authorised pending independent review of the v2 mode", () => {
    const v2 = policyV2()
    expect(v2.promotion.status).toBe("PILOT_AUTHORIZED")
    expect(v2.promotion.requiredEvidence).toEqual([...policy().promotion.requiredEvidence, "OWNED_WORKTREE_CONFINEMENT_PROVEN"])
    expect(v2.promotion.satisfiedEvidence).toEqual({ ...policy().promotion.satisfiedEvidence, OWNED_WORKTREE_CONFINEMENT_PROVEN: null })
  })
  it("leaves the lane fail-closed: the unproven evidence line is enforced, not decorative", () => {
    // Intended state until P2 sets OWNED_WORKTREE_CONFINEMENT_PROVEN. Both enforcement points
    // must refuse the shipped policy, so the v2 lane cannot run by accident.
    const v2 = policyV2()
    const unproven = v2.promotion.requiredEvidence.filter((key: string) => {
      const value = v2.promotion.satisfiedEvidence[key]
      return value === null || value === undefined || (typeof value === "string" && value.trim() === "")
    })
    expect(unproven).toEqual(["OWNED_WORKTREE_CONFINEMENT_PROVEN"])
    expect(read("scripts/hermes-bridge/hermes-kernel-client.mjs")).toContain("RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN")
    expect(read("scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1")).toContain("HERMES_FREE_AGENT_EVIDENCE_WALL")
    expect(read("docs/runbooks/hermes-free-dev-agent.md")).toContain("fails closed until `OWNED_WORKTREE_CONFINEMENT_PROVEN` is set by P2 evidence")
  })
})
