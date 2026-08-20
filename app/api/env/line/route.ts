import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { project, workingWorld } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { CHAT_MODEL, INFERENCE_BASE_URL } from "@/lib/ai/config"
import { resolveAmbiguity } from "@/lib/environment/assumption-policy"
import {
  createWorkingWorld,
  validateWorkingWorld,
  withSurface,
  withTurn,
  type WorkingWorldSnapshot,
} from "@/lib/environment/working-world"

/**
 * The Line (#762): universal input to the Environment. One endpoint receives every sentence and may
 * reshape everything — assemble a world, materialize surfaces, converse. It never asks the owner to
 * classify anything, and where the slice cannot yet act, it says so instead of pretending.
 *
 * Slice scope (Job 1, beats 1–3): naming broken-login work assembles the world from intent — real
 * candidates from real project rows, the S1 policy stating a corrigible assumption — and materializes
 * two REAL surfaces: the running application's own sign-in page, and a live probe of its auth
 * behaviour taken at this moment, not a recording. Free conversation falls through to the sovereign
 * model, bounded and honest. The dispatch beats (fix → diff → tests) are the next slice; the Line
 * says exactly that when asked to fix.
 */

export const maxDuration = 120

type SurfaceDirective = Readonly<{
  kind: "browser" | "trace"
  subject: string
  title: string
  payload?: unknown
}>

type LineReply = Readonly<{
  worldId: string
  say: string
  surfaces: readonly SurfaceDirective[]
}>

const LOGIN_WORK = /(login|log.?in|sign.?in|auth)\b/i
const BROKEN = /(broken|busted|wrong|fail|drops?|mess|not work|doesn.?t work|figure out)/i
const FIX_INTENT = /\b(fix|repair|patch|clean(?: it)? up|make it work)\b/i

async function probeAuthFlow(origin: string): Promise<readonly Record<string, unknown>[]> {
  // A real probe of the running application, taken now. Redirects are followed manually so the chain
  // itself is the evidence: status, location, and whether a session cookie was set at each hop.
  const steps: Record<string, unknown>[] = []
  let url = `${origin}/`
  for (let hop = 0; hop < 5; hop += 1) {
    let response: Response
    try {
      response = await fetch(url, { redirect: "manual", headers: { accept: "text/html" } })
    } catch (error) {
      steps.push({ url, error: error instanceof Error ? error.message : "unreachable" })
      break
    }
    const location = response.headers.get("location")
    steps.push({
      url,
      status: response.status,
      location: location ?? undefined,
      setsSessionCookie: (response.headers.get("set-cookie") ?? "").length > 0 || undefined,
    })
    if (!location) break
    url = location.startsWith("http") ? location : `${origin}${location}`
  }
  return steps
}

async function loadWorld(userId: string, worldId: string): Promise<WorkingWorldSnapshot | null> {
  const rows = await db
    .select({ snapshot: workingWorld.snapshot })
    .from(workingWorld)
    .where(and(eq(workingWorld.userId, userId), eq(workingWorld.id, worldId)))
    .limit(1)
  if (!rows[0]) return null
  try {
    return validateWorkingWorld(JSON.parse(rows[0].snapshot))
  } catch {
    return null
  }
}

async function saveWorld(userId: string, worldId: string, world: WorkingWorldSnapshot, isNew: boolean): Promise<void> {
  const snapshot = JSON.stringify(validateWorkingWorld(world))
  if (isNew) {
    await db.insert(workingWorld).values({ id: worldId, userId, intent: world.intent, snapshot })
  } else {
    await db
      .update(workingWorld)
      .set({ snapshot, updatedAt: new Date() })
      .where(and(eq(workingWorld.userId, userId), eq(workingWorld.id, worldId)))
  }
}

