import { ClipboardCheck, FileText, GitBranch, ShieldCheck } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import { summarizeRuntimeEvidence, type RuntimeEvidence } from "./runtime-evidence"

function formatHead(head?: string | null) {
  return head ? head.slice(0, 7) : "not recorded"
}

export function RuntimeEvidencePanel({ records }: { records: RuntimeEvidence[] }) {
  const summary = summarizeRuntimeEvidence(records)
  const latest = summary.latest

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-success" aria-hidden />
              <h2 className="text-sm font-medium">Verification history</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Recent evidence records attached to governed work orders. This panel is read-only.
            </p>
          </div>
          {latest ? <StatusBadge value={latest.result.toLowerCase()} label={`Latest: ${latest.result}`} /> : null}
        </div>

        {latest ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <EvidenceMetric label="Records" value={String(summary.total)} />
              <EvidenceMetric label="Passed" value={String(summary.passCount)} tone="success" />
              <EvidenceMetric label="Validators" value={String(summary.validatorCount)} />
              <EvidenceMetric label="Files" value={String(summary.changedFileCount)} />
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={latest.result.toLowerCase()} />
                <span className="font-mono text-xs text-muted-foreground">
                  {latest.ref ?? "EV-unassigned"} · {formatHead(latest.head)}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                <EvidenceLine icon={GitBranch} label="Branch" value={latest.branch ?? "not recorded"} />
                <EvidenceLine icon={ShieldCheck} label="Next gate" value={latest.nextValidMove ?? "not recorded"} />
                <EvidenceLine
                  icon={FileText}
                  label="Validators"
                  value={latest.validators.length > 0 ? latest.validators.join("; ") : "not recorded"}
                />
                <EvidenceLine
                  icon={FileText}
                  label="Changed files"
                  value={latest.filesChanged.length > 0 ? latest.filesChanged.join("; ") : "not recorded"}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4">
            <p className="text-sm font-medium">No evidence records yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Runtime health can still be inspected above. Verification history appears after work
              orders save evidence records.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function EvidenceMetric({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className={`font-mono text-lg ${tone === "success" ? "text-success" : ""}`}>{value}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  )
}

function EvidenceLine({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-muted-foreground">{value}</div>
      </div>
    </div>
  )
}
