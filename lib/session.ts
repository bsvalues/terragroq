import { auth } from "@/lib/auth"
import { DEVICE_SESSION_COOKIE } from "@/lib/device-auth/contract"
import { resolveDeviceSession } from "@/lib/device-auth/service"
import { headers } from "next/headers"

export async function getSession() {
  const requestHeaders = await headers()
  const browserSession = await auth.api.getSession({ headers: requestHeaders })
  if (browserSession?.user) return browserSession

  const cookieHeader = requestHeaders.get("cookie") ?? ""
  const rawDeviceToken = cookieHeader
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === DEVICE_SESSION_COOKIE)?.slice(1).join("=")
  if (!rawDeviceToken) return null
  let decodedDeviceToken: string
  try {
    decodedDeviceToken = decodeURIComponent(rawDeviceToken)
  } catch {
    return null
  }
  const device = await resolveDeviceSession(decodedDeviceToken)
  if (!device) return null

  return {
    user: {
      id: device.userId,
      name: device.name,
      email: device.email,
      emailVerified: true,
      image: device.image,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    session: {
      id: device.sessionId,
      userId: device.userId,
      token: "<device-session-redacted>",
      expiresAt: device.expiresAt,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ipAddress: null,
      userAgent: null,
    },
  }
}

export async function getUserId() {
  const session = await getSession()
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}
