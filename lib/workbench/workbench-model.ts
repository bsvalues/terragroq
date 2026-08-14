import type { ActivityFeed, ActivityItem } from "@/lib/operator/activity"
import type { ExecutionAttempt, OperatorState, ProjectResource } from "@/lib/operator/operator-state"

export type WorkbenchThreadState = "working" | "waiting" | "completed" | "stopped" | "idle"

export type WorkbenchArtifact = {
  id: string
  kind: "delivery" | "evidence" | "decision" | "change"
  label: string
  detail: string | null
}

export type WorkbenchThread = {
  id: string
  workOrderId: number
  ref: string
  title: string
  projectKey: null
  state: WorkbenchThreadState
  status: string
  latestAt: string | null
  unread: boolean
  attempts: ExecutionAttempt[]
  activity: ActivityItem[]
  artifacts: WorkbenchArtifact[]
}

export type WorkbenchProject = {
  key: string
  name: string
  lifecycle: "active" | "standby" | "archived"
  resources: ProjectResource[]
  threadIds: string[]
}

export type WorkbenchTool = {
  href: string
  label: string
  verb: "Ask" | "Do" | "Inspect" | "Steer" | "System"
  description: string
}

export type WorkbenchModel = {
  installation: string
  observedAt: string
  projects: WorkbenchProject[]
  threads: WorkbenchThread[]
  tools: WorkbenchTool[]
  systems: OperatorState["systems"]
  needsWilliam: OperatorState["needsWilliam"]
  now: OperatorState["now"]
  knowledge: OperatorState["knowledge"]
  activity: ActivityItem[]
  activityTruth: Pick<ActivityFeed, "truthState" | "latestEventAt" | "observedAt" | "churnCollapsed">
}

export const WORKBENCH_TOOLS: WorkbenchTool[] = [
  { href: "/chat", label: "Ask WilliamOS", verb: "Ask", description: "Continue a direct working conversation." },
  { href: "/goal-console", label: "Create outcome", verb: "Do", description: "Turn intent into a governed outcome." },
  { href: "/work-orders", label: "Execution controls", verb: "Do", description: "Inspect, steer, or stop governed work." },
  { href: "/audit", label: "Evidence", verb: "Inspect", description: "Review proof and acceptance evidence." },
  { href: "/trace", label: "Trace", verb: "Inspect", description: "Inspect technical execution lineage." },
  { href: "/memory", label: "Memory", verb: "Inspect", description: "Inspect durable owner memory." },
  { href: "/corpus", label: "Knowledge", verb: "Inspect", description: "Inspect indexed source material." },
  { href: "/brain-council", label: "Brain Council", verb: "Steer", description: "Request contextual multi-perspective review." },
  { href: "/decisions", label: "Decisions", verb: "Steer", description: "Review recorded decisions." },
  { href: "/doctrine", label: "Doctrine", verb: "Steer", description: "Review binding operating rules." },
  { href: "/governance", label: "Governance", verb: "Steer", description: "Inspect governance history and authority." },
  { href: "/hermes", label: "HERMES", verb: "System", description: "Inspect coordinator detail." },
  { href: "/runtime", label: "Runtime", verb: "System", description: "Inspect current runtime truth." },
  { href: "/agent-forge", label: "Agent Forge", verb: "System", description: "Inspect worker capability definitions." },
  { href: "/academy", label: "Academy", verb: "Inspect", description: "Open operator reference material." },
]

function threadState(status: string, attempts: ExecutionAttempt[]): WorkbenchThreadState {
  if (attempts.some((attempt) => attempt.attemptStatus === "active")) return "working"
  if (["blocked", "review", "proposed", "approved"].includes(status)) return "waiting"
  if (status === "closed" || attempts.some((attempt) => attempt.attemptStatus === "delivered")) return "completed"
  if (status === "aborted" || attempts.some((attempt) => attempt.attemptStatus === "terminal")) return "stopped"
  return "idle"
}

function artifactsFor(attempts: ExecutionAttempt[]): WorkbenchArtifact[] {
  const artifacts = new Map<string, WorkbenchArtifact>()
  for (const attempt of attempts) {
    if (!attempt.delivery) continue
    const label = attempt.delivery.prNumber ? `PR #${attempt.delivery.prNumber}` : "Delivery"
    const detail = attempt.delivery.mergeSha
      ? `merge ${attempt.delivery.mergeSha.slice(0, 7)}`
      : attempt.delivery.branch
        ? `branch ${attempt.delivery.branch}`
        : null
    artifacts.set(label, { id: `delivery:${label}`, kind: "delivery", label, detail })
  }
  return [...artifacts.values()]
}

export function buildWorkbenchModel(state: OperatorState, activity: ActivityFeed): WorkbenchModel {
  const threads = state.work.value.map((work) => {
    const ref = work.ref ?? `work-order:${work.id}`
    const attempts = state.executions.value.filter((attempt) => attempt.workOrderRef === ref)
    const matchingActivity = activity.items.filter((item) => item.ref === ref || item.detail?.includes(ref))
    const latestAt = matchingActivity[0]?.at ?? (work.closedAt ? new Date(work.closedAt).toISOString() : null)
    const status = work.status ?? "unknown"
    return {
      id: `work:${work.id}`,
      workOrderId: work.id,
      ref,
      title: work.title ?? ref,
      projectKey: null,
      state: threadState(status, attempts),
      status,
      latestAt,
      unread: false,
      attempts,
      activity: matchingActivity,
      artifacts: artifactsFor(attempts),
    } satisfies WorkbenchThread
  }).sort((left, right) => {
    const priority = { working: 0, waiting: 1, idle: 2, completed: 3, stopped: 4 }
    return priority[left.state] - priority[right.state] || String(right.latestAt).localeCompare(String(left.latestAt))
  })

  return {
    installation: state.installation,
    observedAt: state.now.observedAt,
    projects: state.projects.value.map((project) => ({ ...project, threadIds: [] })),
    threads,
    tools: WORKBENCH_TOOLS,
    systems: state.systems,
    needsWilliam: state.needsWilliam,
    now: state.now,
    knowledge: state.knowledge,
    activity: activity.items,
    activityTruth: {
      truthState: activity.truthState,
      latestEventAt: activity.latestEventAt,
      observedAt: activity.observedAt,
      churnCollapsed: activity.churnCollapsed,
    },
  }
}
