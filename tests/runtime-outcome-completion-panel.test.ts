import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function panelSource(): string {
  return readFileSync(
    "components/runtime/outcome-completion-timeline-panel.tsx",
    "utf8",
  )
}

describe("outcome completion timeline panel contract", () => {
  it("presents terminal, merge, and automatic-successor evidence", () => {
    const panel = panelSource()

    for (const content of [
      "Outcome completion timeline",
      "Outcome",
      "Terminal result",
      "Merge evidence",
      "Automatic successor",
      "PR #",
      "Receipt #",
      "Fencing",
    ]) {
      expect(panel).toContain(content)
    }
    expect(panel).toContain("evidence.sha.slice(0, 7)")
    expect(panel).toContain("formatTimestamp(evidence.acquiredAt)")
  })

  it("keeps missing and conflicting evidence explicit", () => {
    const panel = panelSource()

    expect(panel).toContain("Missing — no merge SHA recorded.")
    expect(panel).toContain(
      "Missing — no qualifying dependent acquisition recorded.",
    )
    expect(panel).toContain(
      "Conflicting — multiple merge SHA or PR references recorded.",
    )
    expect(panel).toContain(
      "Conflicting — a dependent acquisition predates completion.",
    )
  })

  it("includes the empty state and bounded-history notice", () => {
    const panel = panelSource()

    expect(panel).toContain("No completed outcomes recorded")
    expect(panel).toContain("Bounded history window reached")
    expect(panel).toContain(
      "Only the latest {RECENT_OUTCOME_COMPLETION_LIMIT} completed outcomes are shown.",
    )
  })

  it("contains no mutation controls", () => {
    expect(panelSource()).not.toMatch(
      /<button|<form|<input|<select|<textarea|onClick=|startWorker|runCommand|cancelExecution/,
    )
  })
})
