import type { BaselineResult, BaselineStepId } from "./baseline"
import type { NodeRecord } from "./transport.mjs"

/**
 * The transport primitives are re-exported, not restated.
 *
 * They moved to `transport.mjs` so the broker could stop importing its transport from one of its own
 * callers, and every existing importer still reaches them through this module. Restating the
 * declarations here instead would have made this file promise exports that no longer exist at
 * runtime -- exactly the drift `tests/declaration-parity` exists to catch.
 */
export * from "./transport.mjs"

export interface RunOptions {
  fabricRoot?: string
  stepTimeoutMs?: number
  /**
   * The registry the caller already read.
   *
   * Passed down so the broker resolves this node against the whole list. Omitting it is allowed and
   * makes the broker read the registry itself; handing it a one-entry registry would make its
   * unknown-node refusal unfalsifiable.
   */
  registry?: Record<string, NodeRecord>
  /**
   * Whether a MUTATING step may run without a writable ledger. Default `true` (it may not).
   *
   * Defaulted on so a caller that forgets it gets the safe behaviour, and the unsafe behaviour has to
   * be asked for in writing.
   */
  requireAudit?: boolean
  /** Where each step is recorded. Injectable so tests do not append to the lab's real ledger. */
  audit?: (node: string, action: string, rc: number | string, detail: string) => Promise<void>
  exec?: (
    file: string,
    args: string[],
    options: { timeout: number; windowsHide: boolean },
  ) => Promise<{ stdout: string }>
}

export interface BaselineRun {
  ranAt: string
  results: BaselineResult[]
}

export interface NodeSummary {
  node: string
  passed: boolean
  steps: BaselineResult[]
  firstFailure: BaselineResult | null
}

export declare const PROBE_CONTAINER: string
export declare const BASELINE_STEP_IDS: BaselineStepId[]
export declare const STEP_TIMEOUT_MS: number

/**
 * The steps that change the node, named rather than inferred from the id.
 *
 * These are the ones that refuse to run without a writable ledger.
 */
export declare const MUTATING_BASELINE_STEPS: ReadonlySet<BaselineStepId>

export declare function runNodeBaseline(
  name: string,
  node: NodeRecord,
  options?: RunOptions,
): Promise<BaselineResult[]>
export declare function runAllBaselines(
  registry: Record<string, NodeRecord>,
  options?: RunOptions,
): Promise<BaselineRun>
export declare function nodePassed(results: BaselineResult[]): boolean
export declare function summarise(run: BaselineRun): {
  nodes: NodeSummary[]
  passedCount: number
  total: number
}
