import Link from "next/link"
import { BrainCircuit, GitBranch, ShieldCheck } from "lucide-react"

import { getMemoryGovernanceSurface } from "@/components/memory/memory-governance-registry"
import { StatusBadge } from "@/components/status-badge"

function MiniCard({
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

export function MemoryGovernancePanel() {
  const surface = getMemoryGovernanceSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Memory Governance Registry
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{surface.doctrine.title}</h2>
          <StatusBadge value="pass" label="static" />
          <StatusBadge value="pass" label="read-only" />
          <StatusBadge value="neutral" label="review before canon" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Brain Memory is classified, linked, reviewed, source-aware, sensitivity-aware, and
          authority-gated before it can become trusted context. This registry displays governance
          state only.
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[0.85fr_1.15fr]">
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
            Memory Detail
          </p>
          <h3 className="mt-2 text-base font-semibold">{surface.detailRecord.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {surface.detailRecord.summary}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <MiniCard
              label="state"
              value={surface.detailRecord.state}
              description={surface.detailRecord.reviewRequirement}
            />
            <MiniCard
              label="sensitivity"
              value={surface.detailRecord.sensitivity}
              description={surface.detailRecord.safeDefault}
            />
            <MiniCard
              label="staleness"
              value="review trigger"
              description={surface.detailRecord.staleness}
            />
            <MiniCard
              label="canon"
              value="not automatic"
              description={surface.detailRecord.canonEligibility}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Categories and states</p>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <div className="grid gap-2 md:grid-cols-2">
            {surface.categories.map((category) => (
              <MiniCard
                key={category.category}
                label={category.category}
                value="category"
                description={category.description}
              />
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {surface.states.map((state) => (
              <MiniCard
                key={state.state}
                label={state.state}
                value="state"
                description={state.description}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <p className="text-sm font-medium">Sensitivity registry</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {surface.sensitivityRegistry.map((item) => (
            <div key={item.level} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {item.level}
                </p>
                <StatusBadge
                  value={item.level === "BLOCKED_FROM_MEMORY" ? "blocked" : "neutral"}
                  label={item.safeDefault}
                />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {item.description}
              </p>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Examples: {item.examples.join(", ")}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-medium">Memory record schema</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {surface.recordSchema.map((field) => (
              <div key={field.field} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {field.field}
                  </p>
                  <StatusBadge value={field.required ? "required" : "optional"} />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {field.purpose}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Blocked runtime behavior: {field.blockedRuntimeBehavior}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Brain Memory models</p>
          <div className="mt-3 grid gap-2">
            {[
              surface.decisionMemoryModel,
              surface.procedureMemoryModel,
              surface.patternMemoryModel,
              surface.contradictionStaleMemoryModel,
            ].map((model) => (
              <div key={model.modelId} className="rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-semibold">{model.title}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {model.purpose}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Examples: {model.examples.join(", ")}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Blocked: {model.blockedBehavior.join(", ")}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Next safe gate: {model.nextSafeGate}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 xl:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Static memory records</p>
          <div className="mt-3 grid gap-2">
            {surface.records.map((record) => (
              <div key={record.memoryId} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{record.title}</p>
                  <StatusBadge value={record.state} />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {record.summary}
                </p>
                <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {record.category} | {record.sensitivity} | {record.memoryId}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Review queue model</p>
          <div className="mt-3 grid gap-2">
            {surface.reviewQueue.map((item) => (
              <div key={item.reviewItemId} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{item.memoryCandidate}</p>
                  <StatusBadge value={item.safeDefault} />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {item.reasonForReview}
                </p>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Next: {item.nextValidAction}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t border-border bg-muted/10 p-4 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="text-sm font-medium">{surface.staleContradictionUx.title}</p>
          <ul className="mt-3 grid gap-2 text-xs text-muted-foreground">
            {surface.staleContradictionUx.statements.map((statement) => (
              <li key={statement} className="rounded-md border border-border bg-card px-3 py-2">
                {statement}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <p className="text-sm font-medium">Evidence, WOE, Council, Trace, Forge, Academy, Wiki, Authority, and Owner Decision links</p>
          <div className="mt-3 grid gap-2">
            {[
              ...surface.evidenceMemoryLinks,
              ...surface.workOrderMemoryLinks,
              ...surface.councilMemoryLinks,
              ...surface.traceMemoryLinks,
              ...surface.forgeMemoryLinks,
              ...surface.academyWikiMemoryLinks,
              ...surface.authorityMemoryLinks,
              ...surface.ownerDecisionMemoryLinks,
            ].map(
              (link) => (
                <div key={`${link.memoryId}-${link.relatedItem}`} className="rounded-md border border-border bg-card p-3">
                  <p className="text-xs font-semibold">{link.label}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {link.relatedItem}: {link.description}
                  </p>
                </div>
              ),
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Safety proof</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {surface.safetyProofCards.map((card) => (
            <MiniCard key={card.label} {...card} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Governance navigation</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {surface.navigation.map((item) => (
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
            <p className="text-sm font-medium">{surface.nextLaneDecision.recommendedBatch}</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.nextLaneDecision.reason}
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Blocked lanes: {surface.nextLaneDecision.blockedLanes.join(", ")}.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Static governance only. No ingestion, extraction, memory write, canon promotion, deletion,
          archive mutation, runtime memory read, vector store, embeddings, metadata expansion,
          command execution, persistence, LAN exposure, secrets, TerraFusion/PACS touch, or autonomy.
        </p>
      </div>
    </section>
  )
}
