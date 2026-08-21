"use server"

import { startGoalOutcome } from "@/app/actions/goals"
import { getUserId } from "@/lib/session"
import { isIssue911ReliabilityOutcomeIntent } from "@/lib/workbench/registered-outcome-intent"
import {
  normalizeOutcomeStartInput,
  type StartWorkbenchOutcomeInput,
  type StartWorkbenchOutcomeResult,
} from "@/lib/workbench/outcome-start"

export async function startWorkbenchOutcome(
  input: StartWorkbenchOutcomeInput,
): Promise<StartWorkbenchOutcomeResult> {
  const normalized = normalizeOutcomeStartInput(input)
  if (!isIssue911ReliabilityOutcomeIntent(normalized.intent)) {
    await getUserId()
    return {
      status: "INVALID_INTENT",
      reason: "ROUTE_NOT_START_OUTCOME",
      projectId: normalized.projectId,
      threadId: null,
      goalId: null,
      outcomeKey: null,
      root: null,
      intakeTruth: "unknown",
      ownershipTruth: "unavailable",
      approvalGrantedByIntake: false,
      authorityGrantedByIntake: false,
      executionAuthorizedByIntake: false,
    }
  }
  return startGoalOutcome(normalized)
}
