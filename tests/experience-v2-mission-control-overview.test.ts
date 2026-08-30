import { describe, expect, it } from "vitest"

import { deriveMissionControlOverview } from "@/components/workspace-shell/mission-control-overview"
import type { MissionControlSpaceProjection } from "@/components/workspace-shell/mission-control-surface"

function space(
  id: string,
  name: string,
  updatedAt: string,
  agents: MissionControlSpaceProjection["agents"] = [],
  agentActivityKnown = true,
): MissionControlSpaceProjection {
  return {
    id, name, updatedAt, focus: "development", state: "saved", truth: "live", windows: [], agents, agentActivityKnown,
  }
}

describe("Mission Control real overview", () => {
  it("names actual Spaces and reports exact provider-independent live activity and saved-unverified truth", () => {
    const overview = deriveMissionControlOverview({
      spaces: [
        space("alpha", "Alpha Build", "2026-08-29T10:00:00.000Z", [
          { id: "live-builder", name: "Codex", role: "Builder", activity: "validating changes", state: "working", truth: "live" },
          { id: "saved-reviewer", name: "Claude", role: "Reviewer", activity: "Review src/app.ts", state: "waiting", truth: "resume-unverified" },
        ]),
        space("beta", "Evidence Lab", "2026-08-29T09:00:00.000Z"),
      ],
      currentSpaceId: "alpha",
      currentSpaceJudgment: "Ship the bounded fix.",
      collectionAvailable: true,
      collectionReason: null,
      persistence: { state: "saved", error: null },
    })

    expect(overview).toEqual({
      summary: "Current Space: Alpha Build. Alpha Build: 1 live agent — Builder · validating changes; 1 saved session awaiting verification. Evidence Lab: no agent sessions. Most recent Space: Alpha Build. Current-Space judgment: Ship the bounded fix.",
      attention: null,
      truth: "live",
    })
    expect(overview.summary).not.toMatch(/Codex|Claude/)
  })

  it("keeps unknown activity unknown while retaining exact known live work and resolves recent-time ties deterministically", () => {
    const overview = deriveMissionControlOverview({
      spaces: [
        space("z", "Zulu", "2026-08-29T10:00:00.000Z", [], false),
        space("a", "Alpha", "2026-08-29T10:00:00.000Z", [
          { id: "live", name: "Local", role: "Thinker", activity: "thinking through the failure", state: "working", truth: "live" },
        ], false),
      ],
      currentSpaceId: "z",
      currentSpaceJudgment: null,
      collectionAvailable: true,
      collectionReason: null,
      persistence: { state: "saving", error: null },
    })

    expect(overview.summary).toBe("Current Space: Zulu. Zulu: agent activity unknown. Alpha: 1 live agent — Thinker · thinking through the failure; saved activity unknown. Most recent Space: Alpha. Zulu is saving.")
    expect(overview.attention).toBeNull()
  })

  it("raises attention only for concrete inspectable persistence and collection failures", () => {
    const failed = deriveMissionControlOverview({
      spaces: [space("alpha", "Alpha", "2026-08-29T10:00:00.000Z")],
      currentSpaceId: "alpha",
      currentSpaceJudgment: "Preview is unavailable.",
      collectionAvailable: false,
      collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      persistence: { state: "failed", error: "SPACE_PERSIST_CONFLICT" },
    })
    expect(failed.attention).toBe("Inspect Alpha persistence: SPACE_PERSIST_CONFLICT. Inspect Space collection: SPACE_COLLECTION_UNAVAILABLE.")

    const previewOnly = deriveMissionControlOverview({
      spaces: [{ ...space("alpha", "Alpha", "2026-08-29T10:00:00.000Z"), state: "unavailable" }],
      currentSpaceId: "alpha",
      currentSpaceJudgment: "The developer preview is not attached.",
      collectionAvailable: true,
      collectionReason: null,
      persistence: { state: "saved", error: null },
    })
    expect(previewOnly.attention).toBeNull()
    expect(previewOnly.summary).not.toContain("One visible acceptance condition")
  })

  it("derives one inspection action only for the exact current live Space persistence failure", () => {
    const overview = deriveMissionControlOverview({
      spaces: [
        { ...space("alpha", "Alpha", "2026-08-29T10:00:00.000Z"), state: "live" },
        space("beta", "Beta", "2026-08-29T09:00:00.000Z"),
      ],
      currentSpaceId: "alpha",
      currentSpaceJudgment: null,
      collectionAvailable: true,
      collectionReason: null,
      persistence: { state: "failed", error: "SPACE_PERSIST_CONFLICT" },
    })

    expect(overview.attentionAction).toEqual({
      kind: "inspect-current-space-persistence",
      spaceId: "alpha",
      label: "Inspect Alpha persistence",
    })
    expect(overview.attention).toBe("Inspect Alpha persistence: SPACE_PERSIST_CONFLICT.")
  })

  it("omits inspection actions for foreign, non-live, and collection-only attention", () => {
    const alpha = space("alpha", "Alpha", "2026-08-29T10:00:00.000Z")
    const common = {
      spaces: [alpha],
      currentSpaceJudgment: null,
      collectionAvailable: true,
      collectionReason: null,
    }

    expect(deriveMissionControlOverview({
      ...common,
      currentSpaceId: "foreign",
      persistence: { state: "failed", error: "SPACE_PERSIST_CONFLICT" },
    }).attentionAction).toBeUndefined()
    expect(deriveMissionControlOverview({
      ...common,
      currentSpaceId: "alpha",
      persistence: { state: "failed", error: "SPACE_PERSIST_CONFLICT" },
    }).attentionAction).toBeUndefined()
    expect(deriveMissionControlOverview({
      ...common,
      currentSpaceId: "alpha",
      collectionAvailable: false,
      collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      persistence: { state: "saved", error: null },
    }).attentionAction).toBeUndefined()
  })

  it("does not label a judgment when there is no exact current Space", () => {
    const overview = deriveMissionControlOverview({
      spaces: [space("alpha", "Alpha", "invalid")],
      currentSpaceId: "foreign",
      currentSpaceJudgment: "Stale prior judgment.",
      collectionAvailable: true,
      collectionReason: null,
      persistence: { state: "saved", error: null },
    })

    expect(overview.summary).toBe("Alpha: no agent sessions.")
    expect(overview.summary).not.toContain("judgment")
  })
})
