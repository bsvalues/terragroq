import { NextResponse } from "next/server"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { getProcessStartedAt, getRuntimeInstanceId } from "@/lib/runtime-instance"

export const runtime = "nodejs"

function localSetupEnabled() {
  if (process.env.LOCAL_SETUP_ENABLED === "false") return false
  return process.env.NODE_ENV !== "production"
}

function isLoopbackHost(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
}

export async function GET(req: Request) {
  if (!localSetupEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Local setup status is disabled in this environment. Contact your platform administrator.",
      },
      { status: 403 },
    )
  }

  const url = new URL(req.url)
  if (!isLoopbackHost(url)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Local setup status only accepts loopback requests. Use localhost when running setup.",
      },
      { status: 403 },
    )
  }

  const readiness = await getAuthReadiness({ probeDatabase: true })
  return NextResponse.json(
    {
      ok: true,
      readiness,
      processStartedAt: getProcessStartedAt(),
      runtimeInstanceId: getRuntimeInstanceId(),
      checkedAt: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  )
}
