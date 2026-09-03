import { buildRuntimeStatus } from "@/lib/ai/runtime"
import { getSignupStatus } from "@/components/shell/health-status"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { getSession } from "@/lib/session"
import {
  projectConfiguredSystemRoleTruth,
  projectSystemTruth,
} from "@/lib/system/system-truth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Read-only system truth for the Desk's System surface.
 *
 * Same projection as the legacy `/system` page — one live ATLAS database probe,
 * configured node roles that never masquerade as liveness, explicit runtime
 * provenance — but delivered as data a surface inside the working environment
 * can render, so System stops being a destination with different chrome and
 * becomes something the environment summons. This route only reads: it never
 * starts, stops, repairs, deploys, or grants authority.
 */
export async function GET() {
  let session: Awaited<ReturnType<typeof getSession>> = null
  try {
    session = await getSession()
  } catch {
    session = null
  }
  if (!session?.user) {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: { "cache-control": "no-store" } })
  }

  const readiness = await getAuthReadiness({ probeDatabase: true })
  const runtime = buildRuntimeStatus()
  const signup = getSignupStatus(readiness)

  const signals = [
    ...projectSystemTruth([
      {
        system: "ATLAS",
        signal: "state-database",
        evidenceKind: "current-query",
        succeeded: readiness.databaseReady,
        observedAt: readiness.checkedAt,
        source: "getAuthReadiness database connectivity probe",
        summary: readiness.databaseReady
          ? "Current state-database query succeeded."
          : "Current state-database query did not succeed.",
      },
    ]),
    projectConfiguredSystemRoleTruth("HERMES"),
    projectConfiguredSystemRoleTruth("AEGIS"),
  ]

  const env =
    process.env.VERCEL_ENV === "preview"
      ? "preview"
      : process.env.NODE_ENV === "production"
        ? "prod"
        : "local"

  return Response.json(
    {
      ready: readiness.ready,
      databaseReady: readiness.databaseReady,
      dbLatencyMs: readiness.checks.databaseConnectivity?.latencyMs ?? null,
      dbDetail: readiness.checks.databaseConnectivity?.detail ?? null,
      authReady: readiness.authReady,
      signup: { label: signup.label, tone: signup.tone, title: signup.title ?? null },
      runtime: {
        chatModel: runtime.chatModel,
        embeddingModel: runtime.embeddingModel,
        embeddingDimensions: runtime.embeddingDimensions,
        gateway: runtime.gateway,
        provider: runtime.provider,
        fallback: runtime.fallback,
        fallbackPolicy: runtime.fallbackPolicy ?? null,
      },
      env,
      baseUrlOk: readiness.checks.baseUrl.ok,
      baseUrlDetail: readiness.checks.baseUrl.detail ?? null,
      signals,
      issues: readiness.issues.map((issue) => ({ code: issue.code, severity: issue.severity, message: issue.message })),
      checkedAt: readiness.checkedAt,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  )
}
