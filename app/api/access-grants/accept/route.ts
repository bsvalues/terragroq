import { NextResponse } from "next/server"
import { acceptAccessGrantPreview } from "@/lib/access-grants/service"
import { getAccessGrantReadiness } from "@/lib/access-grants/readiness"

export async function POST(request: Request) {
  let token: unknown
  try {
    const payload = (await request.json()) as { token?: unknown }
    token = payload.token
  } catch {
    token = undefined
  }

  const result = acceptAccessGrantPreview({ enabled: false }, token)
  if (result.ok) {
    throw new Error("Access grant accept route is disabled.")
  }

  return NextResponse.json(
    {
      ok: false,
      error: "ACCESS_GRANTS_DISABLED",
      reason: result.reason,
      readiness: getAccessGrantReadiness(),
      auditPreview: result.auditEvent,
    },
    {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    },
  )
}
