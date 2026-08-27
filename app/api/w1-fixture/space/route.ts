import fs from "node:fs/promises"

import { createDefaultSpace } from "@/lib/environment/space-persistence"
import { readBoundedJson } from "@/lib/environment/line-guard"
import {
  admitW1LocalFixtureRequest,
  validateW1LocalFixtureHome,
  w1FixtureRunningUrl,
  withW1FixtureStateLock,
  writeW1FixtureStateAtomically,
} from "@/lib/environment/w1-local-fixture"
import { EMPTY_SPINE, validateSpaceState, type SpaceState } from "@/lib/environment/working-world"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const WORLD_ID = "w1-local-fixture"
const MAX_SPACE_BYTES = 256_000
const refuse = (error: string, status: number) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } })

async function readSpace(stateFile: string, request: Request): Promise<SpaceState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile, "utf8"))
    return validateSpaceState({ ...parsed, runningAppUrl: w1FixtureRunningUrl(request) })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function writeSpace(stateFile: string, space: SpaceState): Promise<void> {
  await writeW1FixtureStateAtomically(stateFile, `${JSON.stringify(space, null, 2)}\n`)
}

export async function GET(request: Request) {
  const fixture = admitW1LocalFixtureRequest(request)
  if (!fixture || !(await validateW1LocalFixtureHome(fixture))) return refuse("NOT_FOUND", 404)
  try {
    return await withW1FixtureStateLock(fixture.stateFile, async () => {
      const existing = await readSpace(fixture.stateFile, request)
      const space = existing ?? createDefaultSpace(w1FixtureRunningUrl(request))
      if (!existing) await writeSpace(fixture.stateFile, space)
      return Response.json({ worldId: WORLD_ID, space, spine: EMPTY_SPINE }, { headers: { "cache-control": "no-store" } })
    })
  } catch {
    return refuse("FIXTURE_STATE_UNAVAILABLE", 503)
  }
}

export async function PUT(request: Request) {
  const fixture = admitW1LocalFixtureRequest(request)
  if (!fixture || !(await validateW1LocalFixtureHome(fixture))) return refuse("NOT_FOUND", 404)
  const parsed = await readBoundedJson(request, MAX_SPACE_BYTES)
  if (!parsed.ok) return refuse(parsed.error, parsed.status)
  const body = parsed.value as { worldId?: unknown; space?: unknown }
  if (body.worldId !== WORLD_ID || !body.space || typeof body.space !== "object" || Array.isArray(body.space)) {
    return refuse("FIXTURE_SPACE_INVALID", 400)
  }
  try {
    return await withW1FixtureStateLock(fixture.stateFile, async () => {
      const submitted = validateSpaceState({ ...(body.space as object), runningAppUrl: w1FixtureRunningUrl(request) })
      const current = await readSpace(fixture.stateFile, request)
      if (current && submitted.revision <= current.revision) return refuse("SPACE_REVISION_STALE", 409)
      await writeSpace(fixture.stateFile, submitted)
      return Response.json({ worldId: WORLD_ID, space: submitted, spine: EMPTY_SPINE }, { headers: { "cache-control": "no-store" } })
    })
  } catch (error) {
    const reason = error instanceof Error && /^SPACE_/.test(error.message) ? error.message : "FIXTURE_STATE_UNAVAILABLE"
    return refuse(reason, reason === "FIXTURE_STATE_UNAVAILABLE" ? 503 : 400)
  }
}
