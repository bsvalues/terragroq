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
  ["Provider health, circuit breakers, and reroute", 4, [20, 21, 22, 30, 31, 32, 33, 34]],
  ["Provider conformance suite", 4, range(28, 35)],
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
  ["WO-MAO-029", "docs/reports/WO-MAO-029-supported-codex-capability-conformance.md"],
  ["WO-MAO-032", "docs/reports/WO-MAO-032-claude-capability-transport-proof.md"],
  ["WO-MAO-033", "docs/reports/WO-MAO-032-claude-capability-transport-proof.md"],
])

export function resolveMultiAgentWorkOrders(
  completedIds: ReadonlySet<string>,
  blockedIds: ReadonlySet<string> = new Set(),
  deferredProviderUnavailableIds: ReadonlySet<string> = new Set(),
): MultiAgentWorkOrderRecord[] {
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
          : dependsOn.every((dependency) => completedIds.has(dependency))
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

const EVIDENCED_COMPLETE = new Set([...range(1, 24), 29, 32].map(workOrderId))
const PROVIDER_UNAVAILABLE_DEFERRED = new Set([workOrderId(33)])

export const MULTI_AGENT_OPERATOR_WORK_ORDERS = resolveMultiAgentWorkOrders(
  EVIDENCED_COMPLETE,
  new Set(),
  PROVIDER_UNAVAILABLE_DEFERRED,
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