/** Bounded, honest fallback conversation with the sovereign model. Short by design in this slice. */
async function converse(world: WorkingWorldSnapshot, text: string): Promise<string> {
  const messages = [
    {
      role: "system",
      content:
        `You are WilliamOS, the owner's development environment, mid-work on: "${world.intent}". ` +
        `Speak plainly, never require system vocabulary, never claim to have executed anything. ` +
        `Keep replies under 120 words.`,
    },
    ...world.conversation.slice(-10).map((turn) => ({
      role: turn.role === "owner" ? "user" : "assistant",
      content: turn.content,
    })),
    { role: "user", content: text },
  ]
  try {
    const response = await fetch(`${INFERENCE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: CHAT_MODEL, messages, max_tokens: 400, stream: false }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!response.ok) return "The model didn't answer. Your message is kept — try again."
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    return body.choices?.[0]?.message?.content?.trim() || "The model answered nothing. Your message is kept — try again."
  } catch {
    return "The model didn't answer in time. Your message is kept — try again."
  }
}

export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let body: { worldId?: unknown; text?: unknown }
  try {
    body = (await request.json()) as { worldId?: unknown; text?: unknown }
  } catch {
    return Response.json({ error: "INVALID_BODY" }, { status: 400 })
  }
  const text = typeof body.text === "string" ? body.text.trim() : ""
  if (!text) return Response.json({ error: "MESSAGE_EMPTY" }, { status: 400 })
  const requestedWorldId = typeof body.worldId === "string" && body.worldId ? body.worldId : null

  const origin = new URL(request.url).origin

  // Existing world: continue it.
  if (requestedWorldId) {
    const world = await loadWorld(userId, requestedWorldId)
    if (!world) return Response.json({ error: "WORLD_NOT_FOUND" }, { status: 404 })

    let updated = withTurn(world, "owner", text)
    let say: string
    if (FIX_INTENT.test(text)) {
      // Honesty over theater: the dispatch beat is the next slice, and pretending otherwise is the
      // one sin this surface must never commit.
      say =
        "That's the next thing being wired: from here the fix dispatches as bounded work and the diff " +
        "and tests land beside the app. Until that wiring is real I won't pretend — nothing has been " +
        "changed. The investigation above stands ready for it."
    } else {
      say = await converse(updated, text)
    }
    updated = withTurn(updated, "williamos", say)
    await saveWorld(userId, requestedWorldId, updated, false)
    return Response.json({ worldId: requestedWorldId, say, surfaces: [] } satisfies LineReply)
  }

  // No world yet. Does the sentence name work this slice can assemble?
  if (LOGIN_WORK.test(text) && (BROKEN.test(text) || FIX_INTENT.test(text))) {
    // Real candidates from real project rows; preference goes to a login this environment can
    // actually reach and reproduce right now.
    const projects = await db
      .select({ key: project.key, name: project.name })
      .from(project)
      .where(eq(project.userId, userId))
    const candidates = projects.map((row) => ({
      id: row.key,
      label: /williamos/i.test(row.name) ? "the WilliamOS operator sign-in" : `${row.name}'s login`,
      weight: /williamos/i.test(row.name) ? 2 : 1,
    }))
    const decision = resolveAmbiguity({ subject: "which login flow", candidates, costOfWrongGuess: "cheap" })

    if (decision.mode === "ASK") {
      // No projects at all — nothing to assume. Still no ceremony: one plain question.
      return Response.json({ worldId: "", say: decision.question, surfaces: [] } satisfies LineReply)
    }

    const steps = await probeAuthFlow(origin)
    const worldId = crypto.randomUUID()
    let world = createWorkingWorld({
      intent: text,
      assumption: decision.statement,
      resources: ["bsvalues/terragroq"],
    })
    world = withTurn(world, "owner", text)
    const say =
      `${decision.statement} Reproducing it now — the sign-in page is live on the right, and beside it ` +
      `is the auth probe I just ran against the running app: every hop, its status, and whether a ` +
      `session cookie was set. Tell me what looks wrong to you, or say "fix it" and I'll tell you ` +
      `exactly how far the wiring goes today.`
    world = withTurn(world, "williamos", say)
    world = withSurface(world, { kind: "browser", subject: "/sign-in", because: "reproducing the failure" })
    world = withSurface(world, { kind: "trace", subject: "auth-probe", because: "the redirect chain, live" })
    await saveWorld(userId, worldId, world, true)

    return Response.json({
      worldId,
      say,
      surfaces: [
        { kind: "browser", subject: "/sign-in", title: "sign-in · live" },
        { kind: "trace", subject: "auth-probe", title: "auth probe · just now", payload: steps },
      ],
    } satisfies LineReply)
  }

  // Ordinary conversation with no world: talk, honestly, and keep the door open.
  const scratch = createWorkingWorld({ intent: text })
  const say = await converse(scratch, text)
  const worldId = crypto.randomUUID()
  let world = withTurn(scratch, "owner", text)
  world = withTurn(world, "williamos", say)
  await saveWorld(userId, worldId, world, true)
  return Response.json({ worldId, say, surfaces: [] } satisfies LineReply)
}
