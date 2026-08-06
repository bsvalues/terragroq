import { createElement } from "react"

export type SupportingTimelineCoverage = Readonly<{
  coveredGoalIds: readonly number[]
  unavailableGoalIds: readonly number[]
  truncated: boolean
}>

export type SupportingRecordCoverageStatus = "DEFERRED" | "UNAVAILABLE"

export function supportingRecordCoverageStatus(
  goalId: number | null,
  coverage: SupportingTimelineCoverage | undefined,
): SupportingRecordCoverageStatus | null {
  if (goalId === null || !coverage) return null
  if (coverage.unavailableGoalIds.includes(goalId)) return "UNAVAILABLE"
  return coverage.truncated && !coverage.coveredGoalIds.includes(goalId)
    ? "DEFERRED"
    : null
}

export function SupportingRecordCoverageNotice({
  goalId,
  coverage,
}: {
  goalId: number | null
  coverage: SupportingTimelineCoverage | undefined
}) {
  const status = supportingRecordCoverageStatus(goalId, coverage)
  if (status === null) return null
  const deferred = status === "DEFERRED"

  return createElement(
    "div",
    {
      role: "status",
      "data-supporting-record-coverage": status.toLowerCase(),
      className: "mt-3 rounded-md border border-dashed border-warning/40 bg-warning/10 p-3",
    },
    createElement(
      "p",
      { className: "text-xs font-medium text-warning" },
      deferred ? "Supporting-record detail deferred" : "Supporting-record detail unavailable",
    ),
    createElement(
      "p",
      { className: "mt-1 text-[11px] leading-relaxed text-muted-foreground" },
      deferred
        ? "This row falls beyond the bounded Goal timeline enrichment window. Existing Evidence, Trace, or Audit records may still exist; missing links are not evidence that no records exist."
        : "The bounded exact Goal timeline read did not resolve one projection for this row. Existing Evidence, Trace, or Audit records may still exist; no substitute records were inferred.",
    ),
  )
}
