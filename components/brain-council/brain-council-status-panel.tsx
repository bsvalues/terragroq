import { BrainCircuit, LockKeyhole, ShieldCheck } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import { getBrainCouncilStatus } from "@/components/brain-council/brain-council-status"

export function BrainCouncilStatusPanel() {
  const status = getBrainCouncilStatus()

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <BrainCircuit className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium">Brain Council readiness</h2>
                <StatusBadge value={status.verified ? "pass" : "fail"} label={`v${status.version}`} />
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {status.summary}
              </p>
            </div>
          </div>
          <StatusBadge value={status.governed ? "pass" : "partial"} label={status.governed ? "governed" : "review"} />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <ReadinessTile label="Installed" value={status.installed ? "yes" : "no"} tone={status.installed ? "pass" : "fail"} />
          <ReadinessTile label="Verified" value={status.verified ? "PASS" : "not verified"} tone={status.verified ? "pass" : "fail"} />
          <ReadinessTile label="MCP / autonomy" value="disabled" tone="pass" />
          <ReadinessTile label="Production write" value="disabled" tone="pass" />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Runtime activation is disabled. This panel does not execute Brain Council,
            start agents, enable MCP, schedule work, or write production data.
          </p>
        </div>
      </div>
    </section>
  )
}

function ReadinessTile({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "pass" | "fail"
}) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <ShieldCheck className={`h-3.5 w-3.5 ${tone === "pass" ? "text-success" : "text-destructive"}`} aria-hidden />
      </div>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  )
}
