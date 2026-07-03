"use client"

import useSWR from "swr"
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import type { LocalRuntimeStatus } from "@/lib/local-runtime-status"

async function fetchLocalRuntimeStatus(url: string): Promise<LocalRuntimeStatus> {
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as LocalRuntimeStatus
}

function statusBadgeValue(state?: string) {
  if (state === "ready") return "active"
  if (state === "degraded" || state === "stale") return "stale"
  if (state === "stopped") return "inactive"
  return "stale"
}

export function LocalRuntimeLiveStatusPanel() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/local/runtime/status",
    fetchLocalRuntimeStatus,
    { revalidateOnFocus: false, revalidateIfStale: false },
  )
  const state = data?.checks.app.state

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden={true} />
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Localhost live status
              </p>
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">
              OMEN runtime status
            </h2>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void mutate()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden={true} />
            Refresh
          </Button>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Read-only GET status from approved localhost targets. This surface does not start,
          stop, restart, repair, schedule, persist, or expose WilliamOS.
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            App state
          </p>
          <div className="mt-2 flex items-center gap-2">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            ) : error ? (
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            )}
            <StatusBadge value={statusBadgeValue(state)} label={error ? "unknown" : state ?? "checking"} />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Mode
          </p>
          <p className="mt-2 text-sm font-semibold">{data?.mode ?? "manual-only"}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Scope
          </p>
          <p className="mt-2 text-sm font-semibold">{data?.scope ?? "localhost-only"}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Execution
          </p>
          <p className="mt-2 text-sm font-semibold">
            {data?.executionEnabled ? "Enabled" : "Disabled"}
          </p>
        </div>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Status endpoint
          </p>
          <code className="mt-2 block rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
            GET /api/local/runtime/status
          </code>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Approved app base: {data?.checks.app.url ?? "http://127.0.0.1:3100"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Postgres proof
          </p>
          <p className="mt-2 text-sm font-semibold">
            {data?.checks.postgresProof.state ?? "documented"} ·{" "}
            {data?.checks.postgresProof.expectedPort ?? "127.0.0.1:15432"}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Documented only. This slice does not inspect Docker, ports, backups, or database contents.
          </p>
        </div>
      </div>

      {error ? (
        <p className="border-b border-border px-4 py-3 text-xs text-warning">
          Status route unavailable: {String(error.message ?? error)}. Use the manual status
          wrapper for operator-run proof.
        </p>
      ) : data?.warnings.length ? (
        <ul className="border-b border-border px-4 py-3">
          {data.warnings.map((warning) => (
            <li key={warning} className="text-xs leading-relaxed text-warning">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-2 p-4 md:grid-cols-5">
        {(data?.checks.app.routes ?? []).map((route) => (
          <div key={route.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {route.label}
            </p>
            <p className="mt-2 text-sm font-semibold">{route.health}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {route.status ?? "no response"} · {route.latencyMs ?? 0}ms
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
