"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * The capability inventory, live from the modules dispatch enforces (GET /api/environment/capability).
 *
 * Same discipline as the node board above it: every field is read from the real system when this
 * page loads — the registry records, the measured curve through the reviewed loader, the device
 * through the dispatch transport. Nothing is a summary written earlier, and there is no second
 * configuration here to drift: if a capability cannot be read, the row says so instead of showing
 * yesterday's answer.
 */

type CapabilityRow = {
  capabilityId: string
  label: string
  status: string
  executionClass: string
  runtimeReality: string
  claim: string
  dispatch: { allowed: boolean; reasonCode: string }
  evidenceState:
    | { state: "VALID"; finishedAt: string | null; digest: string }
    | { state: string; detail: string | null; ageDays: number | null }
  thresholdRows: number | null
  thresholdIsAtMeasurementFloor: boolean | null
  binding: { nodeId: string; device: string; healthy: boolean; detail: string }
  placementProbe: { workload: string; rows: number; placement: string; reasonCode: string } | null
  restrictions: string[]
}

export function CapabilityBoard() {
  const [rows, setRows] = useState<CapabilityRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/environment/capability", { cache: "no-store" })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail ?? body?.error ?? `HTTP ${response.status}`)
      }
      const data = await response.json()
      setRows(Array.isArray(data.capabilities) ? data.capabilities : [])
      setCheckedAt(new Date().toISOString())
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause))
      setRows(null)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">
          {rows ? `${rows.length} compute capabilities` : "Compute capabilities"}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1 text-xs disabled:opacity-40"
        >
          {busy ? "Reading…" : "Read again"}
        </button>
        {checkedAt ? (
          <span className="text-[11px] text-muted-foreground">
            read {new Date(checkedAt).toLocaleTimeString()} — same registry dispatch enforces, not a cached summary
          </span>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

      {rows ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((row) => (
            <article
              key={row.capabilityId}
              className={`flex flex-col gap-2 rounded-lg border p-4 ${
                row.dispatch.allowed && row.binding.healthy ? "border-border" : "border-amber-500/60 bg-amber-500/5"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <h3 className="font-mono text-sm font-medium">{row.capabilityId}</h3>
                <span
                  className={`text-xs ${
                    row.dispatch.allowed
                      ? row.binding.healthy ? "text-emerald-600" : "text-amber-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {row.status}
                  {" · "}
                  {row.dispatch.allowed
                    ? row.binding.healthy ? "dispatch-eligible · device live" : "dispatch-eligible · device unread"
                    : "dispatch-refused"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{row.label}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-muted-foreground">reason</dt>
                <dd className="font-mono">{row.dispatch.reasonCode}</dd>
                <dt className="text-muted-foreground">threshold</dt>
                <dd className="font-mono">
                  {row.thresholdRows !== null
                    ? `≥ ${row.thresholdRows.toLocaleString()} rows${row.thresholdIsAtMeasurementFloor ? " (measurement floor)" : ""}`
                    : row.evidenceState.state === "VALID" ? "none (not row-gated)" : `evidence ${row.evidenceState.state}`}
                </dd>
                <dt className="text-muted-foreground">evidence</dt>
                <dd className="font-mono">
                  {"finishedAt" in row.evidenceState
                    ? `valid · measured ${row.evidenceState.finishedAt ?? "?"}`
                    : `${row.evidenceState.state}${row.evidenceState.detail ? ` · ${row.evidenceState.detail}` : ""}`}
                </dd>
                <dt className="text-muted-foreground">binding</dt>
                <dd className="font-mono">{row.binding.nodeId} · {row.binding.device}</dd>
                <dt className="text-muted-foreground">live probe</dt>
                <dd className="font-mono">{row.binding.detail}</dd>
                {row.placementProbe ? (
                  <>
                    <dt className="text-muted-foreground">placement now</dt>
                    <dd className="font-mono">
                      {row.placementProbe.workload} @ {row.placementProbe.rows.toLocaleString()} → {row.placementProbe.placement}
                      {" · "}{row.placementProbe.reasonCode}
                    </dd>
                  </>
                ) : null}
              </dl>
              {row.restrictions.length > 0 ? (
                <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
                  {row.restrictions.map((restriction) => <li key={restriction}>{restriction}</li>)}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
