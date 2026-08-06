export type InitialGoalRequestResolution = Readonly<{
  lastRequestedGoalId: number | null
  goalIdToApply: number | null
}>

export function resolveInitialGoalRequest(
  lastRequestedGoalId: number | null,
  requestedGoalId: number | null,
  requestedGoalExists: boolean,
): InitialGoalRequestResolution {
  if (requestedGoalId === null || !requestedGoalExists) {
    return { lastRequestedGoalId: null, goalIdToApply: null }
  }
  if (lastRequestedGoalId === requestedGoalId) {
    return { lastRequestedGoalId, goalIdToApply: null }
  }
  return {
    lastRequestedGoalId: requestedGoalId,
    goalIdToApply: requestedGoalId,
  }
}
