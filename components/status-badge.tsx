import { cn } from "@/lib/utils"

type Tone = "neutral" | "primary" | "success" | "warning" | "danger"

const toneMap: Record<string, Tone> = {
  // decisions
  proposed: "warning",
  accepted: "success",
  superseded: "neutral",
  rejected: "danger",
  // work orders
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
