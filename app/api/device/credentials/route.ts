import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { isDeclaredPrimaryEmail } from "@/lib/primary-identity"
import { listDeviceCredentials } from "@/lib/device-auth/service"

export async function GET() {
  const session = await getSession()
  if (!session?.user || !isDeclaredPrimaryEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }
  const devices = await listDeviceCredentials(session.user.id)
  return NextResponse.json({ devices }, { headers: { "Cache-Control": "no-store" } })
}
