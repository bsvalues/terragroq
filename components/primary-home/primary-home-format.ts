export function formatPrimaryHomeTime(value: string | null): string {
  if (!value) return "Time not recorded"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Time not recorded"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}
