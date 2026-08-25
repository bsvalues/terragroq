export interface NodeRecord {
  transport?: string
  host?: string
  user?: string
  os?: string
  role?: string
  enrolled?: boolean
  /**
   * How the node runs work, which decides how lifecycle control is proven against it.
   *
   * Absent means containers, so every node that predates this keeps the behaviour it had. A cockpit
   * that is deliberately not a service host declares "processes" instead, and is proved by starting
   * and ending a bounded process rather than by having a container runtime installed.
   */
  workloads?: "containers" | "processes"
  /** Free-text provenance, e.g. why a node is addressed by name rather than by address. */
  note?: string
  /**
   * Fields this code has not heard of.
   *
   * The registry is edited by more than one lane, and a field this type does not name is far more
   * likely to be another lane's than to be junk. Declaring the type closed made the safe-write path
   * -- whose entire purpose is carrying unknown fields through untouched -- fail to typecheck, which
   * is the type disagreeing with the requirement rather than with the code.
   */
  [key: string]: unknown
}

export declare function defaultFabricRoot(): string
export declare function parseRegistry(text: string): Record<string, NodeRecord>
export declare function readRegistry(fabricRoot?: string): Promise<Record<string, NodeRecord>>

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

/** Turn PowerShell's CLIXML error-stream encoding back into the sentence it started as. */
export declare function decodeCliXml(text: unknown): string

/** The line of ssh stderr that names the actual fault, skipping OpenSSH's advisories. */
export declare function meaningfulSshError(stderr: unknown): string

/** The connection policy: pinned host key, batch mode, the fabric service key. */
export declare function sshArgs(node: NodeRecord, command: string, fabricRoot: string): string[]
