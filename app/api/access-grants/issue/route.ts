import { NextResponse } from "next/server"
import { issueAccessGrantPreview } from "@/lib/access-grants/service"
import { getAccessGrantReadiness } from "@/lib/access-grants/readiness"

export async function POST() {
  const result = issueAccessGrantPreview(
    { enabled: false },
    {
      scope: "grant:evidence.read",
      targetResourceType: "evidence_packet",
      targetResourceId: "preview-disabled",
      createdByOperatorId: "system",
      createdReason: "runtime disabled",
    },
  )
  if (result.ok) {
    throw new Error("Access grant issue route is disabled.")
  }

  return NextResponse.json(
    {
      ok: false,
      error: "ACCESS_GRANTS_DISABLED",
      readiness: getAccessGrantReadiness(),
      auditPreview: result.auditEvent,
    },
    {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    },
  )
}
