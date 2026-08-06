export function requestedGoalId(
  value: string | string[] | undefined,
): number | null {
  if (Array.isArray(value) && value.length !== 1) return null
  const candidate = (Array.isArray(value) ? value[0] : value)?.trim()
  if (!candidate || !/^[1-9]\d*$/.test(candidate)) return null
  const parsed = Number(candidate)
  return Number.isSafeInteger(parsed) ? parsed : null
}
