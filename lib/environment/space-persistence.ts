import { and, desc, eq } from "drizzle-orm"
import { createHash } from "node:crypto"
import path from "node:path"

import { db } from "@/lib/db"
import { workingWorld } from "@/lib/db/schema"
import {
  createWorkingWorld,
  validateWilliamJudgment,
  validateSpaceState,
  validateWorkingWorld,
  type SpaceState,
  type WilliamJudgment,
  type WorkingWorldSnapshot,
  type WorldSpine,
} from "@/lib/environment/working-world"
import { williamJudgmentBasisFingerprint } from "@/lib/environment/william-judgment"
import { addCouncilSession, validateCouncilSession, type CouncilSession } from "@/lib/environment/council-session"

export type OwnedWorkingWorldRecord = Readonly<{
  id: string
  userId: string
  intent: string
  snapshot: string
  updatedAt: Date
}>

export type WorkspaceProject = Readonly<{ identity: string; name: string }>
export type OwnedSpaceSummary = Readonly<{
  worldId: string
  name: string
  space: SpaceState
  updatedAt: string
}>

/** Opaque, stable browser-fallback namespace bound to one signed-in user and project. */
export function browserSpaceStorageKey(userId: string, projectIdentity: string): string {
  return createHash("sha256")
    .update("williamos-browser-space:v1\0")
    .update(userId)
    .update("\0")
    .update(projectIdentity)
    .digest("base64url")
}

const WORKSPACE_ROOT_RESOURCE = "williamos-workspace-root:v1:"
const WORKSPACE_NAME_RESOURCE = "williamos-workspace-name:v1:"
const SPACE_NAME_RESOURCE = "williamos-space-name:v1:"

/** Derive one stable server-owned identity from the configured project root. */
export function workspaceProjectFromRoot(root: string, configuredName?: string | null): WorkspaceProject {
  const windowsPath = /^[A-Za-z]:[\\/]/.test(root)
  const pathFlavor = windowsPath ? path.win32 : path
  const resolved = pathFlavor.resolve(root)
  const portable = resolved.replace(/\\/g, "/").replace(/\/$/, "")
  return {
    identity: windowsPath || process.platform === "win32" ? portable.toLowerCase() : portable,
    name: configuredName?.trim() || pathFlavor.basename(resolved),
  }
}

function projectResources(project: WorkspaceProject, spaceName?: string): readonly string[] {
  return [
    `${WORKSPACE_ROOT_RESOURCE}${project.identity}`,
    `${WORKSPACE_NAME_RESOURCE}${project.name}`,
    ...(spaceName ? [`${SPACE_NAME_RESOURCE}${encodeURIComponent(spaceName)}`] : []),
  ]
}

function persistedSpaceName(world: WorkingWorldSnapshot, fallback: string): string {
  const resource = world.resources.find((value) => value.startsWith(SPACE_NAME_RESOURCE))
  if (!resource) return fallback
  try {
    const name = decodeURIComponent(resource.slice(SPACE_NAME_RESOURCE.length))
    return canonicalSpaceName(name)
  } catch {
    return fallback
  }
}

function worldMatchesProject(world: WorkingWorldSnapshot, project: WorkspaceProject): boolean {
  // The canonical root is identity. The configured display name is mutable presentation metadata
  // and must not orphan an otherwise valid persisted Space when it changes.
  return world.resources.includes(`${WORKSPACE_ROOT_RESOURCE}${project.identity}`)
}

