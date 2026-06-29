import { BrainCircuit, LockKeyhole, ShieldCheck } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import { summarizeBrainCouncilGates } from "@/components/brain-council/brain-council-gates"
import { getBrainCouncilManifestSummary } from "@/components/brain-council/brain-council-manifest"
import { getBrainCouncilStatus } from "@/components/brain-council/brain-council-status"

export function BrainCouncilStatusPanel() {
  const status = getBrainCouncilStatus()
  const manifest = getBrainCouncilManifestSummary()
  const gateSummary = summarizeBrainCouncilGates()

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

        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Manifest snapshot
            </h3>
            <StatusBadge value="neutral" label={manifest.releaseStatus} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <ManifestCount label="Roles" value={manifest.roleCount} />
            <ManifestCount label="Skills" value={manifest.skillCount} />
            <ManifestCount label="Workflows" value={manifest.workflowCount} />
            <ManifestCount label="Required files" value={manifest.requiredFileCount} />
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {manifest.roles.slice(0, 6).map((role) => (
              <div key={role.id} className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-xs font-medium">{role.name}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {role.id} · authority: {role.authority}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Roles, skills, and workflows are manifest definitions only. This view does not instantiate agents.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Gate status explainer
            </h3>
            <span className="font-mono text-[10px] text-muted-foreground">
              {gateSummary.complete} complete · {gateSummary.inactive} inactive · {gateSummary.review} review
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {gateSummary.gates.map((gate) => (
              <div key={gate.gate} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[11px]">{gate.gate}</p>
                  <StatusBadge value={gate.category === "complete" ? "pass" : gate.category === "inactive" ? "neutral" : "partial"} label={gate.status} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {gate.explanation}
                </p>
              </div>
            ))}
          </div>
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

function ManifestCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-mono text-lg">{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
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
