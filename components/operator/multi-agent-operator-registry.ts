import {
  MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
  isVerifiedWoMao034ProviderSettlement,
  type MultiAgentProviderSettlementRecord,
} from "@/components/operator/multi-agent-provider-settlement-registry"
import {
  MULTI_AGENT_PROVIDER_HEALTH_EVIDENCE,
  isVerifiedWoMao035ProviderHealthEvidence,
} from "@/components/operator/multi-agent-provider-health-registry"
import {
  MULTI_AGENT_PROVIDER_CONFORMANCE_EVIDENCE,
  isVerifiedWoMao036ProviderConformanceEvidence,
} from "@/components/operator/multi-agent-provider-conformance-registry"
import {
  MULTI_AGENT_BRANCH_DELIVERY_EVIDENCE,
  isVerifiedWoMao037BranchDeliveryEvidence,
} from "@/components/operator/multi-agent-branch-delivery-registry"
import {
  MULTI_AGENT_PR_LINKAGE_EVIDENCE,
  isVerifiedWoMao038PrLinkageEvidence,
} from "@/components/operator/multi-agent-pr-linkage-registry"
import {
  MULTI_AGENT_CI_REVIEW_EVIDENCE,
  isVerifiedWoMao039CiReviewEvidence,
} from "@/components/operator/multi-agent-ci-review-registry"
import {
  MULTI_AGENT_REMEDIATION_EVIDENCE,
  isVerifiedWoMao040RemediationEvidence,
} from "@/components/operator/multi-agent-remediation-registry"
import {
  MULTI_AGENT_MERGE_CONTROLLER_EVIDENCE,
  isVerifiedWoMao041MergeControllerEvidence,
} from "@/components/operator/multi-agent-merge-controller-registry"
import {
  MULTI_AGENT_POST_MERGE_EVIDENCE,
  isVerifiedWoMao042PostMergeEvidence,
} from "@/components/operator/multi-agent-post-merge-registry"
import {
  MULTI_AGENT_DEPENDENT_RELEASE_EVIDENCE,
  isVerifiedWoMao043DependentReleaseEvidence,
} from "@/components/operator/multi-agent-dependent-release-registry"
import {
  MULTI_AGENT_GITHUB_LIFECYCLE_EVIDENCE,
  isVerifiedWoMao044GitHubLifecycleEvidence,
} from "@/components/operator/multi-agent-github-lifecycle-registry"
import {
  MULTI_AGENT_SECRET_TRUST_AUDIT_EVIDENCE,
  isVerifiedWoMao045SecretTrustAuditEvidence,
} from "@/components/operator/multi-agent-secret-trust-audit-registry"
import {
  MULTI_AGENT_RETRY_IDEMPOTENCY_EVIDENCE,
  isVerifiedWoMao046RetryIdempotencyEvidence,
} from "@/components/operator/multi-agent-retry-idempotency-registry"
import {
  MULTI_AGENT_WORKER_RECOVERY_EVIDENCE,
  isVerifiedWoMao047WorkerRecoveryEvidence,
} from "@/components/operator/multi-agent-worker-recovery-registry"
import {
  MULTI_AGENT_PROVIDER_FAILOVER_EVIDENCE,
  isVerifiedWoMao048ProviderFailoverEvidence,
} from "@/components/operator/multi-agent-provider-failover-registry"
import {
  MULTI_AGENT_MERGE_RACE_EVIDENCE,
  isVerifiedWoMao049MergeRaceEvidence,
} from "@/components/operator/multi-agent-merge-race-registry"
import {
  MULTI_AGENT_DEFECTIVE_WORKER_EVIDENCE,
  isVerifiedWoMao050DefectiveWorkerEvidence,
} from "@/components/operator/multi-agent-defective-worker-registry"
import {
  MULTI_AGENT_STATUS_UX_EVIDENCE,
  isVerifiedWoMao051StatusUxEvidence,
} from "@/components/operator/multi-agent-status-ux-registry"
import {
  MULTI_AGENT_INCIDENT_PROCEDURE_EVIDENCE,
  isVerifiedWoMao052IncidentProcedureEvidence,
} from "@/components/operator/multi-agent-incident-procedure-registry"
import {
  MULTI_AGENT_RESILIENCE_SAFETY_ROLLUP_EVIDENCE,
  isVerifiedWoMao053ResilienceSafetyRollupEvidence,
} from "@/components/operator/multi-agent-resilience-safety-rollup-registry"
import {
  MULTI_AGENT_ROUTING_REVIEW_EVIDENCE,
  isVerifiedWoMao034RoutingReviewEvidence,
} from "@/components/operator/multi-agent-routing-review-registry"

