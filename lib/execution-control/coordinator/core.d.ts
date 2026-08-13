export class CoordinatorContractError extends Error { code: string }
export interface CoordinatorConfig {
  coordinatorId: string
  atlasDatabaseEnv: "AEH_ATLAS_DATABASE_URL"
  leaderLockKey: number
  pollIntervalMs: number
  shutdownTimeoutMs: number
  healthPort: number
  reconciliationDependency: "WO-AEH-019_REQUIRED_NOT_IMPLEMENTED"
}
export interface LeaderSession {
  query(sql: string, parameters: readonly unknown[]): Promise<{ rows?: Array<Record<string, unknown>> }>
  release(): Promise<void>
}
export interface DrainState { activeLeaseCount: number; ambiguousAttemptCount: number }
export interface CoordinatorStatus {
  state: "STARTING" | "FOLLOWER" | "LEADER" | "DRAINING" | "STOPPED" | "FAILED"
  leader: boolean; accepting: boolean; lastDatabaseProof: string | null; lastFailure: string | null
  reconciliation: CoordinatorConfig["reconciliationDependency"]; coordinatorId: string
}
export function validateCoordinatorConfig(value: unknown): Readonly<CoordinatorConfig>
export function createCoordinator(dependencies: {
  config: unknown
  openLeaderSession(): Promise<LeaderSession>
  pullEligibleJob(session: LeaderSession, request: unknown): Promise<unknown>
  inspectDrainState(session: LeaderSession): Promise<DrainState>
  now?: () => string
}): Readonly<{
  start(): Promise<CoordinatorStatus>; poll(request: unknown): Promise<unknown | Readonly<{ outcome: "NO_WORK"; code: "CLAIM_NOT_ELIGIBLE" }>>; probeDatabase(): Promise<boolean>
  beginReplacement(): Promise<CoordinatorStatus>; status(): CoordinatorStatus
  health(): { ok: boolean; state: CoordinatorStatus["state"]; databaseProof: string | null }
  readiness(): { ready: boolean; reasons: string[]; reconciliationDependency: CoordinatorConfig["reconciliationDependency"] }
}>
