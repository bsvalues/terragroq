import type { BaselineResult, BaselineStepId } from "./baseline"

export interface NodeRecord {
  transport?: string
  host?: string
  user?: string
  os?: string
  role?: string
  enrolled?: boolean
}

export interface RunOptions {
  fabricRoot?: string
  stepTimeoutMs?: number
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

export declare function defaultFabricRoot(): string
export declare function parseRegistry(text: string): Record<string, NodeRecord>
export declare function readRegistry(fabricRoot?: string): Promise<Record<string, NodeRecord>>
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
export declare function quoteForCmd(arg: string): string
export declare function buildWindowsSshCommand(args: string[], outFile: string, errFile: string): string
export declare function defaultExec(
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean },
): Promise<{ stdout: string; stderr?: string }>
export declare function encodePowerShell(command: string): string

/**
 * Throws when an argument carries a %NAME% pair, which cmd.exe substitutes before ssh sees it.
 * Declared here as well as implemented in the .mjs: vitest does not typecheck, so an export missing
 * from this file breaks `tsc --noEmit` on main without any test going red.
 */
export declare function assertNoCmdVariableExpansion(args: readonly string[]): void