export type MultiAgentWorkOrderStatus =
  | "PENDING"
  | "READY"
  | "COMPLETE"
  | "BLOCKED"
  | "DEFERRED_PROVIDER_UNAVAILABLE"

export const MULTI_AGENT_OWNER_COUNTER_NAMES = [
  "OWNER_OPERATION_TOUCH_COUNT",
  "OWNER_CREDENTIAL_TOUCH_COUNT",
  "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  "OWNER_ROUTINE_DECISION_COUNT",
  "OWNER_ROUTINE_CONTACT_COUNT",
] as const

export type MultiAgentWorkOrderRecord = {
  workOrderId: `WO-MAO-${string}`
  title: string
  phase: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  riskClass: "R0" | "R1" | "R2" | "R3"
  dependsOn: `WO-MAO-${string}`[]
  status: MultiAgentWorkOrderStatus
  resumable: boolean
  ownerOperationsAllowed: false
  evidencePath: string
}

type WorkOrderSeed = readonly [title: string, phase: MultiAgentWorkOrderRecord["phase"], dependencies: number[]]

const range = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index)

const WORK_ORDER_SEEDS: WorkOrderSeed[] = [
  ["Terminalize the rejected local adapter", 0, []],
  ["Correct the stale queue", 0, [1]],
  ["Ratify the Owner-Only Constitution", 0, []],
  ["Publish the executable capability inventory", 0, [1]],
  ["Register the multi-agent program", 0, [2, 3, 4]],
  ["Reconcile agent authority entrypoints", 0, [3, 4, 5]],
  ["Worker registry, authority matrix, and preventive trust gate v2", 0, [4, 6]],
  ["Select a useful proof portfolio", 1, [5, 7]],
  ["Build the hosted-team dispatch packet", 1, [8]],
  ["Execute hosted Codex lane A", 1, [9]],
  ["Execute hosted Codex lane B", 1, [9]],
  ["Hosted draft PR and CI intake", 1, [9, 10, 11]],
  ["Independent assurance and remediation lifecycle", 1, [12]],
  ["Hosted merge, verification, and dependent release", 1, [13]],
  ["Hosted-team proof rollup", 1, [10, 11, 12, 13, 14]],
  ["Work-order envelope v2", 2, [15]],
  ["DAG and eligible-set resolver", 2, [16]],
  ["Reservation ledger", 2, [16]],
  ["Provider capability and dispatch contract", 2, [16]],
  ["Canonical lifecycle and escalation taxonomy", 2, [16, 17, 18, 19]],
  ["Per-lane leases and checkpoints", 2, [17, 18, 19, 20]],
  ["Evidence ledger and owner-touch meter", 2, [3, ...range(16, 21)]],
  ["Eligible-set scheduler and worker pool", 3, range(17, 22)],
  ["Team topology and fan-out/fan-in", 3, [19, 21, 22, 23]],
  ["Isolated workspace manager", 3, [18, 21, 22, 23, 24]],
  ["Reservation-aware handoff", 3, [18, 24, 25]],
  ["Concurrency budgets, priority, and fairness", 3, [23, 24, 25, 26]],
  ["Scheduler simulation and model checking", 3, range(17, 27)],
  ["Supported Codex capability conformance", 4, [15, 19]],
  ["Hosted Codex coordinator adapter", 4, [24, 28, 29]],
  ["Codex builder, assurance, and remediation adapters", 4, [26, 29, 30]],
  ["Claude capability and transport proof", 4, [7, 19, 22]],
  ["Claude separate-repository/suite adapter", 4, [25, 28, 32]],
  ["Cross-provider routing and review", 4, [24, 31, 33]],
  ["Provider health, circuit breakers, and reroute", 4, [20, 21, 22, 30, 31, 32, 34]],
  ["Provider conformance suite", 4, [28, 29, 30, 31, 32, 34, 35]],
  ["Branch, commit, and push automation", 5, [7, 25, 26, 36]],
  ["PR creation and packet linkage", 5, [22, 37]],
  ["CI and review ingestion", 5, [20, 22, 38]],
  ["Automated remediation and re-review", 5, [26, 31, 39]],
  ["Bounded merge controller", 5, [7, 20, 39, 40]],
  ["Post-merge verification and cleanup", 5, [22, 25, 41]],
  ["Automatic dependent release", 5, [17, 20, 42]],
  ["GitHub lifecycle conformance", 5, range(37, 43)],
  ["Independent secret, identity, and trust-boundary audit", 6, [22, ...range(36, 44)]],
  ["Retry, idempotency, and duplicate prevention", 6, [21, 35, 44]],
  ["Worker and coordinator recovery", 6, [21, 25, 30, 31, 46]],
  ["Provider outage and failover drill", 6, [35, 36, 46, 47]],
  ["Stale-base, CI, review, and merge-race drill", 6, [39, 40, 41, 46]],
  ["Malicious/defective worker drill", 6, range(45, 49)],
  ["Status, evidence, and owner-decision UX", 6, [3, 22, ...range(44, 50)]],
  ["Kill, revoke, rollback, and incident procedure", 6, range(45, 51)],
  ["Resilience and safety rollup", 6, range(45, 52)],
  ["Select the certification portfolio", 7, [36, 44, 53]],
  ["Execute concurrent certification lanes", 7, [54]],
  ["Cross-review, CI, and remediation certification", 7, [55]],
  ["Failure and recovery certification", 7, [55]],
  ["Merge, verify, clean, and fan-in release", 7, [56, 57]],
  ["Sustained zero-touch soak", 7, [58]],
  ["Zero-owner-touch audit", 7, range(54, 59)],
  ["Unattended multi-agent certification", 7, [60]],
  ["Program closure and portfolio continuation", 7, [61]],
]

