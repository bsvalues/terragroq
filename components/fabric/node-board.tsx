"use client"

import { useCallback, useEffect, useState } from "react"

type Node = {
  name: string
  role?: string
  host?: string
  transport?: string
  enrolled?: boolean
  reachable: boolean
  ms: number
  detail?: string
  fields: Record<string, string>
}

/**
 * The lab, as it actually is right now.
 *
 * This exists because the operator had no way to see his own machines and was taking an assistant's
 * word for every fact about them. Each value here is read from the node at the moment the page loads,
 * and a node that cannot be reached is shown with the reason rather than quietly omitted -- a missing
 * row reads as "fine", which is the opposite of what an unreachable node means.
 */
export function NodeBoard() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/fabric/nodes", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) { setError(payload.error ?? `failed (${response.status})`); return }
      setNodes(payload.nodes ?? [])
      setCheckedAt(payload.checkedAt ?? null)
    } catch (caught) {
      setError(String(caught))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const reachable = nodes.filter((node) => node.reachable).length

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">
          {nodes.length > 0 ? `${reachable} of ${nodes.length} nodes reachable` : "Lab nodes"}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1 text-xs disabled:opacity-40"
        >
          {busy ? "Checking…" : "Check again"}
        </button>
        {checkedAt ? (
          <span className="text-[11px] text-muted-foreground">
            measured {new Date(checkedAt).toLocaleTimeString()} — not a cached summary
          </span>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {nodes.map((node) => (
          <article
            key={node.name}
            className={`flex flex-col gap-2 rounded-lg border p-4 ${node.reachable ? "border-border" : "border-amber-500/60 bg-amber-500/5"}`}
          >
            <div className="flex items-baseline gap-2">
              <h3 className="font-mono text-sm font-medium uppercase">{node.name}</h3>
              <span className={`text-xs ${node.reachable ? "text-emerald-600" : "text-amber-600"}`}>
                {node.reachable ? `reachable · ${node.ms}ms` : "unreachable"}
              </span>
              {node.host ? <span className="ml-auto font-mono text-[11px] text-muted-foreground">{node.host}</span> : null}
            </div>

            {node.role ? <p className="text-xs text-muted-foreground">{node.role}</p> : null}

            {node.reachable ? (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
                {[
                  ["cores", node.fields.cores],
                  ["memory", node.fields.mem ? `${node.fields.mem} GB free/total` : undefined],
                  ["disk", node.fields.disk],
                  ["forge", node.fields.forge],
                  ["gpu", node.fields.gpu],
                  ["driver", node.fields.gpudriver],
                  ["uptime", node.fields.uptime],
                  ["containers", node.fields.containers],
                  ["running", node.fields.services],
                ]
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={String(label)} className="contents">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="break-words font-mono">{value}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <div className="flex flex-col gap-1 text-xs">
                {/* The reason matters: "denied" and "refused" are different problems entirely. */}
                <p className="font-mono text-amber-700 dark:text-amber-400">{node.detail || "no response"}</p>
                {node.enrolled === false ? (
                  <p className="text-muted-foreground">
                    Not enrolled in the management plane yet — nothing on this node accepts a
                    connection from the control node.
                  </p>
                ) : null}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
