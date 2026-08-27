/** The error name used whenever an action's evidence cannot be written, or could not have been. */
export declare const AUDIT_UNAVAILABLE: string

/**
 * Refuse to proceed unless this action's evidence can actually be written.
 *
 * Called BEFORE the action, not after it. Auditing afterwards can only report that a mutation which
 * already happened went unrecorded, which is not the same guarantee.
 */
export declare function requireLedger(fabricRoot: string): Promise<void>

/** Append one action to the lab's single audit log, in the CLI's tab-separated format. */
export declare function auditFabricAction(
  fabricRoot: string,
  node: string,
  action: string,
  rc: number | string,
  detail: string,
  /** `required: true` turns an absent ledger from a skip into a refusal. */
  options?: { required?: boolean },
): Promise<void>