function workOrderId(number: number): `WO-MAO-${string}` {
  return `WO-MAO-${String(number).padStart(3, "0")}`
}

const PHASE_ZERO_EVIDENCE_PATHS = [
  "docs/reports/WO-MAO-001-terminal-local-adapter.md",
  "docs/reports/WO-MAO-002-stale-queue-reconciliation.md",
  "docs/reports/WO-MAO-003-owner-only-authority-contract.md",
  "docs/reports/WO-MAO-004-executable-capability-inventory.md",
  "docs/reports/WO-MAO-005-multi-agent-program-registration.md",
  "docs/reports/WO-MAO-006-agent-entrypoint-reconciliation.md",
  "docs/reports/WO-MAO-007-worker-authority-trust-gate-v2.md",
] as const

const PHASE_ONE_EVIDENCE_PATHS = [
  "docs/reports/WO-MAO-008-useful-proof-portfolio.md",
  "docs/reports/WO-MAO-009-hosted-team-dispatch-packets.md",
  "docs/reports/WO-MAO-010-hosted-codex-lane-a.md",
  "docs/reports/WO-MAO-011-hosted-codex-lane-b.md",
  "docs/reports/WO-MAO-012-hosted-pr-ci-intake.md",
  "docs/reports/WO-MAO-013-independent-assurance-remediation.md",
  "docs/reports/WO-MAO-014-hosted-merge-dependent-release.md",
  "docs/reports/WO-MAO-015-hosted-team-proof-rollup.md",
] as const

