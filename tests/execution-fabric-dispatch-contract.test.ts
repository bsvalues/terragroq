import { describe, expect, it } from "vitest"

// @ts-expect-error JavaScript module has no declaration file.
import {
  bindDispatchContract,
  evaluateDispatchContract,
  runCli,
} from "../scripts/execution-fabric/evaluate-dispatch-contract.mjs"

const at = "2026-08-10T03:40:00.000Z"
const completionAt = "2026-08-10T03:42:00.000Z"
const sha = (character: string) => character.repeat(64)

function packet(phase: "PRE_DISPATCH" | "COMPLETION_CLAIM" = "PRE_DISPATCH") {
  const complete = phase === "COMPLETION_CLAIM"
  const evidence = complete ? {
    commit_sha: sha("A"),
    test_result_sha256: sha("B"),
    review_result_sha256: sha("C"),
    pr_url: "https://github.com/bsvalues/terragroq/pull/999",
    merge_sha: sha("D"),
    verification_sha256: sha("E"),
  } : {
    commit_sha: null,
    test_result_sha256: null,
    review_result_sha256: null,
    pr_url: null,
    merge_sha: null,
    verification_sha256: null,
  }
  const value = {
    schema_version: "0.1-dispatch-contract-proof",
    proof_mode: "STATIC_NON_CONSUMABLE",
    contract_id: "FABRIC-DISPATCH-PROOF-CPU-BUILD-001",
    phase,
    recommendation: {
      schema_version: "0.1-placement-recommendation",
      status: "RECOMMENDED",
      recommendation_only: true,
      snapshot_sha256: "20B218E8F7AC6E78027FE31B2725FF14DD11339D818636F1FC44313C828FC9F9",
      workload_id: "cpu-heavy-build",
      workload_sha256: sha("F"),
      selected_node_id: "aegis",
      rank: 1,
      evaluated_at: "2026-08-10T03:38:05.166Z",
      expires_at: "2026-08-10T03:43:05.166Z",
      execution_authorized: false,
      dispatch_allowed: false,
    },
    workload_envelope: {
      job_id: "JOB-FABRIC-CPU-BUILD-001",
      work_order_id: "WO-FABRIC-DISPATCH-CONTRACT-001",
      repository: "bsvalues/terragroq",
      base_ref: "refs/heads/main",
      base_sha: "1".repeat(40),
      risk_class: "R1",
      selected_node_id: "aegis",
      path_scope: ["scripts/execution-fabric", "tests/execution-fabric-dispatch-contract.test.ts"],
      contract_scope: ["fabric-dispatch-contract-v1"],
      environment_scope: ["fixture-only"],
      allowed_actions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
      denied_actions: [
        "authority-mutation", "autonomous-scheduling", "destructive-action", "paid-overage",
        "production-mutation", "protected-data-access", "remote-dispatch", "secret-inspection",
      ],
      resource_limits: {
        max_cpu_threads: 20,
        max_memory_bytes: 17179869184,
        max_scratch_bytes: 53687091200,
        minimum_free_scratch_bytes: 107374182400,
      },
      data_classification: "repository-source",
      storage_semantics: "scratch-only",
      network_scope: "repository-and-ci-only",
      max_attempts: 2,
      timeout_seconds: 1800,
    },
    dispatch_envelope: {
      schemaVersion: 2,
      programId: "PROGRAM-WILLIAMOS-EXECUTION-FABRIC-001",
      goalId: "GOAL-FABRIC-DISPATCH-CONTRACT-001",
      loopId: "LOOP-FABRIC-DISPATCH-CONTRACT-001",
      workOrderId: "WO-FABRIC-DISPATCH-CONTRACT-001",
      objective: "Validate one non-consumable Execution Fabric dispatch contract.",
      riskClass: "R1",
      repositories: ["bsvalues/terragroq"],
      baseRefs: [{ repository: "bsvalues/terragroq", ref: "refs/heads/main", commitSha: "1".repeat(40) }],
      dependencies: ["WO-FABRIC-PLACEMENT-001"],
      fanInGate: "ALL",
      laneId: "LANE-FABRIC-DISPATCH-001",
      teamRoles: { coordinator: "codex-coordinator", builder: "codex-builder", reviewer: "codex-assurance" },
      providerRequirements: ["static-proof"],
      preferredProviders: ["hosted-codex"],
      fallbackProviders: [],
      reservations: {
        paths: [
          { repository: "bsvalues/terragroq", path: "scripts/execution-fabric" },
          { repository: "bsvalues/terragroq", path: "tests/execution-fabric-dispatch-contract.test.ts" },
        ],
        contracts: ["fabric-dispatch-contract-v1"],
        environments: ["fixture-only"],
      },
      allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
      forbiddenActions: [
        "OWNER_CONTACT", "RUNTIME_ACTIVATION", "CREDENTIAL_ACCESS", "PRODUCTION_WRITE",
        "BRANCH_PROTECTION_BYPASS", "DESTRUCTIVE_GIT",
      ],
      authorityGrantRefs: ["GRANT-FABRIC-PROOF-001"],
      programActivationGrantRef: "GRANT-FABRIC-PROOF-001",
      grantStatusEventRefs: ["EVENT-FABRIC-PROOF-ACTIVE-001"],
      requiredOutputs: ["contract-decision", "evidence-report", "tests"],
      requiredValidation: ["focused-vitest", "git-diff-check"],
      reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
      mergeMode: "NO_MERGE",
      retryBudget: { maxAttempts: 2, backoffSeconds: 10 },
      remediationBudget: { maxCycles: 1 },
      reroutePolicy: "NONE",
      stopConditions: ["authority-wall", "reservation-collision", "lease-fence-conflict"],
      evidenceTargets: ["placement", "authority", "reservation", "lease", "completion"],
      ownerDecisionConditions: [],
      ownerOperationsAllowed: false,
    },
    reservation_set: {
      schemaVersion: 1,
      artifactType: "MULTI_AGENT_RESERVATION_SET",
      reservationSetId: "RES-FABRIC-PROOF-001",
      workerId: "hermes-proof-holder",
      workOrderId: "WO-FABRIC-DISPATCH-CONTRACT-001",
      reservations: {
        paths: [
          { repository: "bsvalues/terragroq", path: "scripts/execution-fabric" },
          { repository: "bsvalues/terragroq", path: "tests/execution-fabric-dispatch-contract.test.ts" },
        ],
        contracts: ["fabric-dispatch-contract-v1"],
        environments: ["fixture-only"],
        repositories: [],
        protectedResources: [],
      },
    },
    authority: {
      evidence_kind: "proof-fixture",
      grant_id: "GRANT-FABRIC-PROOF-001",
      program_id: "PROGRAM-WILLIAMOS-EXECUTION-FABRIC-001",
      goal_id: "GOAL-FABRIC-DISPATCH-CONTRACT-001",
      loop_id: "LOOP-FABRIC-DISPATCH-CONTRACT-001",
      work_order_id: "WO-FABRIC-DISPATCH-CONTRACT-001",
      repository: "bsvalues/terragroq",
      selected_node_id: "aegis",
      risk_ceiling: "R1",
      allowed_actions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
      path_scope: ["scripts/execution-fabric", "tests/execution-fabric-dispatch-contract.test.ts"],
      version: 1,
      decision: "GRANTED",
      issued_at: "2026-08-10T03:39:00.000Z",
      expires_at: "2026-08-10T03:43:00.000Z",
      revoked_at: null,
      single_use: true,
      consumption_count: complete ? 1 : 0,
      consumed_at: complete ? "2026-08-10T03:40:30.000Z" : null,
      nonce: "fabric-proof-once-001",
      authority_tuple_sha256: sha("0"),
      status_event_head_sha256: sha("2"),
      current_status_event_head_sha256: sha("2"),
      revocation_head_sha256: sha("3"),
      current_revocation_head_sha256: sha("3"),
      trusted_owner_bundle_sha256: sha("4"),
      status_event_ref: "EVENT-FABRIC-PROOF-ACTIVE-001",
      revocation_event_ref: "EVENT-FABRIC-PROOF-REVOCATION-HEAD-001",
    },
    reservation: {
      reservation_id: "RES-FABRIC-PROOF-001",
      status: "SIMULATED_HELD",
      holder_id: "hermes-proof-holder",
      selected_node_id: "aegis",
      repository: "bsvalues/terragroq",
      path_scope: ["scripts/execution-fabric", "tests/execution-fabric-dispatch-contract.test.ts"],
      version: 1,
      holder_token_digest: sha("5"),
      acquisition_count: 1,
      conflict_count: 0,
      issued_at: "2026-08-10T03:39:30.000Z",
      expires_at: "2026-08-10T03:42:30.000Z",
    },
    lease: {
      lease_id: "LEASE-FABRIC-PROOF-001",
      status: complete ? "SIMULATED_RELEASED" : "SIMULATED_ACTIVE",
      holder_id: "hermes-proof-holder",
      holder_token_digest: sha("5"),
      reservation_id: "RES-FABRIC-PROOF-001",
      fencing_token: 41,
      generation: 1,
      issued_at: "2026-08-10T03:39:30.000Z",
      expires_at: "2026-08-10T03:42:30.000Z",
      lost_at: null,
      released_at: complete ? "2026-08-10T03:41:30.000Z" : null,
    },
    checkpoint: {
      sequence: complete ? 8 : 0,
      state: complete ? "COMPLETE" : "PRE_DISPATCH",
      recorded_at: complete ? "2026-08-10T03:41:00.000Z" : "2026-08-10T03:39:45.000Z",
      lease_id: "LEASE-FABRIC-PROOF-001",
      holder_id: "hermes-proof-holder",
      holder_token_digest: sha("5"),
      fencing_token: 41,
      evidence_sha256: null,
    },
    recovery: {
      max_attempts: 2,
      current_attempt: 1,
      reclaim_requires_expired_lease: true,
      next_fencing_token: 42,
      retryable_codes: ["PROVIDER_UNAVAILABLE", "NETWORK_INTERRUPTED", "WORKER_LOST"],
      terminal_codes: ["AUTHORITY_REVOKED", "SCOPE_VIOLATION", "SECRET_BOUNDARY"],
    },
    completion: {
      state: complete ? "COMPLETE" : "PENDING",
      claimed_at: complete ? "2026-08-10T03:41:45.000Z" : null,
      required_evidence: [
        "commit_sha", "test_result_sha256", "review_result_sha256", "pr_url", "merge_sha",
        "verification_sha256",
      ],
      evidence,
      evidence_anchor: {
        ledger_id: "LEDGER-FABRIC-PROOF-001",
        event_count: complete ? 8 : 0,
        head_event_sha256: complete ? sha("6") : sha("0"),
        manifest_sha256: complete ? sha("9") : sha("0"),
        source_refs_sha256: sha("0"),
      },
      evidence_sha256: null,
    },
    safety: {
      scheduler_state: "disabled",
      scheduler_authority: "not-granted",
      autonomous_dispatch: false,
      remote_mutation: false,
      authority_mutation: false,
      execution_performed: false,
    },
  }
  const bound = bindDispatchContract(value)
  if (complete) {
    bound.checkpoint.evidence_sha256 = bound.completion.evidence_sha256
    bound.completion.evidence_anchor.source_refs_sha256 = bound.completion.evidence_sha256
    return bindDispatchContract(bound)
  }
  return bound
}

