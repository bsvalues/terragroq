export type SystemName = "ATLAS" | "HERMES" | "AEGIS"
export type SystemTruthState = "live" | "persisted" | "inferred" | "unknown"
export type ConfiguredSystemRole = Exclude<SystemName, "ATLAS">

export interface CurrentQueryEvidence {
  system: SystemName
  signal: string
  evidenceKind: "current-query"
  succeeded: boolean
  observedAt: string
  source: string
  summary: string
}

export interface PersistedEventEvidence {
  system: SystemName
  signal: string
  evidenceKind: "persisted-event"
  observedAt: string
  source: string
  summary: string
}

export interface ConfiguredEvidence {
  system: SystemName
  signal: string
  evidenceKind: "configured"
  observedAt: null
  source: string
  summary: string
}

export type SystemEvidence = CurrentQueryEvidence | PersistedEventEvidence | ConfiguredEvidence

export interface SystemTruthSignal {
  system: SystemName
  signal: string
  truthState: SystemTruthState
  observedAt: string | null
  source: string
  summary: string
}

const CONFIGURED_SYSTEM_ROLES: Record<ConfiguredSystemRole, ConfiguredEvidence> = {
  HERMES: {
    system: "HERMES",
    signal: "coordinator-app-host",
    evidenceKind: "configured",
    observedAt: null,
    source: "issue #762 runtime topology contract",
    summary: "Configured as coordinator and app host. Configuration describes role, not current liveness.",
  },
  AEGIS: {
    system: "AEGIS",
    signal: "worker-node",
    evidenceKind: "configured",
    observedAt: null,
    source: "issue #762 runtime topology contract",
    summary: "Configured as a worker node. Configuration describes role, not current liveness.",
  },
}

export function projectSystemTruth(evidence: readonly SystemEvidence[]): SystemTruthSignal[] {
  return evidence.map((item) => ({
    system: item.system,
    signal: item.signal,
    truthState: item.evidenceKind === "persisted-event"
      ? "persisted"
      : item.evidenceKind === "configured"
        ? "inferred"
        : item.succeeded
          ? "live"
          : "unknown",
    observedAt: item.evidenceKind === "current-query" && !item.succeeded
      ? null
      : item.observedAt,
    source: item.source,
    summary: item.summary,
  }))
}

export function projectConfiguredSystemRoleTruth(system: ConfiguredSystemRole): SystemTruthSignal {
  return projectSystemTruth([CONFIGURED_SYSTEM_ROLES[system]])[0]
}