const PHASE_TWO_EVIDENCE_PATHS = [
  "docs/reports/WO-MAO-016-work-order-envelope-v2.md",
  "docs/reports/WO-MAO-017-dag-eligible-set-resolver.md",
  "docs/reports/WO-MAO-018-reservation-ledger.md",
  "docs/reports/WO-MAO-019-provider-capability-dispatch-contract.md",
  "docs/reports/WO-MAO-020-lifecycle-escalation-taxonomy.md",
  "docs/reports/WO-MAO-021-per-lane-leases-checkpoints.md",
  "docs/reports/WO-MAO-022-evidence-ledger-owner-touch-meter.md",
] as const

const EVIDENCE_PATH_OVERRIDES = new Map<string, string>([
  ["WO-MAO-023", "docs/reports/WO-MAO-023-eligible-set-scheduler-worker-pool.md"],
  ["WO-MAO-024", "docs/reports/WO-MAO-024-team-topology-fan-out-fan-in.md"],
  ["WO-MAO-025", "docs/reports/WO-MAO-025-isolated-workspace-manager.md"],
  ["WO-MAO-026", "docs/reports/WO-MAO-026-reservation-aware-handoff.md"],
  ["WO-MAO-027", "docs/reports/WO-MAO-027-concurrency-budgets-priority-fairness.md"],
  ["WO-MAO-028", "docs/reports/WO-MAO-028-scheduler-simulation-model-checking.md"],
  ["WO-MAO-029", "docs/reports/WO-MAO-029-supported-codex-capability-conformance.md"],
  ["WO-MAO-030", "docs/reports/WO-MAO-030-hosted-codex-coordinator-adapter.md"],
  ["WO-MAO-031", "docs/reports/WO-MAO-031-codex-builder-assurance-remediation-adapters.md"],
  ["WO-MAO-032", "docs/reports/WO-MAO-032-claude-capability-transport-proof.md"],
  ["WO-MAO-033", "docs/reports/WO-MAO-032-claude-capability-transport-proof.md"],
  ["WO-MAO-034", "docs/reports/WO-MAO-034-cross-provider-routing-review.md"],
  ["WO-MAO-035", "docs/reports/WO-MAO-035-provider-health-reroute.md"],
  ["WO-MAO-036", "docs/reports/WO-MAO-036-provider-conformance-suite.md"],
  ["WO-MAO-037", "docs/reports/WO-MAO-037-branch-commit-push-automation.md"],
  ["WO-MAO-038", "docs/reports/WO-MAO-038-pr-creation-packet-linkage.md"],
  ["WO-MAO-039", "docs/reports/WO-MAO-039-ci-review-ingestion.md"],
  ["WO-MAO-040", "docs/reports/WO-MAO-040-remediation-rereview.md"],
  ["WO-MAO-041", "docs/reports/WO-MAO-041-bounded-merge-controller.md"],
  ["WO-MAO-042", "docs/reports/WO-MAO-042-post-merge-verification-cleanup.md"],
  ["WO-MAO-043", "docs/reports/WO-MAO-043-automatic-dependent-release.md"],
  ["WO-MAO-044", "docs/reports/WO-MAO-044-github-lifecycle-conformance.md"],
  ["WO-MAO-045", "docs/reports/WO-MAO-045-independent-secret-identity-trust-boundary-audit.md"],
  ["WO-MAO-046", "docs/reports/WO-MAO-046-retry-idempotency-duplicate-prevention.md"],
  ["WO-MAO-047", "docs/reports/WO-MAO-047-worker-coordinator-recovery.md"],
  ["WO-MAO-048", "docs/reports/WO-MAO-048-provider-outage-failover-drill.md"],
  ["WO-MAO-049", "docs/reports/WO-MAO-049-stale-base-ci-review-merge-race.md"],
  ["WO-MAO-050", "docs/reports/WO-MAO-050-malicious-defective-worker-drill.md"],
  ["WO-MAO-051", "docs/reports/WO-MAO-051-status-evidence-owner-decision-ux.md"],
  ["WO-MAO-052", "docs/reports/WO-MAO-052-kill-revoke-rollback-incident-procedure.md"],
  ["WO-MAO-053", "docs/reports/WO-MAO-053-resilience-safety-rollup.md"],
])

