import { FileText, LockKeyhole } from "lucide-react"
import { getBrainCouncilWorkerPacketPreview } from "@/components/brain-council/brain-council-worker-packet"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilWorkerPacketPreview() {
  const packet = getBrainCouncilWorkerPacketPreview()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Worker packet preview</h2>
              <StatusBadge value="neutral" label={packet.packetId} />
              <StatusBadge value="pass" label={packet.mode} />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Shows the packet a worker could receive after reasoning and readiness
              pass. It is not dispatched, queued, copied into an agent runner, or executed.
            </p>
          </div>
        </div>
        <StatusBadge value={packet.dispatch.enabled ? "fail" : "pass"} label={packet.dispatch.enabled ? "dispatch enabled" : "dispatch disabled"} />
      </div>

      <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-4">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Objective
        </h3>
        <p className="mt-2 text-sm leading-relaxed">{packet.objective}</p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <PacketList title="Evidence carried forward" items={packet.evidence} />
        <PacketList title="Required checks" items={packet.requiredChecks} />
        <PacketList title="Allowed actions" items={packet.allowedActions} tone="allow" />
        <PacketList title="Denied actions" items={packet.deniedActions} tone="deny" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-border bg-background/50 p-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Expected output
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {packet.expectedOutput.map((item) => (
              <span key={item} className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px]">
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p className="text-sm leading-relaxed text-muted-foreground">
            {packet.dispatch.reason} Queue mutation, external worker execution,
            autonomy, and production writes remain disabled.
          </p>
        </div>
      </div>
    </section>
  )
}

function PacketList({
  title,
  items,
  tone = "neutral",
}: {
  title: string
  items: string[]
  tone?: "neutral" | "allow" | "deny"
}) {
  const toneClass =
    tone === "allow"
      ? "border-success/25 bg-success/10"
      : tone === "deny"
        ? "border-destructive/25 bg-destructive/10"
        : "border-border bg-background/50"

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
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
