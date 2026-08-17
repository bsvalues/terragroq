import crypto from "node:crypto"
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
    // P3 W2: the mandatory -QuarantinePath wall in owned mode had no test at all. Without it the
    // marker falls back to the policy directory, i.e. the version-controlled checkout.
    expect(script).toContain("HERMES_FREE_AGENT_QUARANTINE_PATH_WALL")
    expect(script).toContain('$ownedMode -and [string]::IsNullOrWhiteSpace($QuarantinePath)')
  })
})

describe("Hermes free development agent provider — v2 owned-worktree mode", () => {
  it("keeps every v1 containment and identity pin", () => {
    const v1 = policy(); const v2 = policyV2()
    expect(v2.schemaVersion).toBe(2)
    expect(v2.packetSchemaVersion).toBe(3)
    expect(v2.workOrderId).toBe(v1.workOrderId)
    expect(v2.providerId).toBe("hermes-agent-local-qwen-v2")
    expect(v2.runtime).toBe(v1.runtime)
    expect(v2.model).toEqual(v1.model)
    expect(v2.build).toEqual(v1.build)
    // Two containment deltas, both deliberate: per-thread kernel state (P2b, spec §4 item 3) and
    // the deployed-artifact digests (P3 review condition C6). This deep-equal is what content-pins
    // those digests in CI, so a deployed compose/config/runner change cannot land without a
    // reviewed policy change in the same commit.
    expect(v2.containment).toEqual({
      ...v1.containment,
      agentStatePersistence: "PER_THREAD_STATE_DIR",
      // P3 review condition C8: kernel state is a trust surface, so it gets a declared budget.
      threadStateRetention: { maxThreads: 20, maxAgeHours: 168 },
      deployedArtifactSha256: {
        "compose.yaml": "ada957ab2af985aec2f117fc5757f31e326564e344f1ba2358ff37ce1b7d21be",
        "config.yaml": "f8d55cf9c44a3352ee28627b30f8bcaf2f4555a7cdfa419dfae4e67675e454e1",
        "run_agent.py": "8cd7619ddeb7cdbb59c14c9288da1ada4e9c0c8e3d5a6f570dc6f838105e849d",
        // The proxy source is the egress mediator behind NETWORK_ISOLATION_PROVEN, so it is pinned
        // with the topology rather than left as the one unpinned file in the deployed root.
        "inference_proxy.py": "606947a46c8a0bf3848a3c5cb6bd9e127a6d3881d8cbb37ffc6a4de10019ebfa",
      },
    })
    // The invoker must actually enforce them, not merely carry them.
    const invoker = read("scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1")
    expect(invoker).toContain("HERMES_FREE_AGENT_DEPLOYED_ARTIFACT_WALL")
    expect(invoker).toContain("$policy.containment.deployedArtifactSha256")
    // Every pinned artifact is enforced, so the policy and the wall cannot drift apart.
    for (const artifact of Object.keys(v2.containment.deployedArtifactSha256)) {
      expect(invoker).toContain(`"${artifact}"`)
    }
    expect(v2.deniedActions).toEqual(v1.deniedActions)
    expect(v2.execution.allowedToolsets).toEqual(v1.execution.allowedToolsets)
    expect(v2.execution.maximumTurns).toBe(v1.execution.maximumTurns)
    expect(v2.execution.timeoutSeconds).toBe(v1.execution.timeoutSeconds)
  })

  it("pins deployed-artifact digests to reviewable repo content, not to opaque hex", () => {
    // A pinned digest a reviewer cannot check is a number they must take on faith: a coordinated
    // artifact+policy+test edit would pass CI unexamined. Asserting the pin equals the sha256 of the
    // LF-normalised repo copy makes changing a deployed artifact require changing REVIEWABLE CONTENT.
    // It also means the wall fails CLOSED if the deployed host ever stops matching the repo, instead
    // of silently trusting a one-off attestation. Raised by the P3 reviewer as the highest-value
    // follow-up after the grant.
    const pinned = policyV2().containment.deployedArtifactSha256
    expect(Object.keys(pinned).sort()).toEqual(["compose.yaml", "config.yaml", "inference_proxy.py", "run_agent.py"])
    for (const [artifact, digest] of Object.entries(pinned)) {
      const bytes = fs.readFileSync(path.join(repoRoot, "runtime-hermes-agent", artifact))
      const normalised = Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"), "utf8")
      expect(crypto.createHash("sha256").update(normalised).digest("hex")).toBe(digest)
    }
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
    // P2b (2026-08-16) proved kernel session continuity across turns on HERMES; resume is open,
    // and still additionally gated per thread by a captured kernel session id + state dir.
    expect(v2.execution.sessionResumeProven).toBe(true)
    expect(v2.containment.agentStatePersistence).toBe("PER_THREAD_STATE_DIR")
  })
  it("is promoted on a recorded independent review of the v2 mode", () => {
    const v2 = policyV2()
    expect(v2.promotion.status).toBe("PROMOTED")
    expect(v2.promotion.requiredEvidence).toEqual([...policy().promotion.requiredEvidence, "OWNED_WORKTREE_CONFINEMENT_PROVEN", "KERNEL_SESSION_CONTINUITY_PROVEN"])
    // P2 (2026-08-16) proved owned-worktree confinement on HERMES; the value is the completed
    // probe turn id and is documented in docs/reports/hermes-kernel-p2-resident-model-probe-2026-08-16.md.
    // V2_OWNED_WORKTREE_REVIEW_APPROVED granted 2026-08-17 by the Tier 1 independent review. This
    // deep-equal is RE-PINNED to the granted value rather than deleted: it is the only non-circular
    // leg of the evidence machinery (both runtime enforcement points read the same operator-controlled
    // policy), so removing it to make the suite green would remove the anti-self-certification control.
    expect(v2.promotion.satisfiedEvidence).toEqual({ ...policy().promotion.satisfiedEvidence, OWNED_WORKTREE_CONFINEMENT_PROVEN: "p2-b9fbca28-6fea-4898-9533-b556008ff300", KERNEL_SESSION_CONTINUITY_PROVEN: "p2b-1f789bdf-4f51-45f4-aeb3-5080f60a5344", V2_OWNED_WORKTREE_REVIEW_APPROVED: "review-2026-08-17-t1-indep-opus5" })
    expect(read("docs/reports/hermes-kernel-p3-independent-review-2026-08-17.md")).toContain("review-2026-08-17-t1-indep-opus5")
    // W5: the scope annotation is pinned too, so it cannot go stale or be deleted silently.
    expect(Object.keys(v2.promotion.evidenceScope).sort()).toEqual(Object.keys(v2.promotion.satisfiedEvidence).sort())
    expect(v2.promotion.evidenceScope.INDEPENDENT_REVIEW_APPROVED).toContain("v1-SCOPED")
    expect(v2.promotion.evidenceScope.V2_OWNED_WORKTREE_REVIEW_APPROVED).toContain("GRANTED 2026-08-17")
    expect(v2.promotion.evidenceScope.V2_OWNED_WORKTREE_REVIEW_APPROVED).toContain("authorises NO activation")
    expect(read("docs/reports/hermes-kernel-p2-resident-model-probe-2026-08-16.md")).toContain("b9fbca28-6fea-4898-9533-b556008ff300")
    expect(read("docs/reports/hermes-kernel-p2b-session-continuity-2026-08-16.md")).toContain("1f789bdf-4f51-45f4-aeb3-5080f60a5344")
  })
  it("keeps the evidence gate enforced, not decorative", () => {
    // Every declared evidence line is satisfied after P2, and both enforcement points still
    // exist so a future declared-but-unproven line closes the lane again.
    const v2 = policyV2()
    const unproven = v2.promotion.requiredEvidence.filter((key: string) => {
      const value = v2.promotion.satisfiedEvidence[key]
      return value === null || value === undefined || (typeof value === "string" && value.trim() === "")
    })
    expect(unproven).toEqual([])
    expect(read("scripts/hermes-bridge/hermes-kernel-client.mjs")).toContain("RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN")
    expect(read("scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1")).toContain("HERMES_FREE_AGENT_EVIDENCE_WALL")
    expect(read("docs/runbooks/hermes-free-dev-agent.md")).toContain("`OWNED_WORKTREE_CONFINEMENT_PROVEN`")
  })
})

