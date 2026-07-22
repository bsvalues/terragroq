import type { DashboardStats } from "@/components/dashboard/operator-start"
import { getLocalOperatorSurface } from "@/components/local/local-operator-surface"
import {
  LOCAL_OMEN_PHASE_ROLLUP,
  SHELL_WOE_ATTENTION_MODEL,
  SHELL_WOE_AUTHORITY_BLOCKERS,
  SHELL_WOE_NEXT_BATCH,
  SHELL_WOE_SAFETY,
} from "@/components/shell/shell-woe-resume-surface"

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

export type HomeWorkRadarItem = {
  ref: string
  title: string
  status: string
  result: string | null
  detail: string
  href: "/work-orders"
}

export type HomeWorkRadarLane = {
  label: "Now" | "Held" | "Landed"
  title: "Active work" | "Blockers" | "Recent outcomes"
  description: string
  tone: "active" | "blocked" | "complete"
  count: number
  items: HomeWorkRadarItem[]
  emptyState: string
}

export type HomeWorkRadar = {
  eyebrow: "Operational radar"
  title: "Now, held, landed"
  description: string
  activeWork: HomeWorkRadarLane
  blockers: HomeWorkRadarLane
  recentOutcomes: HomeWorkRadarLane
}

type HomeWorkRadarIdentity = {
  id: number
  ref: string | null
  title: string
  status: string
}

export type HomeWorkRadarActiveItem = HomeWorkRadarIdentity & {
  updatedAt: Date
}

export type HomeWorkRadarBlockedItem = HomeWorkRadarIdentity & {
  description: string | null
  stopConditions: string[]
}

export type HomeWorkRadarOutcomeItem = HomeWorkRadarIdentity & {
  result: string | null
  closedAt: Date | null
  completedAt: Date | null
  updatedAt: Date
}

export type HomeWorkRadarSource = {
  activeWork: {
    count: number
    items: HomeWorkRadarActiveItem[]
  }
  blockers: {
    count: number
    items: HomeWorkRadarBlockedItem[]
  }
  recentOutcomes: {
    count: number
    items: HomeWorkRadarOutcomeItem[]
  }
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
  workRadar: HomeWorkRadar
  statusCards: HomeStatusCard[]
  systemPosture: HomeSystemPosture[]
  authorityPanel: {
    title: string
    description: string
    blockers: typeof SHELL_WOE_AUTHORITY_BLOCKERS
  }
  attentionModel: typeof SHELL_WOE_ATTENTION_MODEL
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
    commandRunnerAdded: false
    dockerMetadataAdded: false
    backupScanAdded: false
    portChecksAdded: false
    lanExposureEnabled: false
  }
}

export const HOME_RADAR_LIMIT = 3

const EMPTY_HOME_WORK_RADAR_SOURCE: HomeWorkRadarSource = {
  activeWork: { count: 0, items: [] },
  blockers: { count: 0, items: [] },
  recentOutcomes: { count: 0, items: [] },
}

const RADAR_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function workOrderRef(order: HomeWorkRadarIdentity) {
  return order.ref ?? `WO-${order.id}`
}

function outcomeRecordedAt(order: HomeWorkRadarOutcomeItem) {
  return order.completedAt ?? order.closedAt ?? order.updatedAt
}

