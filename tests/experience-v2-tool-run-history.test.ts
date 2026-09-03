import { describe, expect, it } from "vitest"

import { resolveProjectTerminalAlias, resolveProjectTerminalCommand } from "@/lib/loom/operations"
import {
  loadToolRunHistory,
  persistToolRunTranscript,
  removeToolRunHistory,
  repositoryQualifiedToolHistoryScope,
  toolRunHistoryStorageKey,
  type ToolRunTranscript,
} from "@/components/workspace-shell/tool-run-history"

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> {
  readonly values = new Map<string, string>()
  get length() { return this.values.size }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  key(index: number) { return [...this.values.keys()][index] ?? null }
}

function transcript(index: number, text = `output ${index}`): ToolRunTranscript {
  return {
    schemaVersion: 1,
    id: `run-${index}`,
    operationId: "repo.status",
    operationLabel: "What has changed",
    alias: "git status",
    startedAt: `2026-08-28T10:${String(index).padStart(2, "0")}:00.000Z`,
    endedAt: `2026-08-28T10:${String(index).padStart(2, "0")}:01.000Z`,
    outcome: { status: "completed", code: 0, reason: null },
    lines: [{ channel: "stdout", text }],
  }
}

describe("Experience V2 bounded tool transcript history", () => {
  it("resolves stable actions and bounded read-only Git inspection arguments", () => {
    expect(resolveProjectTerminalAlias("git status")?.id).toBe("repo.status")
    expect(resolveProjectTerminalAlias("git diff")?.id).toBe("repo.diff")
    expect(resolveProjectTerminalAlias("git log")?.id).toBe("repo.log")
    expect(resolveProjectTerminalAlias("build")?.id).toBe("build.run")
    expect(resolveProjectTerminalAlias("git status --short")).toMatchObject({
      id: "repo.status",
      command: "git",
      args: ["status", "--short"],
      terminalAlias: "git status --short",
    })
    expect(resolveProjectTerminalCommand("git diff --name-status HEAD")?.args).toEqual(["diff", "--name-status", "HEAD"])
    expect(resolveProjectTerminalCommand("git log --oneline")?.args).toEqual(["log", "--oneline", "-20"])
    expect(resolveProjectTerminalCommand("git log --oneline -25")?.args).toEqual(["log", "--oneline", "-25"])
    expect(resolveProjectTerminalAlias("rm -rf .")).toBeNull()
    expect(resolveProjectTerminalAlias("powershell Get-ChildItem")).toBeNull()
  })

  it("fails closed for mutations, shell syntax, paths, revisions, config overrides and excessive log limits", () => {
    for (const command of [
      "git checkout main",
      "git status && whoami",
      "git diff -- ../../secret",
      "git diff main",
      "git -c core.pager=cat status",
      "git log -101",
      "git log -10 -20",
      "git status --short --short",
    ]) expect(resolveProjectTerminalCommand(command)).toBeNull()
  })

  it("accepts a persisted transcript for the exact bounded command that produced it", () => {
    const storage = new MemoryStorage()
    const bounded = { ...transcript(0), alias: "git status --short" }

    expect(persistToolRunTranscript(storage, "server:world-a", bounded).ok).toBe(true)
    expect(loadToolRunHistory(storage, "server:world-a").runs[0]?.alias).toBe("git status --short")
  })

  it("scopes history to the exact server world or opaque browser fallback", () => {
    expect(toolRunHistoryStorageKey("server:world-a")).toBe("williamos:tool-runs:v1:server:world-a")
    expect(toolRunHistoryStorageKey("server:world-b")).not.toBe(toolRunHistoryStorageKey("server:world-a"))
    expect(toolRunHistoryStorageKey("browser:opaque-a")).not.toBe(toolRunHistoryStorageKey("browser:opaque-b"))
    expect(() => toolRunHistoryStorageKey("browser-local")).toThrow("TOOL_RUN_SCOPE_INVALID")
  })

  it("qualifies restored evidence by canonical repository, mount and exact revision", () => {
    const base = {
      projectKey: "terrafusion" as const,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      observedRevision: "a".repeat(40),
    }
    const first = repositoryQualifiedToolHistoryScope("server:world-a", base)
    const nextRevision = repositoryQualifiedToolHistoryScope("server:world-a", {
      ...base,
      observedRevision: "b".repeat(40),
    })
    const otherMount = repositoryQualifiedToolHistoryScope("server:world-a", {
      ...base,
      repositoryMountKey: "terrafusion:atlas:worktree-2",
    })

    expect(first).toContain(":identity:bsvalues%2Fterrafusion-atlas")
    expect(first).toContain(":mount:terrafusion%3Aatlas%3Aconfigured")
    expect(first).not.toBe(nextRevision)
    expect(first).not.toBe(otherMount)
  })

  it("removes every exact-revision history when its disposable Space is deleted", () => {
    const storage = new MemoryStorage()
    const repository = {
      projectKey: "terrafusion" as const,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      observedRevision: "a".repeat(40),
    }
    const first = repositoryQualifiedToolHistoryScope("server:deleted-world", repository)
    const second = repositoryQualifiedToolHistoryScope("server:deleted-world", { ...repository, observedRevision: "b".repeat(40) })
    expect(persistToolRunTranscript(storage, first, transcript(1)).ok).toBe(true)
    expect(persistToolRunTranscript(storage, second, transcript(2)).ok).toBe(true)

    expect(removeToolRunHistory(storage, "server:deleted-world")).toBe(true)
    expect(storage.length).toBe(0)
  })

  it("rejects corrupt persisted history without exposing invented transcripts", () => {
    const storage = new MemoryStorage()
    storage.setItem(toolRunHistoryStorageKey("server:world-a"), JSON.stringify({ schemaVersion: 1, runs: [{ id: "invented" }] }))

    expect(loadToolRunHistory(storage, "server:world-a")).toEqual({ runs: [], error: "TOOL_RUN_HISTORY_CORRUPT" })
  })

  it("replaces corrupt JSON with the next valid canonical run instead of poisoning saves forever", () => {
    const storage = new MemoryStorage()
    storage.setItem(toolRunHistoryStorageKey("server:world-a"), "{not-json")

    expect(persistToolRunTranscript(storage, "server:world-a", transcript(1)).ok).toBe(true)
    expect(loadToolRunHistory(storage, "server:world-a")).toEqual({ runs: [transcript(1)], error: null })
  })

  it("rejects a structurally valid transcript that invents an operation or display alias", () => {
    const storage = new MemoryStorage()
    const invented = { ...transcript(0), operationId: "shell.run", operationLabel: "Run anything", alias: "rm -rf ." }
    storage.setItem(toolRunHistoryStorageKey("server:world-a"), JSON.stringify({ schemaVersion: 1, runs: [invented] }))

    expect(loadToolRunHistory(storage, "server:world-a")).toEqual({ runs: [], error: "TOOL_RUN_HISTORY_CORRUPT" })
  })

  it("replaces a catalog-stale envelope with fresh canonical history and retains no false old truth", () => {
    const storage = new MemoryStorage()
    const stale = { ...transcript(0), operationId: "repo.removed", operationLabel: "Removed operation", alias: "old alias" }
    storage.setItem(toolRunHistoryStorageKey("server:world-a"), JSON.stringify({ schemaVersion: 1, runs: [stale] }))

    expect(persistToolRunTranscript(storage, "server:world-a", transcript(2)).ok).toBe(true)
    const loaded = loadToolRunHistory(storage, "server:world-a")
    expect(loaded).toEqual({ runs: [transcript(2)], error: null })
    expect(loaded.runs.some((run) => run.id === stale.id)).toBe(false)
  })

  it("rejects persisted completion claims without a numeric process exit and null reason", () => {
    const storage = new MemoryStorage()
    const falseCompletion = { ...transcript(0), outcome: { status: "completed", code: null, reason: "TIMEOUT" } }
    storage.setItem(toolRunHistoryStorageKey("server:world-a"), JSON.stringify({ schemaVersion: 1, runs: [falseCompletion] }))

    expect(loadToolRunHistory(storage, "server:world-a")).toEqual({ runs: [], error: "TOOL_RUN_HISTORY_CORRUPT" })
  })

  it("preserves an exact numeric exit when a server failure reason makes the run interrupted", () => {
    const storage = new MemoryStorage()
    const failed = { ...transcript(0), outcome: { status: "interrupted" as const, code: 9, reason: "TIMEOUT" } }

    expect(persistToolRunTranscript(storage, "server:world-a", failed).ok).toBe(true)
    expect(loadToolRunHistory(storage, "server:world-a").runs[0]?.outcome).toEqual({ status: "interrupted", code: 9, reason: "TIMEOUT" })
  })

  it("keeps twelve newest canonical transcripts and deterministically prunes the oldest", () => {
    const storage = new MemoryStorage()
    for (let index = 0; index < 13; index += 1) {
      expect(persistToolRunTranscript(storage, "server:world-a", transcript(index)).ok).toBe(true)
    }

    const loaded = loadToolRunHistory(storage, "server:world-a")
    expect(loaded.error).toBeNull()
    expect(loaded.runs.map((run) => run.id)).toEqual(Array.from({ length: 12 }, (_, index) => `run-${index + 1}`))
  })

  it("bounds aggregate UTF-8 bytes and retains the just-completed newest transcript", () => {
    const storage = new MemoryStorage()
    for (let index = 0; index < 12; index += 1) {
      persistToolRunTranscript(storage, "server:world-a", transcript(index, "界".repeat(8_000)))
    }

    const raw = storage.getItem(toolRunHistoryStorageKey("server:world-a"))!
    const loaded = loadToolRunHistory(storage, "server:world-a")
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(131_072)
    expect(loaded.runs.at(-1)?.id).toBe("run-11")
    expect(loaded.runs.length).toBeLessThan(12)
  })

  it("byte-fits one verbose settled run while retaining newest output and terminal metadata", () => {
    const storage = new MemoryStorage()
    const verbose = {
      ...transcript(0),
      lines: [
        ...Array.from({ length: 8 }, (_, index) => ({ channel: "stdout" as const, text: `${index}:${"界".repeat(15_000)}` })),
        { channel: "meta" as const, text: "exit 0" },
      ],
    }

    expect(persistToolRunTranscript(storage, "server:world-a", verbose).ok).toBe(true)
    const saved = loadToolRunHistory(storage, "server:world-a").runs[0]!
    expect(saved.lines.at(-1)).toEqual({ channel: "meta", text: "exit 0" })
    expect(saved.lines.at(-2)?.text.startsWith("7:")).toBe(true)
    expect(saved.lines.some((line) => line.text.startsWith("0:"))).toBe(false)
  })

  it("reports quota failure transactionally and preserves unrelated prior history", () => {
    const storage = new MemoryStorage()
    persistToolRunTranscript(storage, "server:world-a", transcript(0))
    const before = storage.getItem(toolRunHistoryStorageKey("server:world-a"))
    storage.setItem = () => { throw new DOMException("quota", "QuotaExceededError") }

    expect(persistToolRunTranscript(storage, "server:world-a", transcript(1))).toEqual({
      ok: false,
      runs: [transcript(0)],
      error: "TOOL_RUN_HISTORY_NOT_SAVED",
    })
    expect(storage.getItem(toolRunHistoryStorageKey("server:world-a"))).toBe(before)
  })

  it("preserves an exact platform process exit code instead of narrowing it to POSIX status bytes", () => {
    const storage = new MemoryStorage()
    const windowsExit = { ...transcript(0), outcome: { status: "completed" as const, code: 3_221_225_477, reason: null } }

    expect(persistToolRunTranscript(storage, "server:world-a", windowsExit).ok).toBe(true)
    expect(loadToolRunHistory(storage, "server:world-a").runs[0]?.outcome.code).toBe(3_221_225_477)
  })
})
