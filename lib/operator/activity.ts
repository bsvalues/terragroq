import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getUserId } from "@/lib/session"

/*
 * Activity — a humanized, de-noised timeline projected from governance_event.
 * The raw stream is dominated by runtime churn (checkpoints, lease renewals); the
 * operator wants the meaningful events (deliveries, terminals, failures, authority,
 * goals, transitions), so churn is collapsed into a count, not listed line by line.
 * Every value is projected from real rows — nothing fabricated.
 */

const nowIso = () => new Date().toISOString()
const instantIso = (value: Date | string) => new Date(value).toISOString()

export type ActivityKind = "delivery" | "terminal" | "failure" | "authority" | "goal" | "transition" | "runtime"

export interface ActivityItem {
  id: number
  at: string
  kind: ActivityKind
  label: string
  detail: string | null
  ref: string | null
}

export interface ActivityFeed {
  items: ActivityItem[]
  churnCollapsed: number // checkpoint/lease events not individually listed
  source: string
  latestEventAt: string | null
  observedAt: string
  truthState: "persisted" | "idle-empty"
}

export function summarizeActivityFeed(feed: ActivityFeed): string | null {
  if (feed.items.length === 0 && feed.churnCollapsed === 0) return null

  const meaningful = feed.items.length > 0 ? `${feed.items.length} meaningful events` : null
  const churn = feed.churnCollapsed > 0 ? `${feed.churnCollapsed} runtime/retry steps collapsed` : null
  return [meaningful, churn].filter(Boolean).join(" · ")
}

const activityTime = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`

export function activityTruthCaption(feed: ActivityFeed): string {
  const observed = activityTime(feed.observedAt)
  if (feed.latestEventAt === null) return `No persisted activity as of ${observed}`
  return `Persisted activity through ${activityTime(feed.latestEventAt)} · read ${observed}`
}

type Row = {
  id: number
  ref: string | null
  eventType: string
  entityType: string | null
  entityId: string | null
  actor: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  createdAt: Date | string
}

// Retry/runtime churn that dominates the raw stream — collapsed into a count so the
// feed shows meaningful milestones (deliveries, terminals, authority, goals, transitions).
const CHURN_TYPES = [
  "HERMES_RUNTIME_CHECKPOINT",
  "HERMES_RUNTIME_LEASE",
  "HERMES_RUNTIME_FAILURE_EVAL",
  "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED",
  "HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED",
] as const

function classify(eventType: string): { kind: ActivityKind; label: string } {
  switch (eventType) {
    case "HERMES_OUTCOME_COMPLETED":
      return { kind: "delivery", label: "Delivered" }
    case "HERMES_OUTCOME_TERMINAL":
      return { kind: "terminal", label: "Outcome terminal" }
    case "HERMES_RUNTIME_FAILURE_EVAL":
      return { kind: "failure", label: "Attempt failed" }
    case "AUTHORITY_GRANTED":
      return { kind: "authority", label: "Authority granted" }
    case "GOAL_CREATED":
      return { kind: "goal", label: "Goal created" }
    case "WO_TRANSITION":
      return { kind: "transition", label: "Work order transition" }
    case "OUTCOME_QUEUE_APPROVE":
      return { kind: "authority", label: "Outcome approved" }
    default:
      return { kind: "runtime", label: eventType.replace(/^HERMES_/, "").replace(/_/g, " ").toLowerCase() }
  }
}

export async function getActivity(limit = 60): Promise<ActivityFeed> {
  const userId = await getUserId()

  const churnList = sql.join(
    CHURN_TYPES.map((t) => sql`${t}`),
    sql`, `,
  )

  const activitySummaryRow = (await db.execute(
    sql`select
          count(*) filter (where "eventType" in (${churnList}))::int as n,
          max("createdAt") AT TIME ZONE current_setting('TimeZone') as "latestEventAt"
        from governance_event
        where "userId" = ${userId}`,
  )).rows as unknown as Array<{ n: number; latestEventAt: Date | string | null }>
  const churnCollapsed = activitySummaryRow[0]?.n ?? 0
  const persistedLatestEventAt = activitySummaryRow[0]?.latestEventAt ?? null
  const latestEventAt = persistedLatestEventAt === null ? null : instantIso(persistedLatestEventAt)

  const rows = (await db.execute(
    sql`select id, ref, "eventType" as "eventType", "entityType" as "entityType",
          "entityId" as "entityId", actor, reason, metadata,
          "createdAt" AT TIME ZONE current_setting('TimeZone') as "createdAt"
        from governance_event
        where "userId" = ${userId}
          and "eventType" not in (${churnList})
        order by "createdAt" desc, id desc
        limit ${limit}`,
  )).rows as unknown as Row[]

  const items: ActivityItem[] = rows.map((r) => {
    const { kind, label } = classify(r.eventType)
    const md = r.metadata ?? {}
    const ref = (md.workOrderRef as string)
      ?? (md.outcomeId != null ? `outcome:${md.outcomeId}` : null)
      ?? (r.entityType && r.entityId ? `${r.entityType}:${r.entityId}` : r.ref)
    let detail: string | null = null
    if (kind === "delivery" && md.prNumber != null) {
      detail = `${ref ?? ""}${ref ? " · " : ""}PR #${md.prNumber}${md.mergeSha ? ` (${String(md.mergeSha).slice(0, 7)})` : ""}`.trim()
    } else if (r.reason) {
      detail = ref ? `${ref} · ${r.reason}` : r.reason
    } else if (ref) {
      detail = ref
    }
    return { id: r.id, at: instantIso(r.createdAt), kind, label, detail, ref }
  })

  return {
    items,
    churnCollapsed,
    source: "governance_event (meaningful events; runtime churn collapsed)",
    latestEventAt,
    observedAt: nowIso(),
    truthState: latestEventAt ? "persisted" : "idle-empty",
  }
}
