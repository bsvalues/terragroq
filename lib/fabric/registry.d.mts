import type { NodeRecord } from "./run-baseline.mjs"

export declare const REGISTRY_FILE: string

/** The registry was edited by someone else between reading it and writing it. */
export declare class RegistryConflict extends Error {
  constructor(node?: string)
}

/** The update would have removed fields nobody asked to remove -- usually another lane's. */
export declare class RegistryFieldLoss extends Error {
  fields: string[]
  constructor(node: string, fields: string[])
}

export declare function registryFingerprint(fabricRoot?: string): Promise<string>

export declare function readNodes(
  fabricRoot?: string,
): Promise<{ nodes: Record<string, NodeRecord>; fingerprint: string }>

export interface UpdateNodeOptions {
  fabricRoot?: string
  /** Fields to delete. Deleting has to be asked for; it never happens as a side effect. */
  remove?: string[]
  /** Refuse the write unless the registry still matches this fingerprint. */
  expectFingerprint?: string
}

export declare function updateNodeFields(
  name: string,
  patch: Record<string, unknown>,
  options?: UpdateNodeOptions,
): Promise<{ before: NodeRecord; after: NodeRecord; changed: string[] }>
