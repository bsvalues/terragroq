import { NextResponse } from "next/server"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { buildRuntimeStatus } from "@/lib/ai/runtime"
import { getBuildProvenance } from "@/lib/build-provenance"

export const dynamic = "force-dynamic"

type Check = {
  ok: boolean
  latencyMs?: number
  detail?: string
}

export async function GET() {
  const runtime = buildRuntimeStatus()
  const readiness = await getAuthReadiness({ probeDatabase: true })

  const databaseProbe = readiness.checks.databaseConnectivity ?? readiness.checks.databaseUrl
  const database: Check = {
    ok: readiness.databaseReady,
    latencyMs: databaseProbe.latencyMs,
    detail: databaseProbe.ok ? undefined : databaseProbe.detail,
  }

  const authErrors = readiness.issues
    .filter((issue) => issue.severity === "error" && issue.code.startsWith("AUTH_"))
    .map((issue) => issue.message)
  const authWarnings = readiness.issues
    .filter((issue) => issue.severity === "warning" && issue.code.startsWith("AUTH_"))
    .map((issue) => issue.message)
  const auth: Check & { warnings?: string[] } = {
    ok: readiness.authReady,
    detail: authErrors.length > 0 ? authErrors.join(" ") : undefined,
    warnings: authWarnings.length > 0 ? authWarnings : undefined,
  }

  const healthy = readiness.ready

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      // The commit this running artifact was built from. The deploy verifies this equals the commit
      // it built, so a stale standalone can never pass as a fresh deploy (#762 deploy doctrine).
      build: getBuildProvenance(),
      checks: {
        database,
        auth,
        runtime: {
          ok: true,
          chatModel: runtime.chatModel,
          embeddingModel: runtime.embeddingModel,
          gateway: runtime.gateway,
          provider: runtime.provider,
          fallback: runtime.fallback,
        },
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  )
}
