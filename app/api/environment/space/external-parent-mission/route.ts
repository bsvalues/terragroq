import {
  admitExternalParentMission,
  ExternalParentMissionAdmissionError,
  previewExternalParentMissionAdmission,
  terminalExternalParentMission,
} from "@/lib/environment/external-parent-mission-admission"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

const CONFLICTS = new Set([
  "IDEMPOTENCY_CONFLICT",
  "CONFIRMATION_STALE",
  "PROJECT_REPOSITORY_MISMATCH",
  "PARENT_MISSION_ALREADY_BOUND",
  "PARENT_MISSION_BINDING_INVALID",
  "PARENT_MISSION_AUTHORITY_REVOKED",
  "PARENT_MISSION_ALREADY_TERMINAL",
  "PARENT_MISSION_TERMINAL_EVIDENCE_UNVERIFIED",
])

export async function POST(request: Request): Promise<Response> {
  const rejection = guardLineRequest(request)
  if (rejection) return reply({ error: rejection.error }, rejection.status)
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) {
    return reply(
      { error: owner.failure, detail: owner.detail },
      owner.failure === "NOT_OWNER" ? 403 : 409,
    )
  }

  const parsed = await readBoundedJson(request, 32_000)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  try {
    if (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      && (parsed.value as Record<string, unknown>).mode === "PREVIEW") {
      return reply(previewExternalParentMissionAdmission(parsed.value))
    }
    if (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      && (parsed.value as Record<string, unknown>).mode === "TERMINAL") {
      const result = await terminalExternalParentMission(session.user.id, parsed.value)
      return reply(result, result.replayed ? 200 : 201)
    }
    const result = await admitExternalParentMission(session.user.id, parsed.value)
    return reply(result, result.replayed ? 200 : 201)
  } catch (error) {
    const code = error instanceof ExternalParentMissionAdmissionError
      ? error.code
      : error instanceof Error && [
          "REQUEST_FIELDS_INVALID", "CONFIRMATION_REQUIRED", "EXTERNAL_PARENT_MISSION_INVALID",
        ].includes(error.message)
        ? error.message
        : "EXTERNAL_PARENT_MISSION_ADMISSION_UNAVAILABLE"
    if (code === "WORLD_NOT_FOUND") return reply({ error: code }, 404)
    if (CONFLICTS.has(code)) return reply({ error: code }, 409)
    if (["REQUEST_FIELDS_INVALID", "CONFIRMATION_REQUIRED", "EXTERNAL_PARENT_MISSION_INVALID"].includes(code)) {
      return reply({ error: code }, 400)
    }
    return reply({ error: "EXTERNAL_PARENT_MISSION_ADMISSION_UNAVAILABLE" }, 503)
  }
}
