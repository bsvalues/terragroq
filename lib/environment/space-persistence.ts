import { and, desc, eq } from "drizzle-orm"
import { spaceIntentForProject, worldMatchesProject, type ProjectIdentity } from "@/lib/environment/space-identity"

import { db } from "@/lib/db"
import { workingWorld } from "@/lib/db/schema"
import {
  createWorkingWorld,
  validateSpaceState,
  validateWorkingWorld,
  type SpaceState,
  type WorkingWorldSnapshot,
  type WorldSpine,
} from "@/lib/environment/working-world"

export type OwnedWorkingWorldRecord = Readonly<{
  id: string
  userId: string
  intent: string
  snapshot: string
  updatedAt: Date
}>

export interface SpaceWorkingWorldStore {
  findOwned(userId: string, worldId: string): Promise<OwnedWorkingWorldRecord | null>
  findLatestOwned(userId: string): Promise<OwnedWorkingWorldRecord | null>
  insertOwned(row: OwnedWorkingWorldRecord): Promise<void>
  updateOwned(userId: string, worldId: string, snapshot: string, intent: string, expectedSnapshot: string): Promise<boolean>
}

const OWNED_WORLD_PAGE_SIZE = 20

export async function findLatestTerraFusionOwnedByPage(
  readPage: (offset: number, limit: number) => Promise<readonly OwnedWorkingWorldRecord[]>,
): Promise<OwnedWorkingWorldRecord | null> {
  for (let offset = 0; ; offset += OWNED_WORLD_PAGE_SIZE) {
    const rows = await readPage(offset, OWNED_WORLD_PAGE_SIZE)
    const match = rows.find((row) => isTerraFusionWorld(row))
    if (match) return match
    if (rows.length < OWNED_WORLD_PAGE_SIZE) return null
  }
}

export const databaseSpaceWorkingWorldStore: SpaceWorkingWorldStore = {
  async findOwned(userId, worldId) {
    const rows = await db.select({
      id: workingWorld.id, userId: workingWorld.userId, intent: workingWorld.intent,
      snapshot: workingWorld.snapshot, updatedAt: workingWorld.updatedAt,
    }).from(workingWorld)
      .where(and(eq(workingWorld.userId, userId), eq(workingWorld.id, worldId)))
      .limit(1)
    return rows[0] ?? null
  },

  async findLatestOwned(userId) {
    return findLatestTerraFusionOwnedByPage((offset, limit) => db.select({
        id: workingWorld.id, userId: workingWorld.userId, intent: workingWorld.intent,
        snapshot: workingWorld.snapshot, updatedAt: workingWorld.updatedAt,
      }).from(workingWorld)
        .where(eq(workingWorld.userId, userId))
        .orderBy(desc(workingWorld.updatedAt), desc(workingWorld.id))
        .limit(limit)
        .offset(offset))
  },

  async insertOwned(row) {
    await db.insert(workingWorld).values({
      id: row.id, userId: row.userId, intent: row.intent, snapshot: row.snapshot,
      updatedAt: row.updatedAt,
    })
  },

  async updateOwned(userId, worldId, snapshot, intent, expectedSnapshot) {
    const rows = await db.update(workingWorld)
      .set({ snapshot, intent, updatedAt: new Date() })
      .where(and(
        eq(workingWorld.userId, userId),
        eq(workingWorld.id, worldId),
        eq(workingWorld.snapshot, expectedSnapshot),
      ))
      .returning({ id: workingWorld.id })
    return rows.length === 1
  },
}

/**
 * Persist a Line-owned world mutation without replacing Space-owned state. The CAS makes a Space
 * write that lands between Line read and Line save visible; the retry then reapplies the Line result
 * to that latest snapshot while retaining its Space revision and layout.
 */
export async function saveOwnedLineWorld(
  input: Readonly<{
    userId: string
    worldId: string
    world: WorkingWorldSnapshot
    isNew: boolean
  }>,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<void> {
  const submitted = validateWorkingWorld(input.world)
  if (input.isNew) {
    await store.insertOwned({
      id: input.worldId,
      userId: input.userId,
      intent: submitted.intent,
      snapshot: JSON.stringify(submitted),
      updatedAt: new Date(),
    })
    return
  }

  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const row = await store.findOwned(input.userId, input.worldId)
    if (!row) throw new Error("WORLD_NOT_FOUND")
    const latest = validateWorkingWorld(JSON.parse(row.snapshot))
    const merged = validateWorkingWorld({ ...submitted, space: latest.space })
    if (await store.updateOwned(
      input.userId,
      input.worldId,
      JSON.stringify(merged),
      merged.intent,
      row.snapshot,
    )) return
  }
  throw new Error("WORLD_PERSISTENCE_BUSY")
}

/** Whether a stored world row is the Space for a Project, by projectId (regex-free). */
function latestMatchesProject(row: OwnedWorkingWorldRecord, project: ProjectIdentity): boolean {
  try {
    const world = validateWorkingWorld(JSON.parse(row.snapshot))
    return worldMatchesProject(
      {
        projectId: world.spine.projectId,
        projectName: world.spine.projectName,
        intent: world.intent,
        resources: world.resources,
      },
      project,
    )
  } catch {
    return false
  }
}

