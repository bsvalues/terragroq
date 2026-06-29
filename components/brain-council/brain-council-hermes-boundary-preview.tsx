import { LockKeyhole, ShieldAlert } from "lucide-react"
import { getBrainCouncilHermesBoundaryPreview } from "@/components/brain-council/brain-council-hermes-boundary"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesBoundaryPreviewPanel() {
  const boundary = getBrainCouncilHermesBoundaryPreview()

  return (
    <section className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-warning" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Hermes readiness boundary</h2>
              <StatusBadge value="partial" label={boundary.verdict.replace(/_/g, " ")} />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Hermes remains a candidate concept. This panel explains what is
              missing before runtime can even be proposed; it does not activate
              Hermes, MCP, autonomy, skills, scheduler, or worker dispatch.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {boundary.gates.map((gate) => (
          <div key={gate.id} className="rounded-lg border border-warning/30 bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{gate.label}</h3>
              <StatusBadge value={gate.status === "requires-owner" ? "partial" : "fail"} label={gate.status} />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{gate.reason}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <BoundaryList title="Missing approvals" items={boundary.missingApprovals} />
        <BoundaryList title="Blocked capabilities" items={boundary.blockedCapabilities} />
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-card p-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Next safe step: {boundary.nextSafeStep}
        </p>
      </div>
    </section>
  )
}

function BoundaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
