import Link from "next/link"
import { Hammer, PackageCheck, ShieldCheck } from "lucide-react"

import { getAgentForgeSurface } from "@/components/agent-forge/agent-forge-surface"
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

export function AgentForgePanel() {
  const forge = getAgentForgeSurface()
  const allLinks = [
    ...forge.links.authorityOwner,
    ...forge.links.evidenceTraceMemory,
    ...forge.links.hermesCouncilAcademy,
  ]

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Hammer className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {forge.eyebrow}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{forge.title}</h2>
          <StatusBadge value="pass" label="read-only" />
          <StatusBadge value="blocked" label="no execution" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {forge.description}
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {forge.doctrine.title}
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {forge.doctrine.statements.map((statement) => (
              <li key={statement} className="rounded-md border border-border bg-card px-3 py-2">
                {statement}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <div className="flex flex-wrap items-center gap-2">
            <PackageCheck className="h-4 w-4 text-primary" aria-hidden={true} />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Skill categories
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {forge.categories.map((category) => (
              <StatusBadge key={category} value="neutral" label={category} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Risk levels</p>
          <div className="mt-3 grid gap-2">
            {forge.riskLevels.map((risk) => (
              <Card key={risk.level} label={risk.level} value="descriptive only" description={risk.description} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Quarantine states</p>
          <div className="mt-3 grid gap-2">
            {forge.quarantineStates.map((state) => (
              <Card key={state.state} label={state.state} value="display only" description={state.description} />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <p className="text-sm font-medium">Permission matrix</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {forge.permissionMatrix.map((permission) => (
            <Card
              key={permission.area}
              label={permission.area}
              value={permission.posture}
              description={permission.description}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Skill registry</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {forge.skills.map((skill) => (
            <article key={skill.skillId} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{skill.title}</h3>
                <StatusBadge value="neutral" label={skill.quarantineState} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {skill.purpose}
              </p>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {skill.skillId}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Risk: {skill.riskLevel}. Category: {skill.category}.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Does not authorize: {skill.whatThisDoesNotAuthorize.join(", ")}.
              </p>
            </article>
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <p className="text-sm font-medium">Skill proposal packets</p>
        <div className="mt-3 grid gap-3">
          {forge.proposalPackets.map((packet) => (
            <article key={packet.packetId} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{packet.proposedCapability}</h3>
                <StatusBadge value="neutral" label={packet.packetId} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{packet.reason}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Card label="Allowed scope" value="proposal only" description={packet.allowedScope.join(", ")} />
                <Card label="Blocked scope" value="blocked" description={packet.blockedScope.join(", ")} />
                <Card label="Activation review" value="required" description={packet.activationReview} />
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Review queue</p>
          <div className="mt-3 grid gap-3">
            {forge.reviewQueue.map((item) => (
              <Card
                key={item.skillId}
                label={item.title}
                value={item.riskLevel}
                description={`${item.whyReviewIsNeeded} Safe next action: ${item.safeNextAction}`}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Blocked / quarantined UX</p>
          <div className="mt-3 grid gap-3">
            {forge.blockedUx.map((item) => (
              <Card
                key={item.skillId}
                label={item.skillId}
                value={item.blockedReason}
                description={`Missing authority: ${item.missingAuthority.join(", ")}. Prohibited: ${item.prohibitedActions.join(", ")}.`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <p className="text-sm font-medium">Safety proof</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {forge.safetyProofCards.map((card) => (
            <Card key={card.label} {...card} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Related surfaces</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {allLinks.map((link) => (
              <Link
                key={`${link.href}-${link.label}`}
                href={link.href}
                className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
              >
                <p className="text-sm font-semibold">{link.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {link.description}
                </p>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <p className="text-sm font-medium">{forge.nextLaneDecision.nextRecommendedBatch}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Recommended option: {forge.nextLaneDecision.recommendedOption}.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {forge.nextLaneDecision.reason}
          </p>
          <div className="mt-3 grid gap-2">
            {forge.nextLaneDecision.options.map((option) => (
              <Card key={option.option} label={option.option} value={option.classification} description="Next-lane classification." />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Agent Forge is read-only here. It cannot execute skills, load runtime skills, install
          dependencies, call tools, execute commands, activate Hermes, activate MCP, start workers,
          persist state, change schemas, disclose secrets, or enable autonomy.
        </p>
      </div>
    </section>
  )
}
