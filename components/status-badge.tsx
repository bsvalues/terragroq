import { cn } from "@/lib/utils"

type Tone = "neutral" | "primary" | "success" | "warning" | "danger"

const toneMap: Record<string, Tone> = {
  // decisions
  proposed: "warning",
  accepted: "success",
  superseded: "neutral",
  rejected: "danger",
  // work orders (8-status lifecycle)
  draft: "neutral",
  approved: "primary",
  review: "warning",
  closed: "success",
  aborted: "danger",
  backlog: "neutral",
  in_progress: "primary",
  blocked: "danger",
  done: "success",
  // priority
  low: "neutral",
  medium: "primary",
  high: "warning",
  critical: "danger",
  // confidence
  active: "success",
  inactive: "neutral",
  // memory authority lifecycle
  intake: "neutral",
  unreviewed: "warning",
  working: "primary",
  reviewed: "primary",
  canon: "success",
  deprecated: "neutral",
  archived: "neutral",
  stale: "warning",
  // decision authority
  binding: "danger",
  advisory: "primary",
  informational: "neutral",
  // doctrine category + status
  principle: "primary",
  policy: "primary",
  guardrail: "danger",
  retired: "neutral",
  // governance hardening — authority grants
  revoked: "danger",
  expired: "neutral",
  // locks
  released: "neutral",
  HOLD: "warning",
  STOP: "danger",
  FREEZE: "primary",
  // conflicts
  open: "warning",
  resolved: "success",
  accepted_risk: "neutral",
  // truth freshness
  fresh: "success",
  aging: "warning",
  // agent claim classifications
  SELF_REPORTED: "neutral",
  EVIDENCE_BACKED: "success",
  UNSUPPORTED: "warning",
  CONFLICTING: "danger",
  REQUIRES_VERIFICATION: "warning",
  // not-now vault
  parked: "neutral",
  promoted: "success",
  dropped: "neutral",
}

const toneClasses: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/15 text-primary border-primary/30",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
}

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  const tone = toneMap[value] ?? "neutral"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] capitalize",
        toneClasses[tone],
      )}
    >
      {label ?? value.replace(/_/g, " ")}
    </span>
  )
}
