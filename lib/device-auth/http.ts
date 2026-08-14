import { NextResponse } from "next/server"
import { z } from "zod"

import { resolveTrustedOriginConfig } from "@/lib/auth-origins"
import { validateDeviceMutationOrigin } from "./contract"

export function deviceRequestOrigin(request: Request) {
  return validateDeviceMutationOrigin(request, resolveTrustedOriginConfig().trustedOrigins, {
    trustLoopbackHttpsProxy: process.env.WILLIAMOS_TRUST_LOOPBACK_HTTPS_PROXY === "1",
  })
}

export async function boundedJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (!Number.isFinite(length) || length > 4096) throw new Error("DEVICE_INPUT_INVALID")
  return schema.parse(await request.json())
}

export function deviceError(error: unknown) {
  const code = error instanceof Error ? error.message : "DEVICE_ERROR"
  const status = code === "DEVICE_RATE_LIMITED" ? 429
    : code === "DEVICE_ORIGIN_REJECTED" ? 403
      : code === "DEVICE_AUTH_REJECTED" ? 401
        : code === "Unauthorized" ? 401
          : 400
  return NextResponse.json(
    { error: status === 429 ? "Too many device requests." : status === 401 ? "Device authentication rejected." : "Device request rejected." },
    { status, headers: { "Cache-Control": "no-store" } },
  )
}

export const enrollmentCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  publicKeySpki: z.string().min(40).max(128).regex(/^[A-Za-z0-9_-]+$/),
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
  label: z.string().trim().min(1).max(80),
}).strict()

export const sessionChallengeSchema = z.object({
  credentialId: z.string().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/),
}).strict()

export const sessionCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict()
