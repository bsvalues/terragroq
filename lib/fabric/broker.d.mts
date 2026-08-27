import type { NodeRecord } from "./run-baseline.mjs"

export declare const POLICY_DENY: string

/** Refusal to act on a node that is not in the registry. */
export declare class BrokerDenied extends Error {
  node: string
  allowed: string[]
  constructor(node: string, known: string[])
}

export interface BrokeredExecOptions {
  fabricRoot?: string
  registry?: Record<string, NodeRecord>
  exec?: (
    file: string,
    args: string[],
    options: { timeout: number; windowsHide: boolean },
  ) => Promise<{ stdout: string; stderr?: string }>
  timeout?: number
  /** Recorded in the ledger, so a probe reads differently from a mutation. */
  action?: string
  /**
   * Treat evidence as part of the action rather than commentary on it.
   *
   * Checks the ledger BEFORE the node is touched, so an action that cannot be recorded does not
   * happen. Off by default: reads, and machines that have never had a fabric directory, are the
   * common case and neither is a fault.
   */
  requireAudit?: boolean
}

/** Append one action to the lab's single audit log, in the CLI's tab-separated format. */
export declare function auditBrokerAction(
  fabricRoot: string,
  node: string,
  action: string,
  rc: number | string,
  detail: string,
  options?: { required?: boolean },
): Promise<void>

export declare function resolveBrokeredNode(
  name: string,
  options?: { fabricRoot?: string; registry?: Record<string, NodeRecord> },
): Promise<NodeRecord>

/** Carry a POSIX body as base64 so no shell in the chain reinterprets its quoting. */
export declare function encodePosix(command: string): string

export declare function brokeredExec(
  name: string,
  command: string,
  options?: BrokeredExecOptions,
): Promise<{ stdout: string; stderr: string }>
