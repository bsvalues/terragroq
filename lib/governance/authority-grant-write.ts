import { and, eq, isNull, sql } from "drizzle-orm"
import { access, readFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

import { db } from "@/lib/db"
import { authorityGrant, eventLog, governanceEvent, workOrder, type AuthorityGrant } from "@/lib/db/schema"
import { hashRecord } from "@/lib/governance/hash"
import { writeArtifact, type ArtifactResult } from "@/lib/governance/artifacts"
import { authorityRank } from "@/lib/goal/taxonomy"
import { isProtectedV12AuthorityScope } from "@/lib/outcome-queue/v1-2-protected-authority"

// Audit artifacts mirror canonical database authority; they do not create it.
export type GovernanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type AuthorityGrantArtifactExport = Readonly<{
  status: "written" | "unchanged" | "failed" | "not-required"
  wrote: boolean
  artifact?: ArtifactResult
}>

const authorityArtifactFlights = new Map<string, Promise<AuthorityGrantArtifactExport>>()
const authorityArtifactSuccesses = new Map<string, Pick<ArtifactResult, "markdownPath" | "jsonPath">>()

export type TransactionalAuthorityGrantInput = Readonly<{
  workOrderId?: number | null
  bindToWorkOrder?: boolean
  grantedTo?: string
  authorityLevel: string
  scope?: string | null
  allowedActions?: readonly string[]
  blockedActions?: readonly string[]
  reason?: string | null
  expiresAt?: Date | null
  reuseActiveScope?: boolean
}>

function draftFromRow(row: AuthorityGrant) {
  return {
    userId: row.userId, ref: row.ref!, workOrderId: row.workOrderId,
    grantedBy: row.grantedBy, grantedTo: row.grantedTo, authorityLevel: row.authorityLevel,
    scope: row.scope, allowedActions: row.allowedActions, blockedActions: row.blockedActions,
    reason: row.reason, status: "active" as const, expiresAt: row.expiresAt,
  }
}

async function ensureGrantEvidence(
  transaction: GovernanceTransaction,
  row: AuthorityGrant,
  draft: ReturnType<typeof draftFromRow>,
  contentHash: string,
  now: Date,
) {
  const afterHash = hashRecord({ ...draft, contentHash })
  const [existing] = await transaction.select({ id: governanceEvent.id }).from(governanceEvent).where(and(
    eq(governanceEvent.userId, row.userId), eq(governanceEvent.eventType, "AUTHORITY_GRANTED"),
    eq(governanceEvent.entityType, "authority_grant"), eq(governanceEvent.entityId, String(row.id)),
    eq(governanceEvent.afterHash, afterHash),
  )).limit(1)
  if (!existing) await transaction.insert(governanceEvent).values({
    userId: row.userId, eventType: "AUTHORITY_GRANTED", entityType: "authority_grant",
    entityId: String(row.id), actor: row.grantedBy, reason: draft.reason, afterHash,
    metadata: { authorityLevel: draft.authorityLevel, ref: draft.ref }, createdAt: now,
  })
  const [registered] = await transaction.select({ id: eventLog.id }).from(eventLog).where(and(
    eq(eventLog.userId, row.userId), eq(eventLog.type, "authority.granted"),
    eq(eventLog.register, "authority"), eq(eventLog.refId, row.id),
  )).limit(1)
  if (!registered) await transaction.insert(eventLog).values({
    userId: row.userId, type: "authority.granted",
    summary: `${draft.ref}: granted ${draft.authorityLevel} to ${draft.grantedTo}${draft.workOrderId ? ` for WO #${draft.workOrderId}` : ""}`,
    register: "authority", refId: row.id, createdAt: now,
  })
}

/** The canonical authority registry write, composable inside a caller-owned transaction. */
export async function createAuthorityGrantInTransaction(
  transaction: GovernanceTransaction,
  userId: string,
  input: TransactionalAuthorityGrantInput,
  now: Date,
): Promise<{ grant: AuthorityGrant; replayed: boolean }> {
  const scope = input.scope ?? null
  if (scope && isProtectedV12AuthorityScope(scope)) throw new Error("V1_2_BOUND_AUTHORITY_ACTION_REQUIRED")
  const workOrderId = input.workOrderId ?? null
  const grantedTo = input.grantedTo ?? "operator"
  const allowedActions = [...(input.allowedActions ?? [])]
  const blockedActions = [...(input.blockedActions ?? [])]
  const expiresAt = input.expiresAt ?? null
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:authority-grant-allocation`}))`)
  if (input.reuseActiveScope) {
    const candidates = await transaction.select().from(authorityGrant).where(and(
      eq(authorityGrant.userId, userId), eq(authorityGrant.status, "active"),
      eq(authorityGrant.authorityLevel, input.authorityLevel), eq(authorityGrant.grantedTo, grantedTo),
      scope === null ? isNull(authorityGrant.scope) : eq(authorityGrant.scope, scope),
    ))
    const reusable = candidates.find((candidate) => candidate.ref !== null && candidate.revokedAt === null
      && (candidate.expiresAt === null || candidate.expiresAt.getTime() > now.getTime())
      && candidate.workOrderId === workOrderId
      && JSON.stringify(candidate.allowedActions) === JSON.stringify(allowedActions)
      && JSON.stringify(candidate.blockedActions) === JSON.stringify(blockedActions))
    if (reusable) {
      const draft = draftFromRow(reusable)
      const contentHash = reusable.contentHash ?? hashRecord(draft)
      await ensureGrantEvidence(transaction, reusable, draft, contentHash, now)
      return { grant: reusable, replayed: true }
    }
  }
  const refs = await transaction.select({ ref: authorityGrant.ref }).from(authorityGrant)
    .where(eq(authorityGrant.userId, userId))
  const max = refs.reduce((current, candidate) => {
    const match = candidate.ref?.match(/^GRANT-(\d+)$/)
    return match ? Math.max(current, Number.parseInt(match[1], 10)) : current
  }, 0)
  const draft = {
    userId, ref: `GRANT-${String(max + 1).padStart(4, "0")}`, workOrderId,
    grantedBy: userId, grantedTo, authorityLevel: input.authorityLevel, scope,
    allowedActions, blockedActions, reason: input.reason ?? null,
    status: "active" as const, expiresAt,
  }
  const contentHash = hashRecord(draft)
  const [grant] = await transaction.insert(authorityGrant).values({ ...draft, contentHash, createdAt: now }).returning()
  if (workOrderId && input.bindToWorkOrder !== false) await transaction.update(workOrder)
    .set({ authorityGrantId: grant.id, updatedAt: now })
    .where(and(eq(workOrder.id, workOrderId), eq(workOrder.userId, userId)))
  await ensureGrantEvidence(transaction, grant, draft, contentHash, now)
  return { grant, replayed: false }
}

