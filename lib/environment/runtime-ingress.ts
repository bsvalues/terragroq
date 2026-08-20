import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { authorityGrant, environmentWorld, evidenceRecord, workOrder } from "@/lib/db/schema"
import { grantCovers } from "@/lib/governance/authority"

/**
 * Runtime publication is not normal browser input. It is accepted only when the exact world, Work
 * Order, active grant, and durable evidence all join for the same owner. This adapter consumes the
 * existing authority model; it never grants or widens authority itself.
 */
export async function requireEnvironmentRuntimeAuthority(input: {
  userId: string
  worldId: string
  workOrderRef: string
  grantRef: string
  evidenceRefs: readonly string[]
}) {
  const [world] = await db
    .select({ id: environmentWorld.id, resourceIdentity: environmentWorld.resourceIdentity })
    .from(environmentWorld)
    .where(and(eq(environmentWorld.userId, input.userId), eq(environmentWorld.id, input.worldId)))
    .limit(1)
  if (!world) throw new Error("WORLD_NOT_FOUND")

  const [work] = await db
    .select()
    .from(workOrder)
    .where(and(eq(workOrder.userId, input.userId), eq(workOrder.ref, input.workOrderRef)))
    .limit(1)
  if (!work || !["active", "review"].includes(work.status)) throw new Error("RUNTIME_WORK_ORDER_NOT_ACTIVE")
  if (!work.description?.includes(`[environment-world:${input.worldId}]`)) {
    throw new Error("RUNTIME_WORK_ORDER_WORLD_MISMATCH")
  }

  const [grant] = await db
    .select()
    .from(authorityGrant)
    .where(and(eq(authorityGrant.userId, input.userId), eq(authorityGrant.ref, input.grantRef)))
    .limit(1)
  if (!grant || grant.id !== work.authorityGrantId || grant.workOrderId !== work.id) {
    throw new Error("RUNTIME_AUTHORITY_BINDING_MISMATCH")
  }
  const covered = grantCovers(grant, "A2_WRITE_OWN")
  if (!covered.ok) throw new Error("RUNTIME_AUTHORITY_NOT_GRANTED")

  const required = [...new Set(input.evidenceRefs.map((ref) => ref.trim()).filter(Boolean))]
  if (required.length === 0) throw new Error("RUNTIME_EVIDENCE_REQUIRED")
  const rows = await db
    .select({ id: evidenceRecord.id, ref: evidenceRecord.ref })
    .from(evidenceRecord)
    .where(and(eq(evidenceRecord.userId, input.userId), eq(evidenceRecord.workOrderId, work.id)))
  const present = new Set(rows.map((row) => row.ref).filter((ref): ref is string => Boolean(ref)))
  if (required.some((ref) => !present.has(ref))) throw new Error("RUNTIME_EVIDENCE_BINDING_MISMATCH")

  return { world, work, grant, evidence: rows.filter((row) => row.ref && required.includes(row.ref)) }
}
