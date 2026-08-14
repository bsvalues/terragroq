import { db } from "@/lib/db"
import { eq, sql } from "drizzle-orm"
import {
  decision,
  document,
  evidenceRecord,
  goal,
  goalOutcomeIntakeReceipt,
  governanceEvent,
  memoryFact,
  outcomeQueueItem,
  workOrder,
} from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { getActiveGoalAuthorityRequestTimelines } from "@/app/(shell)/goal-console/authority-request-timelines"
import { loadProjects } from "@/lib/projects/load-projects"

/*
 * Operator State — the single read-model every operator surface projects from.
 * See docs: WILLIAMOS_OPERATOR_INFORMATION_MODEL + the Step 2.5 contract proof.
 *
 * Grounding invariants:
 *  - outcomeId === goal.id (Hermes selects `g.id AS "outcomeId"`).
 *  - Outcome identity is the intake receipt's goalId↔outcomeKey binding; the queue
 *    is transient state, not identity. Goals without a receipt are legacy-unresolved.
 *  - Execution is a projection over governance_event + receipts, NOT loop_run.
 *  - Every projected item carries a truth envelope (source, observedAt, freshness).
 */

const INSTALLATION = "WILLIAMOS_PRIMARY"
const nowIso = () => new Date().toISOString()

export type TruthState = "live" | "idle-empty" | "legacy-unresolved" | "modelled" | "inferred" | "degraded"

export interface TruthEnvelope<T> {
  value: T
  truthState: TruthState
  source: string
  observedAt: string
  freshness: string
}

const envelope = <T>(
  value: T,
  source: string,
  truthState: TruthState = "live",
  freshness = "current",
): TruthEnvelope<T> => ({ value, truthState, source, observedAt: nowIso(), freshness })

export interface ProjectResource {
  type: "repo" | "database" | "node" | "service" | "data_source"
  canonicalIdentity: string
  label: string
  relationship: string
}
export interface ProjectView {
  key: string
  name: string
  lifecycle: "active" | "standby" | "archived"
  resources: ProjectResource[]
}

export interface OutcomeView {
  identity: string
  outcomeId: number | null
  goalRef: string | null
  outcomeKey: string | null
  resolved: boolean
  resolution: string
  cohort: "goal-driven" | "campaign"
}

export interface ExecutionAttempt {
  id: string
  outcomeId: number
  outcomeIdentity: string
  workOrderRef: string
  attempt: number
  attemptStatus: "active" | "abandoned" | "released" | "delivered" | "terminal"
  outcomeStatus: string
  coordinator: string
  node: string
  worker: string
  events: number
  failureEvals: number
  delivery: { prNumber: number | null; mergeSha: string | null; branch: string | null } | null
}

export interface NodeHealth {
  node: string
  role: string
  status: "healthy" | "available" | "unreachable"
  detail: string
}

export interface OwnerDecision {
  timelineId: string
  goalRef: string
  workOrderRef: string | null
  expectedNextState: string | null
}

export interface OperatorState {
  installation: string
  now: TruthEnvelope<{ activeExecutions: number; queueDepth: number }>
  projects: TruthEnvelope<ProjectView[]>
  outcomes: TruthEnvelope<OutcomeView[]>
  work: TruthEnvelope<Array<{ id: number; ref: string | null; title: string | null; status: string | null; closedAt: Date | null }>>
  executions: TruthEnvelope<ExecutionAttempt[]>
  recentActivity: TruthEnvelope<Array<{ at: string; type: string; actor: string | null }>>
  needsWilliam: TruthEnvelope<OwnerDecision[]>
  governance: TruthEnvelope<{ foundingADRs: Array<{ ref: string; scopeType: string; authorityDomainId: string; createdByUserId: string; visibleToPrimary: boolean }> }>
  knowledge: TruthEnvelope<{ canonical: number; memory: number; documents: number; evidence: number; governance: number }>
  systems: TruthEnvelope<NodeHealth[]>
}

type GovRow = { eventType: string; metadata: Record<string, unknown>; createdAt: string }
type DoneRow = { goalId: number; eventType: string; metadata: Record<string, unknown> }

function deriveScopeType(scope: string | null): string {
  if (!scope) return "unscoped"
  if (scope === "global") return "installation"
  if (/^(goal:|outcome:|acceptance:)/.test(scope)) return "outcome"
  if (scope.startsWith("campaign:")) return "project"
  if (/^(runtime|release|workers|memory|governance|phase)/i.test(scope)) return "system"
  return "system"
}

