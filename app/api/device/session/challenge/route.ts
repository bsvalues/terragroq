import { NextResponse } from "next/server"
import { boundedJson, deviceError, deviceRequestOrigin, sessionChallengeSchema } from "@/lib/device-auth/http"
import { issueAuthenticationChallenge } from "@/lib/device-auth/service"

export async function POST(request: Request) {
  try {
    const origin = deviceRequestOrigin(request)
    const body = await boundedJson(request, sessionChallengeSchema)
    const challenge = await issueAuthenticationChallenge({ credentialId: body.credentialId, origin })
    return NextResponse.json(challenge, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return deviceError(error)
  }
}
