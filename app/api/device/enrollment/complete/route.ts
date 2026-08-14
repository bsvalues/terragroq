import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { isDeclaredPrimaryEmail } from "@/lib/primary-identity"
import { boundedJson, deviceError, deviceRequestOrigin, enrollmentCompleteSchema } from "@/lib/device-auth/http"
import { completeDeviceEnrollment } from "@/lib/device-auth/service"

export async function POST(request: Request) {
  try {
    const origin = deviceRequestOrigin(request)
    const session = await getSession()
    if (!session?.user || !isDeclaredPrimaryEmail(session.user.email)) throw new Error("Unauthorized")
    const body = await boundedJson(request, enrollmentCompleteSchema)
    const device = await completeDeviceEnrollment({ ...body, userId: session.user.id, origin })
    return NextResponse.json(device, { status: 201, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return deviceError(error)
  }
}
