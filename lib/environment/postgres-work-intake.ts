import { eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { governanceEvent, workOrder } from "@/lib/db/schema"
import type { EnvironmentWorkIntakePort } from "@/lib/environment/world-service"

/**
 * A sentence may suggest governed work, never authorize it. The resulting draft is deliberately
 * undispatchable until an independent policy/owner path supplies exact files, validators, approval,
 * and an active grant. The world marker makes retries idempotent and later runtime publication exact.
 */
export const postgresEnvironmentWorkIntake: EnvironmentWorkIntakePort = {
  async createSuggested({ userId, worldId, intent, resource }) {
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:environment-work-intake`}))`)
      const marker = `[environment-world:${worldId}]`
      const existing = await transaction
        .select({ ref: workOrder.ref, description: workOrder.description })
        .from(workOrder)
        .where(eq(workOrder.userId, userId))
      const matched = existing.find((row) => row.ref && row.description?.includes(marker))
      if (matched?.ref) return { workOrderRef: matched.ref }

      let max = 0
      for (const row of existing) {
        const parsed = /^WO-(\d+)$/.exec(row.ref ?? "")
        if (parsed) max = Math.max(max, Number(parsed[1]))
      }
      const ref = `WO-${String(max + 1).padStart(4, "0")}`
      const title = intent.length > 100 ? `${intent.slice(0, 97)}...` : intent
      const [created] = await transaction.insert(workOrder).values({
        userId,
        ref,
        title,
        goal: intent,
        description: `${intent}\n\n${marker}`,
        scope: `[resource:${resource.canonicalIdentity}] [resource-record:${resource.recordId}]`,
        lane: "operator-objective",
        phase: "environment-suggested",
        status: "draft",
        priority: "medium",
        agent: "codex",
        authorityLevel: "A2_WRITE_OWN",
        allowedFiles: [],
        forbiddenFiles: [],
        validators: [],
        stopConditions: ["Do not execute without an active exact-scope authority grant"],
        acceptanceCriteria: ["Return runtime-bound diff, test, and application evidence to the same Environment world"],
      }).returning({ id: workOrder.id })
      if (!created) throw new Error("ENVIRONMENT_WORK_INTAKE_FAILED")
      await transaction.insert(governanceEvent).values({
        userId,
        eventType: "ENVIRONMENT_WORK_SUGGESTED",
        entityType: "work_order",
        entityId: String(created.id),
        actor: "owner-line",
        reason: "Environment sentence preserved as an unauthorized draft",
        metadata: {
          worldId,
          resourceIdentity: resource.canonicalIdentity,
          resourceRecordId: resource.recordId,
          workOrderRef: ref,
        },
      })
      return { workOrderRef: ref }
    })
  },
}
