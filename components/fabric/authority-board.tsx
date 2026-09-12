"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * The sovereign Git authority, live from the integration record the lab itself writes
 * (GET /api/environment/authority).
 *
 * Same discipline as the boards beside it: every field is read from the record of the real
 * integration when the page loads. Nothing is typed into this component — no policy, no state, no
 * commit is restated here. If the record can't be read, the surface says so with its typed reason
 * rather than showing an empty history, because an empty list would read as "nothing was promoted".
 *
 * What it makes visible is the doctrine's central pair: the product transition and the mirror echo
 * are separate facts, and a mirror failure never reopens the product.
 */

type Surface = {
  authority: { rule: string; model: string; source: string; note: string }
  runtime: {
    buildSha: string
    builtAt: string | null
    provenanceState: string
    labMainHead: string | null
  }
  product: { state: string; detail: string; at: string | null; promotions: number }
  mirror: { state: string; detail: string; at: string | null; laggingSince: string | null }
  recentPromotions: Array<{
    at: string
    candidate: string
    labMainBefore: string
    labMainAfter: string
    sealKey: string
    reviewerKey: string
    productState: string
    mirrorState: string
    mirrorDetail: string
  }>
  staleness: { newestRecordAt: string | null; ageHours: number | null; thresholdHours: number; withinWindow: boolean | null }
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 10) : "—")

function tone(value: string, good: string[], bad: string[]) {
  if (good.includes(value)) return "text-emerald-600"
  if (bad.includes(value)) return "text-amber-600"
  return "text-muted-foreground"
}

export function AuthorityBoard() {
  const [surface, setSurface] = useState<Surface | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/environment/authority", { cache: "no-store" })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail ?? body?.error ?? `HTTP ${response.status}`)
      }
      setSurface((await response.json()) as Surface)
      setCheckedAt(new Date().toISOString())
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause))
      setSurface(null)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">
          {surface ? `Sovereign authority · ${surface.product.promotions} sealed integrations` : "Sovereign authority"}
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
            read {new Date(checkedAt).toLocaleTimeString()} — from the lab integration record, not a cached summary
          </span>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

      {surface ? (
        <div
          className={`grid gap-3 rounded-lg border p-4 md:grid-cols-2 ${
            surface.product.state === "COMPLETE" ? "border-border" : "border-amber-500/60 bg-amber-500/5"
          }`}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <h3 className="font-mono text-sm font-medium">PRODUCT / LOCAL AUTHORITY</h3>
              <span className={`text-xs ${tone(surface.product.state, ["COMPLETE"], ["NO_AUTHORITY_RECORD"])}`}>
                {surface.product.state}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{surface.product.detail}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-muted-foreground">lab main</dt>
              <dd className="font-mono">{short(surface.runtime.labMainHead)}</dd>
              <dt className="text-muted-foreground">seal key / reviewer</dt>
              <dd className="font-mono">
                {short(surface.recentPromotions[0]?.sealKey)} · {surface.recentPromotions[0]?.reviewerKey ?? "—"}
              </dd>
              <dt className="text-muted-foreground">at</dt>
              <dd className="font-mono">{surface.product.at ?? "—"}</dd>
            </dl>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <h3 className="font-mono text-sm font-medium">GITHUB MIRROR</h3>
              <span className={`text-xs ${tone(surface.mirror.state, ["IN_SYNC"], ["OUT_OF_SYNC", "UNKNOWN"])}`}>
                {surface.mirror.state}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {surface.mirror.detail}
              {surface.mirror.laggingSince ? ` · lagging since ${surface.mirror.laggingSince}` : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">
              A mirror failure is reported beside the product transition, never instead of it.
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-muted-foreground">deployed build</dt>
              <dd className="font-mono">
                {short(surface.runtime.buildSha)} · {surface.runtime.provenanceState}
                {surface.runtime.builtAt ? ` (${surface.runtime.builtAt})` : ""}
              </dd>
              <dt className="text-muted-foreground">record age</dt>
              <dd className="font-mono">
                {surface.staleness.ageHours === null
                  ? "no record"
                  : `${surface.staleness.ageHours}h of ${surface.staleness.thresholdHours}h window`}{" "}
                {surface.staleness.withinWindow === true
                  ? "· within"
                  : surface.staleness.withinWindow === false
                    ? "· stale: check the integration lane"
                    : ""}
              </dd>
            </dl>
          </div>

          <div className="md:col-span-2">
            <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              recent sealed integrations
            </h4>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-normal">at</th>
                  <th className="py-1 pr-3 font-normal">candidate</th>
                  <th className="py-1 pr-3 font-normal">lab main</th>
                  <th className="py-1 pr-3 font-normal">product</th>
                  <th className="py-1 font-normal">mirror</th>
                </tr>
              </thead>
              <tbody>
                {surface.recentPromotions.map((r) => (
                  <tr key={`${r.at}-${r.labMainAfter}`} className="border-t border-border/60">
                    <td className="py-1 pr-3 font-mono">{r.at}</td>
                    <td className="py-1 pr-3 font-mono">{short(r.candidate)}</td>
                    <td className="py-1 pr-3 font-mono">{short(r.labMainAfter)}</td>
                    <td className={`py-1 pr-3 font-mono ${tone(r.productState, ["COMPLETE"], [])}`}>{r.productState}</td>
                    <td className={`py-1 font-mono ${tone(r.mirrorState, ["IN_SYNC"], ["OUT_OF_SYNC"])}`}>{r.mirrorState}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              authority model {surface.authority.model} · rule {surface.authority.rule} · record {surface.authority.source}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}