export interface SpaceWorkingWorldStore {
  findOwned(userId: string, worldId: string): Promise<OwnedWorkingWorldRecord | null>
  findLatestOwned(userId: string): Promise<OwnedWorkingWorldRecord | null>
  findLatestOwnedForProject(userId: string, projectIdentity: string): Promise<OwnedWorkingWorldRecord | null>
  listOwnedForProject?(userId: string, projectIdentity: string): Promise<readonly OwnedWorkingWorldRecord[]>
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

export async function findLatestProjectOwnedByPage(
  projectIdentity: string,
  readPage: (offset: number, limit: number) => Promise<readonly OwnedWorkingWorldRecord[]>,
): Promise<OwnedWorkingWorldRecord | null> {
  const rootResource = `${WORKSPACE_ROOT_RESOURCE}${projectIdentity}`
  for (let offset = 0; ; offset += OWNED_WORLD_PAGE_SIZE) {
    const rows = await readPage(offset, OWNED_WORLD_PAGE_SIZE)
    const match = rows.find((row) => {
      try {
        return validateWorkingWorld(JSON.parse(row.snapshot)).resources.includes(rootResource)
      } catch {
        return false
      }
    })
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

  async findLatestOwnedForProject(userId, projectIdentity) {
    return findLatestProjectOwnedByPage(projectIdentity, (offset, limit) => db.select({
        id: workingWorld.id, userId: workingWorld.userId, intent: workingWorld.intent,
        snapshot: workingWorld.snapshot, updatedAt: workingWorld.updatedAt,
      }).from(workingWorld)
        .where(eq(workingWorld.userId, userId))
        .orderBy(desc(workingWorld.updatedAt), desc(workingWorld.id))
        .limit(limit)
        .offset(offset))
  },

  async listOwnedForProject(userId) {
    return db.select({
        id: workingWorld.id, userId: workingWorld.userId, intent: workingWorld.intent,
        snapshot: workingWorld.snapshot, updatedAt: workingWorld.updatedAt,
      }).from(workingWorld)
        .where(eq(workingWorld.userId, userId))
        .orderBy(desc(workingWorld.updatedAt), desc(workingWorld.id))
        .limit(240)
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
    // Space and judgment have independent writers. A Line turn may have loaded before either one;
    // preserve both latest product-owned fields while applying only the conversational mutation.
    const candidate = validateWorkingWorld({
      ...submitted,
      space: latest.space,
      judgment: latest.judgment,
      councilHistory: latest.councilHistory,
    })
    const merged = candidate.judgment
      && candidate.judgment.basisFingerprint !== williamJudgmentBasisFingerprint(candidate)
      ? validateWorkingWorld({ ...candidate, judgment: null })
      : candidate
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

/** Load one exact owned world for a product adapter without exposing the persistence row. */
export async function loadOwnedWorkingWorld(
  userId: string,
  worldId: string,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<WorkingWorldSnapshot | null> {
  const row = await store.findOwned(userId, worldId)
  if (!row) return null
  return validateWorkingWorld(JSON.parse(row.snapshot))
}

/** Lazily load completed advisory sessions from one exact owned world. */
export async function loadOwnedCouncilHistory(
  userId: string,
  worldId: string,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<readonly CouncilSession[] | null> {
  const world = await loadOwnedWorkingWorld(userId, worldId, store)
  return world?.councilHistory ?? null
}

/** CAS-add one completed advisory while retaining all concurrent Space and Line state. */
export async function saveOwnedCouncilSession(
  input: Readonly<{ userId: string; worldId: string; session: CouncilSession }>,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<readonly CouncilSession[]> {
  const session = validateCouncilSession(input.session)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await store.findOwned(input.userId, input.worldId)
    if (!row) throw new Error("WORLD_NOT_FOUND")
    const latest = validateWorkingWorld(JSON.parse(row.snapshot))
    const councilHistory = addCouncilSession(latest.councilHistory, session)
    const updated = validateWorkingWorld({ ...latest, councilHistory })
    if (await store.updateOwned(
      input.userId,
      input.worldId,
      JSON.stringify(updated),
      updated.intent,
      row.snapshot,
    )) return councilHistory
  }
  throw new Error("WORLD_PERSISTENCE_BUSY")
}

/** Persist William's latest judgment while preserving every concurrent Space/world field. */
export async function saveOwnedJudgment(
  input: Readonly<{
    userId: string
    worldId: string
    judgment: WilliamJudgment
    expectedBasisFingerprint: string
  }>,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<void> {
  const judgment = validateWilliamJudgment(input.judgment)
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const row = await store.findOwned(input.userId, input.worldId)
    if (!row) throw new Error("WORLD_NOT_FOUND")
    const latest = validateWorkingWorld(JSON.parse(row.snapshot))
    if (williamJudgmentBasisFingerprint(latest) !== input.expectedBasisFingerprint
      || judgment.basisFingerprint !== input.expectedBasisFingerprint) {
      throw new Error("JUDGMENT_BASIS_STALE")
    }
    const updated = validateWorkingWorld({ ...latest, judgment })
    if (await store.updateOwned(
      input.userId,
      input.worldId,
      JSON.stringify(updated),
      updated.intent,
      row.snapshot,
    )) return
  }
  throw new Error("WORLD_PERSISTENCE_BUSY")
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

const MAX_PROJECT_SPACES = 12

export async function listOwnedProjectSpaces(
  input: Readonly<{ userId: string; project: WorkspaceProject; workspaceAppUrl?: string | null }>,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<readonly OwnedSpaceSummary[]> {
  const rows = await store.listOwnedForProject?.(input.userId, input.project.identity) ?? []
  return rows.flatMap((row): readonly OwnedSpaceSummary[] => {
    try {
      const world = validateWorkingWorld(JSON.parse(row.snapshot))
      if (!worldMatchesProject(world, input.project)) return []
      return [{
        worldId: row.id,
        name: persistedSpaceName(world, row.intent.trim() || input.project.name),
        space: restoredSpace(world, input.workspaceAppUrl),
        updatedAt: row.updatedAt.toISOString(),
      }]
    } catch {
      return []
    }
  }).slice(0, MAX_PROJECT_SPACES)
}

function canonicalSpaceName(value: unknown): string {
  if (typeof value !== "string") throw new Error("SPACE_NAME_INVALID")
  const name = value.trim()
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("SPACE_NAME_INVALID")
  }
  return name
}

export async function createOwnedProjectSpace(
  input: Readonly<{
    userId: string
    project: WorkspaceProject
    name: unknown
    workspaceAppUrl?: string | null
    newWorldId?: () => string
  }>,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<Readonly<{ worldId: string; name: string; space: SpaceState; spine: WorldSpine; judgment: null; project: WorkspaceProject }>> {
  const name = canonicalSpaceName(input.name)
  const worldId = (input.newWorldId ?? crypto.randomUUID)()
  const base = createWorkingWorld({ intent: name, resources: projectResources(input.project, name) })
  const space = createDefaultSpace(serverRunningAppUrl(base, input.workspaceAppUrl))
  const world = validateWorkingWorld({ ...base, space })
  await store.insertOwned({
    id: worldId, userId: input.userId, intent: name,
    snapshot: JSON.stringify(world), updatedAt: new Date(),
  })
  return { worldId, name, space, spine: world.spine, judgment: null, project: input.project }
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
    project?: WorkspaceProject
  }>,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<Readonly<{
  worldId: string
  name: string
  space: SpaceState
  spine: WorldSpine
  judgment: WilliamJudgment | null
  project?: WorkspaceProject
}> | null> {
  const exact = input.worldId ? await store.findOwned(input.userId, input.worldId) : null
  if (input.worldId && !exact) return null
  const latest = exact
    ? null
    : input.project
      ? await store.findLatestOwnedForProject(input.userId, input.project.identity)
      : await store.findLatestOwned(input.userId)
  // Store implementations may be generic "latest owned" readers. Recheck identity here so an
  // unrelated working world can never silently become the TerraFusion Space.
  let row = exact ?? (latest && (input.project || isTerraFusionWorld(latest)) ? latest : null)
  if (row) {
    const world = validateWorkingWorld(JSON.parse(row.snapshot))
    if (input.project && !worldMatchesProject(world, input.project)) {
      if (exact) throw new Error("SPACE_PROJECT_MISMATCH")
      row = null
    } else {
      const space = restoredSpace(world, input.workspaceAppUrl)
      const restoredWorld = validateWorkingWorld({ ...world, space })
      return {
        worldId: row.id,
        name: persistedSpaceName(world, row.intent.trim() || input.project?.name || "TerraFusion"),
        space,
        spine: world.spine,
        judgment: world.judgment?.basisFingerprint === williamJudgmentBasisFingerprint(restoredWorld)
          ? world.judgment
          : null,
        ...(input.project ? { project: input.project } : {}),
      }
    }
  }

  const worldId = (input.newWorldId ?? crypto.randomUUID)()
  const base = createWorkingWorld({
    intent: "TerraFusion",
    resources: input.project
      ? projectResources(input.project, "TerraFusion")
      : input.projectRootIdentity ? [input.projectRootIdentity] : [],
  })
  const space = createDefaultSpace(serverRunningAppUrl(base, input.workspaceAppUrl))
  const world = validateWorkingWorld({ ...base, space })
  await store.insertOwned({
    id: worldId, userId: input.userId, intent: world.intent,
    snapshot: JSON.stringify(world), updatedAt: new Date(),
  })
  return {
    worldId,
    name: world.intent,
    space,
    spine: world.spine,
    judgment: world.judgment,
    ...(input.project ? { project: input.project } : {}),
  }
}

export async function saveOwnedSpace(
  input: Readonly<{
    userId: string
    worldId: string
    space: unknown
    workspaceAppUrl?: string | null
    project?: WorkspaceProject
  }>,
  store: SpaceWorkingWorldStore = databaseSpaceWorkingWorldStore,
): Promise<Readonly<{
  worldId: string
  space: SpaceState
  spine: WorldSpine
  judgment: WilliamJudgment | null
  project?: WorkspaceProject
}> | null> {
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
    if (input.project && !worldMatchesProject(world, input.project)) {
      throw new Error("SPACE_PROJECT_MISMATCH")
    }
    const persistedRevision = world.space?.revision ?? 0
    if (submitted.revision <= persistedRevision) throw new Error("SPACE_REVISION_STALE")
    const space = validateSpaceState({
      ...submitted,
      runningAppUrl: serverRunningAppUrl(world, input.workspaceAppUrl),
    })
    const candidate = validateWorkingWorld({ ...world, space })
    const updated = candidate.judgment
      && candidate.judgment.basisFingerprint !== williamJudgmentBasisFingerprint(candidate)
      ? validateWorkingWorld({ ...candidate, judgment: null })
      : candidate
    if (await store.updateOwned(
      input.userId,
      input.worldId,
      JSON.stringify(updated),
      updated.intent,
      row.snapshot,
    )) return {
      worldId: input.worldId,
      space,
      spine: updated.spine,
      judgment: updated.judgment,
      ...(input.project ? { project: input.project } : {}),
    }

    const latest = await store.findOwned(input.userId, input.worldId)
    if (!latest) return null
    row = latest
  }
  throw new Error("SPACE_PERSISTENCE_BUSY")
}
