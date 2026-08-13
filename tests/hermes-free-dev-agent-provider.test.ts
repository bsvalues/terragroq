import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const repoRoot = path.resolve(import.meta.dirname, "..")
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8")
const policy = () => JSON.parse(read("config/execution-fabric/hermes-free-dev-agent-v1.policy.json"))

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
