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
    expect(capability("hosted-codex-coordinator-adapter")).toMatchObject({
      status: "PROVEN",
      executionClass: "WORKER_CANDIDATE",
      coordinationEligible: true,
      adapterRef: "scripts/multi-agent-operator/codex-coordinator-adapter.mjs",
      trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
      restrictions: expect.arrayContaining([
        "Production host-session, trust, and native-bridge registries remain empty and immutable",
        "Host side effects require exact idempotency, lookup-only reconciliation, and quarantine on uncertain outcomes",
        "Provider-contract dispatch remains false",
        "No durable persistence, service worker, runtime activation, or authority grant",
        "No GitHub write, production operation, rejected nested-runtime reuse, or owner relay",
      ]),
      evidence: expect.arrayContaining([
        "docs/reports/WO-MAO-030-post-merge-assurance-remediation.md",
      ]),
    })
    expect(capability("hosted-codex-role-adapters")).toMatchObject({
      status: "PROVEN",
      executionClass: "WORKER_CANDIDATE",
      coordinationEligible: true,
      reasonCode: "HOSTED_CODEX_ONE_CYCLE_ROLE_LIFECYCLE_PROVEN",
      adapterRef: "scripts/multi-agent-operator/codex-role-adapters.mjs",
      trustGateRef: PREVENTIVE_TRUST_GATE_V2_REF,
      restrictions: expect.arrayContaining([
        "Exactly one bounded remediation and re-review cycle; no multi-cycle or unattended claim",
        "Assurance remains independent and cannot remediate its own finding",
        "Remediation is bound to the original builder and the envelope remediation budget",
        "Opaque same-plan handles, live authority fences, bounded retries, and lookup-only ambiguous-effect reconciliation remain mandatory",
        "Provider-contract dispatch remains false",
        "No durable persistence, service worker, runtime activation, or authority grant",
      ]),
    })
    expect(capability("cross-provider-routing-review-model")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
      reasonCode: "CANONICAL_ROUTING_AND_INDEPENDENT_CANDIDATE_ASSURANCE_VERIFIED",
      adapterRef: "scripts/multi-agent-operator/cross-provider-routing-review.mjs",
      authorityGrantRefs: [],
      trustGateRef: null,
      restrictions: expect.arrayContaining([
        "Bounded zero-input control-plane routing evaluation only; no provider execution or dispatch",
        "Logical route-role separation is proven; host-native worker identity is not claimed",
        "WO-MAO-034 is complete through independently reviewed candidate evidence; WO-MAO-035 and WO-MAO-036 now complete the ordered Phase 4 re-proof chain",
        "The settlement remains scoped only to WO-MAO-034<-WO-MAO-033; the graph correction does not retarget or generalize it",
        "Callers cannot submit roots, writers, trust bundles, ledger anchors, signatures, or raw trust material",
        "Unavailable providers contribute no capability",
        "No provider dispatch, GitHub review automation, runtime activation, or authority grant",
      ]),
    })
    expect(capability("provider-health-reroute-model")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
      reasonCode: "CANONICAL_PROVIDER_HEALTH_REROUTE_VERIFIED",
      adapterRef: "scripts/multi-agent-operator/provider-health-reroute.mjs",
      authorityGrantRefs: [],
      trustGateRef: null,
      restrictions: expect.arrayContaining([
        "Static health and reroute planning only",
        "Caller-supplied providers, observations, breaker state, and reroute requests are rejected",
        "Trusted observations and stateful breaker transitions come only from the sealed canonical registry",
        "WO-MAO-035 is complete; WO-MAO-036 is now complete and releases WO-MAO-037 through retained prerequisites",
        "Unavailable providers remain disabled and deferred",
        "No provider call, GitHub automation, runtime activation, authority grant, or owner relay",
      ]),
    })
    expect(capability("provider-conformance-suite-model")).toMatchObject({
      status: "PROVEN",
      executionClass: "NON_EXECUTABLE",
      reasonCode: "CANONICAL_PROVIDER_CONFORMANCE_SUITE_VERIFIED",
      adapterRef: "scripts/multi-agent-operator/provider-conformance-suite.mjs",
      authorityGrantRefs: [],
      trustGateRef: null,
      restrictions: expect.arrayContaining([
        "Static conformance suite only",
        "Caller-supplied provider records, fixture coverage, and contract sets are rejected",
        "Hosted Codex is session-only conformant, not executable-worker certified",
        "Hosted Codex remains session-only and non-executable",
        "Unavailable and rejected providers are excluded, not certified",
        "WO-MAO-036 is complete; WO-MAO-037 is released to READY through retained prerequisites",
        "No provider dispatch, GitHub automation, runtime activation, authority grant, or owner relay",
      ]),
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
      .toEqual(["hosted-codex-session", "codex-native-subagent-team", "hosted-codex-coordinator-adapter", "hosted-codex-role-adapters"])
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