function evaluate(value = packet()) {
  return evaluateDispatchContract(value, {
    evaluatedAt: value.phase === "COMPLETION_CLAIM" ? completionAt : at,
    resolveTrustedEvidenceManifest: value.phase === "COMPLETION_CLAIM"
      ? () => ({ verified: true, manifest_sha256: sha("9") })
      : undefined,
  })
}

function rebound(mutator: (value: any) => void, phase: "PRE_DISPATCH" | "COMPLETION_CLAIM" = "PRE_DISPATCH") {
  const value = packet(phase)
  mutator(value)
  return evaluate(bindDispatchContract(value))
}

describe("Execution Fabric bounded dispatch-contract proof", () => {
  it("makes one CPU build contract-ready without authorizing execution", () => {
    const result = evaluate()
    expect(result).toMatchObject({
      status: "CONTRACT_READY",
      phase: "PRE_DISPATCH",
      selected_node_id: "aegis",
      recommendation_only: true,
      contract_proof_only: true,
      proof_mode: "STATIC_NON_CONSUMABLE",
      execution_authorized: false,
      dispatch_allowed: false,
      scheduler: { state: "disabled", authority: "not-granted" },
      authority_mutated: false,
      remote_systems_modified: false,
    })
  })

  it("verifies a complete evidence chain without claiming execution occurred", () => {
    expect(evaluate(packet("COMPLETION_CLAIM"))).toMatchObject({
      status: "CONTRACT_READY",
      phase: "COMPLETION_CLAIM",
      execution_authorized: false,
      dispatch_allowed: false,
    })
  })

  it.each([
    ["stale placement", (value: any) => { value.recommendation.expires_at = "2026-08-10T03:39:59.000Z" }, "PLACEMENT_EVIDENCE_STALE"],
    ["changed authority scope", (value: any) => { value.authority.path_scope = ["**"] }, "PATH_SCOPE_MISMATCH"],
    ["duplicate acquisition", (value: any) => { value.reservation.acquisition_count = 2 }, "RESERVATION_NOT_EXCLUSIVE"],
    ["conflicting reservation", (value: any) => { value.reservation.conflict_count = 1 }, "RESERVATION_NOT_EXCLUSIVE"],
    ["expired authority", (value: any) => { value.authority.expires_at = "2026-08-10T03:39:59.000Z" }, "AUTHORITY_EXPIRED"],
    ["authority expiry instant", (value: any) => { value.authority.expires_at = at }, "AUTHORITY_EXPIRED"],
    ["revoked authority", (value: any) => { value.authority.revoked_at = "2026-08-10T03:39:59.000Z" }, "AUTHORITY_REVOKED"],
    ["changed authority head", (value: any) => { value.authority.current_status_event_head_sha256 = sha("6") }, "AUTHORITY_CHANGED"],
    ["changed revocation head", (value: any) => { value.authority.current_revocation_head_sha256 = sha("7") }, "REVOCATION_HEAD_CHANGED"],
    ["lease loss", (value: any) => { value.lease.lost_at = "2026-08-10T03:39:59.000Z" }, "LEASE_LOST"],
    ["lease expiry instant", (value: any) => { value.lease.expires_at = at }, "LEASE_NOT_HELD"],
    ["fencing mismatch", (value: any) => { value.checkpoint.fencing_token = 40 }, "FENCING_TOKEN_CONFLICT"],
    ["holder digest mismatch", (value: any) => { value.checkpoint.holder_token_digest = sha("8") }, "HOLDER_TOKEN_DIGEST_MISMATCH"],
    ["authority replay", (value: any) => { value.authority.consumption_count = 1; value.authority.consumed_at = "2026-08-10T03:39:59.000Z" }, "AUTHORITY_REPLAY"],
    ["non-rank-one placement", (value: any) => { value.recommendation.rank = 2 }, "PLACEMENT_RECOMMENDATION_INVALID"],
    ["scheduler activation", (value: any) => { value.safety.scheduler_state = "enabled" }, "SCHEDULER_AUTHORITY_WALL"],
    ["remote dispatch", (value: any) => { value.safety.autonomous_dispatch = true }, "PROOF_MODE_VIOLATION"],
    ["unfenced prohibited action", (value: any) => { value.workload_envelope.denied_actions = value.workload_envelope.denied_actions.filter((entry: string) => entry !== "production-mutation") }, "PROHIBITED_ACTION_NOT_FENCED"],
  ])("blocks %s", (_name, mutate, code) => {
    expect(rebound(mutate).reasons.map((entry: any) => entry.code)).toContain(code)
  })

  it("detects packet tampering without recomputed bindings", () => {
    const value = packet()
    value.workload_envelope.timeout_seconds = 999
    expect(evaluate(value).reasons.map((entry: any) => entry.code)).toContain("BINDING_MISMATCH")
  })

  it("rejects malformed and unknown input fields", () => {
    const value = packet()
    value.unexpected = true
    expect(evaluate(value)).toMatchObject({ status: "INPUT_REJECTED", dispatch_allowed: false })
  })

  it("rejects executable fields and secret-like material before readiness projection", () => {
    const executable = packet()
    ;(executable.workload_envelope as any).command = "npm test"
    expect(evaluate(executable).status).toBe("INPUT_REJECTED")

    const secret = packet()
    secret.authority.nonce = "sk_this-is-not-a-real-key-123456789"
    expect(evaluate(secret).status).toBe("INPUT_REJECTED")
  })

  it("uses the canonical dispatch envelope and reservation-set validators", () => {
    const badEnvelope = packet()
    badEnvelope.dispatch_envelope.ownerOperationsAllowed = true
    expect(evaluate(bindDispatchContract(badEnvelope)).status).toBe("INPUT_REJECTED")

    const badReservation = packet()
    badReservation.reservation_set.reservations.paths.push(
      { repository: "bsvalues/terragroq", path: "scripts/execution-fabric/evaluate-dispatch-contract.mjs" },
    )
    expect(evaluate(bindDispatchContract(badReservation)).status).toBe("INPUT_REJECTED")
  })

  it.each([
    ["base ref", (value: any) => { value.dispatch_envelope.baseRefs[0].ref = "refs/heads/other" }, "DISPATCH_ENVELOPE_SCOPE_MISMATCH"],
    ["actions", (value: any) => { value.dispatch_envelope.allowedActions.push("COMMIT_OWN_CHANGES") }, "DISPATCH_ENVELOPE_SCOPE_MISMATCH"],
    ["grant", (value: any) => { value.dispatch_envelope.authorityGrantRefs = ["GRANT-FABRIC-PROOF-002"] }, "DISPATCH_ENVELOPE_SCOPE_MISMATCH"],
    ["status event", (value: any) => { value.dispatch_envelope.grantStatusEventRefs = ["EVENT-FABRIC-PROOF-ACTIVE-002"] }, "DISPATCH_ENVELOPE_SCOPE_MISMATCH"],
    ["contract reservation", (value: any) => { value.reservation_set.reservations.contracts = ["other-contract"] }, "RESERVATION_CONTRACT_MISMATCH"],
    ["environment reservation", (value: any) => { value.workload_envelope.environment_scope = ["other-environment"] }, "RESERVATION_CONTRACT_MISMATCH"],
  ])("blocks independently rebound contradictory canonical %s", (_name, mutate, code) => {
    const result = rebound(mutate)
    expect(result.status).toBe("CONTRACT_BLOCKED")
    expect(result.reasons.map((entry: any) => entry.code)).toContain(code)
  })

  it("rejects incomplete completion evidence and false completion", () => {
    const result = rebound((value) => {
      value.completion.evidence.merge_sha = null
      value.checkpoint.evidence_sha256 = null
    }, "COMPLETION_CLAIM")
    expect(result.status).toBe("CONTRACT_BLOCKED")
    expect(result.reasons.map((entry: any) => entry.code)).toContain("COMPLETION_EVIDENCE_MISSING")
  })

  it("rejects a second completion consumption as replay", () => {
    const result = rebound((value) => { value.authority.consumption_count = 2 }, "COMPLETION_CLAIM")
    expect(result.reasons.map((entry: any) => entry.code)).toContain("AUTHORITY_CONSUMPTION_INVALID")
  })

  it.each([
    ["future consumption", (value: any) => { value.authority.consumed_at = "2026-08-10T03:42:30.000Z" }],
    ["checkpoint before consumption", (value: any) => { value.checkpoint.recorded_at = "2026-08-10T03:40:00.000Z" }],
    ["release before checkpoint", (value: any) => { value.lease.released_at = "2026-08-10T03:40:45.000Z" }],
    ["claim before release", (value: any) => { value.completion.claimed_at = "2026-08-10T03:41:15.000Z" }],
    ["equal event timestamps", (value: any) => {
      value.checkpoint.recorded_at = value.authority.consumed_at
      value.lease.released_at = value.authority.consumed_at
      value.completion.claimed_at = value.authority.consumed_at
    }],
  ])("rejects invalid completion chronology: %s", (_name, mutate) => {
    const result = rebound(mutate, "COMPLETION_CLAIM")
    expect(result.reasons.map((entry: any) => entry.code)).toContain("COMPLETION_CHRONOLOGY_INVALID")
  })

  it("requires an independently trusted completion evidence manifest", () => {
    const value = packet("COMPLETION_CLAIM")
    const result = evaluateDispatchContract(value, { evaluatedAt: completionAt })
    expect(result.status).toBe("CONTRACT_BLOCKED")
    expect(result.reasons.map((entry: any) => entry.code)).toContain("COMPLETION_EVIDENCE_UNATTESTED")
  })

  it.each([
    ["AWS access key", ["AK", "IAABCDEFGHIJKLMNOP"].join("")],
    ["Slack token", ["xoxb", "123456789012", "abcdefghijklmnop"].join("-")],
    ["JWT", ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "signaturevalue"].join(".")],
  ])("rejects %s material", (_name, secret) => {
    const value = packet()
    value.authority.nonce = secret
    expect(evaluate(value).status).toBe("INPUT_REJECTED")
  })

  it("rejects executable argv fields and command-shaped identifiers", () => {
    const argv = packet()
    ;(argv.recovery as any).argv = ["node", "script.mjs"]
    expect(evaluate(argv).status).toBe("INPUT_REJECTED")

    const commandIdentifier = packet()
    commandIdentifier.authority.nonce = "npm test && curl example.invalid"
    expect(evaluate(commandIdentifier).status).toBe("INPUT_REJECTED")
  })

  it("keeps retry and terminal classifications disjoint", () => {
    const result = rebound((value) => { value.recovery.terminal_codes.push("WORKER_LOST") })
    expect(result.reasons.map((entry: any) => entry.code)).toContain("RECOVERY_CLASS_CONFLICT")
  })

  it("returns structured INPUT_REJECTED from the CLI boundary", () => {
    expect(runCli([])).toMatchObject({ status: "INPUT_REJECTED", execution_authorized: false })
  })
})
