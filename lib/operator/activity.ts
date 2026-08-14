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
  observedAt: string
  truthState: "live" | "idle-empty"
}

type Row = { id: number; eventType: string; actor: string | null; reason: string | null; metadata: Record<string, unknown>; createdAt: string }

const CHURN = new Set(["HERMES_RUNTIME_CHECKPOINT", "HERMES_RUNTIME_LEASE"])

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

  const churnRow = (await db.execute(
    sql`select count(*)::int as n from governance_event
        where "userId" = ${userId} and "eventType" in ('HERMES_RUNTIME_CHECKPOINT','HERMES_RUNTIME_LEASE')`,
  )).rows as unknown as Array<{ n: number }>
  const churnCollapsed = churnRow[0]?.n ?? 0

  const rows = (await db.execute(
    sql`select id, "eventType" as "eventType", actor, reason, metadata, "createdAt"::text as "createdAt"
        from governance_event
        where "userId" = ${userId}
          and "eventType" not in ('HERMES_RUNTIME_CHECKPOINT','HERMES_RUNTIME_LEASE')
        order by "createdAt" desc
        limit ${limit}`,
  )).rows as unknown as Row[]

  const items: ActivityItem[] = rows.map((r) => {
    const { kind, label } = classify(r.eventType)
    const md = r.metadata ?? {}
    const ref = (md.workOrderRef as string) ?? (md.outcomeId != null ? `outcome:${md.outcomeId}` : null)
    let detail: string | null = null
    if (kind === "delivery" && md.prNumber != null) {
      detail = `${ref ?? ""}${ref ? " · " : ""}PR #${md.prNumber}${md.mergeSha ? ` (${String(md.mergeSha).slice(0, 7)})` : ""}`.trim()
    } else if (r.reason) {
      detail = r.reason
    } else if (ref) {
      detail = ref
    }
    return { id: r.id, at: r.createdAt, kind, label, detail, ref }
  })

  return {
    items,
    churnCollapsed,
    source: "governance_event (meaningful events; runtime churn collapsed)",
    observedAt: nowIso(),
    truthState: items.length ? "live" : "idle-empty",
  }
}
