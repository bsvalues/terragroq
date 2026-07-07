import { FileCheck2, LockKeyhole } from "lucide-react"
import { getCouncilDecisionPacketSchema } from "@/components/brain-council/council-decision-packet-schema"
import { StatusBadge } from "@/components/status-badge"

export function CouncilDecisionPacketSchemaPanel() {
  const schema = getCouncilDecisionPacketSchema()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Decision packet schema
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{schema.title}</h2>
          <StatusBadge value="pass" label="review artifact" />
          <StatusBadge value="neutral" label="not approval" />
          <StatusBadge value="pass" label="schema only" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {schema.summary}
        </p>
      </div>

      <div className="border-b border-border p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Status flow
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {schema.statusFlow.map((status) => (
            <span
              key={status}
              className="rounded-full border border-border bg-background px-3 py-1 font-mono text-[10px] text-muted-foreground"
            >
              {status}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2 xl:grid-cols-3">
        {schema.requiredFields.map((field) => (
          <div key={field.label} className="rounded-lg border border-border bg-background p-3">
            <p className="text-sm font-semibold">{field.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {field.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border bg-muted/10 p-4 md:grid-cols-3">
        {schema.authorityChecks.map((check) => (
          <div key={check.label} className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-3.5 w-3.5 text-primary" aria-hidden={true} />
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                required
              </p>
            </div>
            <p className="mt-2 text-sm font-semibold">{check.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {check.description}
            </p>
          </div>
        ))}
      </div>

      <div className="px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Blocked until approved: {schema.blockedUntilApproved.join(", ")}.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {schema.criticalRule}
        </p>
      </div>
    </section>
  )
}
