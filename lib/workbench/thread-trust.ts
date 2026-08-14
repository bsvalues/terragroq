import type { WorkbenchExecutionProjection } from "@/lib/workbench/execution-projection"

export type WorkbenchThreadTrustStatus =
  | "owned"
  | "awaiting_authority"
  | "authorized"
  | "acquired"
  | "working"
  | "validating"
  | "review"
  | "recovering"
  | "completed"
  | "unavailable"

export type WorkbenchThreadTrust = Readonly<{
  status: WorkbenchThreadTrustStatus
  label: string
  detail: string
  outcomeKey: string | null
  canStart: boolean
}>

const terminalStates = new Set(["COMPLETE", "COMPLETED", "DELIVERED", "MERGED"])
const workingStates = new Set(["WORKING", "RUNNING", "EXECUTING", "IMPLEMENTING"])

type ActiveStage = "working" | "validating" | "review" | "recovering"

function normalized(value: string | null | undefined): string {
  return value?.trim().replaceAll("-", "_").replaceAll(" ", "_").toUpperCase() ?? ""
}

function trust(status: WorkbenchThreadTrustStatus, label: string, detail: string, outcomeKey: string | null, canStart = false): WorkbenchThreadTrust {
  return { status, label, detail, outcomeKey, canStart }
}

function latestActiveStage(projection: WorkbenchExecutionProjection): ActiveStage | null {
  const candidates: Array<{ stage: ActiveStage; at: string }> = []
  const attempt = projection.attempts.at(-1)
  const attemptState = normalized(attempt?.currentState)
  if (attempt?.updatedAt) {
    if (workingStates.has(attemptState)) candidates.push({ stage: "working", at: attempt.updatedAt })
    else if (attemptState.includes("VALIDAT")) candidates.push({ stage: "validating", at: attempt.updatedAt })
    else if (attemptState.includes("REVIEW")) candidates.push({ stage: "review", at: attempt.updatedAt })
    else if (attemptState.includes("RECOVER") || attemptState.includes("REMEDIAT")) candidates.push({ stage: "recovering", at: attempt.updatedAt })
  }
  for (const item of projection.validations) candidates.push({ stage: "validating", at: item.occurredAt })
  for (const item of projection.reviews) candidates.push({ stage: "review", at: item.occurredAt })
  for (const item of [...projection.remediations, ...projection.recoveries]) candidates.push({ stage: "recovering", at: item.occurredAt })
  return candidates.sort((left, right) => left.at.localeCompare(right.at)).at(-1)?.stage ?? null
}

export function summarizeWorkbenchThreadTrust(
  projection: WorkbenchExecutionProjection,
  repositoryEligible: boolean,
): WorkbenchThreadTrust {
  if (!repositoryEligible) {
    return trust("unavailable", "Start work unavailable", "No supported primary repository is bound to this Project.", null)
  }
  if (projection.availability !== "available" || projection.coverage.conflicts.length > 0) {
    return trust("unavailable", "Start work unavailable", "Exact persisted execution custody is unavailable or conflicted for this Thread.", null)
  }
  if (projection.work.outcomes.length !== 1) {
    return trust("unavailable", "Start work unavailable", "Exactly one persisted outcome must be rooted in this Thread.", null)
  }

  const outcome = projection.work.outcomes[0]
  const outcomeState = normalized(outcome.state)
  const hasExpiredLease = projection.agents.some((agent) => agent.kind === "lease" && normalized(agent.state) === "EXPIRED")
  const activeStage = latestActiveStage(projection)

  if (terminalStates.has(outcomeState) || projection.deliveries.some((item) => terminalStates.has(normalized(item.state)))) {
    return trust("completed", "Completed", "Persisted delivery evidence marks this outcome complete.", outcome.id)
  }
  if ((projection.freshness.state === "stale" && (outcomeState === "ACTIVE" || projection.work.workOrders.length > 0)) || hasExpiredLease) {
    return trust("recovering", "Recovering", "Current work evidence is stale or its recorded lease expired. WilliamOS is reconciling persisted state.", outcome.id)
  }
  if (activeStage === "recovering") {
    return trust("recovering", "Recovering", "Persisted evidence places the selected work in bounded recovery or remediation.", outcome.id)
  }
  if (activeStage === "review") {
    return trust("review", "Review", "Persisted evidence places the selected work in review.", outcome.id)
  }
  if (activeStage === "validating") {
    return trust("validating", "Validating", "Persisted evidence places the selected work in validation.", outcome.id)
  }
  if (projection.freshness.state === "fresh" && activeStage === "working") {
    return trust("working", "Working", "A fresh runtime checkpoint is tied to this exact outcome and work attempt.", outcome.id)
  }
  if (projection.work.workOrders.length > 0 || projection.agents.some((agent) => agent.kind === "acquisition" || agent.kind === "lease")) {
    return trust("acquired", "Acquired", "Durable acquisition or lease custody is recorded. This does not prove process liveness.", outcome.id)
  }
  if (["APPROVED", "AUTHORIZED", "AUTHORIZED_FOR_ACQUISITION"].includes(outcomeState)) {
    return trust("authorized", "Authorized", "Acquisition is authorized, but no worker is known to be running.", outcome.id)
  }
  if (outcomeState === "SUGGESTED") {
    return trust("awaiting_authority", "Awaiting authority", "WilliamOS owns this outcome and is waiting for your explicit Start work decision.", outcome.id, true)
  }
  return trust("owned", "Owned", "This outcome is durably owned by the selected Project Thread.", outcome.id)
}
