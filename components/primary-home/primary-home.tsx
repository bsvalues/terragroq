import Link from "next/link"
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  FolderKanban,
  ShieldCheck,
} from "lucide-react"

import type { GoalTimelineDecisionRequest } from "@/components/goal-console/goal-timeline-read-model"
import { PrimaryHomeDecisionPanel } from "@/components/primary-home/primary-home-decision"
import type {
  PrimaryHomeHealthState,
  PrimaryHomeModel,
} from "@/components/primary-home/primary-home-model"
import { cn } from "@/lib/utils"

const HEALTH_TONES: Record<PrimaryHomeHealthState, string> = {
  ADVANCING: "bg-primary",
  BLOCKED: "bg-warning",
  AWAITING_REVIEW: "bg-warning",
  COMPLETE: "bg-success",
  UNKNOWN: "bg-muted-foreground",
}

function formatWhen(value: string | null) {
  if (!value) return "Completion time not recorded"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function PrimaryHome({
  model,
  decisionRequest,
}: {
  model: PrimaryHomeModel
  decisionRequest: GoalTimelineDecisionRequest | null
}) {
  const briefing = model.founderBriefing
  const needsWilliam = model.needsWilliam !== null && decisionRequest !== null

  return (
    <main className="min-w-0">
      <section className="px-5 py-7 sm:px-7 sm:py-9" aria-labelledby="primary-home-title">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Primary briefing</p>
              <h1 id="primary-home-title" className="mt-2 text-2xl font-semibold sm:text-3xl">
                {briefing.outcome ?? "No approved outcome is moving"}
              </h1>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={cn("size-2 rounded-full", HEALTH_TONES[briefing.health.state])} />
              <span className="font-medium">{briefing.health.label}</span>
            </div>
          </div>

          <div className="mt-7 grid gap-6 border-y border-border py-6 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.55fr)]">
            <div>
              <p className="max-w-2xl text-base leading-7 text-foreground">{briefing.summary}</p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {briefing.health.detail}
              </p>
            </div>
            <dl className="grid gap-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Project</dt>
                <dd className="text-right font-medium">{briefing.project ?? "Project not recorded"}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Working now</dt>
                <dd className="text-right font-medium">{briefing.actor ?? "No live worker proven"}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Needs you</dt>
                <dd className={cn("text-right font-medium", needsWilliam && "text-warning")}>
                  {needsWilliam ? "One decision" : "Nothing"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {needsWilliam ? (
        <PrimaryHomeDecisionPanel decision={model.needsWilliam!} request={decisionRequest} />
      ) : (
        <section className="border-y border-success/25 bg-success/[0.04] px-5 py-4 sm:px-7">
          <div className="mx-auto flex max-w-5xl items-center gap-3 text-sm">
            <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
            <p>
              <span className="font-medium">Nothing needs William.</span>{" "}
              {model.nextWithoutWilliam.mode === "NONE"
                ? "WilliamOS will not invent work or turn routine delivery conditions into an owner decision."
                : "Approved work continues inside its recorded authority."}
            </p>
          </div>
        </section>
      )}

      <section className="px-5 py-7 sm:px-7" aria-labelledby="next-without-william-title">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2">
            <CircleDot className="size-4 text-primary" aria-hidden />
            <h2 id="next-without-william-title" className="text-sm font-semibold">Next without William</h2>
          </div>
          <div className="mt-4 flex flex-col justify-between gap-4 border-l-2 border-primary pl-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-lg font-semibold">{model.nextWithoutWilliam.label}</p>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                {model.nextWithoutWilliam.reason}
              </p>
            </div>
            <Link href="/work-orders" className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-primary hover:underline">
              Open work <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-border px-5 py-7 sm:px-7">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.8fr)]">
          <div aria-labelledby="recent-outcomes-title">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-success" aria-hidden />
                <h2 id="recent-outcomes-title" className="text-sm font-semibold">Recently completed</h2>
              </div>
              <Link href="/runtime" className="text-xs text-muted-foreground hover:text-foreground">Evidence</Link>
            </div>
            {model.recentOutcomes.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No completed outcomes are recorded yet.</p>
            ) : (
              <ol className="mt-3 divide-y divide-border border-y border-border">
                {model.recentOutcomes.slice(0, 5).map((outcome) => (
                  <li key={outcome.outcomeKey} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{outcome.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{outcome.result ?? "Completed"}</p>
                      {outcome.evidenceState !== "RECORDED" && (
                        <Link
                          href={outcome.technicalDetailHref}
                          className={cn(
                            "mt-1 inline-block text-xs font-medium hover:underline",
                            outcome.evidenceState === "CONFLICTING" ? "text-destructive" : "text-warning",
                          )}
                        >
                          {outcome.evidenceState === "CONFLICTING"
                            ? "Evidence conflict - inspect"
                            : "Merge evidence not recorded - inspect"}
                        </Link>
                      )}
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground">{formatWhen(outcome.completedAt)}</time>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div aria-labelledby="project-horizon-title">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="size-4 text-primary" aria-hidden />
                <h2 id="project-horizon-title" className="text-sm font-semibold">Project horizon</h2>
              </div>
              <Link href="/projects" className="text-xs text-muted-foreground hover:text-foreground">Projects</Link>
            </div>
            {model.projectHorizon.length === 0 ? (
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                No project identity is proven by current evidence.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {model.projectHorizon.slice(0, 5).map((project) => (
                  <li key={project.repo} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 break-words text-sm font-medium">{project.repo}</p>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn("size-1.5 rounded-full", HEALTH_TONES[project.health.state])} />
                        {project.health.label}
                      </span>
                    </div>
                    {project.currentOutcome && (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{project.currentOutcome}</p>
                    )}
                    {project.health.state === "BLOCKED" && (
                      <p className="mt-1 text-xs leading-5 text-warning">{project.health.detail}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className={project.williamNeeded ? "text-warning" : "text-muted-foreground"}>
                        {project.williamNeeded ? "Needs William" : "No owner action"}
                      </span>
                      {project.latestResult && (
                        <span className="text-muted-foreground">
                          Latest: {project.latestResult.result} · {formatWhen(project.latestResult.recordedAt)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-border px-5 py-5 sm:px-7">
        <div className="mx-auto max-w-5xl">
          <details className="text-sm">
            <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
              <Clock3 className="size-4" aria-hidden />
              Technical details
            </summary>
            <dl className="mt-4 grid gap-x-8 gap-y-3 border-l border-border pl-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <TechnicalDetail label="Queue" value={`${model.technicalDetails.queueState} · ${model.technicalDetails.queueReason}`} />
              <TechnicalDetail label="Timeline truth" value={model.technicalDetails.timelineTruth} />
              <TechnicalDetail label="Goal" value={model.technicalDetails.currentGoalId?.toString() ?? "Not recorded"} />
              <TechnicalDetail label="Work Order" value={model.technicalDetails.currentWorkOrderId?.toString() ?? "Not recorded"} />
              <TechnicalDetail label="Decision Goal" value={model.technicalDetails.decisionGoalId?.toString() ?? "None"} />
              <TechnicalDetail label="Generated" value={formatWhen(model.technicalDetails.generatedAt)} />
            </dl>
          </details>
        </div>
      </section>
    </main>
  )
}

function TechnicalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-mono text-foreground">{value}</dd>
    </div>
  )
}
