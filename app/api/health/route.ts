import { NextResponse } from "next/server"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { buildRuntimeStatus } from "@/lib/ai/runtime"
import { INFERENCE_BASE_URL } from "@/lib/ai/config"
import {
  isLoopbackInferenceBase,
  readOllamaModelInventory,
  resolveOllamaChatModelFromInventory,
  resolveOllamaExactModelFromInventory,
} from "@/lib/ai/ollama-models"
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
  const loopbackInference = isLoopbackInferenceBase(INFERENCE_BASE_URL)
  const inventory = loopbackInference ? await readOllamaModelInventory(INFERENCE_BASE_URL) : null
  const liveRuntime = inventory
    ? resolveOllamaChatModelFromInventory(inventory, runtime.chatModel)
    : { available: true, model: runtime.chatModel, detail: null }
  const embeddingRuntime = inventory
    ? resolveOllamaExactModelFromInventory(inventory, runtime.embeddingModel)
    : { available: true, model: runtime.embeddingModel, detail: null }
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
  // requires both exact configured local models, not merely any locally installed fallback model.
  const exactCountyChatModelReady = liveRuntime.available && liveRuntime.model === runtime.chatModel
  const exactCountyEmbeddingModelReady = embeddingRuntime.available
  const countyRuntimeReady = deployment.profile !== "county-development"
    || exactCountyChatModelReady && exactCountyEmbeddingModelReady
  const healthy = readiness.ready && deployment.valid && countyRuntimeReady
  const runtimeDetail = deployment.profile === "county-development" && liveRuntime.available && !exactCountyChatModelReady
    ? `Configured County model ${runtime.chatModel} is not installed.`
    : deployment.profile === "county-development" && !exactCountyEmbeddingModelReady
      ? `Configured County embedding model ${runtime.embeddingModel} is not installed.`
      : liveRuntime.detail ?? embeddingRuntime.detail ?? undefined

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
          ok: deployment.profile === "county-development"
            ? exactCountyChatModelReady && exactCountyEmbeddingModelReady
            : liveRuntime.available,
          chatModel: liveRuntime.model,
          embeddingModel: runtime.embeddingModel,
          embeddingResolvedModel: embeddingRuntime.model,
          ...(runtimeDetail ? { detail: runtimeDetail } : {}),
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
