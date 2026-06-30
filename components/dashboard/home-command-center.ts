import type { DashboardStats } from "@/components/dashboard/operator-start"

export type HomeStatusCard = {
  label: string
  value: string
  description: string
  href: string
}

export type HomeCommandCenter = {
  title: "WilliamOS Home"
  eyebrow: "Primary Operator Command Center"
  description: string
  primaryAction: {
    label: "Review next move"
    href: "/work-orders"
  }
  statusCards: HomeStatusCard[]
  nextMove: {
    label: string
    href: string
    reason: string
  }
  safety: {
    readOnly: true
    startsHermes: false
    activatesBrainCouncil: false
    executesWorkOrders: false
    deploys: false
    writesProduction: false
    changesAuthority: false
  }
}

export function getHomeCommandCenter(stats: DashboardStats): HomeCommandCenter {
  const blockedWork =
    stats.openWork > 0
      ? `${stats.openWork} active`
      : "none"

  return {
    title: "WilliamOS Home",
    eyebrow: "Primary Operator Command Center",
    description:
      "A private command environment for attention, readiness, evidence, and the next governed move.",
    primaryAction: {
      label: "Review next move",
      href: "/work-orders",
    },
    statusCards: [
      {
        label: "Active Work",
        value: blockedWork,
        description: "Open Work Orders define the current governed attention queue.",
        href: stats.openWork > 0 ? "/work-orders" : "/goal-console",
      },
      {
        label: "Ready Next",
        value: "Classify",
        description: "New intent starts in Next Objective before any mutation is allowed.",
        href: "/goal-console",
      },
      {
        label: "Blocked Decisions",
        value: String(stats.openDecisions),
        description: "Authority-sensitive calls remain visible until explicitly resolved.",
        href: "/decisions",
      },
      {
        label: "Evidence Required",
        value: "Tracked",
        description: "Evidence proves validation, production posture, and completion claims.",
        href: "/audit",
      },
      {
        label: "Systems",
        value: "Ready",
        description: "Health and auth readiness remain visible without changing configuration.",
        href: "/runtime",
      },
      {
        label: "Council",
        value: "Advisory",
        description: "Brain Council prepares reasoning and evidence without execution authority.",
        href: "/brain-council",
      },
      {
        label: "Worker Dock",
        value: "Inactive",
        description: "Hermes remains preview-only until explicit authority grants execution.",
        href: "/brain-council",
      },
      {
        label: "Agent Forge",
        value: "Proposal-only",
        description: "Capabilities, packets, and skill definitions prepare work without running it.",
        href: "/agent-forge",
      },
      {
        label: "Active Project",
        value: "TerraFusion OS",
        description: "Project systems stay inside WilliamOS under Work Orders and Evidence.",
        href: "/projects",
      },
    ],
    nextMove:
      stats.openWork > 0
        ? {
            label: "Review active work orders",
            href: "/work-orders",
            reason: "Open work exists. Resolve or classify it before starting another lane.",
          }
        : {
            label: "Classify the next objective",
            href: "/goal-console",
            reason: "No active work is blocking the Primary Operator briefing.",
          },
    safety: {
      readOnly: true,
      startsHermes: false,
      activatesBrainCouncil: false,
      executesWorkOrders: false,
      deploys: false,
      writesProduction: false,
      changesAuthority: false,
    },
  }
}
