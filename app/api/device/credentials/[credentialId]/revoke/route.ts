import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { isDeclaredPrimaryEmail } from "@/lib/primary-identity"
import { deviceError, deviceRequestOrigin } from "@/lib/device-auth/http"
import { revokeDeviceCredential } from "@/lib/device-auth/service"

export async function POST(request: Request, context: { params: Promise<{ credentialId: string }> }) {
  try {
    deviceRequestOrigin(request)
    const session = await getSession()
    if (!session?.user || !isDeclaredPrimaryEmail(session.user.email)) throw new Error("Unauthorized")
    const { credentialId } = await context.params
    await revokeDeviceCredential({ userId: session.user.id, credentialId })
    return NextResponse.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return deviceError(error)
  }
}
