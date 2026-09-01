import type { MissionControlSpaceProjection, MissionControlWilliamOverview } from "./mission-control-surface"

export type MissionControlOverviewInput = Readonly<{
  spaces: readonly MissionControlSpaceProjection[]
  currentSpaceId: string | null
  currentSpaceJudgment: string | null
  collectionAvailable: boolean
  collectionReason: string | null
  persistence: Readonly<{ state: "saved" | "saving" | "failed"; error: string | null }>
}>

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function agentTruth(space: MissionControlSpaceProjection): string {
  const live = space.agents.filter((agent) => agent.truth === "live")
  const persisted = space.agents.filter((agent) => agent.truth === "persisted")
  const saved = space.agents.filter((agent) => agent.truth === "resume-unverified")
  const parts: string[] = []
  if (live.length > 0) {
    parts.push(`${countLabel(live.length, "live agent")} — ${live.map((agent) => `${agent.role} · ${agent.activity}`).join("; ")}`)
  }
  if (persisted.length > 0) {
    parts.push(`${countLabel(persisted.length, "persisted assignment")} — ${persisted.map((agent) => `${agent.role} · ${agent.activity}`).join("; ")}`)
  }
  if (space.agentActivityKnown === false) {
    parts.push(live.length > 0 ? "saved activity unknown" : "agent activity unknown")
  } else if (saved.length > 0) {
    parts.push(`${countLabel(saved.length, "saved session")} awaiting verification`)
  } else if (live.length === 0 && persisted.length === 0) {
    parts.push("no agent sessions")
  }
  return `${space.name}: ${parts.join("; ")}.`
}

function mostRecent(spaces: readonly MissionControlSpaceProjection[]): MissionControlSpaceProjection | null {
  const valid = spaces.flatMap((space) => {
    const timestamp = typeof space.updatedAt === "string" ? Date.parse(space.updatedAt) : Number.NaN
    return Number.isFinite(timestamp) ? [{ space, timestamp }] : []
  })
  valid.sort((left, right) => right.timestamp - left.timestamp
    || (left.space.name < right.space.name ? -1 : left.space.name > right.space.name ? 1 : 0)
    || (left.space.id < right.space.id ? -1 : left.space.id > right.space.id ? 1 : 0))
  return valid[0]?.space ?? null
}

export function deriveMissionControlOverview(input: MissionControlOverviewInput): MissionControlWilliamOverview {
  const current = input.spaces.find((space) => space.id === input.currentSpaceId) ?? null
  const recent = mostRecent(input.spaces)
  const summary = [
    current ? `Current Space: ${current.name}.` : null,
    ...input.spaces.map(agentTruth),
    recent ? `Most recent Space: ${recent.name}.` : null,
    current && input.persistence.state === "saving" ? `${current.name} is saving.` : null,
    current && input.currentSpaceJudgment?.trim() ? `Current-Space judgment: ${input.currentSpaceJudgment.trim()}` : null,
  ].filter((value): value is string => Boolean(value)).join(" ") || "No Spaces are currently available."
  const attention = [
    current && input.persistence.state === "failed" && input.persistence.error
      ? `Inspect ${current.name} persistence: ${input.persistence.error}.` : null,
    !input.collectionAvailable
      ? `Inspect Space collection: ${input.collectionReason ?? "collection unavailable"}.` : null,
  ].filter((value): value is string => Boolean(value)).join(" ") || null
  const attentionAction = current?.state === "live" && current.truth === "live"
    && input.persistence.state === "failed" && input.persistence.error
    ? {
      kind: "inspect-current-space-persistence" as const,
      spaceId: current.id,
      label: `Inspect ${current.name} persistence`,
    }
    : null
  return {
    summary,
    attention,
    ...(attentionAction ? { attentionAction } : {}),
    truth: "live",
  }
}