describe("Hermes free development agent provider — P2b per-thread kernel state", () => {
  it("adds an owned-mode compose service whose HERMES_HOME is the per-thread state dir, and leaves `agent` on tmpfs", () => {
    const compose = read("runtime-hermes-agent/compose.yaml")
    const [agentBlock, ownedBlock] = [compose.split("\n  agent-owned:\n")[0], compose.split("\n  agent-owned:\n")[1].split("\n  inference-proxy:\n")[0]]
    expect(agentBlock).toContain("- /opt/data:rw,nosuid,size=256m,mode=0755")
    expect(ownedBlock).toContain("${WILLIAMOS_AGENT_STATE:?set the per-thread kernel state dir}:/opt/data")
    expect(ownedBlock).not.toContain("/opt/data:rw,nosuid")
    expect(ownedBlock).toContain("${WILLIAMOS_AGENT_WORKSPACE:?set the owned worktree}:/workspace")
    expect(ownedBlock).toContain("read_only: true")
    expect(ownedBlock).toContain("- ALL")
    expect(ownedBlock).toContain("no-new-privileges:true")
  })
  it("resumes a captured kernel session only through a validated env var in the runner", () => {
    const runner = read("runtime-hermes-agent/run_agent.py")
    expect(runner).toContain("WILLIAMOS_RESUME_SESSION")
    expect(runner).toContain("[A-Za-z0-9_-]{4,64}")
    expect(runner).toContain('"--resume"')
    expect(runner).toContain("HERMES_FREE_AGENT_SESSION_ID_WALL")
  })
})

