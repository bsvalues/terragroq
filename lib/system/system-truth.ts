/**
 * The three systems the existing System panel renders.
 *
 * OMEN is deliberately NOT added here. Widening this type widens `SystemTruthSignal.system`, which
 * `components/systems/system-truth-panel.tsx` uses to index a total icon map -- so adding a fourth
 * name to this union is a UI change, and Gate 1 does not own the decision to put a fourth row on
 * that panel. `FabricSystemName` below is the vocabulary that covers every owner-directed node.
 */
export type SystemName = "ATLAS" | "HERMES" | "AEGIS"

/**
 * Every owner-directed node in the Fabric inventory, OMEN included.
 *
 * The inventory has always had five nodes; this vocabulary is what stops OMEN being unrepresentable
 * in system truth just because the panel happens to draw three.
 */
export type FabricSystemName = SystemName | "OMEN"

/**
 * `stale` is not a flavour of `unknown`.
 *
 * "measured, and the measurement has aged out" and "never measured" are different claims about the
 * world, and a reader that cannot tell them apart will present an aged reading as a current one.
 */
export type SystemTruthState = "live" | "stale" | "persisted" | "inferred" | "unknown"

/**
 * Derived from the roles that actually exist, rather than written as "every system except ATLAS".
 *
 * The old `Exclude<SystemName, "ATLAS">` was a closed two-entry set that silently claimed every
 * future system was a configured role -- adding OMEN to `SystemName` would have made
 * `projectConfiguredSystemRoleTruth("OMEN")` a type-correct call into a missing map entry.
 */
export type ConfiguredSystemRole = keyof typeof CONFIGURED_SYSTEM_ROLES

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

const CONFIGURED_SYSTEM_ROLES = {
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
} as const satisfies Record<string, ConfiguredEvidence>

export interface SystemTruthFreshness {
  /** Seconds after which a successful current query is `stale` rather than `live`. */
  freshnessSeconds: number
  nowMs?: number
}

function currentQueryState(
  item: CurrentQueryEvidence,
  freshness: SystemTruthFreshness | undefined,
): SystemTruthState {
  if (!item.succeeded) return "unknown"
  if (!freshness) return "live"
  const observed = Date.parse(item.observedAt)
  if (!Number.isFinite(observed)) return "unknown"
  const ageSeconds = ((freshness.nowMs ?? Date.now()) - observed) / 1000
  return ageSeconds > freshness.freshnessSeconds ? "stale" : "live"
}

/**
 * Project evidence into truth signals.
 *
 * `freshness` is optional so existing callers keep their exact behaviour. Supplying it is what makes
 * an aged successful query report `stale` instead of `live` -- staleness is a temporal claim, and it
 * needs a bound to be one.
 */
export function projectSystemTruth(
  evidence: readonly SystemEvidence[],
  freshness?: SystemTruthFreshness,
): SystemTruthSignal[] {
  return evidence.map((item) => ({
    system: item.system,
    signal: item.signal,
    truthState: item.evidenceKind === "persisted-event"
      ? "persisted"
      : item.evidenceKind === "configured"
        ? "inferred"
        : currentQueryState(item, freshness),
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

/**
 * Configured role truth taken from the Fabric inventory rather than restated prose.
 *
 * The inventory is where owner-directed roles actually live -- `registry.seed.json` carries a `role`
 * for every node, OMEN included. `CONFIGURED_SYSTEM_ROLES` above predates it and is kept only for the
 * callers that already name a system literally; anything reading roles for a node should read them
 * from the inventory, so a role change lands in one place.
 */
export interface FabricRoleTruthSignal extends Omit<SystemTruthSignal, "system"> {
  system: FabricSystemName
}

export function projectInventoryConfiguredRoleTruth(node: {
  system: FabricSystemName
  role: string
  source?: string
}): FabricRoleTruthSignal {
  const [signal] = projectSystemTruth([
    {
      // The evidence vocabulary is the panel's; the returned signal is the inventory's. Casting here
      // rather than widening `SystemEvidence` keeps the widening out of the panel's type surface.
      system: node.system as SystemName,
      signal: node.role,
      evidenceKind: "configured",
      observedAt: null,
      source: node.source ?? "config/execution-fabric/registry.seed.json",
      summary: "Owner-directed role from the Fabric inventory. Configuration describes role, not current liveness.",
    },
  ])
  return { ...signal, system: node.system }
}