export function resolveMultiAgentWorkOrders(
  completedIds: ReadonlySet<string>,
  blockedIds: ReadonlySet<string> = new Set(),
  deferredProviderUnavailableIds: ReadonlySet<string> = new Set(),
  providerSettlement: MultiAgentProviderSettlementRecord | null = null,
): MultiAgentWorkOrderRecord[] {
  const canonicalSettlementVerified = providerSettlement !== null
    && isVerifiedWoMao034ProviderSettlement(providerSettlement)
    && completedIds.has(providerSettlement.assessmentWorkOrderId)
    && deferredProviderUnavailableIds.has(providerSettlement.subjectWorkOrderId)
  return WORK_ORDER_SEEDS.map(([title, phase, dependencies], index) => {
    const number = index + 1
    const id = workOrderId(number)
    const dependsOn = dependencies.map(workOrderId)
    const status: MultiAgentWorkOrderStatus = completedIds.has(id)
      ? "COMPLETE"
      : blockedIds.has(id)
        ? "BLOCKED"
        : deferredProviderUnavailableIds.has(id)
          ? "DEFERRED_PROVIDER_UNAVAILABLE"
          : dependsOn.every((dependency) => completedIds.has(dependency)
              || (canonicalSettlementVerified
                && id === providerSettlement.consumerWorkOrderId
                && dependency === providerSettlement.subjectWorkOrderId))
            ? "READY"
            : "PENDING"

    return {
      workOrderId: id,
      title,
      phase,
      riskClass: phase <= 1 ? "R1" : phase === 7 ? "R2" : "R3",
      dependsOn,
      status,
      resumable: status === "DEFERRED_PROVIDER_UNAVAILABLE",
      ownerOperationsAllowed: false,
      evidencePath: EVIDENCE_PATH_OVERRIDES.get(id)
        ?? PHASE_ZERO_EVIDENCE_PATHS[index]
        ?? PHASE_ONE_EVIDENCE_PATHS[index - PHASE_ZERO_EVIDENCE_PATHS.length]
        ?? PHASE_TWO_EVIDENCE_PATHS[index - PHASE_ZERO_EVIDENCE_PATHS.length - PHASE_ONE_EVIDENCE_PATHS.length]
        ?? `docs/reports/${id}.md`,
    }
  })
}

