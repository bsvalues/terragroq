import { describe, expect, it } from "vitest"
import {
  getHomeCommandCenter,
  type HomeWorkRadarActiveItem,
  type HomeWorkRadarBlockedItem,
  type HomeWorkRadarDecisionItem,
  type HomeWorkRadarOutcomeItem,
} from "@/components/dashboard/home-command-center"
import type { DashboardStats } from "@/components/dashboard/operator-start"

const initializedStats: DashboardStats = {
  memory: 3,
  decisions: 2,
  openDecisions: 0,
  doctrines: 2,
  work: 4,
  openWork: 0,
  docs: 5,
}

function radarIdentity(id: number, status: string, title: string) {
  return {
    id,
    ref: `WO-${String(id).padStart(4, "0")}`,
    title,
    status,
    evidence: [],
  }
}

function activeWorkOrder(
  id: number,
  status: string,
  title: string,
  updatedAt: string,
  overrides: Partial<HomeWorkRadarActiveItem> = {},
): HomeWorkRadarActiveItem {
  return {
    ...radarIdentity(id, status, title),
    updatedAt: new Date(updatedAt),
    ...overrides,
  }
}

function blockedWorkOrder(
  id: number,
  title: string,
  overrides: Partial<HomeWorkRadarBlockedItem> = {},
): HomeWorkRadarBlockedItem {
  return {
    ...radarIdentity(id, "blocked", title),
    description: null,
    stopConditions: [],
    ...overrides,
  }
}

function ownerDecision(
  id: number,
  title: string,
  overrides: Partial<HomeWorkRadarDecisionItem> = {},
): HomeWorkRadarDecisionItem {
  return {
    id,
    ref: `ADR-${String(id).padStart(4, "0")}`,
    title,
    status: "proposed",
    decisionText: "Choose the bounded next move.",
    rationale: null,
    evidence: [],
    ...overrides,
  }
}

function outcomeWorkOrder(
  id: number,
  status: "closed" | "aborted",
  title: string,
  updatedAt: string,
  overrides: Partial<HomeWorkRadarOutcomeItem> = {},
): HomeWorkRadarOutcomeItem {
  return {
    ...radarIdentity(id, status, title),
    result: null,
    closedAt: null,
    completedAt: null,
    updatedAt: new Date(updatedAt),
    ...overrides,
  }
}

