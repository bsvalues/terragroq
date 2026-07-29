type ReorderRow = {
  outcomeKey: string
  lifecycleState: string
  version: number
}

const REORDERABLE_STATES = new Set(["suggested", "approved", "blocked"])

export function buildProtectedOutcomeReorderSnapshot({
  rows,
  outcomeKey,
  direction,
  protectedOutcomeKeys,
}: {
  rows: readonly ReorderRow[]
  outcomeKey: string
  direction: -1 | 1
  protectedOutcomeKeys: ReadonlySet<string>
}): Array<{ outcomeKey: string; expectedVersion: number }> | null {
  const snapshot = rows.filter((item) => (
    REORDERABLE_STATES.has(item.lifecycleState)
    || (item.lifecycleState === "active" && protectedOutcomeKeys.has(item.outcomeKey))
  ))
  const movable = snapshot.filter((item) => !protectedOutcomeKeys.has(item.outcomeKey))
  const currentIndex = movable.findIndex((item) => item.outcomeKey === outcomeKey)
  const destination = currentIndex + direction
  if (currentIndex < 0 || destination < 0 || destination >= movable.length) return null

  const currentSnapshotIndex = snapshot.findIndex(
    (item) => item.outcomeKey === movable[currentIndex].outcomeKey,
  )
  const destinationSnapshotIndex = snapshot.findIndex(
    (item) => item.outcomeKey === movable[destination].outcomeKey,
  )
  const next = [...snapshot]
  ;[next[currentSnapshotIndex], next[destinationSnapshotIndex]] = [
    next[destinationSnapshotIndex],
    next[currentSnapshotIndex],
  ]
  return next.map((item) => ({
    outcomeKey: item.outcomeKey,
    expectedVersion: item.version,
  }))
}