const EVIDENCED_COMPLETE = new Set([
  ...range(1, 32).map(workOrderId),
  ...(isVerifiedWoMao034RoutingReviewEvidence(MULTI_AGENT_ROUTING_REVIEW_EVIDENCE)
    ? [workOrderId(34)]
    : []),
  ...(isVerifiedWoMao035ProviderHealthEvidence(MULTI_AGENT_PROVIDER_HEALTH_EVIDENCE)
    ? [workOrderId(35)]
    : []),
  ...(isVerifiedWoMao036ProviderConformanceEvidence(MULTI_AGENT_PROVIDER_CONFORMANCE_EVIDENCE)
    ? [workOrderId(36)]
    : []),
  ...(isVerifiedWoMao037BranchDeliveryEvidence(MULTI_AGENT_BRANCH_DELIVERY_EVIDENCE)
    ? [workOrderId(37)]
    : []),
  ...(isVerifiedWoMao038PrLinkageEvidence(MULTI_AGENT_PR_LINKAGE_EVIDENCE)
    ? [workOrderId(38)]
    : []),
  ...(isVerifiedWoMao039CiReviewEvidence(MULTI_AGENT_CI_REVIEW_EVIDENCE)
    ? [workOrderId(39)]
    : []),
  ...(isVerifiedWoMao040RemediationEvidence(MULTI_AGENT_REMEDIATION_EVIDENCE)
    ? [workOrderId(40)]
    : []),
  ...(isVerifiedWoMao041MergeControllerEvidence(MULTI_AGENT_MERGE_CONTROLLER_EVIDENCE)
    ? [workOrderId(41)]
    : []),
  ...(isVerifiedWoMao042PostMergeEvidence(MULTI_AGENT_POST_MERGE_EVIDENCE)
    ? [workOrderId(42)]
    : []),
  ...(isVerifiedWoMao043DependentReleaseEvidence(MULTI_AGENT_DEPENDENT_RELEASE_EVIDENCE)
    ? [workOrderId(43)]
    : []),
  ...(isVerifiedWoMao044GitHubLifecycleEvidence(MULTI_AGENT_GITHUB_LIFECYCLE_EVIDENCE)
    ? [workOrderId(44)]
    : []),
  ...(isVerifiedWoMao045SecretTrustAuditEvidence(MULTI_AGENT_SECRET_TRUST_AUDIT_EVIDENCE)
    ? [workOrderId(45)]
    : []),
  ...(isVerifiedWoMao046RetryIdempotencyEvidence(MULTI_AGENT_RETRY_IDEMPOTENCY_EVIDENCE)
    ? [workOrderId(46)]
    : []),
  ...(isVerifiedWoMao047WorkerRecoveryEvidence(MULTI_AGENT_WORKER_RECOVERY_EVIDENCE)
    ? [workOrderId(47)]
    : []),
  ...(isVerifiedWoMao048ProviderFailoverEvidence(MULTI_AGENT_PROVIDER_FAILOVER_EVIDENCE)
    ? [workOrderId(48)]
    : []),
  ...(isVerifiedWoMao049MergeRaceEvidence(MULTI_AGENT_MERGE_RACE_EVIDENCE)
    ? [workOrderId(49)]
    : []),
  ...(isVerifiedWoMao050DefectiveWorkerEvidence(MULTI_AGENT_DEFECTIVE_WORKER_EVIDENCE)
    ? [workOrderId(50)]
    : []),
  ...(isVerifiedWoMao051StatusUxEvidence(MULTI_AGENT_STATUS_UX_EVIDENCE)
    ? [workOrderId(51)]
    : []),
  ...(isVerifiedWoMao052IncidentProcedureEvidence(MULTI_AGENT_INCIDENT_PROCEDURE_EVIDENCE)
    ? [workOrderId(52)]
    : []),
  ...(isVerifiedWoMao053ResilienceSafetyRollupEvidence(MULTI_AGENT_RESILIENCE_SAFETY_ROLLUP_EVIDENCE)
    ? [workOrderId(53)]
    : []),
])
const PROVIDER_UNAVAILABLE_DEFERRED = new Set([workOrderId(33)])
export const MULTI_AGENT_OPERATOR_WORK_ORDERS = resolveMultiAgentWorkOrders(
  EVIDENCED_COMPLETE,
  new Set(),
  PROVIDER_UNAVAILABLE_DEFERRED,
  MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
)

export const MULTI_AGENT_OPERATOR_PROGRAM = {
  programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
  loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
  state: "ACTIVE" as const,
  executionMode: "DEPENDENCY_RESERVATION_ELIGIBLE_SET" as const,
  communicationMode: "FINAL_OUTCOME_OR_GENUINE_AUTHORITY_WALL_ONLY" as const,
  ownerRole: "AUTHORITY_ONLY" as const,
  ownerOperationsAllowed: false as const,
  ownerCounters: Object.fromEntries(
    MULTI_AGENT_OWNER_COUNTER_NAMES.map((name) => [name, 0]),
  ) as Record<(typeof MULTI_AGENT_OWNER_COUNTER_NAMES)[number], 0>,
  workOrders: MULTI_AGENT_OPERATOR_WORK_ORDERS,
}
