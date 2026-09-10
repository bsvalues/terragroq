import {
  authorizePersistedArtifactAdoption,
  issuePersistedArtifactAdoption,
  previewPersistedArtifactAdoption,
  previewTargetArtifactAdoption,
} from "@/lib/governance/artifact-adoption-runtime"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const DIGEST = /^[0-9a-f]{64}$/
const HEAD = /^[0-9a-f]{40}$/
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/

const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } })

export async function POST(request: Request): Promise<Response> {
  const rejection = guardLineRequest(request)
  if (rejection) return reply({ error: rejection.error }, rejection.status)
  const parsed = await readBoundedJson(request, 2_000)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return reply({ error: "DELIVERY_SEAL_REQUEST_INVALID" }, 400)
  const body = parsed.value as Record<string, unknown>
  const targetPresent = body.pullRequest !== undefined || body.expectedHeadSha !== undefined
  const targetValid = Number.isSafeInteger(body.pullRequest) && Number(body.pullRequest) > 0
    && typeof body.expectedHeadSha === "string" && HEAD.test(body.expectedHeadSha)
  const preview = body.mode === "PREVIEW"
    && Object.keys(body).every((key) => ["mode", "worldId", "pullRequest", "expectedHeadSha"].includes(key))
    && typeof body.worldId === "string" && body.worldId.trim().length > 0
    && (!targetPresent || targetValid)
  const mutation = (body.mode === "AUTHORIZE" || body.mode === "ISSUE")
    && Object.keys(body).every((key) => ["mode", "worldId", "pullRequest", "expectedHeadSha", "confirmedPreviewDigest", "idempotencyKey"].includes(key))
    && typeof body.worldId === "string" && body.worldId.trim().length > 0
    && (body.mode === "ISSUE" || (typeof body.confirmedPreviewDigest === "string" && DIGEST.test(body.confirmedPreviewDigest)))
    && (body.mode === "ISSUE" || targetValid)
    && (body.mode !== "ISSUE" || (!targetPresent && body.confirmedPreviewDigest === undefined))
    && typeof body.idempotencyKey === "string" && KEY.test(body.idempotencyKey)
  if (!preview && !mutation) return reply({ error: "DELIVERY_SEAL_REQUEST_INVALID" }, 400)

  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) return reply({ error: owner.failure, detail: owner.detail }, owner.failure === "NOT_OWNER" ? 403 : 409)
  try {
    if (body.mode === "PREVIEW") {
      const worldId = String(body.worldId).trim()
      return reply(targetPresent
        ? await previewTargetArtifactAdoption(session.user.id, worldId, { pullRequest: Number(body.pullRequest), expectedHeadSha: String(body.expectedHeadSha) })
        : await previewPersistedArtifactAdoption(session.user.id, worldId))
    }
    if (body.mode === "AUTHORIZE") return reply(await authorizePersistedArtifactAdoption(
      session.user.id,
      String(body.worldId).trim(),
      { pullRequest: Number(body.pullRequest), expectedHeadSha: String(body.expectedHeadSha) },
      String(body.idempotencyKey),
      String(body.confirmedPreviewDigest),
    ), 201)
    return reply(await issuePersistedArtifactAdoption(session.user.id, String(body.worldId).trim(), String(body.idempotencyKey)))
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "DELIVERY_ADOPTION_UNAVAILABLE"
    const detail = error instanceof Error ? error.message.slice(0, 500) : "prospective delivery adoption failed"
    return reply({ error: code, detail }, code === "DELIVERY_ADOPTION_UNAVAILABLE" ? 503 : 409)
  }
}
