export const GOAL_TIMELINE_BATCH_SIZE = 25
export const GOAL_TIMELINE_LOAD_LIMIT = 50

export type MissingGoalTimelinePlan = Readonly<{
  batches: number[][]
  selectedGoalIds: number[]
  truncated: boolean
}>

export function planMissingGoalTimelines(
  queueGoalIds: Iterable<number>,
  knownGoalIds: Iterable<number>,
): MissingGoalTimelinePlan {
  const seen = new Set(knownGoalIds)
  const selected: number[] = []
  let truncated = false

  for (const goalId of queueGoalIds) {
    if (!Number.isSafeInteger(goalId) || goalId <= 0 || seen.has(goalId)) continue
    seen.add(goalId)
    if (selected.length === GOAL_TIMELINE_LOAD_LIMIT) {
      truncated = true
      break
    }
    selected.push(goalId)
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
): Promise<T[]> {
  const loaded: T[] = []
  for (const batch of batches) {
    if (batch.length === 0) continue
    loaded.push(...await loadBatch([...batch]))
  }
  return loaded
}