function artifactPath(target: string): string {
  return isAbsolute(target) ? target : resolve(process.cwd(), target)
}

async function exportedFilesExist(paths: Pick<ArtifactResult, "markdownPath" | "jsonPath">): Promise<boolean> {
  try {
    await Promise.all([access(artifactPath(paths.markdownPath)), access(artifactPath(paths.jsonPath))])
    return true
  } catch {
    return false
  }
}

async function canonicalArtifactIsCurrent(ref: string, artifactSha: string): Promise<boolean> {
  try {
    const jsonPath = resolve(process.cwd(), "docs", "devkit", "authority", `${ref}.json`)
    const markdownPath = resolve(process.cwd(), "docs", "devkit", "authority", `${ref}.md`)
    const parsed = JSON.parse(await readFile(jsonPath, "utf8")) as { sha256?: unknown }
    return parsed.sha256 === artifactSha && await exportedFilesExist({ markdownPath, jsonPath })
  } catch {
    return false
  }
}

/** Preserve canonical Git-backed A2+ evidence once per immutable grant content. */
export async function writeAuthorityGrantArtifact(grant: AuthorityGrant): Promise<AuthorityGrantArtifactExport> {
  if (authorityRank(grant.authorityLevel) < authorityRank("A2_WRITE_OWN")) {
    return { status: "not-required", wrote: false }
  }
  const draft = draftFromRow(grant)
  const contentHash = grant.contentHash ?? hashRecord(draft)
  const record = { ...draft, contentHash }
  const artifactSha = hashRecord(record)
  const flightKey = `${draft.userId}:${draft.ref}:${artifactSha}`
  const active = authorityArtifactFlights.get(flightKey)
  if (active) return active
  const flight = (async (): Promise<AuthorityGrantArtifactExport> => {
    const successful = authorityArtifactSuccesses.get(flightKey)
    if ((successful && await exportedFilesExist(successful))
      || await canonicalArtifactIsCurrent(draft.ref, artifactSha)) {
      return { status: "unchanged", wrote: false }
    }
    const artifact = await writeArtifact({
      id: draft.ref, category: "authority", title: `Authority Grant ${draft.ref} — ${draft.authorityLevel}`,
      sections: [
        { heading: "Granted to", body: draft.grantedTo },
        { heading: "Scope", body: draft.scope ?? "(unscoped)" },
        { heading: "Allowed actions", body: draft.allowedActions.join("\n") || "(none specified)" },
        { heading: "Blocked actions", body: draft.blockedActions.join("\n") || "(none specified)" },
        { heading: "Reason", body: draft.reason ?? "(none)" },
        { heading: "Expires", body: draft.expiresAt ? draft.expiresAt.toISOString() : "no expiry (review recommended)" },
      ],
      record,
    })
    if (!artifact.wrote) return { status: "failed", wrote: false, artifact }
    authorityArtifactSuccesses.set(flightKey, artifact)
    return { status: "written", wrote: true, artifact }
  })()
  authorityArtifactFlights.set(flightKey, flight)
  try {
    return await flight
  } finally {
    authorityArtifactFlights.delete(flightKey)
  }
}
