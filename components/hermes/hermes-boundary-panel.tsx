import Link from "next/link"
import { Bot, LockKeyhole, ShieldCheck } from "lucide-react"

import { getHermesBoundarySurface } from "@/components/hermes/hermes-boundary-registry"
import { StatusBadge } from "@/components/status-badge"

function Card({ label, value, description }: { label: string; value: string; description: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

export function HermesBoundaryPanel() {
  const surface = getHermesBoundarySurface()

  const allLinks = [
    ...surface.links.authority,
    ...surface.links.ownerDecisions,
    ...surface.links.evidenceTrace,
    ...surface.links.memoryCouncil,
    ...surface.links.academyWiki,
  ]

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Hermes Boundary
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{surface.doctrine.title}</h2>
          <StatusBadge value="blocked" label={surface.currentStatus.replace(/_/g, " ")} />
          <StatusBadge value="pass" label="read-only" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Hermes is defined as a governed worker-sidecar concept. This surface documents the
          boundary, blocked states, activation requirements, and safety proof without activating
          Hermes or adding worker capability.
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Doctrine
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {surface.doctrine.statements.map((statement) => (
              <li key={statement} className="rounded-md border border-border bg-card px-3 py-2">
                {statement}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Status model
          </p>
          <div className="mt-3 grid gap-2">
            {surface.statuses.map((item) => (
              <div key={item.status} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{item.label}</p>
                  <StatusBadge value={item.status === surface.currentStatus ? "blocked" : "neutral"} label={item.status} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Authority boundaries</p>
          <div className="mt-3 grid gap-2">
            {surface.authorityBoundaries.map((boundary) => (
              <Card
                key={boundary.label}
                label={boundary.label}
                value={boundary.required ? "required" : "optional"}
                description={boundary.description}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Activation requirements</p>
          <div className="mt-3 grid gap-2">
            {surface.activationRequirements.map((requirement) => (
              <Card
                key={requirement.label}
                label={requirement.label}
                value="required before activation"
                description={requirement.description}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <p className="text-sm font-medium">Worker packet proposals</p>
        <div className="mt-3 grid gap-3">
          {surface.workerPacketProposals.map((packet) => (
            <article key={packet.packetId} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{packet.proposedTask}</h3>
                <StatusBadge value="neutral" label={packet.packetId} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{packet.purpose}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Card label="Allowed actions" value="review only" description={packet.allowedActions.join(", ")} />
                <Card label="Blocked actions" value="blocked" description={packet.blockedActions.join(", ")} />
                <Card label="Does not authorize" value="no execution" description={packet.whatThisDoesNotAuthorize.join(", ")} />
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2">
          <LockKeyhole className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="text-sm font-medium">Blocked / denied state UX</p>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {surface.blockedStates.map((state) => (
            <article key={state.label} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{state.label}</h3>
                <StatusBadge value="blocked" label="no activation" />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{state.blockedReason}</p>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Missing authority: {state.missingAuthority.join(", ")}.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Safe next action: {state.safeNextAction}
              </p>
            </article>
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <p className="text-sm font-medium">Safety proof</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.safetyProofCards.map((card) => (
            <Card key={card.label} {...card} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Related surfaces</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {allLinks.map((item) => (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
              >
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <p className="text-sm font-medium">{surface.nextLaneDecision.nextRecommendedBatch}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Recommended option: {surface.nextLaneDecision.recommendedOption}.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.nextLaneDecision.reason}
          </p>
          <div className="mt-3 grid gap-2">
            {surface.nextLaneDecision.options.map((option) => (
              <Card key={option.option} label={option.option} value={option.classification} description="Next-lane classification." />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Hermes remains inactive. No runtime, activation, worker, tool calls, command execution,
          MCP activation, memory write/read, dynamic retrieval, persistence, service, scheduler,
          LAN exposure, secrets, unrelated container touch, or autonomy was added.
        </p>
      </div>
    </section>
  )
}
