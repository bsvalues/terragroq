import Link from "next/link"
import {
  ArrowUpRight,
  Check,
  Clock3,
  FolderKanban,
  ShieldCheck,
} from "lucide-react"

import type { GoalTimelineDecisionRequest } from "@/components/goal-console/goal-timeline-read-model"
import { OutcomeFieldBackground } from "@/components/primary-home/outcome-field-background"
import { PrimaryHomeDecisionPanel } from "@/components/primary-home/primary-home-decision"
import { PrimaryHomeTechnicalDetails } from "@/components/primary-home/primary-home-technical-details"
import type {
  PrimaryHomeHealthState,
  PrimaryHomeModel,
} from "@/components/primary-home/primary-home-model"
import { cn } from "@/lib/utils"

const HEALTH_TONES: Record<PrimaryHomeHealthState, string> = {
  ADVANCING: "bg-[#54e0a3] shadow-[0_0_14px_rgba(84,224,163,0.42)]",
  BLOCKED: "bg-[#ff725f] shadow-[0_0_14px_rgba(255,114,95,0.35)]",
  AWAITING_REVIEW: "bg-[#59b8df] shadow-[0_0_14px_rgba(89,184,223,0.35)]",
  COMPLETE: "bg-[#d8dfd9]",
  UNKNOWN: "bg-[#66716c]",
}

const HEALTH_TEXT: Record<PrimaryHomeHealthState, string> = {
  ADVANCING: "text-[#54e0a3]",
  BLOCKED: "text-[#ff725f]",
  AWAITING_REVIEW: "text-[#59b8df]",
  COMPLETE: "text-[#d8dfd9]",
  UNKNOWN: "text-[#8e9994]",
}