export async function getOperatorState(): Promise<OperatorState> {
  const userId = await getUserId()
  const projects = await loadProjects(userId)

  // --- durable stores (reuse existing tables via drizzle) ---
  const goals = await db
    .select({ id: goal.id, ref: goal.ref })
    .from(goal)
    .where(eq(goal.userId, userId))
  const intake = await db
    .select({ goalId: goalOutcomeIntakeReceipt.goalId, outcomeKey: goalOutcomeIntakeReceipt.outcomeKey })
    .from(goalOutcomeIntakeReceipt)
    .where(eq(goalOutcomeIntakeReceipt.userId, userId))
  const work = await db
    .select({ id: workOrder.id, ref: workOrder.ref, title: workOrder.title, status: workOrder.status, closedAt: workOrder.closedAt })
    .from(workOrder)
    .where(eq(workOrder.userId, userId))
  const decisions = await db
    .select({ ref: decision.ref, scope: decision.scope, userId: decision.userId })
    .from(decision)
  const queueDepth = await db.$count(outcomeQueueItem, eq(outcomeQueueItem.userId, userId))
  const knowledge = {
    canonical: 0,
    memory: await db.$count(memoryFact, eq(memoryFact.userId, userId)),
    documents: await db.$count(document, eq(document.userId, userId)),
    evidence: await db.$count(evidenceRecord, eq(evidenceRecord.userId, userId)),
    governance: await db.$count(governanceEvent, eq(governanceEvent.userId, userId)),
  }

  // --- owner decisions actually waiting on William (reuse the goal-console authority engine) ---
  const authorityTimelines = await getActiveGoalAuthorityRequestTimelines()
  const ownerDecisions: OwnerDecision[] = authorityTimelines
    .filter((t) => t.truth.state === "CURRENT" && t.decisionRequest.status === "ACTIONABLE")
    .map((t) => ({
      timelineId: t.id,
      goalRef: t.decisionRequest.goalRef,
      workOrderRef: t.decisionRequest.workOrderRef,
      expectedNextState: t.decisionRequest.expectedNextState,
    }))

  const intakeByGoal = new Map(intake.map((r) => [r.goalId, r.outcomeKey]))

  // --- outcomes: consume the existing goalId↔outcomeKey crosswalk; flag legacy ---
  const outcomes: OutcomeView[] = goals.map((g) => {
    const outcomeKey = intakeByGoal.get(g.id) ?? null
    return {
      identity: outcomeKey ?? `goal:${g.ref}`,
      outcomeId: g.id,
      goalRef: g.ref,
      outcomeKey,
      resolved: Boolean(outcomeKey),
      resolution: outcomeKey ? "goalId→outcomeKey via intake receipt" : "legacy: queue-only binding, unresolved",
      cohort: "goal-driven",
    }
  })

  // --- execution projection: governance lease lifecycle + completion delivery (NOT loop_run) ---
  const govRows = (await db.execute(
    sql`select "eventType" as "eventType", metadata, "createdAt"::text as "createdAt"
        from governance_event
        where "userId" = ${userId} and metadata ->> 'outcomeId' is not null
        order by "createdAt"`,
  )).rows as unknown as GovRow[]
  const doneRows = (await db.execute(
    sql`select ("entityId")::int as "goalId", "eventType" as "eventType", metadata
        from governance_event
        where "userId" = ${userId} and "entityType" = 'goal'
          and "eventType" in ('HERMES_OUTCOME_COMPLETED','HERMES_OUTCOME_TERMINAL')`,
  )).rows as unknown as DoneRow[]

  const deliveryByGoal = new Map<number, { eventType: string; branch: string | null; prNumber: number | null; mergeSha: string | null }>()
  for (const d of doneRows) {
    const cur = deliveryByGoal.get(d.goalId)
    if (!cur || d.eventType === "HERMES_OUTCOME_COMPLETED") {
      deliveryByGoal.set(d.goalId, {
        eventType: d.eventType,
        branch: (d.metadata.branch as string) ?? null,
        prNumber: (d.metadata.prNumber as number) ?? null,
        mergeSha: (d.metadata.mergeSha as string) ?? null,
      })
    }
  }

  const byOutcome = new Map<number, GovRow[]>()
  for (const e of govRows) {
    const oid = Number(e.metadata.outcomeId)
    const list = byOutcome.get(oid) ?? []
    list.push(e)
    byOutcome.set(oid, list)
  }

  const executions: ExecutionAttempt[] = []
  for (const [oid, evs] of byOutcome) {
    const goalRow = goals.find((g) => g.id === oid)
    const outcomeIdentity = intakeByGoal.get(oid) ?? (goalRow ? `goal:${goalRow.ref}` : `outcomeId:${oid}`)
    const woRef = (evs.find((e) => e.metadata.workOrderRef)?.metadata.workOrderRef as string) ?? `WO?-${oid}`
    const delivery = deliveryByGoal.get(oid) ?? null

    type Attempt = { n: number; status: ExecutionAttempt["attemptStatus"]; events: number; fails: number }
    const attempts: Attempt[] = []
    let cur: Attempt | null = null
    let n = 0
    for (const e of evs) {
      if (!cur) {
        n += 1
        cur = { n, status: "active", events: 0, fails: 0 }
      }
      cur.events += 1
      const ls = e.metadata.leaseStatus as string | undefined
      if (e.eventType === "HERMES_RUNTIME_FAILURE_EVAL") cur.fails += 1
      if (ls === "ABANDONED") {
        cur.status = "abandoned"
        attempts.push(cur)
        cur = null
      } else if (ls === "RELEASED") {
        cur.status = "released"
        attempts.push(cur)
        cur = null
      }
    }
    if (cur) attempts.push(cur)
    if (attempts.length > 0) {
      const fa = attempts[attempts.length - 1]
      if (delivery?.eventType === "HERMES_OUTCOME_COMPLETED") fa.status = "delivered"
      else if (delivery?.eventType === "HERMES_OUTCOME_TERMINAL") fa.status = "terminal"
    }
    const outcomeStatus =
      delivery?.eventType === "HERMES_OUTCOME_COMPLETED"
        ? `delivered PR#${delivery.prNumber} (merge ${String(delivery.mergeSha).slice(0, 7)})`
        : delivery?.eventType === "HERMES_OUTCOME_TERMINAL"
          ? "terminal"
          : queueDepth > 0
            ? "in-lease"
            : "idle"

    for (const a of attempts) {
      executions.push({
        id: `exec:${outcomeIdentity}:wo:${woRef}:attempt:${a.n}`,
        outcomeId: oid,
        outcomeIdentity,
        workOrderRef: woRef,
        attempt: a.n,
        attemptStatus: a.status,
        outcomeStatus,
        coordinator: "HERMES",
        node: "AEGIS",
        worker: "Codex",
        events: a.events,
        failureEvals: a.fails,
        delivery,
      })
    }
  }

  // --- governance: founding ADRs projected by scope, author preserved ---
  const foundingADRs = decisions
    .filter((d) => /^ADR-/.test(d.ref ?? "") && d.userId !== userId)
    .map((d) => {
      const scopeType = deriveScopeType(d.scope)
      return {
        ref: d.ref as string,
        scopeType,
        authorityDomainId: INSTALLATION,
        createdByUserId: d.userId,
        visibleToPrimary: ["installation", "system", "project"].includes(scopeType),
      }
    })

  // --- recent activity (governance tail) ---
  const recent = govRows.slice(-8).map((e) => ({
    at: e.createdAt,
    type: e.eventType,
    actor: (e.metadata.actor as string) ?? null,
  }))

  // --- systems: derived from live signals available in-process (no external probes) ---
  const aegisRecentlyActive = govRows.some((e) => (e.metadata.actor as string) === "hermes-codex-bridge")
  // ATLAS status is grounded (this query returned); HERMES/AEGIS are inferred, not live-probed here.
  const systems: NodeHealth[] = [
    { node: "ATLAS", role: "state/database", status: "healthy", detail: "live — read-model query returned" },
    { node: "HERMES", role: "coordinator", status: "healthy", detail: "inferred — resident runtime host" },
    {
      node: "AEGIS",
      role: "worker",
      // provisioned worker; in-process signals can't probe reachability, so never assert "unreachable"
      status: "available",
      detail: aegisRecentlyActive ? "inferred — recent delivery activity" : "inferred — provisioned, no recent activity",
    },
  ]

  const activeExecutions = queueDepth > 0 ? executions.filter((e) => e.attemptStatus === "active").length : 0
  const idle = queueDepth === 0

  return {
    installation: INSTALLATION,
    now: envelope({ activeExecutions, queueDepth }, "outcome_queue_item + execution projection", idle ? "idle-empty" : "live"),
    projects: envelope(projects, "project + project_resource", projects.length ? "live" : "idle-empty"),
    outcomes: envelope(outcomes, "goal + goal_outcome_intake_receipt", outcomes.some((o) => o.resolved) ? "live" : "legacy-unresolved"),
    work: envelope(work, "work_order (all statuses)", "live"),
    executions: envelope(executions, "governance_event (lease lifecycle + completion) + receipts", "live"),
    recentActivity: envelope(recent, "governance_event", recent.length ? "live" : "idle-empty"),
    needsWilliam: envelope(
      ownerDecisions,
      "active goal authority-request timelines (ACTIONABLE, truth CURRENT)",
      ownerDecisions.length ? "live" : "idle-empty",
    ),
    governance: envelope({ foundingADRs }, "decision (scope projection)", "live"),
    knowledge: envelope(knowledge, "memory_fact/document/evidence_record/governance_event", knowledge.evidence ? "live" : "idle-empty"),
    systems: envelope(systems, "in-process signals — ATLAS live, HERMES/AEGIS inferred", "inferred"),
  }
}
