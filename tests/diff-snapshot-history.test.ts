import { describe, expect, it } from "vitest"

import {
  MAX_DIFF_SNAPSHOT_BYTES,
  loadDiffBrowserSnapshot,
  persistDiffBrowserSnapshot,
  removeDiffBrowserSnapshot,
} from "@/components/workspace-shell/diff-snapshot-history"
import { repositoryQualifiedToolHistoryScope } from "@/components/workspace-shell/tool-run-history"

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get length() { return values.size },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) },
    key(index) { return [...values.keys()][index] ?? null },
  }
}

describe("Space-scoped Changes browser snapshots", () => {
  it("bounds an oversized real diff while preserving a truthful truncation marker", () => {
    const storage = memoryStorage()
    const saved = persistDiffBrowserSnapshot(storage, "server:world-a", {
      schemaVersion: 1,
      path: "src/app.ts",
      diff: `+${"🚀".repeat(80_000)}`,
      status: " M src/app.ts",
      capturedAt: "2026-08-29T03:00:00.000Z",
    })

    expect(saved).toBe(true)
    const snapshot = loadDiffBrowserSnapshot(storage, "server:world-a").snapshot
    expect(snapshot?.diff).toContain("saved browser snapshot truncated")
    expect(new TextEncoder().encode([...storage.values.values()][0]).byteLength).toBeLessThanOrEqual(MAX_DIFF_SNAPSHOT_BYTES)
  })

  it("does not restore a snapshot beside a different exact repository revision", () => {
    const storage = memoryStorage()
    const repository = {
      projectKey: "terrafusion" as const,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      observedRevision: "a".repeat(40),
    }
    const capturedScope = repositoryQualifiedToolHistoryScope("server:world-a", repository)
    const currentScope = repositoryQualifiedToolHistoryScope("server:world-a", {
      ...repository,
      observedRevision: "b".repeat(40),
    })
    expect(persistDiffBrowserSnapshot(storage, capturedScope, {
      schemaVersion: 1,
      path: "src/app.ts",
      diff: "+old checkout",
      status: " M src/app.ts",
      capturedAt: "2026-08-29T03:00:00.000Z",
    })).toBe(true)

    expect(loadDiffBrowserSnapshot(storage, currentScope)).toEqual({ snapshot: null, error: null })
    expect(removeDiffBrowserSnapshot(storage, "server:world-a")).toBe(true)
    expect(storage.values.size).toBe(0)
  })
})
