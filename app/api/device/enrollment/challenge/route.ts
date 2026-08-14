import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { isDeclaredPrimaryEmail } from "@/lib/primary-identity"
import { deviceError, deviceRequestOrigin } from "@/lib/device-auth/http"
import { issueEnrollmentChallenge } from "@/lib/device-auth/service"

export async function POST(request: Request) {
  try {
    const origin = deviceRequestOrigin(request)
    const session = await getSession()
    if (!session?.user || !isDeclaredPrimaryEmail(session.user.email)) throw new Error("Unauthorized")
    const challenge = await issueEnrollmentChallenge({ userId: session.user.id, origin })
    return NextResponse.json(challenge, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return deviceError(error)
  }
}
