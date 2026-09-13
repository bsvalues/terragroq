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
 *
 * The row-level Run control is the same discipline on the write side (POST, owner-gated): it
 * dispatches one bounded synthetic workload through the seam and renders what the seam ANSWERED —
 * status, placement, device binding, timings, result — inside this product. The client never
 * decides which capability is runnable or where the job lands: a refusal comes back typed from
 * the server and is displayed as received.
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
  ownerRunnable: boolean
}

type RunOutcome = {
  status?: string
  outcome?: string
  placement?: string
  reasonCode?: string
  capabilityId?: string
  dispatchId?: string
  workOrderRef?: string
  result?: unknown
  workloadSeconds?: number | null
  bindingObserved?: { deviceHealthy?: boolean; cumlVersion?: string | null; probeError?: string } | null
  evidenceRef?: string | null
  executed?: boolean
  syntheticDataOnly?: boolean
  authorization?: { settled?: boolean; settleError?: string }
  error?: string
  detail?: string
}

export function CapabilityBoard() {
  const [rows, setRows] = useState<CapabilityRow[] | null>(null)
  const [ownerRun, setOwnerRun] = useState<{ minRows: number; maxRows: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Record<string, RunOutcome>>({})

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
      setOwnerRun(data.ownerRun && typeof data.ownerRun.minRows === "number" ? data.ownerRun : null)
      setCheckedAt(new Date().toISOString())
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause))
      setRows(null)
    } finally {
      setBusy(false)
    }
  }, [])

  const runOnce = useCallback(async (capabilityId: string) => {
    setRunningId(capabilityId)
    setRunResults((prev) => { const next = { ...prev }; delete next[capabilityId]; return next })
    try {
      const response = await fetch("/api/environment/capability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capabilityId }),
        cache: "no-store",
      })
      const body = (await response.json().catch(() => null)) as RunOutcome | null
      setRunResults((prev) => ({
        ...prev,
        [capabilityId]: body ?? { error: `HTTP ${response.status}`, detail: "the seam returned no body" },
      }))
    } catch (cause) {
      setRunResults((prev) => ({
        ...prev,
        [capabilityId]: { error: "DISPATCH_UNREACHABLE", detail: String(cause instanceof Error ? cause.message : cause) },
      }))
    } finally {
      setRunningId(null)
      // The device may have recorded evidence while the job ran; refresh the inventory so the
      // board's claim about the seam is no newer than the seam itself.
      void load()
    }
  }, [load])

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

              <div className="mt-1 flex flex-col gap-2">
                {row.ownerRunnable ? (
                  <button
                    type="button"
                    onClick={() => void runOnce(row.capabilityId)}
                    disabled={runningId !== null}
                    title={`Dispatches one bounded synthetic workload through the governed seam (${ownerRun?.minRows ? ownerRun.minRows.toLocaleString() : "the floor"} rows). The seam — registry, curve evidence, trust gate — decides where it runs and may refuse.`}
                    className="self-start rounded-md border border-border px-3 py-1 text-xs disabled:opacity-40"
                  >
                    {runningId === row.capabilityId
                      ? "Dispatching… (this runs on the node)"
                      : `Run once (synthetic ${ownerRun?.minRows ? `${Math.round(ownerRun.minRows / 1000)}k` : "bounded"})`}
                  </button>
                ) : (
                  // No run control where the gate refuses: the board says so rather than offering
                  // a button whose only possible outcome is a typed 400.
                  <p className="text-[11px] text-muted-foreground">
                    Owner-run not offered for this capability (not in the owner-runnable vocabulary).
                  </p>
                )}
                {runResults[row.capabilityId] ? (
                  <RunResultView outcome={runResults[row.capabilityId]} />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Renders exactly what the seam returned — including refusals — as a compact evidence block.
 * No client-side reinterpretation: status and reason codes are displayed verbatim, because the
 * whole point of this board is that the displayed answer IS the enforced answer.
 */
function RunResultView({ outcome }: { outcome: RunOutcome }) {
  const failed = Boolean(outcome.error) || (outcome.status && !["SUCCEEDED"].includes(String(outcome.status)))
  const value = typeof outcome.result === "object" && outcome.result !== null
    ? JSON.stringify(outcome.result)
    : outcome.result != null ? String(outcome.result) : null
  return (
    <div
      role="status"
      className={`rounded-md border p-3 text-[11px] font-mono ${
        failed ? "border-destructive/50 bg-destructive/5 text-destructive" : "border-emerald-600/40 bg-emerald-500/5"
      }`}
    >
      <div className="flex flex-wrap gap-x-3">
        <span>{outcome.error ? `error: ${outcome.error}` : `status: ${outcome.status} · ${outcome.outcome ?? ""}`}</span>
        {outcome.placement ? <span>placement: {outcome.placement}</span> : null}
        {outcome.reasonCode ? <span>reason: {outcome.reasonCode}</span> : null}
        {typeof outcome.workloadSeconds === "number" ? <span>{outcome.workloadSeconds.toFixed(2)}s on workload</span> : null}
      </div>
      {outcome.bindingObserved ? (
        <div className="mt-1 text-muted-foreground">
          device: {String(outcome.bindingObserved.deviceHealthy)}
          {outcome.bindingObserved.cumlVersion ? ` · cuML ${outcome.bindingObserved.cumlVersion}` : ""}
          {outcome.bindingObserved.probeError ? ` · probe error ${outcome.bindingObserved.probeError}` : ""}
        </div>
      ) : null}
      {value ? <div className="mt-1 break-all">result: {value}</div> : null}
      {outcome.dispatchId ? (
        <div className="mt-1 text-muted-foreground">
          dispatch {String(outcome.dispatchId).slice(0, 13)}…
          {outcome.workOrderRef ? ` · WO ${outcome.workOrderRef}` : ""}
          {outcome.evidenceRef ? ` · evidence ${outcome.evidenceRef}` : ""}
        </div>
      ) : null}
      {outcome.detail ? <div className="mt-1 break-all">{outcome.detail}</div> : null}
      {outcome.authorization && outcome.authorization.settled === false ? (
        <div className="mt-1 text-amber-600">authorization NOT settled: {outcome.authorization.settleError} — revoke it from the authority register</div>
      ) : null}
    </div>
  )
}
