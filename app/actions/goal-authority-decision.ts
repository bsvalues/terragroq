"use server"

import { revalidatePath } from "next/cache"

import { getGoalTimeline } from "@/app/actions/goal-timeline"
import {
  type GoalAuthorityDecisionChoice,
  type GoalTimelineDecisionRequest,
} from "@/components/goal-console/goal-timeline-read-model"
import { recordOwnerAuthorityDecision as runtimeRecordOwnerAuthorityDecision } from "@/scripts/hermes-bridge/outcome-source.mjs"
import { getUserId } from "@/lib/session"

type RuntimeOwnerAuthorityDecisionInput = {
  outcomeId: number
  workOrderId: number
  terminalEventId: number
  ownerUserId: string
  choice: GoalAuthorityDecisionChoice
  expectedNextState: string
}

type RuntimeOwnerAuthorityDecisionResult = {
  replayed?: boolean
}

const recordOwnerAuthorityDecision = runtimeRecordOwnerAuthorityDecision as unknown as (
  input: RuntimeOwnerAuthorityDecisionInput,
) => Promise<RuntimeOwnerAuthorityDecisionResult>

export type GoalAuthorityDecisionActionInput = {
  request: GoalTimelineDecisionRequest
  choice: GoalAuthorityDecisionChoice
}

export type GoalAuthorityDecisionActionResult = {
  status: "RECORDED" | "REPLAYED" | "STALE" | "CONFLICT" | "INVALID" | "UNAUTHORIZED"
  choice: GoalAuthorityDecisionChoice | null
  message: string
}

function isChoice(value: unknown): value is GoalAuthorityDecisionChoice {
  return value === "APPROVE" || value === "DENY"
}

function requestBindingMatches(
  submitted: GoalTimelineDecisionRequest,
  current: GoalTimelineDecisionRequest,
): boolean {
  return submitted.goalId === current.goalId
    && submitted.goalRef === current.goalRef
    && submitted.outcomeId === current.outcomeId
    && submitted.outcomeRef === current.outcomeRef
    && submitted.workOrderId === current.workOrderId
    && submitted.workOrderRef === current.workOrderRef
    && submitted.terminalEventId === current.terminalEventId
    && submitted.terminalState === current.terminalState
    && submitted.terminalResult === current.terminalResult
    && submitted.blockedAction === current.blockedAction
    && submitted.authorityBoundary === current.authorityBoundary
    && submitted.expectedNextState === current.expectedNextState
    && submitted.ownerUserId === current.ownerUserId
    && submitted.consequences.approve === current.consequences.approve
    && submitted.consequences.deny === current.consequences.deny
    && submitted.choices.length === 2
    && submitted.choices[0] === "APPROVE"
    && submitted.choices[1] === "DENY"
}

function runtimeErrorCode(error: unknown): string | null {
  return error !== null && typeof error === "object" && "code" in error
    && typeof error.code === "string"
    ? error.code
    : null
}

