import { issuePersistedCodexDeliverySeal } from "@/lib/governance/delivery-seal-runtime"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const HASH = /^[0-9a-f]{64}$/i
const COMMIT = /^[0-9a-f]{40}$/i
const MAX_DELIVERY_SEAL_REQUEST_BYTES = 2_000

export async function POST(request: Request) {
  const rejection = guardLineRequest(request)
  if (rejection) return Response.json({ error: rejection.error }, { status: rejection.status })

  const parsed = await readBoundedJson(request, MAX_DELIVERY_SEAL_REQUEST_BYTES)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status })

  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  const body = parsed.value
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "DELIVERY_SEAL_REQUEST_INVALID" }, { status: 400 })
  }
  const row = body as Record<string, unknown>
  if (Object.keys(row).some((key) => !["threadId", "assignmentHash", "commitSha"].includes(key))
    || typeof row.threadId !== "string" || !row.threadId.trim()
    || typeof row.assignmentHash !== "string" || !HASH.test(row.assignmentHash)
    || typeof row.commitSha !== "string" || !COMMIT.test(row.commitSha)) {
    return Response.json({ error: "DELIVERY_SEAL_REQUEST_INVALID" }, { status: 400 })
  }
  try {
    const seal = await issuePersistedCodexDeliverySeal({
      userId: session.user.id,
      threadId: row.threadId.trim(),
      assignmentHash: row.assignmentHash.toLowerCase(),
      commitSha: row.commitSha.toLowerCase(),
    })
    return Response.json({ ok: true, seal }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string"
      ? String((error as { code: string }).code)
      : "DELIVERY_SEAL_ASSIGNMENT_STALE"
    const detail = error instanceof Error ? error.message.slice(0, 500) : "delivery seal issuance failed"
    return Response.json({ error: code, detail }, { status: 409, headers: { "cache-control": "no-store" } })
  }
}
