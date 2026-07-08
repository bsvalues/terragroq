import Link from "next/link"
import { GitBranch, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { getTraceLedgerSurface } from "@/components/trace/trace-ledger-registry"

export function TraceLedgerPanel() {
  const surface = getTraceLedgerSurface()
  const detail = surface.records[0]

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Trace Ledger
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.doctrine.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Static reasoning records for goals, loops, Work Orders, evidence, memory,
          decisions, authority gates, Council packets, blockers, and proposed evals.
          Trace explains. It does not execute.
        </p>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <TracePill label="Goal" value={surface.currentBatch.goal} />
          <TracePill label="Batch" value={surface.currentBatch.batch} />
          <TracePill label="Mode" value={surface.currentBatch.mode} />
        </div>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[0.9fr_1.1fr]">
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Trace detail
            </p>
            <Badge variant="outline">{detail.category}</Badge>
          </div>
          <h3 className="mt-2 text-base font-semibold">{detail.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {detail.reasoningSummary}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <TraceField label="Evidence used" values={detail.evidenceUsed} />
            <TraceField label="Memory referenced" values={detail.memoryReferenced} />
            <TraceField label="Authority gate" values={[detail.authorityGate]} />
            <TraceField label="Does not authorize" values={[detail.whatItDoesNotAuthorize]} />
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Trace proof readability</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {surface.proofReadability.map((item) => (
            <div key={item.label} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-2 text-xs font-medium">{item.value}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Trace categories</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.categories.map((category) => (
            <div key={category.category} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {category.category}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {category.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 xl:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Static trace records</p>
          <div className="mt-3 grid gap-2">
            {surface.records.map((record) => (
              <div key={record.traceId} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{record.title}</p>
                  <Badge variant="outline">{record.result}</Badge>
                </div>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {record.traceId} | {record.failureType}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {record.whatItProves}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-destructive">
                  Boundary: {record.whatItDoesNotAuthorize}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Failure-to-eval proposals</p>
          <div className="mt-3 grid gap-2">
            {surface.evalProposals.map((proposal) => (
              <div key={proposal.proposalId} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{proposal.proposedEvalTitle}</p>
                  <Badge variant="outline">{proposal.status}</Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Assertion: {proposal.expectedAssertion}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Authority: {proposal.authorityRequired}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-destructive">
                  {proposal.whatThisDoesNotDo}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Failure classes</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.failureClassifications.map((failure) => (
            <div key={failure.failureType} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {failure.failureType}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {failure.description}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Safe default: {failure.safeDefault}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Failure classification clarity</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.failureClassificationPolish.map((failure) => (
            <div key={`${failure.failureType}-${failure.plainLabel}`} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{failure.plainLabel}</p>
                <Badge variant="outline">{failure.severity}</Badge>
              </div>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {failure.failureType}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Evidence: {failure.evidenceRequired}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Eval candidate: {failure.mayProduceEvalCandidate ? "possible" : "not by default"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-destructive">
                {failure.ownerDecisionImplication}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 xl:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Evidence gap classes</p>
          <div className="mt-3 grid gap-2">
            {surface.evidenceGapClassifications.map((gap) => (
              <div key={gap.gapType} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {gap.gapType}
                  </p>
                  <Badge variant="outline">{gap.confidenceEffect}</Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {gap.description}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Safe default: {gap.safeDefault}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Confidence movement</p>
          <div className="mt-3 grid gap-2">
            {surface.confidenceMovementModel.map((rule) => (
              <div key={rule.movement} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {rule.movement}
                  </p>
                  <Badge variant="outline">advisory</Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Trigger: {rule.trigger}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Trace requirement: {rule.traceRequirement}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-destructive">
                  Boundary: {rule.authorityBoundary}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{surface.evalCandidatePacket.title}</p>
          <Badge variant="outline">proposal-only</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {surface.evalCandidatePacket.rule}
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.evalCandidatePacket.requiredFields.map((field) => (
            <div key={field.label} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {field.label}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {field.description}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Blocked until authorized
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {surface.evalCandidatePacket.blockedUntilAuthorized.map((action) => (
              <Badge key={action} variant="outline">
                {action}
              </Badge>
            ))}
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {surface.evalCandidateReadability.map((item) => (
            <div key={item.label} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 xl:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Missing and stale proof states</p>
          <div className="mt-3 grid gap-2">
            {surface.missingProofStates.map((state) => (
              <div key={state.state} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{state.state}</p>
                  <Badge variant="outline">{state.nextGate}</Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {state.definition}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Primary: {state.primaryAction}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Codex: {state.codexAction}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Council / WOE / Evidence / Trace relationships</p>
          <div className="mt-3 grid gap-2">
            {surface.relationshipClarity.map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {item.source} to {item.target}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {item.meaning}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-destructive">
                  {item.boundary}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-3">
        <TraceLinks title="Work Order links" links={surface.workOrderLinks} />
        <TraceLinks title="Evidence links" links={surface.evidenceLinks} />
        <TraceLinks title="Memory links" links={surface.memoryLinks} />
        <TraceLinks title="Owner decision links" links={surface.ownerDecisionLinks} />
        <TraceLinks title="Authority links" links={surface.authorityLinks} />
        <TraceLinks title="Council links" links={surface.councilLinks} />
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Trace safety proof</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.safetyProofCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-2 text-sm font-semibold">{card.value}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {card.description}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {surface.safetyFlagGroups.map((group) => (
            <div key={group.label} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="mt-2 grid gap-1 text-xs leading-relaxed text-muted-foreground">
                {group.flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs leading-relaxed text-destructive">
                {group.blockedMeaning}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-3">
        {surface.navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <p className="text-sm font-semibold">{item.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium">{surface.nextLaneDecision.recommendedBatch}</p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {surface.nextLaneDecision.reason}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
          Static ledger only. No runtime tracing, eval execution, persistence, or autonomy.
        </div>
      </div>
    </section>
  )
}

function TraceField({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <ul className="mt-2 grid gap-1 text-xs leading-relaxed text-muted-foreground">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  )
}

function TracePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-foreground">{value}</p>
    </div>
  )
}

function TraceLinks({
  title,
  links,
}: {
  title: string
  links: {
    traceId: string
    relatedItem: string
    relationship: string
    boundary: string
  }[]
}) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-3 grid gap-2">
        {links.map((link) => (
          <div key={`${title}-${link.traceId}-${link.relatedItem}`} className="rounded-lg border border-border bg-background p-3">
            <p className="text-sm font-semibold">{link.relationship}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {link.traceId}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {link.relatedItem}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-destructive">
              {link.boundary}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
