import { and, desc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { environmentWorld, project, projectResource } from "@/lib/db/schema"
import { validateEnvironmentWorldProjection } from "@/lib/environment/world-projection"
import type {
  EnvironmentWorldRepository,
  ResourceCandidate,
  StoredEnvironmentWorld,
} from "@/lib/environment/world-service"

export const postgresEnvironmentWorldRepository: EnvironmentWorldRepository = {
  async listResourceCandidates(userId): Promise<readonly ResourceCandidate[]> {
    const rows = await db
      .select({
        projectKey: project.key,
        projectName: project.name,
        projectLifecycle: project.lifecycle,
        type: projectResource.type,
        canonicalIdentity: projectResource.canonicalIdentity,
        resourceLabel: projectResource.label,
        ratifiedAt: projectResource.ratifiedAt,
      })
      .from(project)
      .innerJoin(
        projectResource,
        and(eq(projectResource.userId, userId), eq(projectResource.projectId, project.id)),
      )
      .where(eq(project.userId, userId))

    return rows
      .map((row) => ({
        candidateId: `${row.projectKey}:${row.type}:${row.canonicalIdentity}`,
        canonicalIdentity: row.canonicalIdentity,
        label: `${row.projectName} — ${row.resourceLabel}`,
        weight: (row.projectLifecycle === "active" ? 4 : row.projectLifecycle === "standby" ? 2 : 0) +
          (row.ratifiedAt ? 1 : 0),
      }))
      .sort((a, b) => b.weight - a.weight || a.candidateId.localeCompare(b.candidateId))
  },

  async loadExact(userId, worldId): Promise<StoredEnvironmentWorld | null> {
    const rows = await db
      .select({ projection: environmentWorld.projection, updatedAt: environmentWorld.updatedAt })
      .from(environmentWorld)
      .where(and(eq(environmentWorld.userId, userId), eq(environmentWorld.id, worldId)))
      .limit(1)
    return rows[0] ? decode(rows[0]) : null
  },

  async loadLatest(userId): Promise<StoredEnvironmentWorld | null> {
    const rows = await db
      .select({ projection: environmentWorld.projection, updatedAt: environmentWorld.updatedAt })
      .from(environmentWorld)
      .where(eq(environmentWorld.userId, userId))
      .orderBy(desc(environmentWorld.updatedAt), desc(environmentWorld.id))
      .limit(1)
    return rows[0] ? decode(rows[0]) : null
  },

  async insert(userId, world, now): Promise<void> {
    const projection = validateEnvironmentWorldProjection(world)
    await db.insert(environmentWorld).values({
      id: projection.id,
      userId,
      resourceIdentity: projection.resource?.canonicalIdentity ?? null,
      intent: projection.meaning.intent,
      projection,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
  },

  async update(userId, world, now): Promise<boolean> {
    const projection = validateEnvironmentWorldProjection(world)
    const rows = await db
      .update(environmentWorld)
      .set({
        resourceIdentity: projection.resource?.canonicalIdentity ?? null,
        intent: projection.meaning.intent,
        projection,
        updatedAt: new Date(now),
      })
      .where(and(eq(environmentWorld.userId, userId), eq(environmentWorld.id, projection.id)))
      .returning({ id: environmentWorld.id })
    return rows.length === 1
  },
}

function decode(row: { projection: unknown; updatedAt: Date }): StoredEnvironmentWorld {
  const raw = typeof row.projection === "string" ? JSON.parse(row.projection) : row.projection
  return {
    world: validateEnvironmentWorldProjection(raw),
    updatedAt: row.updatedAt.toISOString(),
  }
}
