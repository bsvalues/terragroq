import { execFile as execFileCallback } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { project, workingWorld } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { CHAT_MODEL, INFERENCE_BASE_URL } from "@/lib/ai/config"
import { resolveAmbiguity } from "@/lib/environment/assumption-policy"
import { classifyGrounded, composeProjectsAnswer, groundedCurrentWork, groundedIdentity, groundingFacts, type ProjectRow } from "@/lib/environment/grounding"
import { exceedsLineCap, guardLineRequest, isMalformedWorldId, readBoundedJson } from "@/lib/environment/line-guard"
import {
  createWorkingWorld,
  validateWorkingWorld,
  withSurface,
  withTurn,
  type WorkingWorldSnapshot,
} from "@/lib/environment/working-world"

/**
 * The Line of the replacement environment (#762): one universal conversational input. Every sentence
 * arrives here and may reshape everything; nothing is classified into workflow objects; where the
 * slice cannot yet act it says so instead of pretending.
 *
 * Job 1, complete: naming broken-login work assembles the world (real project candidates, the S1
 * policy stating a corrigible assumption) and materializes the REAL anonymous login page beside a
 * probe taken at that moment. Saying "fix it" composes a REAL change to the real defect this page
 * carries — the provisioning-lock status, the env-flag recovery note, the stale placeholder — and
 * materializes the current source, the actual unified diff of the proposed change, and a real test
 * run, all produced now, none pretended. Nothing is applied to any tree from here: application
 * travels the governed path, and the Line says exactly that.
 */

export const maxDuration = 300

const execFile = promisify(execFileCallback)
// The standalone runtime directory holds no source; composing a fix REQUIRES a configured source
// root. Absent one, the fix beat refuses honestly rather than reading whatever cwd holds (review P1).
const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT?.trim() || null
// Self-fetches target the standalone listener itself: loopback on the port THIS process serves.
// A hardcoded 3100 was wrong the moment the container mapped a different port (review P1).
const SELF_ORIGIN = process.env.WILLIAMOS_SELF_ORIGIN?.trim() || `http://127.0.0.1:${process.env.PORT ?? "3100"}`

type SurfaceDirective = Readonly<{
  kind: "browser" | "trace" | "source" | "diff" | "tests"
  subject: string
  payload?: unknown
}>

type LineReply = Readonly<{ worldId: string; say: string; surfaces: readonly SurfaceDirective[] }>

const LOGIN_WORK = /(login|log.?in|sign.?in|auth)\b/i
const BROKEN = /(broken|busted|wrong|fail|drops?|mess|not work|doesn.?t work|figure out)/i
const FIX_INTENT = /\b(fix|repair|patch|clean(?: it)? up|make it work|do it|go ahead)\b/i

/** The three owner-facing defects on the sign-in page, as real, matchable edits. */
const SIGN_IN_FIX: readonly Readonly<{ file: string; from: string; to: string }>[] = [
  {
    file: "lib/auth-ux-state.ts",
    from: '"Auth is ready. Owner provisioning is locked because a Primary Operator already exists."',
    to: '"Welcome back."',
  },
  {
    file: "components/auth-form.tsx",
    from: '"Email OTP is scaffolded but not configured. Use email and password for now."',
    to: '"Email recovery isn\'t available yet. Use your passkey or password."',
  },
  {
    file: "components/auth-form.tsx",
    from: 'placeholder="you@command.io"',
    to: 'placeholder="your email"',
  },
]

