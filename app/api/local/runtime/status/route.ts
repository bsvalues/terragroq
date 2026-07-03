import { NextResponse } from "next/server"
import {
  getLocalRuntimeStatus,
  validateLocalRuntimeStatusRequest,
} from "@/lib/local-runtime-status"

export const runtime = "nodejs"

function methodNotAllowed() {
  return NextResponse.json(
    {
      ok: false,
      error: "Method not allowed. This route supports GET status reads only.",
    },
    {
      status: 405,
      headers: {
        Allow: "GET",
        "Cache-Control": "no-store",
      },
    },
  )
}

export async function GET(req: Request) {
  const validation = validateLocalRuntimeStatusRequest(req)
  if (!validation.ok) {
    return NextResponse.json(validation.body, {
      status: validation.status,
      headers: { "Cache-Control": "no-store" },
    })
  }

  return NextResponse.json(await getLocalRuntimeStatus(), {
    headers: { "Cache-Control": "no-store" },
  })
}

export const POST = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed

