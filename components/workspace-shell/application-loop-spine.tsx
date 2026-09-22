"use client"

import { Check, Circle, CircleAlert, CircleDot } from "lucide-react"

import type { ApplicationRuntimeState } from "./application-ui-contract"
import styles from "./application-loop-spine.module.css"

export type ApplicationLoopStepId = "create" | "start" | "ask" | "review"

/**
 * Contractual step states. Nothing is collapsed: a step is only `done` when the
 * underlying product state proves it.
 */
export type ApplicationLoopStepState = "done" | "current" | "next" | "blocked"

export type ApplicationLoopStep = Readonly<{
  id: ApplicationLoopStepId
  label: string
  detail: string
  state: ApplicationLoopStepState
}>

export type ApplicationLoopInput = Readonly<{
  projectName: string
  runtimeState: ApplicationRuntimeState | "checking" | null
  proposalStatus: string | null
  requestInProgress: boolean
}>

const TERMINAL_PROPOSAL_STATUSES = new Set(["APPLIED", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"])
const IN_PROGRESS_PROPOSAL_STATUSES = new Set(["PROPOSAL_IN_PROGRESS", "APPLY_IN_PROGRESS", "REJECT_IN_PROGRESS"])

/**
 * Derives the visible application loop from real product state only.
 * There is no stored step counter: every value below is recomputed from
 * `runtimeState` (the contained runtime truth) and the authoritative proposal
 * status, so the spine cannot report progress the product has not made.
 */
export function deriveApplicationLoopSteps(input: ApplicationLoopInput): readonly ApplicationLoopStep[] {
  const runtimeRunning = input.runtimeState === "running"
  const status = input.proposalStatus
  const terminal = status !== null && TERMINAL_PROPOSAL_STATUSES.has(status)
  const inProgress = status !== null && IN_PROGRESS_PROPOSAL_STATUSES.has(status)
  const readyForReview = status === "READY_FOR_REVIEW"

  const create: ApplicationLoopStep = {
    id: "create",
    label: "Create",
    detail: `${input.projectName} exists`,
    state: "done",
  }

  const start: ApplicationLoopStep = {
    id: "start",
    label: "Start",
    detail: runtimeRunning
      ? "Contained runtime running"
      : input.runtimeState === "checking" || input.runtimeState === null
        ? "Checking contained runtime"
        : "Contained runtime stopped",
    state: runtimeRunning ? "done" : "current",
  }

  const ask: ApplicationLoopStep = {
    id: "ask",
    label: "Ask",
    detail: input.requestInProgress
      ? "Preparing a governed proposal"
      : terminal || inProgress || readyForReview
        ? "Request sent"
        : runtimeRunning
          ? "Describe one visible change"
          : "Start the contained runtime first",
    state: input.requestInProgress || terminal || inProgress || readyForReview
      ? "done"
      : runtimeRunning
        ? "current"
        : "blocked",
  }

  const review: ApplicationLoopStep = {
    id: "review",
    label: "Review & Apply",
    detail: terminal
      ? "Receipt retained below"
      : readyForReview
        ? "Proposal ready for your decision"
        : inProgress
          ? "Decision in progress"
          : "No proposal to review yet",
    state: terminal ? "done" : readyForReview || inProgress ? "current" : "next",
  }

  return [create, start, ask, review]
}

function StepGlyph({ state }: Readonly<{ state: ApplicationLoopStepState }>) {
  if (state === "done") return <Check size={12} aria-hidden />
  if (state === "current") return <CircleDot size={12} aria-hidden />
  if (state === "blocked") return <CircleAlert size={12} aria-hidden />
  return <Circle size={12} aria-hidden />
}

/**
 * The application loop spine: (1) Create -> (2) Start -> (3) Ask -> (4) Review & Apply.
 * Each actionable step is a real click target for the step it names.
 */
export function ApplicationLoopSpine({
  projectName,
  runtimeState,
  proposalStatus,
  requestInProgress,
  onStart,
  onAsk,
  onReview,
}: ApplicationLoopInput & Readonly<{
  onStart?: () => void
  onAsk?: () => void
  onReview?: () => void
}>) {
  const steps = deriveApplicationLoopSteps({
    projectName,
    runtimeState,
    proposalStatus,
    requestInProgress,
  })
  const handlers: Readonly<Record<ApplicationLoopStepId, (() => void) | undefined>> = {
    create: undefined,
    start: onStart,
    ask: onAsk,
    review: onReview,
  }

  return (
    <nav className={styles.spine} aria-label={`${projectName} application loop`}>
      <ol className={styles.steps}>
        {steps.map((step, index) => {
          const handler = handlers[step.id]
          const content = (
            <>
              <span className={styles.marker}>
                <StepGlyph state={step.state} />
              </span>
              <span className={styles.text}>
                <strong>{`${index + 1}. ${step.label}`}</strong>
                <span className={styles.detail}>{step.detail}</span>
              </span>
            </>
          )
          return (
            <li key={step.id} className={styles.step} data-state={step.state}>
              {handler ? (
                <button
                  type="button"
                  className={styles.stepButton}
                  data-state={step.state}
                  aria-current={step.state === "current" ? "step" : undefined}
                  onClick={handler}
                >
                  {content}
                </button>
              ) : (
                <span
                  className={styles.stepStatic}
                  data-state={step.state}
                  aria-current={step.state === "current" ? "step" : undefined}
                >
                  {content}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
