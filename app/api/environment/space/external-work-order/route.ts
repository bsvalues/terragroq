import {
  admitExternalWorkOrder,
  ExternalWorkOrderAdmissionError,
  previewExternalWorkOrderAdmission,
} from "@/lib/environment/external-work-order-admission"
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
  "SPACE_ALREADY_BOUND",
  "ACTIVE_OUTCOME_CONFLICT",
  "EXTERNAL_WORK_ORDER_ALREADY_ADMITTED",
  "PROJECT_REPOSITORY_MISMATCH",
  "PERSISTED_BINDING_INVALID",
  "DOCTRINE_FORBIDDEN",
  "WORK_ORDER_GOVERNANCE_REFUSED",
])

export async function POST(request: Request): Promise<Response> {
  const rejection = guardLineRequest(request)
  if (rejection) return reply({ error: rejection.error }, rejection.status)
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) return reply({ error: owner.failure, detail: owner.detail }, owner.failure === "NOT_OWNER" ? 403 : 409)

  const parsed = await readBoundedJson(request, 32_000)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  try {
    if (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      && (parsed.value as Record<string, unknown>).mode === "PREVIEW") {
      return reply(previewExternalWorkOrderAdmission(parsed.value))
    }
    const result = await admitExternalWorkOrder(session.user.id, parsed.value)
    return reply(result, result.replayed ? 200 : 201)
  } catch (error) {
    // Preserve server diagnostics without returning internal details to the client.
    if (!(error instanceof ExternalWorkOrderAdmissionError)) {
      console.error("External Work Order admission failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Unknown failure",
        cause: error instanceof Error && error.cause instanceof Error
          ? { name: error.cause.name, message: error.cause.message }
          : undefined,
      })
    }
    const code = error instanceof ExternalWorkOrderAdmissionError
      ? error.code
      : error instanceof Error && [
          "REQUEST_FIELDS_INVALID", "CONFIRMATION_REQUIRED", "EXTERNAL_PROVENANCE_INVALID",
        ].includes(error.message)
        ? error.message
        : "EXTERNAL_WORK_ORDER_ADMISSION_UNAVAILABLE"
    if (code === "WORLD_NOT_FOUND") return reply({ error: code }, 404)
    if (CONFLICTS.has(code)) return reply({ error: code }, 409)
    if (code === "REQUEST_FIELDS_INVALID" || code === "CONFIRMATION_REQUIRED" || code === "EXTERNAL_PROVENANCE_INVALID") {
      return reply({ error: code }, 400)
    }
    return reply({ error: "EXTERNAL_WORK_ORDER_ADMISSION_UNAVAILABLE" }, 503)
  }
}
