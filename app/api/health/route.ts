import { NextResponse } from "next/server"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { buildRuntimeStatus } from "@/lib/ai/runtime"
import { INFERENCE_BASE_URL } from "@/lib/ai/config"
import { isLoopbackInferenceBase, resolveOllamaChatModel } from "@/lib/ai/ollama-models"
import { getBuildProvenance } from "@/lib/build-provenance"
import { getDeploymentStatus } from "@/lib/deployment/profile"

export const dynamic = "force-dynamic"

type Check = {
  ok: boolean
  latencyMs?: number
  detail?: string
}

export async function GET() {
  const deployment = getDeploymentStatus()
  const runtime = buildRuntimeStatus()
  const liveRuntime = isLoopbackInferenceBase(INFERENCE_BASE_URL)
    ? await resolveOllamaChatModel(INFERENCE_BASE_URL, runtime.chatModel)
    : { available: true, model: runtime.chatModel, detail: null }
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

  // Preserve the established HERMES aggregate-health behavior. County Development additionally
  // requires a valid local-only compartment and the configured local model to be available.
  const countyRuntimeReady = deployment.profile !== "county-development" || liveRuntime.available
  const healthy = readiness.ready && deployment.valid && countyRuntimeReady

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      // The commit this running artifact was built from. The deploy verifies this equals the commit
      // it built, so a stale standalone can never pass as a fresh deploy (#762 deploy doctrine).
      build: getBuildProvenance(),
      deployment,
      checks: {
        deployment: {
          ok: deployment.valid,
          detail: deployment.valid ? undefined : deployment.violations.join(" "),
        },
        database,
        auth,
        runtime: {
          ok: liveRuntime.available,
          chatModel: liveRuntime.model,
          ...(liveRuntime.detail ? { detail: liveRuntime.detail } : {}),
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