async function probeAuthFlow(): Promise<readonly Record<string, unknown>[]> {
  const steps: Record<string, unknown>[] = []
  let url = `${SELF_ORIGIN}/`
  for (let hop = 0; hop < 5; hop += 1) {
    let response: Response
    try {
      response = await fetch(url, { redirect: "manual", headers: { accept: "text/html" }, signal: AbortSignal.timeout(15_000) })
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
    url = location.startsWith("http") ? location : `${SELF_ORIGIN}${location}`
  }
  return steps
}

function describeProbe(steps: readonly Record<string, unknown>[]): string {
  const failed = steps.find((step) => step.error)
  if (failed) return `Reproduced it: the flow dies at ${String(failed.url)} — ${String(failed.error)}.`
  const chain = steps
    .map((step) => `${String(step.status ?? "?")}${step.location ? ` → ${String(step.location)}` : ""}`)
    .join(", ")
  const cookie = steps.some((step) => step.setsSessionCookie)
  return (
    `Just walked it anonymously: ${chain}${cookie ? ", with a session cookie issued" : ", and no session cookie is ever issued"}. ` +
    `The page itself carries three things that shouldn't face you: provisioning-lock status text, an ` +
    `internal flag name in the recovery note, and a placeholder from another product. Say "fix it" and ` +
    `I'll compose the change with its diff and tests, here.`
  )
}

/** Compose the real fix in memory and return the real artifacts: sources, unified diff, test output. */
async function composeSignInFix(): Promise<{ ok: boolean; say: string; surfaces: SurfaceDirective[] }> {
  if (!PROJECT_ROOT) {
    return {
      ok: false,
      say: "This runtime has no source root configured, so I can't compose the change from here — nothing to pretend about.",
      surfaces: [],
    }
  }
  const files = [...new Set(SIGN_IN_FIX.map((edit) => edit.file))]
  const originals = new Map<string, string>()
  for (const file of files) {
    try {
      originals.set(file, fs.readFileSync(path.join(PROJECT_ROOT, file), "utf8"))
    } catch {
      return { ok: false, say: `I can't read ${file} from the working copy, so I won't guess at a diff.`, surfaces: [] }
    }
  }
  const changed = new Map<string, string>()
  const missed: string[] = []
  for (const edit of SIGN_IN_FIX) {
    const current = changed.get(edit.file) ?? originals.get(edit.file) ?? ""
    if (!current.includes(edit.from)) {
      missed.push(`${edit.file}: ${edit.from.slice(0, 40)}…`)
      continue
    }
    changed.set(edit.file, current.replace(edit.from, edit.to))
  }
  if (missed.length > 0) {
    return {
      ok: false,
      say: `The source has moved since I last looked — ${missed.length} of the edits no longer match, so there is no diff to show. That is a fact, not a failure to try.`,
      surfaces: [],
    }
  }

  // A real unified diff, produced by git itself over the in-memory change. No tree is touched.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "env-fix-"))
  let diffText = ""
  try {
    for (const file of files) {
      const oldPath = path.join(scratch, "a", file)
      const newPath = path.join(scratch, "b", file)
      fs.mkdirSync(path.dirname(oldPath), { recursive: true })
      fs.mkdirSync(path.dirname(newPath), { recursive: true })
      fs.writeFileSync(oldPath, originals.get(file) ?? "", "utf8")
      fs.writeFileSync(newPath, changed.get(file) ?? "", "utf8")
    }
    try {
      await execFile("git", ["diff", "--no-index", "--unified=3", "--src-prefix=a/", "--dst-prefix=b/", path.join(scratch, "a"), path.join(scratch, "b")], {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      })
    } catch (error) {
      // git diff exits 1 when the trees differ; the diff is on stdout of the "failure".
      diffText = String((error as { stdout?: string }).stdout ?? "")
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  diffText = diffText.replaceAll(scratch.replaceAll("\\", "/"), "").replaceAll(scratch, "")

  // A real test run, now, against the copy-contract tests that govern exactly this surface.
  let testOutput = ""
  let testsPassed = false
  try {
    const run = await execFile("cmd.exe", ["/c", "pnpm", "exec", "vitest", "run", "tests/auth-error-copy.test.ts", "tests/auth-ux-state.test.ts"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 240_000,
    })
    testOutput = `${run.stdout}${run.stderr}`
    testsPassed = true
  } catch (error) {
    testOutput = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}` || "test run failed to start"
  }
  const testTail = testOutput.replace(/\[[0-9;]*m/g, "").split(/\r?\n/).filter(Boolean).slice(-18).join("\n")

  const say =
    `Composed. The diff is exactly the three sentences that had no business facing you — nothing else ` +
    `moves. The copy contracts ${testsPassed ? "pass against the code as it stands today" : "are failing against today's code — read them beside the diff"} — ` +
    `running them against the patched tree is what an isolated working world is for, and that arrives with ` +
    `the sandbox slice. Applying this travels the governed path from here; I won't pretend it has been applied.`

  return {
    ok: true,
    say,
    surfaces: [
      {
        kind: "source",
        subject: "components/auth-form.tsx",
        payload: originals.get("components/auth-form.tsx"),
      },
      { kind: "diff", subject: "sign-in copy fix", payload: diffText.trim() },
      { kind: "tests", subject: "auth copy contracts", payload: testTail },
    ],
  }
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

/** Bounded, honest conversation with the sovereign model. */
/**
 * Answer identity/project/current-work questions from grounded state, never from the free-form model.
 * Returns null when the sentence is not one of those, so it falls through to converse(). This is what
 * makes fabrication unreachable on these paths (real-operator acceptance).
 */
async function loadProjects(userId: string): Promise<ProjectRow[]> {
  return db.select({ name: project.name, lifecycle: project.lifecycle }).from(project).where(eq(project.userId, userId))
}

async function groundedAnswer(text: string, userId: string): Promise<string | null> {
  const kind = classifyGrounded(text)
  if (!kind) return null
  if (kind === "identity") return groundedIdentity()
  const projects = await loadProjects(userId)
  if (kind === "projects") return composeProjectsAnswer(projects)
  return groundedCurrentWork(projects)
}

async function converse(world: WorkingWorldSnapshot, text: string, facts: string): Promise<string> {
  const messages = [
    {
      role: "system",
      // The second grounding layer: real identity + the real project register travel with every
      // model call, so a question the classifier missed still answers from data, not a vacuum.
      content:
        `${facts} You are mid-work on: "${world.intent}". Speak plainly, never require system ` +
        `vocabulary, never claim to have executed anything. Keep replies under 120 words.`,
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
  // A cookie-authenticated, state-changing, model-fanning endpoint: refuse the cross-site CSRF
  // shape and oversized bodies before doing any work. See lib/environment/line-guard.ts.
  const rejection = guardLineRequest(request)
  if (rejection) return Response.json({ error: rejection.error }, { status: rejection.status })
  // Session resolution THROWS on a cookieless request rather than returning null; both spell
  // unauthenticated, and neither may spell 500.
  let userId: string | null = null
  try {
    userId = await getUserId()
  } catch {
    userId = null
  }
  if (!userId) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  // Read the body with the byte cap enforced AS IT STREAMS: the Content-Length reject in
  // guardLineRequest is only a fast path (absent under chunked encoding, and a small text beside a
  // huge ignored field would still buffer fully) -- this bounds the actual bytes.
  const parsed = await readBoundedJson(request)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status })
  const body = parsed.value as { worldId?: unknown; text?: unknown }
  const text = typeof body.text === "string" ? body.text.trim() : ""
  if (!text) return Response.json({ error: "MESSAGE_EMPTY" }, { status: 400 })
  if (exceedsLineCap(text)) return Response.json({ error: "MESSAGE_TOO_LARGE" }, { status: 413 })
  // worldId is a string id, or absent for a new world -- and the Desk client spells "absent" as an
  // explicit null on the first message, so null is a valid new-world sentinel, NOT a malformed
  // request. Only a present, non-null, non-string value is malformed (Codex P1: rejecting null here
  // would 400 every first message and no world could ever be created).
  if (isMalformedWorldId(body.worldId)) {
    return Response.json({ error: "INVALID_WORLD_ID" }, { status: 400 })
  }
  const requestedWorldId = typeof body.worldId === "string" && body.worldId ? body.worldId : null

  if (requestedWorldId) {
    const world = await loadWorld(userId, requestedWorldId)
    if (!world) return Response.json({ error: "WORLD_NOT_FOUND" }, { status: 404 })

    let updated = withTurn(world, "owner", text)
    let say: string
    let surfaces: SurfaceDirective[] = []
    if (FIX_INTENT.test(text) && LOGIN_WORK.test(world.intent)) {
      const fix = await composeSignInFix()
      say = fix.say
      surfaces = fix.surfaces
      if (fix.ok) {
        updated = withSurface(updated, { kind: "editor", subject: "components/auth-form.tsx", because: "the defects live here" })
        updated = withSurface(updated, { kind: "diff", subject: "sign-in copy fix", because: "the proposed change" })
        updated = withSurface(updated, { kind: "tests", subject: "auth copy contracts", because: "the governing contract" })
      }
    } else {
      say = (await groundedAnswer(text, userId)) ?? (await converse(updated, text, groundingFacts(await loadProjects(userId))))
    }
    updated = withTurn(updated, "williamos", say)
    await saveWorld(userId, requestedWorldId, updated, false)
    return Response.json({ worldId: requestedWorldId, say, surfaces } satisfies LineReply)
  }

  if (LOGIN_WORK.test(text) && (BROKEN.test(text) || FIX_INTENT.test(text))) {
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
      return Response.json({ worldId: "", say: decision.question, surfaces: [] } satisfies LineReply)
    }

    const steps = await probeAuthFlow()
    const worldId = crypto.randomUUID()
    let world = createWorkingWorld({ intent: text, assumption: decision.statement, resources: ["bsvalues/terragroq"] })
    world = withTurn(world, "owner", text)
    const say = `${decision.statement} ${describeProbe(steps)}`
    world = withTurn(world, "williamos", say)
    world = withSurface(world, { kind: "browser", subject: "/sign-in", because: "reproducing the failure" })
    world = withSurface(world, { kind: "trace", subject: "auth-probe", because: "the redirect chain, live" })
    await saveWorld(userId, worldId, world, true)

    return Response.json({
      worldId,
      say,
      surfaces: [
        { kind: "browser", subject: "/sign-in" },
        { kind: "trace", subject: "auth-probe", payload: steps },
      ],
    } satisfies LineReply)
  }

  const scratch = createWorkingWorld({ intent: text })
  const say = (await groundedAnswer(text, userId)) ?? (await converse(scratch, text, groundingFacts(await loadProjects(userId))))
  const worldId = crypto.randomUUID()
  let world = withTurn(scratch, "owner", text)
  world = withTurn(world, "williamos", say)
  await saveWorld(userId, worldId, world, true)
  return Response.json({ worldId, say, surfaces: [] } satisfies LineReply)
}
