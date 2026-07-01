import { FileCheck2, PackageCheck } from "lucide-react"
import { getHermesWorkerPacketSchema } from "@/components/brain-council/hermes-worker-packet-schema"
import { StatusBadge } from "@/components/status-badge"

export function HermesWorkerPacketSchemaPanel() {
  const schema = getHermesWorkerPacketSchema()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <PackageCheck className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Worker packet schema
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{schema.title}</h2>
          <StatusBadge value="pass" label="requirements only" />
          <StatusBadge value="neutral" label={`execution ${schema.executionStatus}`} />
          <StatusBadge value="pass" label="no dispatch" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {schema.summary}
        </p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {schema.requiredFields.map((field) => (
          <div key={field.label} className="rounded-lg border border-border bg-background p-3">
            <p className="text-sm font-semibold">{field.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {field.description}
            </p>
          </div>
        ))}
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Required safety checks
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {schema.safetyChecks.map((check) => (
            <span
              key={check}
              className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground"
            >
              {check}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
