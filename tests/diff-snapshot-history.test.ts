import { describe, expect, it } from "vitest"

import {
  MAX_DIFF_SNAPSHOT_BYTES,
  loadDiffBrowserSnapshot,
  persistDiffBrowserSnapshot,
} from "@/components/workspace-shell/diff-snapshot-history"

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
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
})