function formatWhen(value: string | null) {
  if (!value) return "Time not recorded"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function operationVerb(state: PrimaryHomeHealthState) {
  if (state === "BLOCKED") return "Held"
  if (state === "AWAITING_REVIEW") return "Under review"
  if (state === "COMPLETE") return "Completed"
  if (state === "ADVANCING") return "In motion"
  return "Truth unavailable"
}

type PrimaryHomeFieldMode = "ACTIVE" | "READY" | "RECOVERY" | "BLOCKED" | "COMPLETE" | "UNKNOWN"

function fieldMode(model: PrimaryHomeModel): PrimaryHomeFieldMode {
  if (model.founderBriefing.health.state === "BLOCKED") return "BLOCKED"
  if (model.founderBriefing.health.state === "COMPLETE") return "COMPLETE"
  if (model.nextWithoutWilliam.mode === "CONTINUE_ACTIVE") return "ACTIVE"
  if (model.nextWithoutWilliam.mode === "ACTIVATE") return "READY"
  if (model.nextWithoutWilliam.mode === "RECOVER") return "RECOVERY"
  return "UNKNOWN"
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
  const hasCurrentOutcome = briefing.outcome !== null
  const projectCount = model.projectHorizon.length
  const mode = fieldMode(model)

  return (
    <main className="relative min-h-[calc(100vh-4rem)] min-w-0 overflow-hidden bg-[#0c0f10] text-[#edf1ed]">
      <OutcomeFieldBackground
        health={briefing.health.state}
        active={mode === "ACTIVE"}
      />

      <div className="relative z-10">
        <header className="flex min-h-14 items-center justify-between border-b border-[#2a3232]/70 px-5 sm:px-7 lg:px-10">
          <div className="flex min-w-0 items-center gap-3 text-xs text-[#8e9994]">
            <span className="size-2 rotate-45 border-2 border-[#54e0a3]" aria-hidden />
            <span className="truncate">{briefing.project ?? "WilliamOS"}</span>
            <span className="h-px w-6 bg-[#3c4745]" aria-hidden />
            <span>{operationVerb(briefing.health.state)}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-[#8e9994]" aria-live="polite">
              <span className={cn(
                "size-2 rounded-full",
                needsWilliam
                  ? "bg-[#ff725f] shadow-[0_0_14px_rgba(255,114,95,0.35)]"
                  : "bg-[#54e0a3] shadow-[0_0_14px_rgba(84,224,163,0.42)]",
              )} />
              <span>{needsWilliam ? "One decision needs you" : "Nothing needs you"}</span>
            </div>
            <PrimaryHomeTechnicalDetails details={model.technicalDetails} />
          </div>
        </header>

        {needsWilliam ? (
          <PrimaryHomeDecisionPanel decision={model.needsWilliam!} request={decisionRequest} />
        ) : hasCurrentOutcome && mode !== "READY" ? (
          <OperatingField model={model} mode={mode} />
        ) : (
          <ReadyField model={model} mode={mode} />
        )}

        <section
          className="border-t border-[#2a3232]/80 bg-[#0c0f10]/90 px-5 py-6 sm:px-7 lg:px-10"
          aria-labelledby="continuity-title"
        >
          <div className="mx-auto grid max-w-[90rem] gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.65fr)]">
            <div>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="size-4 text-[#54e0a3]" aria-hidden />
                  <h2 id="continuity-title" className="text-xs font-semibold">Recent continuity</h2>
                </div>
                <Link href="/runtime" className="text-xs text-[#8e9994] hover:text-[#edf1ed]">
                  Evidence
                </Link>
              </div>
              {model.recentOutcomes.length === 0 ? (
                <p className="border-t border-[#2a3232] py-4 text-sm text-[#8e9994]">
                  No completed outcomes are recorded yet.
                </p>
              ) : (
                <ol className="grid border-t border-[#2a3232] sm:grid-cols-2 xl:grid-cols-3">
                  {model.recentOutcomes.slice(0, 3).map((outcome, index) => (
                    <li
                      key={outcome.outcomeKey}
                      className={cn(
                        "min-w-0 border-b border-[#2a3232] py-4 sm:pr-5",
                        index > 0 && "sm:border-l sm:pl-5",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center border border-[#3c4745] text-[#54e0a3]">
                          <Check className="size-3" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-sm font-medium leading-5">{outcome.title}</p>
                          <p className="mt-1 text-xs leading-5 text-[#8e9994]">
                            {outcome.result ?? "Completed"} · {formatWhen(outcome.completedAt)}
                          </p>
                          {outcome.evidenceState !== "RECORDED" && (
                            <Link
                              href={outcome.technicalDetailHref}
                              className={cn(
                                "mt-1 inline-block text-xs font-medium",
                                outcome.evidenceState === "CONFLICTING" ? "text-[#ff725f]" : "text-[#59b8df]",
                              )}
                            >
                              Inspect evidence
                            </Link>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <FolderKanban className="size-4 text-[#59b8df]" aria-hidden />
                  <h2 className="text-xs font-semibold">Project horizon</h2>
                </div>
                <Link href="/projects" className="text-xs text-[#8e9994] hover:text-[#edf1ed]">
                  {projectCount} {projectCount === 1 ? "project" : "projects"}
                </Link>
              </div>
              {projectCount === 0 ? (
                <p className="border-t border-[#2a3232] py-4 text-sm text-[#8e9994]">
                  No project identity is proven by current evidence.
                </p>
              ) : (
                <ul className="border-t border-[#2a3232]">
                  {model.projectHorizon.slice(0, 3).map((project) => (
                    <li key={project.repo} className="flex items-start gap-3 border-b border-[#2a3232] py-3">
                      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", HEALTH_TONES[project.health.state])} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="truncate text-sm font-medium">{project.repo}</p>
                          <span className={cn("shrink-0 text-[11px]", HEALTH_TEXT[project.health.state])}>
                            {project.health.label}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-[#8e9994]">
                          {project.currentOutcome ?? project.latestResult?.result ?? "No current outcome recorded"}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#626c68]">
                          <span className={project.williamNeeded ? "text-[#ff725f]" : undefined}>
                            {project.williamNeeded ? "Needs William" : "No owner action"}
                          </span>
                          {project.latestResult && (
                            <span>Latest: {project.latestResult.result} · {formatWhen(project.latestResult.recordedAt)}</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function OperatingField({ model, mode }: { model: PrimaryHomeModel; mode: PrimaryHomeFieldMode }) {
  const briefing = model.founderBriefing
  const artifact = model.activeArtifact
  const contextLabel = mode === "ACTIVE"
    ? "Active outcome"
    : mode === "BLOCKED"
      ? "Held outcome"
      : mode === "RECOVERY"
        ? "Recovery in progress"
        : mode === "COMPLETE"
          ? "Completed outcome"
          : "Observed outcome"

  return (
    <section className="relative mx-auto min-h-[36rem] max-w-[90rem] px-5 py-8 sm:px-7 sm:py-10 lg:px-10">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(15rem,0.42fr)_minmax(0,1.58fr)] lg:gap-10 xl:grid-cols-[minmax(18rem,0.48fr)_minmax(38rem,1.52fr)] xl:gap-12">
        <div className="pt-2 lg:sticky lg:top-6">
          <p className={cn("font-mono text-[10px] uppercase", HEALTH_TEXT[briefing.health.state])}>
            {contextLabel}
          </p>
          <h1 className="mt-4 max-w-3xl text-[2rem] font-medium leading-[1.05] sm:text-[2.25rem] xl:text-[2.7rem]">
            {briefing.outcome}
          </h1>
          <div className="mt-7 border-t border-[#3c4745] pt-5 text-xs">
            <span className={cn("font-medium", HEALTH_TEXT[briefing.health.state])}>
              {briefing.health.label}
            </span>
            <p className="mt-2 leading-5 text-[#8e9994]">{briefing.health.detail}</p>
          </div>
        </div>

        <article className="relative min-h-[31rem] overflow-hidden border border-[#3c4745] bg-[#131718]/95 shadow-[0_32px_90px_rgba(0,0,0,0.38)]">
          <header className="flex min-h-14 items-center justify-between gap-4 border-b border-[#2a3232] px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center border border-[#3c4745] text-[#59b8df]">
                <ShieldCheck className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{artifact?.title ?? briefing.outcome}</p>
                <p className="text-[11px] text-[#8e9994]">
                  {artifact ? `${artifact.phase} · ${artifact.status}` : "No active Work Order is proven"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10px] uppercase text-[#8e9994]">
              <span className={cn("size-1.5 rounded-full", HEALTH_TONES[briefing.health.state])} />
              {operationVerb(briefing.health.state)}
            </div>
          </header>

          <div className="grid min-h-[23rem] content-between gap-12 p-6 sm:p-8">
            <div className="grid gap-7 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,0.48fr)]">
              <div>
                <p className="font-mono text-[10px] uppercase text-[#54e0a3]">Work artifact</p>
                <p className="mt-3 max-w-2xl text-2xl font-medium leading-8 sm:text-3xl sm:leading-10">
                  {artifact?.title ?? "No work artifact is active"}
                </p>
                <p className="mt-4 text-sm text-[#8e9994]">
                  Delivery: {artifact?.deliveryStatus.toLowerCase().replaceAll("_", " ") ?? "not proven"}
                </p>
              </div>
              <div className="border-t border-[#3c4745] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                <p className="font-mono text-[10px] uppercase text-[#626c68]">Continuity</p>
                {artifact?.checkpoints.length ? (
                  <ol className="mt-4 space-y-3">
                    {artifact.checkpoints.map((checkpoint, index) => (
                      <li key={`${checkpoint.state}-${index}`} className="flex items-start gap-2 text-xs">
                        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#59b8df]" />
                        <span>
                          <span className="block text-[#d8dfd9]">{checkpoint.state}</span>
                          {checkpoint.result && <span className="text-[#626c68]">{checkpoint.result}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-4 text-xs leading-5 text-[#626c68]">No validation checkpoint is recorded yet.</p>
                )}
              </div>
            </div>

            {artifact?.actor && (
              <div className="flex w-fit items-center gap-2 border border-[#3c4745] bg-[#0c0f10] px-3 py-2 text-xs">
                <span className="size-1.5 rounded-full bg-[#54e0a3] shadow-[0_0_12px_rgba(84,224,163,0.48)]" />
                <span>{artifact.actor}</span>
                <span className="text-[#626c68]">operating</span>
              </div>
            )}
          </div>

          <footer className="grid min-h-20 gap-3 border-t border-[#2a3232] px-5 py-4 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="border-l-2 border-[#54e0a3] pl-3">
              <span className="font-mono text-[9px] uppercase text-[#54e0a3]">Next without William</span>
              <p className="mt-1 text-sm font-medium">{model.nextWithoutWilliam.label}</p>
              {model.nextWithoutWilliam.reason !== model.nextWithoutWilliam.label && (
                <p className="mt-1 text-[#8e9994]">{model.nextWithoutWilliam.reason}</p>
              )}
            </div>
            <Link href={artifact?.detailHref ?? "/work-orders"} className="inline-flex shrink-0 items-center gap-2 font-medium hover:text-[#54e0a3]">
              Open artifact <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </footer>
        </article>
      </div>
    </section>
  )
}

function ReadyField({ model, mode }: { model: PrimaryHomeModel; mode: PrimaryHomeFieldMode }) {
  const readyOutcome = mode === "READY" ? model.founderBriefing.outcome : null
  return (
    <section className="mx-auto flex min-h-[36rem] max-w-5xl flex-col items-center justify-center px-5 py-16 text-center">
      <div className="relative mb-9 size-20 rotate-45 border border-[#3c4745]" aria-hidden>
        <span className="absolute inset-3 border border-[#2a3232]" />
        <span className="absolute inset-7 bg-[#54e0a3]" />
      </div>
      <p className="text-xs text-[#54e0a3]">WilliamOS is ready</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-medium leading-none sm:text-6xl">
        {readyOutcome ?? "No approved outcome is moving."}
      </h1>
      <p className="mt-6 max-w-2xl text-sm leading-6 text-[#8e9994] sm:text-base">
        {model.nextWithoutWilliam.reason}
      </p>
      <div className="mt-9 border-t border-[#3c4745] pt-5 text-xs text-[#8e9994]">
        Nothing needs your decision right now.
      </div>
    </section>
  )
}
