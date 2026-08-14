import { NextResponse } from "next/server"
import { DEVICE_SESSION_COOKIE, deviceSessionCookieOptions } from "@/lib/device-auth/contract"
import { boundedJson, deviceError, deviceRequestOrigin, sessionCompleteSchema } from "@/lib/device-auth/http"
import { completeDeviceAuthentication } from "@/lib/device-auth/service"

export async function POST(request: Request) {
  try {
    const origin = deviceRequestOrigin(request)
    const body = await boundedJson(request, sessionCompleteSchema)
    const session = await completeDeviceAuthentication({ ...body, origin })
    const response = NextResponse.json({ authenticated: true, expiresAt: session.expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } })
    response.cookies.set(DEVICE_SESSION_COOKIE, session.rawToken, deviceSessionCookieOptions(process.env.NODE_ENV === "production"))
    return response
  } catch (error) {
    return deviceError(error)
  }
}
