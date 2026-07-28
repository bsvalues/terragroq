import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  new URL(
    "../components/outcome-queue/operator-outcome-queue-panel.tsx",
    import.meta.url,
  ),
  "utf8",
)

describe("operator outcome queue panel accessibility contract", () => {
  it("labels the queue region and every icon-only queue control", () => {
    expect(source).toContain('aria-labelledby="operator-outcome-queue-title"')
    expect(source).toContain('id="operator-outcome-queue-title"')
    expect(source).toContain('aria-label="Eligibility blockers"')
    expect(source).toContain("aria-label={`Move ${row.title} earlier`}")
    expect(source).toContain("aria-label={`Move ${row.title} later`}")
    expect(source).toContain("aria-label={`Supersede ${row.title}`}")
    expect(source).toContain("aria-label={`Decline ${row.title}`}")
    expect(source).toContain("<DialogTitle>Supersede outcome</DialogTitle>")
    expect(source).toContain('<Label htmlFor="replacement-title">')
    expect(source).toContain('id="replacement-title"')
  })

  it("refreshes current truth after a typed stale mutation result", () => {
    expect(source).toContain('if (result.status === "STALE") router.refresh()')
  })
})
