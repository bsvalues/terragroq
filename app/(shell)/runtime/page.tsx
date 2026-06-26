import { Cpu, Database, Network, ShieldCheck } from "lucide-react"
import { PageHeader } from "@/components/shell/page-header"
import { StatusBadge } from "@/components/status-badge"
import { RuntimeProbe } from "@/components/runtime/runtime-probe"
import { buildRuntimeStatus } from "@/lib/ai/runtime"

export default function RuntimePage() {
  const rt = buildRuntimeStatus()

  const rows: { icon: typeof Cpu; label: string; value: string; mono?: boolean }[] = [
    { icon: Cpu, label: "Chat model", value: rt.chatModel, mono: true },
    { icon: Database, label: "Embedding model", value: rt.embeddingModel, mono: true },
    { icon: Database, label: "Embedding dimensions", value: String(rt.embeddingDimensions), mono: true },
    { icon: Network, label: "Gateway", value: rt.gateway, mono: true },
    { icon: Network, label: "Provider", value: rt.provider, mono: true },
  ]

  return (
    <>
      <PageHeader
        title="Runtime"
        description="Model and inference provenance for this shell. Read-only — this surface reports the runtime, it never selects or changes it."
      />
      <div className="flex flex-col gap-6 p-6">
        {/* Fallback posture — the governed guarantee */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-success" aria-hidden />
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Fallback posture</span>
                <StatusBadge
                  value={rt.fallback ? "stale" : "active"}
                  label={rt.fallback ? "fallback enabled" : "explicit-only"}
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
              Active runtime · source {rt.source}
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
