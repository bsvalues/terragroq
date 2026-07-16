import { describe, expect, it } from "vitest"

import {
  MULTI_AGENT_CAPABILITY_INVENTORY,
  PREVENTIVE_TRUST_GATE_V2_REF,
  capability,
  evaluateCapabilityDispatch,
  validateCapabilityInventory,
  type MultiAgentCapabilityRecord,
} from "@/components/operator/multi-agent-capability-registry"

function executable(overrides: Partial<MultiAgentCapabilityRecord> = {}): MultiAgentCapabilityRecord {
  return {
    capabilityId: "fixture-hosted-worker",
    label: "Fixture hosted worker",
    kind: "PROVIDER_ADAPTER",
    status: "PILOT_AUTHORIZED",
    executionClass: "EXECUTABLE_WORKER",
    claim: "Fixture-only executable claim.",
    reasonCode: "FIXTURE",
    adapterRef: "fixture-adapter",
    authorityGrantRefs: ["grant-fixture"],
    trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    evidence: ["fixture-evidence"],
    restrictions: [],
    ...overrides,
  }
}

describe("multi-agent executable capability inventory", () => {
  it("uses one complete, unique, evidence-backed inventory", () => {
    expect(validateCapabilityInventory()).toEqual({ valid: true, violations: [] })
    expect(new Set(MULTI_AGENT_CAPABILITY_INVENTORY.map((entry) => entry.capabilityId)).size)
      .toBe(MULTI_AGENT_CAPABILITY_INVENTORY.length)
    expect(MULTI_AGENT_CAPABILITY_INVENTORY.every((entry) => entry.evidence.length > 0)).toBe(true)
  })

  it("distinguishes proven surfaces from executable workers", () => {
    expect(capability("williamos-governance-control-plane")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
    })
    expect(capability("serial-operational-kernel")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
    })
    expect(capability("multi-agent-phase-two-local-contracts")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
      reasonCode: "PHASE_TWO_LOCAL_CONTRACTS_PROVEN",
      restrictions: expect.arrayContaining([
        "No durable provider dispatch or unattended scheduler",
        "No GitHub delivery automation",
      ]),
    })
    expect(capability("multi-agent-phase-three-team-topology-plan")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
      reasonCode: "PHASE_THREE_TEAM_TOPOLOGY_PLAN_PROVEN",
      adapterRef: null,
      authorityGrantRefs: [],
      trustGateRef: null,
      restrictions: expect.arrayContaining([
        "Planning only; no dispatch or runtime activation",
        "No authority grant, minting, or expansion",
        "No rejected nested-runtime reuse",
        "Owner operations remain prohibited and owner-touch counters remain zero",
      ]),
    })
    expect(capability("multi-agent-phase-three-isolated-workspace-manager")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
      reasonCode: "PHASE_THREE_ISOLATED_WORKSPACE_MANAGER_PROVEN",
      adapterRef: null,
      authorityGrantRefs: [],
      trustGateRef: null,
      restrictions: expect.arrayContaining([
        "Git mutation is bounded to exact owned branch/worktree lifecycle under an authorized coordinator",
        "No shared worktree, foreign or dirty change absorption, forced deletion, or unsafe cleanup",
        "No authority grant, provider dispatch, runtime activation, push, PR, merge, or production operation",
        "Owner operations remain prohibited and owner-touch counters remain zero",
      ]),
    })
    expect(capability("multi-agent-phase-three-reservation-aware-handoff")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
      reasonCode: "PHASE_THREE_RESERVATION_AWARE_HANDOFF_PROVEN",
      adapterRef: null,
      authorityGrantRefs: [],
      trustGateRef: null,
      restrictions: expect.arrayContaining([
        "No reservation or lease release during handoff",
        "Reviewer and verifier remain read-only; remediation returns only to the original builder",
        "No second writer, authority grant, provider dispatch, runtime activation, or GitHub operation",
        "Owner operations remain prohibited and owner-touch counters remain zero",
      ]),
    })
    expect(capability("multi-agent-phase-three-concurrency-fairness")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
      reasonCode: "PHASE_THREE_CONCURRENCY_FAIRNESS_PROVEN",
      adapterRef: null,
      authorityGrantRefs: [],
      trustGateRef: null,
      restrictions: expect.arrayContaining([
        "Priority cannot bypass trust, authority, DAG, provider, reservation, lease, risk, or capacity gates",
        "Security preemption emits a bounded drain request and never releases capacity or cancels work",
        "No authority grant, runtime activation, provider dispatch, or GitHub operation",
        "Owner operations remain prohibited and owner-touch counters remain zero",
      ]),
    })
    expect(capability("multi-agent-phase-three-scheduler-model-check")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
      reasonCode: "PHASE_THREE_SCHEDULER_MODEL_CHECK_PROVEN",
      adapterRef: null,
      authorityGrantRefs: [],
      trustGateRef: null,
      evidence: expect.arrayContaining([
        "scripts/multi-agent-operator/scheduler-model-check.mjs",
        "tests/scheduler-model-check.test.ts",
        "docs/reports/WO-MAO-028-scheduler-simulation-model-checking.md",
      ]),
      restrictions: expect.arrayContaining([
        "Pure deterministic simulation only; no provider or runtime execution",
        "No external dispatch, GitHub operation, production mutation, or authority grant",
        "No rejected nested-runtime reuse",
        "Owner operations remain prohibited and owner-touch counters remain zero",
      ]),
    })
    expect(capability("brain-council-advisory")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
    })
    expect(capability("agent-forge-governance")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
    })
    expect(capability("ollama-local-model")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
    })
    expect(MULTI_AGENT_CAPABILITY_INVENTORY.filter((entry) => entry.executionClass === "EXECUTABLE_WORKER")
      .map((entry) => entry.capabilityId))
      .toEqual([])
  })

  it("records provider and adapter truth without architecture inflation", () => {
    expect(capability("local-nested-codex-adapter")).toMatchObject({
      status: "REJECTED",
      executionClass: "WORKER_CANDIDATE",
      reasonCode: "CODEX_NETWORK_WALL",
    })
    expect(capability("hosted-codex-session")).toMatchObject({
      status: "PROVEN",
      executionClass: "WORKER_CANDIDATE",
      coordinationEligible: true,
      adapterRef: null,
      trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    })
    expect(capability("codex-native-subagent-team")).toMatchObject({
      status: "PROVEN",
      executionClass: "WORKER_CANDIDATE",
      coordinationEligible: true,
      adapterRef: null,
      trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
    })
    expect(capability("claude-code-provider")).toMatchObject({
      status: "UNAVAILABLE",
      reasonCode: "PROVIDER_UNAVAILABLE",
    })
    expect(capability("hermes-worker-sidecar")).toMatchObject({
      status: "UNAVAILABLE",
      reasonCode: "PROVIDER_UNAVAILABLE",
    })
  })

  it("keeps hosted coordination available without claiming dispatch eligibility", () => {
    for (const entry of MULTI_AGENT_CAPABILITY_INVENTORY) {
      const decision = evaluateCapabilityDispatch(entry)
      expect(decision).toEqual({ allowed: false, reasonCode: "NOT_EXECUTABLE_WORKER" })
    }
    expect(evaluateCapabilityDispatch(undefined)).toEqual({
      allowed: false,
      reasonCode: "CAPABILITY_NOT_FOUND",
    })
    expect(MULTI_AGENT_CAPABILITY_INVENTORY.filter((entry) => entry.coordinationEligible)
      .map((entry) => entry.capabilityId))
      .toEqual(["hosted-codex-session", "codex-native-subagent-team"])
  })

  it("requires status, adapter, authority, and preventive trust proof for an executable worker", () => {
    expect(evaluateCapabilityDispatch(executable())).toEqual({
      allowed: true,
      reasonCode: "EXECUTABLE_CAPABILITY_ELIGIBLE",
    })
    expect(evaluateCapabilityDispatch(executable({ status: "AVAILABLE_UNPROVEN" }))).toMatchObject({
      allowed: false,
      reasonCode: "CAPABILITY_NOT_AUTHORIZED",
    })
    expect(evaluateCapabilityDispatch(executable({ adapterRef: null }))).toMatchObject({
      allowed: false,
      reasonCode: "ADAPTER_NOT_CONFORMANT",
    })
    expect(evaluateCapabilityDispatch(executable({ authorityGrantRefs: [] }))).toMatchObject({
      allowed: false,
      reasonCode: "AUTHORITY_GRANT_MISSING",
    })
    expect(evaluateCapabilityDispatch(executable({ trustGateRef: null }))).toMatchObject({
      allowed: false,
      reasonCode: "PREVENTIVE_TRUST_GATE_MISSING",
    })
    expect(evaluateCapabilityDispatch(executable({ trustGateRef: "fictional-gate" }))).toMatchObject({
      allowed: false,
      reasonCode: "PREVENTIVE_TRUST_GATE_UNRECOGNIZED",
    })
  })

  it("rejects duplicate, evidence-free, and unsupported executable claims", () => {
    const duplicate = executable({ evidence: [] })
    const result = validateCapabilityInventory([duplicate, duplicate])

    expect(result.valid).toBe(false)
    expect(result.violations).toEqual(expect.arrayContaining([
      "fixture-hosted-worker:EVIDENCE_MISSING",
      "fixture-hosted-worker:DUPLICATE_CAPABILITY_ID",
    ]))

    const rejectedExecutable = executable({ status: "REJECTED" })
    expect(validateCapabilityInventory([rejectedExecutable])).toMatchObject({ valid: false })
    expect(validateCapabilityInventory([rejectedExecutable]).violations).toEqual(expect.arrayContaining([
      "fixture-hosted-worker:CAPABILITY_NOT_AUTHORIZED",
      "fixture-hosted-worker:INACTIVE_CAPABILITY_MARKED_EXECUTABLE",
    ]))
  })
})
