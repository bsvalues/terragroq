import Link from "next/link"
import { ArrowRight, Crosshair, FileCheck2, LockKeyhole, Route, ShieldCheck } from "lucide-react"

import { getGoalNativeConceptSurface, type GoalNativeConceptCard } from "@/components/goal-console/goal-native-concept"
import { Badge } from "@/components/ui/badge"
import { formatOwnerOperationCounter, OWNER_OPERATION_COUNTER_NAMES } from "@/lib/governance/owner-operation-evidence"

function postureLabel(posture: GoalNativeConceptCard["posture"]) {
  if (posture === "authority-gated") return "authority-gated"
  if (posture === "handoff") return "handoff"
  return "read-only"
}

function postureIcon(posture: GoalNativeConceptCard["posture"]) {
  if (posture === "authority-gated") return LockKeyhole
  if (posture === "handoff") return Route
  return Crosshair
}

export function GoalNativeConceptPanel() {
  const surface = getGoalNativeConceptSurface()

  return (
    <section className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{surface.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{surface.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{surface.description}</p>
        </div>
        <Badge variant="outline" className="w-fit border-primary/30 text-primary">
          Primary intent surface
        </Badge>
      </div>

      <div className="mt-5 border-y border-border py-4" aria-label="Owner-operation evidence">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-primary" aria-hidden />
              <h3 className="text-sm font-semibold">Owner-operation evidence</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              No counters are implied when evidence is absent; recorded zeros still require independent proof.
            </p>
          </div>
          <Badge variant="outline" className="max-w-full whitespace-normal break-all font-mono text-[10px]">
            {surface.ownerOperationEvidence.lifecycleState}
          </Badge>
        </div>

        <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {OWNER_OPERATION_COUNTER_NAMES.map((name) => (
            <div key={name} className="min-w-0 border-l-2 border-border pl-3">
              <dt className="break-all font-mono text-[10px] text-muted-foreground">{name}</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums">
                {formatOwnerOperationCounter(surface.ownerOperationEvidence.counters[name])}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="font-medium">{surface.ownerOperationEvidence.ownerAuthorityDecisions.label}</p>
            <p className="mt-1 text-muted-foreground">{surface.ownerOperationEvidence.ownerAuthorityDecisions.description}</p>
          </div>
          <div>
            <p className="font-medium">{surface.ownerOperationEvidence.routineOwnerOperations.label}</p>
            <p className="mt-1 text-muted-foreground">{surface.ownerOperationEvidence.routineOwnerOperations.description}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {surface.cards.map((card) => {
          const Icon = postureIcon(card.posture)

          return (
            <article key={card.title} className="rounded-xl border border-border bg-background/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <Icon className="h-4 w-4 text-primary" aria-hidden />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {postureLabel(card.posture)}
                </span>
              </div>
              <h3 className="mt-4 text-sm font-semibold">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
            </article>
          )
        })}
      </div>

      <div className="mt-5 grid gap-4 rounded-xl border border-dashed border-border bg-background/50 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
            <p className="text-sm font-medium">Boundaries stay visible</p>
          </div>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
            {surface.boundaries.map((boundary) => (
              <li key={boundary}>{boundary}</li>
            ))}
          </ul>
        </div>
        <Link
          href={surface.nextStep.href}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-primary/50 hover:text-primary"
        >
          {surface.nextStep.label}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  )
}
