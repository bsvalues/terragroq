import type { DashboardStats } from "@/components/dashboard/operator-start"

export type HomeStatusCard = {
  label: string
  value: string
  description: string
  href: string
}

export type HomeBriefingLane = {
  label: string
  value: string
  description: string
  href: string
  tone: "attention" | "stable" | "authority"
}

export type HomeSystemPosture = {
  label: string
  posture: string
  description: string
  href: string
}

export type HomeCommandCenter = {
  title: "WilliamOS Home"
  eyebrow: "Primary Operator Command Center"
  description: string
  thesis: string
  primaryAction: {
    label: "Review next move"
    href: "/work-orders"
  }
  briefing: {
    status: "Ready" | "Attention"
    summary: string
    detail: string
  }
  lanes: HomeBriefingLane[]
  statusCards: HomeStatusCard[]
  systemPosture: HomeSystemPosture[]
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
  const hasAttention = stats.openWork > 0 || stats.openDecisions > 0

  return {
    title: "WilliamOS Home",
    eyebrow: "Primary Operator Command Center",
    description:
      "A private command environment for attention, readiness, evidence, and the next governed move.",
    thesis:
      "Home is the Primary briefing: it shows what needs attention, what is stable, what is blocked, and what WilliamOS recommends next.",
    primaryAction: {
      label: "Review next move",
      href: "/work-orders",
    },
    briefing: hasAttention
      ? {
          status: "Attention",
          summary: "Operator attention required",
          detail:
            "WilliamOS has active work or unresolved decisions. Review the governed queue before opening another lane.",
        }
      : {
          status: "Ready",
          summary: "No active work is blocking Home",
          detail:
            "Core registers are available. Classify the next objective when the Primary is ready to move.",
        },
    lanes: [
      {
        label: "Attention",
        value: stats.openWork > 0 ? `${stats.openWork} work order${stats.openWork === 1 ? "" : "s"}` : "clear",
        description:
          stats.openWork > 0
            ? "Active Work Orders should be reviewed before new mutation starts."
            : "No active Work Order is currently requesting Primary attention.",
        href: stats.openWork > 0 ? "/work-orders" : "/goal-console",
        tone: "attention",
      },
      {
        label: "Stable",
        value: "systems visible",
        description:
          "Runtime, auth readiness, and production posture stay observable without changing configuration.",
        href: "/runtime",
        tone: "stable",
      },
      {
        label: "Blocked",
        value: stats.openDecisions > 0 ? `${stats.openDecisions} decision${stats.openDecisions === 1 ? "" : "s"}` : "none",
        description:
          stats.openDecisions > 0
            ? "Proposed decisions remain blocked until the Primary resolves them."
            : "No proposed decision is currently waiting on authority.",
        href: "/decisions",
        tone: "authority",
      },
    ],
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
    systemPosture: [
      {
        label: "Brain Council",
        posture: "Advisory",
        description:
          "Prepares reasoning, evidence, and recommendations without autonomous execution.",
        href: "/brain-council",
      },
      {
        label: "Hermes Worker Dock",
        posture: "Inactive",
        description:
          "Execution remains blocked until authority gates explicitly permit it.",
        href: "/brain-council",
      },
      {
        label: "Evidence",
        posture: "Read-only",
        description:
          "Proof trails show validation, production posture, and completion claims.",
        href: "/audit",
      },
      {
        label: "Access Grants",
        posture: "Disabled",
        description:
          "Scoped access routes exist, but issuance and acceptance remain owner-gated.",
        href: "/operator",
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