describe("WilliamOS Home Command Center", () => {
  it("renders bounded radar projections with complete lane counts", () => {
    const home = getHomeCommandCenter(initializedStats, {
      activeWork: {
        count: 4,
        items: [
          activeWorkOrder(1, "active", "Ship the owner briefing", "2026-07-08T12:00:00.000Z", {
            evidence: ["EV-0042", "docs/reports/WO-0001.md"],
          }),
          activeWorkOrder(2, "active", "Verify the queue", "2026-07-07T12:00:00.000Z"),
          activeWorkOrder(3, "review", "Review delivery evidence", "2026-07-09T12:00:00.000Z"),
          activeWorkOrder(4, "approved", "Queue the next bounded lane", "2026-07-06T12:00:00.000Z"),
        ],
      },
      blockers: {
        count: 4,
        items: [
          blockedWorkOrder(6, "Restore required evidence"),
          blockedWorkOrder(7, "Clear the reservation"),
          blockedWorkOrder(5, "Resolve the policy gate", {
            stopConditions: ["Owner authority is not recorded."],
            evidence: ["EV-0043"],
          }),
          blockedWorkOrder(8, "Wait for the dependency"),
        ],
      },
      ownerDecisions: {
        count: 4,
        items: [
          ownerDecision(12, "Choose the release boundary", {
            rationale: "The next mutation crosses the recorded release authority boundary.",
            evidence: ["EV-0044", "EV-0045"],
          }),
          ownerDecision(13, "Choose the retention window"),
          ownerDecision(14, "Approve the production cutover"),
          ownerDecision(15, "Choose the migration window"),
        ],
      },
      recentOutcomes: {
        count: 4,
        items: [
          outcomeWorkOrder(9, "closed", "Home shell foundation", "2026-07-02T12:00:00.000Z", {
            result: "PASS",
            completedAt: new Date("2026-07-10T12:00:00.000Z"),
            evidence: ["EV-0046"],
          }),
          outcomeWorkOrder(10, "aborted", "Retired adapter lane", "2026-07-09T12:00:00.000Z", {
            closedAt: new Date("2026-07-09T12:00:00.000Z"),
          }),
          outcomeWorkOrder(11, "closed", "Evidence surface", "2026-07-08T12:00:00.000Z", {
            result: "PASS",
          }),
          outcomeWorkOrder(16, "closed", "Older completed lane", "2026-07-07T12:00:00.000Z"),
        ],
      },
    })

    expect(home.workRadar).toMatchObject({
      eyebrow: "Operational radar",
      title: "Now, held, decide, landed",
    })
    expect(home.workRadar.activeWork.count).toBe(4)
    expect(home.workRadar.activeWork.items.map((item) => item.ref)).toEqual([
      "WO-0001",
      "WO-0002",
      "WO-0003",
    ])
    expect(home.workRadar.activeWork.items.every((item) => item.href === "/work-orders")).toBe(true)
    expect(home.workRadar.activeWork.items[0].evidence).toEqual({
      count: 2,
      label: "Open supporting evidence",
      href: "/audit",
    })
    expect(home.workRadar.activeWork.items[1].evidence).toEqual({
      count: 0,
      label: "Evidence not linked",
      href: null,
    })

    expect(home.workRadar.blockers.count).toBe(4)
    expect(home.workRadar.blockers.items.map((item) => item.ref)).toEqual([
      "WO-0006",
      "WO-0007",
      "WO-0005",
    ])
    expect(home.workRadar.blockers.items[2]).toMatchObject({
      status: "blocked",
      detail: "Owner authority is not recorded.",
    })

    expect(home.workRadar.ownerDecisions).toMatchObject({
      label: "Decide",
      title: "Needs your decision",
      tone: "decision",
      count: 4,
    })
    expect(home.workRadar.ownerDecisions.items.map((item) => item.ref)).toEqual([
      "ADR-0012",
      "ADR-0013",
      "ADR-0014",
    ])
    expect(home.workRadar.ownerDecisions.items[0]).toMatchObject({
      href: "/decisions",
      actionLabel: "Review decision",
      detail: "The next mutation crosses the recorded release authority boundary.",
      evidence: {
        count: 2,
        label: "Open supporting evidence",
        href: "/audit",
      },
    })

    expect(home.workRadar.recentOutcomes.count).toBe(4)
    expect(home.workRadar.recentOutcomes.items.map((item) => item.ref)).toEqual([
      "WO-0009",
      "WO-0010",
      "WO-0011",
    ])
    expect(home.workRadar.recentOutcomes.items.map((item) => item.result)).toEqual([
      "PASS",
      "ABORTED",
      "PASS",
    ])
    expect(home.workRadar.recentOutcomes.items.every((item) => item.href === "/work-orders")).toBe(true)
  })

  it("provides useful independent empty states for the operational radar", () => {
    const home = getHomeCommandCenter(initializedStats, {
      activeWork: { count: 0, items: [] },
      blockers: { count: 0, items: [] },
      ownerDecisions: { count: 0, items: [] },
      recentOutcomes: { count: 0, items: [] },
    })

    expect(home.workRadar.activeWork).toMatchObject({
      count: 0,
      items: [],
      emptyState: "No active work is requesting attention.",
    })
    expect(home.workRadar.blockers).toMatchObject({
      count: 0,
      items: [],
      emptyState: "No Work Order blockers are recorded.",
    })
    expect(home.workRadar.ownerDecisions).toMatchObject({
      count: 0,
      items: [],
      emptyState: "No owner decision is waiting for you.",
    })
    expect(home.workRadar.recentOutcomes).toMatchObject({
      count: 0,
      items: [],
      emptyState: "Completed outcomes will appear here with their recorded result.",
    })
  })

  it("frames Home as the Primary Operator command center", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.title).toBe("WilliamOS Home")
    expect(home.eyebrow).toBe("Primary Operator Command Center")
    expect(home.description).toContain("private command environment")
    expect(home.thesis).toContain("Primary briefing")
    expect(home.primaryAction).toEqual({
      label: "Review next move",
      href: "/work-orders",
    })
  })

  it("answers attention, stable, and blocked briefing questions", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 2,
      openDecisions: 1,
    })

    expect(home.briefing).toMatchObject({
      status: "Attention",
      summary: "Operator attention required",
    })
    expect(home.lanes).toEqual([
      expect.objectContaining({
        label: "Attention",
        value: "2 work orders",
        href: "/work-orders",
        tone: "attention",
      }),
      expect.objectContaining({
        label: "Stable",
        value: "systems visible",
        href: "/runtime",
        tone: "stable",
      }),
      expect.objectContaining({
        label: "Blocked",
        value: "1 decision",
        href: "/decisions",
        tone: "authority",
      }),
    ])
  })

  it("reports a ready briefing when nothing is blocking Home", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.briefing).toMatchObject({
      status: "Ready",
      summary: "No active work is blocking Home",
    })
    expect(home.lanes.find((lane) => lane.label === "Attention")).toMatchObject({
      value: "clear",
      href: "/goal-console",
    })
    expect(home.lanes.find((lane) => lane.label === "Blocked")).toMatchObject({
      value: "none",
    })
  })

  it("surfaces the unified WilliamOS command areas", () => {
    const home = getHomeCommandCenter(initializedStats)
    const labels = home.statusCards.map((card) => card.label)

    expect(labels).toEqual([
      "Active Work",
      "Ready Next",
      "Blocked Decisions",
      "Evidence Required",
      "Systems",
      "Local Status",
      "Local Operations",
      "Completed Phase",
      "Next Batch",
      "Authority Gates",
      "Council",
      "Worker Dock",
      "Agent Forge",
      "Active Project",
    ])
    expect(home.statusCards.find((card) => card.label === "Council")).toMatchObject({
      value: "Advisory",
      href: "/brain-council",
    })
    expect(home.statusCards.find((card) => card.label === "Worker Dock")).toMatchObject({
      value: "Inactive",
      href: "/brain-council",
    })
    expect(home.statusCards.find((card) => card.label === "Agent Forge")).toMatchObject({
      value: "Proposal-only",
      href: "/agent-forge",
    })
    expect(home.statusCards.find((card) => card.label === "Active Project")).toMatchObject({
      value: "TerraFusion OS",
      href: "/projects",
    })
    expect(home.statusCards.find((card) => card.label === "Local Operations")).toMatchObject({
      value: "Manual-ready",
      href: "/runtime",
    })
    expect(home.statusCards.find((card) => card.label === "Local Status")).toMatchObject({
      value: "Stable",
      href: "/runtime",
    })
    expect(home.statusCards.find((card) => card.label === "Local Status")?.description).toContain(
      "route status, host-loopback checks, and operator-run wrappers stay separated",
    )
    expect(home.statusCards.find((card) => card.label === "Next Batch")).toMatchObject({
      value: "Shell / WOE",
      href: "/work-orders",
    })
    expect(home.statusCards.find((card) => card.label === "Authority Gates")).toMatchObject({
      value: "Closed",
      href: "/decisions",
    })
  })

  it("shows Brain Council, Hermes, Evidence, and Access Grants posture without activation", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.systemPosture).toEqual([
      expect.objectContaining({
        label: "Brain Council",
        posture: "Advisory",
        href: "/brain-council",
      }),
      expect.objectContaining({
        label: "Hermes Worker Dock",
        posture: "Inactive",
        href: "/brain-council",
      }),
      expect.objectContaining({
        label: "Evidence",
        posture: "Read-only",
        href: "/audit",
      }),
      expect.objectContaining({
        label: "Access Grants",
        posture: "Disabled",
        href: "/operator",
      }),
      expect.objectContaining({
        label: "Local Status",
        posture: "Read-only",
        href: "/runtime",
      }),
    ])
  })

  it("shows authority blockers and attention model without granting control", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.authorityPanel.title).toBe("Authority / Blocked Decisions")
    expect(home.authorityPanel.blockers.map((blocker) => blocker.label)).toEqual([
      "Local runtime control",
      "Metadata expansion",
      "Execution authority",
      "External mutation",
    ])
    expect(home.attentionModel).toEqual([
      "Stable systems",
      "Ready next work",
      "Blocked decisions",
      "Recent completed phase",
      "Local runtime status",
      "Evidence links",
    ])
  })

  it("routes active work to work order review", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 2,
    })

    expect(home.nextMove).toMatchObject({
      label: "Review active work orders",
      href: "/work-orders",
    })
    expect(home.statusCards.find((card) => card.label === "Active Work")).toMatchObject({
      value: "2 active",
      href: "/work-orders",
    })
  })

  it("routes zero active work to goal classification", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 0,
    })

    expect(home.nextMove).toMatchObject({
      label: "Classify the next objective",
      href: "/goal-console",
      reason: "No active work is blocking the Primary Operator briefing.",
    })
    expect(home.statusCards.find((card) => card.label === "Active Work")).toMatchObject({
      value: "none",
      href: "/goal-console",
    })
  })

  it("routes proposed decisions to authority review before new goals", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 0,
      openDecisions: 2,
    })

    expect(home.nextMove).toMatchObject({
      label: "Resolve blocked decisions",
      href: "/decisions",
      reason: "Proposed decisions are waiting on Primary authority before new work starts.",
    })
    expect(home.briefing.status).toBe("Attention")
  })

  it("does not grant execution, autonomy, authority, or production-write behavior", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.safety).toEqual({
      readOnly: true,
      startsHermes: false,
      activatesBrainCouncil: false,
      executesWorkOrders: false,
      deploys: false,
      writesProduction: false,
      changesAuthority: false,
      commandRunnerAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      lanExposureEnabled: false,
    })
  })

  it("keeps the Home local status card consistent with manual-only runtime semantics", () => {
    const home = getHomeCommandCenter(initializedStats)
    const localStatus = home.statusCards.find((card) => card.label === "Local Status")
    const localPosture = home.systemPosture.find((card) => card.label === "Local Status")
    const text = [localStatus?.description, localPosture?.description].join(" ")

    expect(localStatus).toMatchObject({
      value: "Stable",
      href: "/runtime",
    })
    expect(text).toContain("route status")
    expect(text).toContain("host-loopback checks")
    expect(text).toContain("operator-run wrappers")
    expect(text).toContain("metadata and controls remain blocked")
    expect(text).not.toContain("start")
    expect(text).not.toContain("restart")
    expect(text).not.toContain("enable persistence")
    expect(text).not.toContain("LAN exposure enabled")
  })
})
