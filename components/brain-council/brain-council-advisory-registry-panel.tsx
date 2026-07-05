import Link from "next/link"
import { BrainCircuit, GitBranch, ShieldCheck } from "lucide-react"

import { getBrainCouncilAdvisoryRegistry } from "@/components/brain-council/brain-council-advisory-registry"
import { StatusBadge } from "@/components/status-badge"

function InfoCard({
  label,
  value,
  description,
}: {
  label: string
  value: string
  description: string
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

export function BrainCouncilAdvisoryRegistryPanel() {
  const registry = getBrainCouncilAdvisoryRegistry()
  const detail = registry.detailPacket

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Brain Council Advisory Registry
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{registry.doctrine.title}</h2>
          <StatusBadge value="pass" label="advisory only" />
          <StatusBadge value="pass" label="read-only" />
          <StatusBadge value="neutral" label="owner authority" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Council roles, states, packets, recommendations, evidence, memory, and owner-decision
          links are displayed as static advice. Nothing here runs work.
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Doctrine
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {registry.doctrine.statements.map((statement) => (
              <li key={statement} className="rounded-md border border-border bg-card px-3 py-2">
                {statement}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Decision Packet Detail
          </p>
          <h3 className="mt-2 text-base font-semibold">{detail.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {detail.contextSummary}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <InfoCard label="state" value={detail.advisoryState} description={detail.question} />
            <InfoCard label="confidence" value={detail.confidence} description={detail.evidenceSufficiency} />
            <InfoCard label="risk stop" value="visible" description={detail.stopCondition} />
            <InfoCard label="authority" value="required" description={detail.authorityRequired} />
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Advisory roles</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {registry.roles.map((role) => (
            <InfoCard
              key={role.roleId}
              label={role.label}
              value="advisory label"
              description={`${role.perspective} ${role.advisoryBoundary}`}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <p className="text-sm font-medium">Advisory states</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {registry.states.map((state) => (
            <InfoCard
              key={state.state}
              label={state.state}
              value="display state"
              description={state.description}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 xl:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Decision packets</p>
          <div className="mt-3 grid gap-2">
            {registry.packets.map((packet) => (
              <div key={packet.packetId} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{packet.title}</p>
                  <StatusBadge value={packet.advisoryState} />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {packet.recommendation}
                </p>
                <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {packet.packetId}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Work Order recommendations</p>
          <div className="mt-3 grid gap-2">
            {registry.recommendations.map((recommendation) => (
              <div key={recommendation.recommendedWorkOrder} className="rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-semibold">{recommendation.recommendedWorkOrder}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {recommendation.reason}
                </p>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Next: {recommendation.nextSafeOwnerAction}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t border-border bg-muted/10 p-4 xl:grid-cols-3">
        <div>
          <p className="text-sm font-medium">Evidence links</p>
          <div className="mt-3 grid gap-2">
            {registry.evidenceLinks.map((link) => (
              <InfoCard key={`${link.packetId}-${link.relatedItem}`} label={link.label} value={link.relatedItem} description={link.description} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Memory links</p>
          <div className="mt-3 grid gap-2">
            {registry.memoryLinks.map((link) => (
              <InfoCard key={`${link.packetId}-${link.relatedItem}`} label={link.label} value={link.relatedItem} description={link.description} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Owner decision links</p>
          <div className="mt-3 grid gap-2">
            {registry.ownerDecisionLinks.map((link) => (
              <InfoCard key={`${link.packetId}-${link.relatedItem}`} label={link.label} value={link.relatedItem} description={link.description} />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Options, risks, and blocked actions</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Options</p>
            <div className="mt-3 grid gap-2">
              {detail.options.map((option) => (
                <div key={option.label} className="rounded-md border border-border bg-card px-3 py-2">
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{option.summary}</p>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    risk: {option.risk}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Risks</p>
            <ul className="mt-3 grid gap-2 text-xs text-muted-foreground">
              {detail.risks.map((risk) => (
                <li key={risk} className="rounded-md border border-border bg-card px-3 py-2">
                  {risk}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-destructive">Blocked actions</p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {detail.blockedActions.join(", ")}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Does not authorize: {detail.whatThisDoesNotAuthorize.join(", ")}.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Safety proof</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {registry.safetyProofCards.map((card) => (
            <InfoCard key={card.label} {...card} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Navigation</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {registry.navigation.map((item) => (
              <Link
                key={item.href}
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
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" aria-hidden={true} />
            <p className="text-sm font-medium">{registry.nextLaneDecision.recommendedBatch}</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {registry.nextLaneDecision.reason}
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Blocked lanes: {registry.nextLaneDecision.blockedLanes.join(", ")}.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Static advisory read model only. No Council runtime, command execution, command runner,
          tool calls, worker activation, Hermes/MCP activation, memory write, runtime memory read,
          dynamic retrieval, vector store, embeddings, persistence, scheduler, GitHub write,
          Codex automation, metadata expansion, LAN exposure, secrets, TerraFusion/PACS touch,
          unrelated container touch, or autonomy.
        </p>
      </div>
    </section>
  )
}
