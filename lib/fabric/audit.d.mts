/** Append one action to the lab's single audit log, in the CLI's tab-separated format. */
export declare function auditFabricAction(
  fabricRoot: string,
  node: string,
  action: string,
  rc: number | string,
  detail: string,
): Promise<void>