function buildHomeWorkRadar(source: HomeWorkRadarSource): HomeWorkRadar {
  return {
    eyebrow: "Operational radar",
    title: "Now, held, landed",
    description:
      "The current governed queue, recorded blockers, and newest completed outcomes in one owner briefing.",
    activeWork: {
      label: "Now",
      title: "Active work",
      description: "Approved, active, and review-state Work Orders currently moving through the governed loop.",
      tone: "active",
      count: source.activeWork.count,
      items: source.activeWork.items.slice(0, HOME_RADAR_LIMIT).map((order) => ({
        ref: workOrderRef(order),
        title: order.title,
        status: order.status,
        result: null,
        detail: `Updated ${RADAR_DATE_FORMATTER.format(order.updatedAt)}`,
        href: "/work-orders",
      })),
      emptyState: "No active work is requesting attention.",
    },
    blockers: {
      label: "Held",
      title: "Blockers",
      description: "Work Orders held at an authority, dependency, reservation, validation, or evidence boundary.",
      tone: "blocked",
      count: source.blockers.count,
      items: source.blockers.items.slice(0, HOME_RADAR_LIMIT).map((order) => ({
        ref: workOrderRef(order),
        title: order.title,
        status: order.status,
        result: null,
        detail:
          order.stopConditions[0]
          ?? order.description
          ?? "Waiting on an authority gate or missing evidence.",
        href: "/work-orders",
      })),
      emptyState: "No Work Order blockers are recorded.",
    },
    recentOutcomes: {
      label: "Landed",
      title: "Recent outcomes",
      description: "The newest closed or aborted outcomes, ordered by their recorded completion signal.",
      tone: "complete",
      count: source.recentOutcomes.count,
      items: source.recentOutcomes.items.slice(0, HOME_RADAR_LIMIT).map((order) => ({
        ref: workOrderRef(order),
        title: order.title,
        status: order.status,
        result:
          order.result ?? (order.status === "aborted" ? "ABORTED" : "NO RESULT"),
        detail: `Recorded ${RADAR_DATE_FORMATTER.format(outcomeRecordedAt(order))}`,
        href: "/work-orders",
      })),
      emptyState: "Completed outcomes will appear here with their recorded result.",
    },
  }
}

export function getHomeCommandCenter(
  stats: DashboardStats,
  radarSource: HomeWorkRadarSource = EMPTY_HOME_WORK_RADAR_SOURCE,
): HomeCommandCenter {
  const localOperatorSurface = getLocalOperatorSurface()
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
    workRadar: buildHomeWorkRadar(radarSource),
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
        label: "Local Status",
        value: LOCAL_OMEN_PHASE_ROLLUP.value,
        description: LOCAL_OMEN_PHASE_ROLLUP.description,
        href: LOCAL_OMEN_PHASE_ROLLUP.href,
      },
      localOperatorSurface.homeCard,
      {
        label: "Completed Phase",
        value: "OMEN stable",
        description: "Latest local status/refinement lane is complete, validated, and read-only.",
        href: "/audit",
      },
      {
        label: "Next Batch",
        value: "Shell / WOE",
        description: "Resume WilliamOS shell and Work Order Engine read models.",
        href: SHELL_WOE_NEXT_BATCH.href,
      },
      {
        label: "Authority Gates",
        value: "Closed",
        description: "Metadata, runtime control, persistence, LAN exposure, and autonomy remain blocked.",
        href: "/decisions",
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
      {
        label: "Local Status",
        posture: "Read-only",
        description:
          "OMEN route status and host-loopback checks stay separate; operator-run wrappers remain manual and metadata and controls remain blocked.",
        href: "/runtime",
      },
    ],
    authorityPanel: {
      title: "Authority / Blocked Decisions",
      description:
        "These boundaries require explicit Primary approval before any implementation can expand.",
      blockers: SHELL_WOE_AUTHORITY_BLOCKERS,
    },
    attentionModel: SHELL_WOE_ATTENTION_MODEL,
    nextMove:
      stats.openWork > 0
        ? {
            label: "Review active work orders",
            href: "/work-orders",
            reason: "Open work exists. Resolve or classify it before starting another lane.",
          }
        : stats.openDecisions > 0
          ? {
              label: "Resolve blocked decisions",
              href: "/decisions",
              reason: "Proposed decisions are waiting on Primary authority before new work starts.",
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
      commandRunnerAdded: SHELL_WOE_SAFETY.commandRunnerAdded,
      dockerMetadataAdded: SHELL_WOE_SAFETY.dockerMetadataAdded,
      backupScanAdded: SHELL_WOE_SAFETY.backupScanAdded,
      portChecksAdded: SHELL_WOE_SAFETY.portChecksAdded,
      lanExposureEnabled: SHELL_WOE_SAFETY.lanExposureEnabled,
    },
  }
}
