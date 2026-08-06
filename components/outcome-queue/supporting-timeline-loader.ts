export const GOAL_TIMELINE_BATCH_SIZE = 25
export const GOAL_TIMELINE_LOAD_LIMIT = 50

const TERMINAL_OUTCOME_STATES = new Set(["completed", "declined", "superseded"])

export type SupportingTimelineQueueRow = Readonly<{
  goalId: number | null
  isActive: boolean
  isNextEligible: boolean
  lifecycleState: string
}>

export type MissingGoalTimelinePlan = Readonly<{
  batches: number[][]
  selectedGoalIds: number[]
  truncated: boolean
}>

export type GoalTimelineBatchLoadResult<T> = Readonly<{
  records: T[]
  failedGoalIds: number[]
}>

export function prioritizeQueueGoalIds(
  rows: readonly SupportingTimelineQueueRow[],
): number[] {
  const activeOrNext: number[] = []
  const otherNonTerminal: number[] = []
  const terminal: number[] = []

  for (const row of rows) {
    const goalId = row.goalId
    if (goalId === null || !Number.isSafeInteger(goalId) || goalId <= 0) continue

    if (row.isActive || row.isNextEligible) {
      activeOrNext.push(goalId)
    } else if (!TERMINAL_OUTCOME_STATES.has(row.lifecycleState)) {
      otherNonTerminal.push(goalId)
    } else {
      terminal.push(goalId)
    }
  }

  const seen = new Set<number>()
  return [...activeOrNext, ...otherNonTerminal, ...terminal].filter((goalId) => {
    if (seen.has(goalId)) return false
    seen.add(goalId)
    return true
  })
}

export function planMissingGoalTimelines(
  queueGoalIds: Iterable<number>,
  knownGoalIds: Iterable<number>,
  reservedGoalIds: Iterable<number> = [],
): MissingGoalTimelinePlan {
  const seen = new Set(knownGoalIds)
  const selected: number[] = []
  let truncated = false

  selection: for (const goalIds of [reservedGoalIds, queueGoalIds]) {
    for (const goalId of goalIds) {
      if (!Number.isSafeInteger(goalId) || goalId <= 0 || seen.has(goalId)) continue
      seen.add(goalId)
      if (selected.length === GOAL_TIMELINE_LOAD_LIMIT) {
        truncated = true
        break selection
      }
      selected.push(goalId)
    }
  }

  const batches: number[][] = []
  for (let index = 0; index < selected.length; index += GOAL_TIMELINE_BATCH_SIZE) {
    batches.push(selected.slice(index, index + GOAL_TIMELINE_BATCH_SIZE))
  }
  return {
    batches,
    selectedGoalIds: selected,
    truncated,
  }
}

export async function loadGoalTimelineBatches<T>(
  batches: readonly (readonly number[])[],
  loadBatch: (goalIds: number[]) => Promise<readonly T[]>,
): Promise<GoalTimelineBatchLoadResult<T>> {
  const records: T[] = []
  const failedGoalIds: number[] = []

  for (const batch of batches) {
    if (batch.length === 0) continue
    try {
      records.push(...await loadBatch([...batch]))
    } catch {
      failedGoalIds.push(...batch)
    }
  }

  return { records, failedGoalIds }
}

export function unavailableGoalTimelineIds(
  selectedGoalIds: readonly number[],
  returnedGoalIds: Iterable<number>,
  failedGoalIds: Iterable<number>,
): number[] {
  const returned = new Set(returnedGoalIds)
  const failed = new Set(failedGoalIds)
  return selectedGoalIds.filter((goalId) => (
    failed.has(goalId) || !returned.has(goalId)
  ))
}
