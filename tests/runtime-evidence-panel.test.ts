import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  RUNTIME_EVIDENCE_HISTORY_LIMIT,
  projectRuntimeEvidenceHistory,
  summarizeRuntimeEvidence,
  type RuntimeEvidence,
} from "@/components/runtime/runtime-evidence"

function record(overrides: Partial<RuntimeEvidence>): RuntimeEvidence {
  return {
    ref: "EV-0001",
    result: "PASS",
    branch: "codex/example",
    head: "1234567890abcdef",
    filesChanged: ["app/example.tsx"],
    validators: ["npm test -- --run"],
    nextValidMove: "merge when checks pass",
    createdAt: new Date("2026-06-28T00:00:00.000Z"),
    ...overrides,
  }
}

function historyRecords(count: number): RuntimeEvidence[] {
  return Array.from({ length: count }, (_, index) =>
    record({
      ref: `EV-${String(index + 1).padStart(4, "0")}`,
      createdAt: new Date(Date.UTC(2026, 5, 28, index)),
    }),
  )
}

describe("runtime evidence panel summary", () => {
  it("summarizes recent evidence without mutating runtime state", () => {
    const summary = summarizeRuntimeEvidence([
      record({ ref: "EV-0001", result: "FAIL", validators: [], createdAt: new Date("2026-06-28T00:00:00.000Z") }),
      record({ ref: "EV-0003", result: "PASS", validators: ["vitest", "next build"], createdAt: new Date("2026-06-28T02:00:00.000Z") }),
      record({ ref: "EV-0002", result: "PARTIAL", filesChanged: ["a.ts", "b.ts"], createdAt: new Date("2026-06-28T01:00:00.000Z") }),
    ])

    expect(summary.total).toBe(3)
    expect(summary.latest?.ref).toBe("EV-0003")
    expect(summary.timeline.map((entry) => entry.ref)).toEqual(["EV-0003", "EV-0002", "EV-0001"])
    expect(summary.passCount).toBe(1)
    expect(summary.partialCount).toBe(1)
    expect(summary.failCount).toBe(1)
    expect(summary.validatorCount).toBe(3)
    expect(summary.changedFileCount).toBe(4)
  })

  it("keeps empty evidence history explicit", () => {
    const summary = summarizeRuntimeEvidence([])

    expect(summary.total).toBe(0)
    expect(summary.latest).toBeUndefined()
    expect(summary.passCount).toBe(0)
    expect(summary.validatorCount).toBe(0)
    expect(summary.changedFileCount).toBe(0)
  })
})

describe("runtime evidence bounded history", () => {
  it("keeps empty and exact-window histories complete", () => {
    expect(RUNTIME_EVIDENCE_HISTORY_LIMIT).toBe(5)
    expect(projectRuntimeEvidenceHistory([])).toEqual({
      records: [],
      limit: 5,
      truncated: false,
    })

    const history = projectRuntimeEvidenceHistory(historyRecords(5))

    expect(history.limit).toBe(5)
    expect(history.truncated).toBe(false)
    expect(history.records.map((entry) => entry.ref)).toEqual([
      "EV-0005",
      "EV-0004",
      "EV-0003",
      "EV-0002",
      "EV-0001",
    ])
  })

  it("marks evidence beyond the window truncated and keeps the latest records", () => {
    const history = projectRuntimeEvidenceHistory(historyRecords(6))

    expect(history.limit).toBe(5)
    expect(history.truncated).toBe(true)
    expect(history.records.map((entry) => entry.ref)).toEqual([
      "EV-0006",
      "EV-0005",
      "EV-0004",
      "EV-0003",
      "EV-0002",
    ])
  })
})

describe("runtime evidence page contract", () => {
  it("requests a sentinel record and passes the projected history to the panel", () => {
    const page = readFileSync("app/(shell)/runtime/page.tsx", "utf8")
    const auditPage = readFileSync("app/(shell)/audit/page.tsx", "utf8")

    expect(page).toContain("RUNTIME_EVIDENCE_HISTORY_LIMIT + 1")
    expect(page).toContain("projectRuntimeEvidenceHistory")
    expect(page).toMatch(/records=\{[^}]+\.records\}/)
    expect(page).toMatch(/limit=\{[^}]+\.limit\}/)
    expect(page).toMatch(/truncated=\{[^}]+\.truncated\}/)
    expect(auditPage).toContain("RUNTIME_EVIDENCE_HISTORY_LIMIT + 1")
    expect(auditPage).toContain("projectRuntimeEvidenceHistory(persistedEvidence.records)")
    expect(auditPage).toContain("<RuntimeEvidencePanel {...evidenceHistory} />")
  })

  it("labels complete and bounded evidence histories without adding controls", () => {
    const page = readFileSync("app/(shell)/runtime/page.tsx", "utf8")
    const panel = readFileSync("components/runtime/runtime-evidence-panel.tsx", "utf8")

    for (const copy of [
      "Complete persisted history",
      "Bounded history window reached",
      "Earlier persisted evidence may be omitted.",
      "Records shown",
    ]) {
      expect(panel).toContain(copy)
    }
    expect(`${page}\n${panel}`).not.toContain(".slice(0, 5)")
    expect(panel).not.toMatch(/<button|onClick=|startWorker|runCommand|cancelExecution/)
  })
})