export async function recordGoalAuthorityDecision(
  input: GoalAuthorityDecisionActionInput,
): Promise<GoalAuthorityDecisionActionResult> {
  let ownerUserId: string
  try {
    ownerUserId = await getUserId()
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        status: "UNAUTHORIZED",
        choice: null,
        message: "Sign in as the decision owner before recording an authority decision.",
      }
    }
    throw error
  }
  if (!input || typeof input !== "object" || !input.request) {
    return {
      status: "INVALID",
      choice: null,
      message: "A persisted decision request is required.",
    }
  }
  if (!isChoice(input.choice)) {
    return {
      status: "INVALID",
      choice: null,
      message: "Choose approve or deny.",
    }
  }

  const submitted = input.request
  if (
    typeof submitted !== "object"
    || submitted === null
    || !Array.isArray(submitted.choices)
    || typeof submitted.consequences !== "object"
    || submitted.consequences === null
  ) {
    return {
      status: "INVALID",
      choice: input.choice,
      message: "The decision request binding is incomplete.",
    }
  }
  if (submitted.ownerUserId !== ownerUserId) {
    return {
      status: "UNAUTHORIZED",
      choice: input.choice,
      message: "The decision actor must be the authenticated user.",
    }
  }
  if (!Number.isSafeInteger(submitted.goalId) || submitted.goalId < 1) {
    return {
      status: "INVALID",
      choice: input.choice,
      message: "The decision is not bound to a valid Goal.",
    }
  }

  const timeline = await getGoalTimeline(submitted.goalId)
  if (!timeline) {
    return {
      status: "STALE",
      choice: input.choice,
      message: "Decision request is stale; the Goal timeline no longer exists.",
    }
  }
  const current = timeline.decisionRequest

  if (submitted.status !== "ACTIONABLE" || !requestBindingMatches(submitted, current)) {
    return {
      status: "STALE",
      choice: input.choice,
      message: "Decision request is stale; the persisted timeline has changed.",
    }
  }
  if (current.status === "RECEIPT_RECORDED") {
    return {
      status: current.receipt.choice === input.choice ? "REPLAYED" : "CONFLICT",
      choice: input.choice,
      message: current.receipt.choice === input.choice
        ? "Authority decision was already recorded."
        : "Decision request conflicts with the recorded authority decision.",
    }
  }
  if (current.status !== "ACTIONABLE") {
    return {
      status: current.status === "CONFLICTING" ? "CONFLICT" : "STALE",
      choice: input.choice,
      message: current.status === "CONFLICTING"
        ? "Decision request conflicts with current persisted truth."
        : "Decision request is stale; the persisted timeline has changed.",
    }
  }
  if (
    current.workOrderId === null
    || current.terminalEventId === null
    || current.expectedNextState === null
  ) {
    return {
      status: "CONFLICT",
      choice: input.choice,
      message: "Decision request is missing its persisted Work Order, terminal event, or next state.",
    }
  }

  try {
    const recorded = await recordOwnerAuthorityDecision({
      outcomeId: current.outcomeId,
      workOrderId: current.workOrderId,
      terminalEventId: current.terminalEventId,
      ownerUserId,
      choice: input.choice,
      expectedNextState: current.expectedNextState,
    })
    if (recorded.replayed === true) {
      return {
        status: "REPLAYED",
        choice: input.choice,
        message: "Authority decision was already recorded.",
      }
    }
  } catch (error) {
    const code = runtimeErrorCode(error)
    if (code?.includes("REPLAY")) {
      return {
        status: "REPLAYED",
        choice: input.choice,
        message: "Authority decision was already recorded.",
      }
    }
    if (code?.includes("UNAUTHORIZED")) {
      return {
        status: "UNAUTHORIZED",
        choice: input.choice,
        message: "The decision is outside the authenticated user's authority scope.",
      }
    }
    if (code?.includes("INVALID")) {
      return {
        status: "INVALID",
        choice: input.choice,
        message: "The persisted authority decision binding is invalid.",
      }
    }
    if (code?.includes("STALE") || code?.includes("ACTIVE_LEASE")) {
      return {
        status: "STALE",
        choice: input.choice,
        message: code.includes("ACTIVE_LEASE")
          ? "Decision cannot be recorded while the Work Order has an active lease."
          : "Decision request is stale; the persisted terminal wall has changed.",
      }
    }
    if (code?.includes("CONFLICT") || code?.includes("CONSUMED")) {
      return {
        status: "CONFLICT",
        choice: input.choice,
        message: "Decision request conflicts with an existing persisted authority decision.",
      }
    }
    throw error
  }

  revalidatePath("/goal-console")
  return {
    status: "RECORDED",
    choice: input.choice,
    message: input.choice === "APPROVE" ? "Resume approval recorded." : "Deny decision recorded.",
  }
}
