function hasLabel(issue, name) {
  return issue.labels.some((label) => (typeof label === "string" ? label : label.name) === name)
}

export function chooseNextWorkOrder(issues) {
  return issues
    .filter((issue) => hasLabel(issue, "williamos:ready"))
    .filter((issue) => !hasLabel(issue, "williamos:blocked") && !hasLabel(issue, "williamos:leased"))
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.number - right.number)[0] ?? null
}

export function buildLease({ issueNumber, runId, attempt, now }) {
  return {
    schemaVersion: 1,
    leaseId: `wo-${issueNumber}-run-${runId}-attempt-${attempt}`,
    issueNumber,
    runId,
    attempt,
    status: "LEASED",
    leasedAt: now,
  }
}

export function isLeaseExpired(leasedAt, now, ttlMinutes) {
  return Date.parse(now) - Date.parse(leasedAt) > ttlMinutes * 60_000
}

export function buildCheckpoint({ leaseId, state, detail, at }) {
  return { schemaVersion: 1, leaseId, state, detail, at }
}

export function evaluatePullRequestGate({ legacyStatuses, checkRuns, unresolvedThreads }) {
  if (unresolvedThreads > 0) return { decision: "REMEDIATE", reason: "UNRESOLVED_REVIEW_THREADS" }
  const failedCheck = checkRuns.some((check) => check.status === "completed" && !["success", "neutral", "skipped"].includes(check.conclusion))
  const failedStatus = legacyStatuses.some((status) => !["success", "pending"].includes(status.state))
  if (failedCheck || failedStatus) return { decision: "REMEDIATE", reason: "FAILED_CHECK" }
  const pendingCheck = checkRuns.length === 0 || checkRuns.some((check) => check.status !== "completed")
  const pendingStatus = legacyStatuses.some((status) => status.state === "pending")
  if (pendingCheck || pendingStatus) return { decision: "WAIT" }
  return { decision: "MERGE" }
}
