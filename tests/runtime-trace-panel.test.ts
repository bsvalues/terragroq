import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("runtime trace panel contract", () => {
  it("renders persisted checkpoint and failure-eval provenance", () => {
    const panel = readFileSync("components/trace/runtime-trace-panel.tsx", "utf8")
    for (const marker of [
      "HERMES_RUNTIME_CHECKPOINT",
      "HERMES_RUNTIME_FAILURE_EVAL",
      "Persisted runtime trace",
      "Failure evaluations",
      "Evidence digest",
      "Source checkpoint",
    ]) {
      expect(panel).toContain(marker)
    }
  })

  it("keeps the runtime trace read-only and excludes raw secret surfaces", () => {
    const panel = readFileSync("components/trace/runtime-trace-panel.tsx", "utf8")
    expect(panel).toContain("No evaluator, replay")
    expect(panel).not.toMatch(/<button|onClick=|password|cookie|session value/i)
  })

  it("labels the historical ledger separately from persisted execution truth", () => {
    const page = readFileSync("app/(shell)/trace/page.tsx", "utf8")
    expect(page).toContain("Historical / static Trace Ledger")
    expect(page).toContain("RuntimeTracePanel")
    expect(page).toContain("TraceLedgerPanel")
  })
})