function isTerraFusionWorld(row: OwnedWorkingWorldRecord): boolean {
  if (/terrafusion/i.test(row.intent)) return true
  try {
    const world = validateWorkingWorld(JSON.parse(row.snapshot))
    return world.resources.some((resource) => /terrafusion|terragroq/i.test(resource))
      || /terrafusion/i.test(world.spine.projectName ?? "")
  } catch {
    return false
  }
}

function validHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

/** Only an admitted server-owned endpoint can become executable browser content. */
export function serverRunningAppUrl(_world: WorkingWorldSnapshot, configured?: string | null): string | null {
  return validHttpUrl(configured)
}

export function createDefaultSpace(runningAppUrl: string | null): SpaceState {
  return {
    schemaVersion: 1,
    revision: 0,
    windows: [
      { id: "workspace-editor", kind: "editor", title: "Source", frame: { x: 36, y: 44, width: 920, height: 700 }, z: 2, minimized: false },
      { id: "workspace-running-app", kind: "running-app", title: "TerraFusion", frame: { x: 820, y: 72, width: 860, height: 640 }, z: 1, minimized: false },
    ],
    openFiles: [],
    panes: [{ id: "workspace-pane", filePath: null }],
    selection: null,
    activeWindowId: "workspace-editor",
    activePaneId: "workspace-pane",
    runningAppUrl,
  }
}

function restoredSpace(world: WorkingWorldSnapshot, configured?: string | null): SpaceState {
  const runningAppUrl = serverRunningAppUrl(world, configured)
  return world.space
    ? validateSpaceState({ ...world.space, runningAppUrl })
    : createDefaultSpace(runningAppUrl)
}

export async function loadOrCreateOwnedSpace(
  input: Readonly<{
    userId: string
    worldId?: string | null
    workspaceAppUrl?: string | null
    newWorldId?: () => string
    projectRootIdentity?: string | null
    // The Project this Space belongs to. When present, world identity is decided by projectId, not
    // by a string regex, and a new world is named for the Project rather than the literal
    // "TerraFusion". Absent = legacy behaviour, unchanged.
    project?: ProjectIdentity | null
  }>,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<Readonly<{ worldId: string; space: SpaceState; spine: WorldSpine }> | null> {
  const exact = input.worldId ? await store.findOwned(input.userId, input.worldId) : null
  if (input.worldId && !exact) return null
  const latest = exact ? null : await store.findLatestOwned(input.userId)
  // Store implementations may be generic "latest owned" readers. Recheck identity here so an
  // unrelated working world can never silently become the TerraFusion Space.
  // Identity by Project when we have one; the string regex is legacy-only.
  const matchesLatest = latest
    ? input.project
      ? latestMatchesProject(latest, input.project)
      : isTerraFusionWorld(latest)
    : false
  const row = exact ?? (matchesLatest ? latest : null)
  if (row) {
    const world = validateWorkingWorld(JSON.parse(row.snapshot))
    return { worldId: row.id, space: restoredSpace(world, input.workspaceAppUrl), spine: world.spine }
  }

  const worldId = (input.newWorldId ?? crypto.randomUUID)()
  const base = createWorkingWorld({
    intent: input.project ? spaceIntentForProject(input.project) : "TerraFusion",
    resources: input.projectRootIdentity ? [input.projectRootIdentity] : [],
  })
  const space = createDefaultSpace(serverRunningAppUrl(base, input.workspaceAppUrl))
  const world = validateWorkingWorld({ ...base, space })
  await store.insertOwned({
    id: worldId, userId: input.userId, intent: world.intent,
    snapshot: JSON.stringify(world), updatedAt: new Date(),
  })
  return { worldId, space, spine: world.spine }
}

export async function saveOwnedSpace(
  input: Readonly<{
    userId: string
    worldId: string
    space: unknown
    workspaceAppUrl?: string | null
  }>,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<Readonly<{ worldId: string; space: SpaceState; spine: WorldSpine }> | null> {
  let row = await store.findOwned(input.userId, input.worldId)
  if (!row) return null
  // URL is intentionally overwritten before validation: it is not browser authority. A malicious
  // scheme cannot become persisted state, nor can it turn an otherwise valid layout into a write.
  if (!input.space || typeof input.space !== "object" || Array.isArray(input.space)) {
    throw new Error("SPACE_MALFORMED")
  }
  const submittedRecord = input.space as Record<string, unknown>
  const submitted = validateSpaceState({ ...submittedRecord, runningAppUrl: null })
  // A failed CAS says only that the working world changed between read and write. It does NOT say
  // this Space revision is stale: another world writer may have changed the spine or an older Space
  // revision may have landed first. Re-read, re-compare revision, and rebuild on the latest whole
  // snapshot so unrelated concurrent world fields survive.
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const world = validateWorkingWorld(JSON.parse(row.snapshot))
    const persistedRevision = world.space?.revision ?? 0
    if (submitted.revision <= persistedRevision) throw new Error("SPACE_REVISION_STALE")
    const space = validateSpaceState({
      ...submitted,
      runningAppUrl: serverRunningAppUrl(world, input.workspaceAppUrl),
    })
    const updated = validateWorkingWorld({ ...world, space })
    if (await store.updateOwned(
      input.userId,
      input.worldId,
      JSON.stringify(updated),
      updated.intent,
      row.snapshot,
    )) return { worldId: input.worldId, space, spine: updated.spine }

    const latest = await store.findOwned(input.userId, input.worldId)
    if (!latest) return null
    row = latest
  }
  throw new Error("SPACE_PERSISTENCE_BUSY")
}