describe("Hermes free development agent provider — P3 promotion gate", () => {
  it("claims promotion only with its declared review line satisfied", () => {
    const v2 = policyV2()
    expect(v2.promotion.promotionRequires).toEqual(["V2_OWNED_WORKTREE_REVIEW_APPROVED"])
    // Granted 2026-08-17 by an independent reviewer that did not build this lane. The gate is what
    // matters, not the word: PROMOTED is only legitimate while every promotionRequires line is
    // satisfied, and both enforcement points refuse the lane otherwise.
    expect(v2.promotion.status).toBe("PROMOTED")
    for (const key of v2.promotion.promotionRequires) {
      const value = v2.promotion.satisfiedEvidence[key]
      expect(typeof value === "string" && value.trim().length > 0).toBe(true)
    }
    expect(read("scripts/hermes-bridge/hermes-kernel-client.mjs")).toContain("RESIDENT_MODEL_LANE_PROMOTION_UNPROVEN")
    expect(read("scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1")).toContain("HERMES_FREE_AGENT_PROMOTION_EVIDENCE_WALL")
  })
  it("does not let v1's independent review stand in for the v2 mode", () => {
    const v2 = policyV2()
    // INDEPENDENT_REVIEW_APPROVED is inherited from v1 (2026-08-13) and predates owned-worktree
    // mode entirely, so promotion is gated on a v2-scoped line instead of that value.
    expect(v2.promotion.satisfiedEvidence.INDEPENDENT_REVIEW_APPROVED).toBe(policy().promotion.satisfiedEvidence.INDEPENDENT_REVIEW_APPROVED)
    expect(v2.promotion.promotionRequires).not.toContain("INDEPENDENT_REVIEW_APPROVED")
    expect(read("docs/reports/hermes-kernel-p3-promotion-review-packet-2026-08-16.md")).toContain("V2_OWNED_WORKTREE_REVIEW_APPROVED")
  })
  it("enforces the promotion gate at both enforcement points", () => {
    expect(read("scripts/hermes-bridge/hermes-kernel-client.mjs")).toContain("RESIDENT_MODEL_LANE_PROMOTION_UNPROVEN")
    expect(read("scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1")).toContain("HERMES_FREE_AGENT_PROMOTION_EVIDENCE_WALL")
  })
})
