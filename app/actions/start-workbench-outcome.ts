"use server"

import { startGoalOutcome } from "@/app/actions/goals"
import type {
  StartWorkbenchOutcomeInput,
  StartWorkbenchOutcomeResult,
} from "@/lib/workbench/outcome-start"

export async function startWorkbenchOutcome(
  input: StartWorkbenchOutcomeInput,
): Promise<StartWorkbenchOutcomeResult> {
  return startGoalOutcome(input)
}
