"use client"

import useSWR from "swr"
import { useState } from "react"
import { CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

type RuntimeStatus = {
  chatModel: string
  embeddingModel: string
  gateway: string
  provider: string
  fallback: boolean
  fallbackPolicy: string
  ts: string
}

async function fetchRuntime(url: string): Promise<{ data: RuntimeStatus; latencyMs: number }> {
  const start = performance.now()
  const res = await fetch(url, { headers: { accept: "application/json" } })
  const latencyMs = Math.round(performance.now() - start)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return { data: (await res.json()) as RuntimeStatus, latencyMs }
}

// Live verification that GET /api/copilot/runtime is reachable and reporting
// the same provenance the page rendered server-side. This mirrors how the
// future Tauri tray / PWA will consume the endpoint.
export function RuntimeProbe() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, error, isLoading, mutate } = useSWR(
    ["/api/copilot/runtime", refreshKey],
    ([url]) => fetchRuntime(url),
    { revalidateOnFocus: false },
  )

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          ) : error ? (
            <XCircle className="h-4 w-4 text-destructive" aria-hidden />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          )}
          <span className="text-sm font-medium">
            {isLoading
              ? "Probing endpoint…"
              : error
                ? "Endpoint unreachable"
                : "Endpoint live"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {data && !error ? (
            <span className="font-mono text-xs text-muted-foreground">{data.latencyMs}ms</span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => {
              setRefreshKey((k) => k + 1)
              void mutate()
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Re-probe
          </Button>
        </div>
      </div>

      <p className="mt-2 font-mono text-xs text-muted-foreground">
        GET /api/copilot/runtime
      </p>

      {error ? (
        <p className="mt-2 text-xs text-destructive">
          {String(error.message ?? error)} — the page provenance above is read
          from the in-process source and remains accurate.
        </p>
      ) : data ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Verified {data.data.provider} · {data.data.gateway} · fallback{" "}
          {data.data.fallback ? "ON" : "OFF"} at{" "}
          {new Date(data.data.ts).toLocaleTimeString()}
        </p>
      ) : null}
    </div>
  )
}
