import { Cpu, Database, Network, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { PageHeader } from "@/components/shell/page-header"
import { StatusBadge } from "@/components/status-badge"
import { getRecentEvidence } from "@/app/actions/evidence"
import { RuntimeEvidencePanel } from "@/components/runtime/runtime-evidence-panel"
import {
  projectRuntimeEvidenceHistory,
  RUNTIME_EVIDENCE_HISTORY_LIMIT,
} from "@/components/runtime/runtime-evidence"
import { RuntimeExecutionPanel } from "@/components/runtime/runtime-execution-panel"
import { ContinuousCampaignStatusPanel } from "@/components/runtime/continuous-campaign-status-panel"
import { projectContinuousCampaignStatus } from "@/components/runtime/continuous-campaign-status"
import { OutcomeCompletionTimelinePanel } from "@/components/runtime/outcome-completion-timeline-panel"
import { RuntimeProbe } from "@/components/runtime/runtime-probe"
import { ReadinessNativeAreaPanel } from "@/components/runtime/readiness-native-area-panel"
import { SystemTruthPanel } from "@/components/systems/system-truth-panel"
import { LocalRuntimeLiveStatusPanel } from "@/components/local/local-runtime-live-status-panel"
import { getRuntimeExecutions } from "@/app/actions/runtime-executions"
import { getRecentOutcomeCompletionTimeline } from "@/app/actions/goal-timeline"
import { getOutcomeQueueSurface } from "@/app/actions/outcome-queue"
import { buildRuntimeStatus } from "@/lib/ai/runtime"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { projectSystemTruth } from "@/lib/system/system-truth"
import { DeviceEnrollmentPanel } from "@/components/device/device-enrollment-panel"

async function RuntimeSupportingPanels({ databaseReady }: { databaseReady: boolean }) {
  if (!databaseReady) {
    return (
      <div role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-muted-foreground">
        Supporting persisted runtime panels are unavailable while the ATLAS query is unknown.
      </div>
    )
  }

  try {
    const [evidenceRecords, executionTruth, outcomeCompletionTimeline, outcomeQueueSurface] = await Promise.all([
      getRecentEvidence(RUNTIME_EVIDENCE_HISTORY_LIMIT + 1),
      getRuntimeExecutions(),
      getRecentOutcomeCompletionTimeline(),
      getOutcomeQueueSurface(),
    ])
    const evidenceHistory = projectRuntimeEvidenceHistory(evidenceRecords)
    const continuousCampaignStatus = projectContinuousCampaignStatus(
      outcomeQueueSurface,
      outcomeCompletionTimeline,
    )

    return (
      <>
        <RuntimeExecutionPanel truth={executionTruth} />
        <ContinuousCampaignStatusPanel status={continuousCampaignStatus} />
        <OutcomeCompletionTimelinePanel timeline={outcomeCompletionTimeline} />
        <RuntimeEvidencePanel
          records={evidenceHistory.records}
          limit={evidenceHistory.limit}
          truncated={evidenceHistory.truncated}
        />
      </>
    )
  } catch {
    return (
      <div role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-muted-foreground">
        Supporting persisted runtime panels are unavailable; SYSTEM truth remains independently visible.
      </div>
    )
  }
}

export default async function RuntimePage({
  searchParams,
}: {
  searchParams: Promise<{ detail?: string | string[] }>
}) {
  const detail = (await searchParams).detail
  const rt = buildRuntimeStatus()
  const systemReadiness = await getAuthReadiness({ probeDatabase: true })
  const systemTruth = projectSystemTruth([
    {
      system: "ATLAS",
      signal: "state-database",
      evidenceKind: "current-query",
      succeeded: systemReadiness.databaseReady,
      observedAt: systemReadiness.checkedAt,
      source: "getAuthReadiness database connectivity probe",
      summary: systemReadiness.databaseReady
        ? "Current state-database query succeeded."
        : "Current state-database query did not succeed.",
    },
    {
      system: "HERMES",
      signal: "coordinator-app-host",
      evidenceKind: "configured",
      observedAt: null,
      source: "issue #762 runtime topology contract",
      summary: "Configured as coordinator and app host. Configuration describes role, not current liveness.",
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
  const rows: { icon: typeof Cpu; label: string; value: string; mono?: boolean }[] = [
    { icon: Cpu, label: "Chat model", value: rt.chatModel, mono: true },
    { icon: Database, label: "Embedding model", value: rt.embeddingModel, mono: true },
    { icon: Database, label: "Embedding dimensions", value: String(rt.embeddingDimensions), mono: true },
    { icon: Network, label: "Gateway", value: rt.gateway, mono: true },
    { icon: Network, label: "Provider", value: rt.provider, mono: true },
  ]

  if (detail !== "technical") {
    return (
      <div className="mx-auto w-full max-w-4xl p-5 md:p-8">
        <div className="mb-5 flex items-end justify-between gap-4 border-b border-[var(--workbench-hairline)] pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">System</p>
            <h1 className="mt-2 text-xl font-semibold">Current operating truth</h1>
          </div>
          <Link href="/runtime?detail=technical" className="workbench-focus text-xs text-[var(--workbench-copper)]">Open technical detail</Link>
        </div>
        <SystemTruthPanel signals={systemTruth} />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Systems"
        description="Primary read-only status view for WilliamOS systems under command: readiness, stable areas, blocked states, disabled-by-design capabilities, advisory layers, local runtime posture, and production health."
      />
      <div className="flex flex-col gap-6 p-6">
        <SystemTruthPanel signals={systemTruth} />
        <DeviceEnrollmentPanel />
        <RuntimeSupportingPanels databaseReady={systemReadiness.databaseReady} />
        <LocalRuntimeLiveStatusPanel />
        <ReadinessNativeAreaPanel />

        {/* Fallback posture — the governed guarantee */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-success" aria-hidden />
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Fallback posture</span>
                <StatusBadge
                  value={rt.fallback ? "stale" : "informational"}
                  label={rt.fallback ? "fallback configured" : "explicit configuration"}
                />
              </div>
              <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
                {rt.fallbackPolicy}
              </p>
            </div>
          </div>
        </div>

        {/* Provenance table */}
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-muted/50 px-4 py-2.5">
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Configured runtime · source {rt.source}
            </h2>
          </div>
          <dl className="divide-y divide-border">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center gap-3 px-4 py-3">
                <row.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <dt className="w-48 shrink-0 text-sm text-muted-foreground">{row.label}</dt>
                <dd className={`text-sm ${row.mono ? "font-mono" : ""}`}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Live endpoint verification */}
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            HTTP contract
          </h2>
          <RuntimeProbe />
        </div>

      </div>
    </>
  )
}
