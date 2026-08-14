import { PageHeader } from "@/components/shell/page-header"
import { StatusBadge } from "@/components/status-badge"
import { SystemTruthPanel } from "@/components/systems/system-truth-panel"
import { getSignupStatus, type HealthTone } from "@/components/shell/health-status"
import { buildRuntimeStatus } from "@/lib/ai/runtime"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { getOperatorState } from "@/lib/operator/operator-state"
import { projectSystemTruth } from "@/lib/system/system-truth"
import { cn } from "@/lib/utils"

// System — the truthful, read-only primary. It composes signals that are actually
// grounded (one live ATLAS database probe, configured node roles that never masquerade
// as liveness, explicit runtime provenance, and current operator load) and labels each
// with its evidence class. It never starts, stops, repairs, deploys, or grants authority.

function chip(tone: HealthTone, text: string, title?: string) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px]",
        tone === "ready" && "border-success/30 bg-success/15 text-success",
        tone === "warn" && "border-warning/30 bg-warning/15 text-warning",
        tone === "blocked" && "border-destructive/30 bg-destructive/15 text-destructive",
      )}
    >
      {text}
    </span>
  )
}

// Operator load is projected from getOperatorState(), which queries ATLAS and will throw
// if the state database is unreachable. That failure must NOT crash the page — the DB
// signal above is exactly what the operator needs to see during an outage. So this read
// is isolated; on failure the load section reports itself unavailable.
async function loadOperatorLoad() {
  try {
    const state = await getOperatorState()
    return {
      activeExecutions: state.now.value.activeExecutions,
      queueDepth: state.now.value.queueDepth,
      knowledge: state.knowledge.value,
      idle: state.now.truthState === "idle-empty",
    }
  } catch {
    return null
  }
}

export default async function SystemPage() {
  const readiness = await getAuthReadiness({ probeDatabase: true })
  const runtime = buildRuntimeStatus()
  const signup = getSignupStatus(readiness)
  const load = await loadOperatorLoad()

  const dbLatency = readiness.checks.databaseConnectivity?.latencyMs
  const env =
    process.env.VERCEL_ENV === "preview"
      ? "preview"
      : process.env.NODE_ENV === "production"
        ? "prod"
        : "local"

  const systemTruth = projectSystemTruth([
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
    {
      system: "HERMES",
      signal: "coordinator-app-host",
      evidenceKind: "configured",
      observedAt: null,
      source: "issue #762 runtime topology contract",
      summary:
        "Configured as coordinator and app host. Configuration describes role, not current liveness.",
    },
    {
      system: "AEGIS",
      signal: "worker-node",
      evidenceKind: "configured",
      observedAt: null,
      source: "issue #762 runtime topology contract",
      summary: "Configured as a worker node. Configuration describes role, not current liveness.",
    },
  ])

  const runtimeRows = [
    { label: "Chat model", value: runtime.chatModel },
    { label: "Embedding model", value: runtime.embeddingModel },
    { label: "Embedding dimensions", value: String(runtime.embeddingDimensions) },
    { label: "Gateway", value: runtime.gateway },
    { label: "Provider", value: runtime.provider },
  ]

  const loadStats = load
    ? [
        { label: "Active executions", value: load.activeExecutions },
        { label: "Queue depth", value: load.queueDepth },
        { label: "Evidence", value: load.knowledge.evidence },
        { label: "Governance events", value: load.knowledge.governance },
        { label: "Memory facts", value: load.knowledge.memory },
        { label: "Documents", value: load.knowledge.documents },
      ]
    : []

  return (
    <>
      <PageHeader
        title="System"
        description="Truthful, read-only signals: platform readiness, node truth, runtime provenance, and operator load. System does not start, stop, repair, deploy, or grant authority to any runtime."
      />
      <div className="flex flex-col gap-6 p-6">
        {/* Platform readiness — one live probe; the rest is configuration */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Platform readiness
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {readiness.ready ? "Ready" : "Needs attention"}
              </h2>
            </div>
            {chip(readiness.ready ? "ready" : "blocked", readiness.ready ? "Ready" : "Attention")}
          </header>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Live probe
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {chip(
                  readiness.databaseReady ? "ready" : "blocked",
                  `DB: ${readiness.databaseReady ? "ready" : "blocked"}${dbLatency != null ? ` · ${dbLatency}ms` : ""}`,
                  readiness.checks.databaseConnectivity?.detail,
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Configuration (not a liveness probe)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {chip(readiness.authReady ? "ready" : "blocked", `Auth: ${readiness.authReady ? "ready" : "setup needed"}`)}
                {chip(signup.tone, signup.label, signup.title)}
                {chip(runtime.fallback ? "warn" : "ready", `Runtime: ${runtime.fallback ? "fallback" : "explicit"}`, runtime.fallbackPolicy)}
                {chip(env === "local" ? "warn" : "ready", `Env: ${env}`)}
                {chip(readiness.checks.baseUrl.ok ? "ready" : "warn", `Base URL: ${readiness.checks.baseUrl.ok ? "set" : "unset"}`, readiness.checks.baseUrl.detail)}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Source: getAuthReadiness · database connectivity is a live probe; auth, provisioning, runtime, and environment are configuration checks. Checked {new Date(readiness.checkedAt).toISOString()}.
            </p>
            {readiness.issues.length > 0 && (
              <ul className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                {readiness.issues.map((issue) => (
                  <li key={issue.code} className="flex items-start gap-2">
                    <StatusBadge value={issue.severity === "error" ? "fail" : "partial"} label={issue.severity} />
                    <span className="text-muted-foreground">{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Node truth — configuration never becomes liveness */}
        <SystemTruthPanel signals={systemTruth} />

        {/* Runtime provenance — explicit, no silent fallback */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Runtime provenance
              </p>
              <h2 className="mt-1 text-lg font-semibold">Configured runtime</h2>
            </div>
            <StatusBadge value="informational" label="explicit configuration" />
          </header>
          <dl className="divide-y divide-border">
            {runtimeRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                <dd className="font-mono text-sm">{row.value}</dd>
              </div>
            ))}
          </dl>
          <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {runtime.fallbackPolicy} · source {runtime.source}
          </footer>
        </section>

        {/* Operator load — idle does not mean dead; unavailable if ATLAS is down */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Operator load
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {load ? (load.idle ? "Idle" : "Active") : "Unavailable"}
              </h2>
            </div>
            <StatusBadge
              value={load ? (load.idle ? "informational" : "active") : "fail"}
              label={load ? (load.idle ? "idle" : "live") : "unavailable"}
            />
          </header>
          {load ? (
            <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
              {loadStats.map((stat) => (
                <div key={stat.label} className="bg-card px-4 py-3">
                  <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              Operator load is unavailable because the state read-model query did not succeed — see the DB signal above.
            </p>
          )}
          <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            Source: outcome_queue_item + execution projection · knowledge counts from evidence / governance / memory / document. Idle does not mean dead.
          </footer>
        </section>
      </div>
    </>
  )
}
