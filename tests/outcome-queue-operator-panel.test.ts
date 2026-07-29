import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  new URL(
    "../components/outcome-queue/operator-outcome-queue-panel.tsx",
    import.meta.url,
  ),
  "utf8",
)
const actionSource = readFileSync(
  new URL("../app/actions/outcome-queue.ts", import.meta.url),
  "utf8",
)
const authoritySource = readFileSync(
  new URL("../app/actions/authority.ts", import.meta.url),
  "utf8",
)
const acceptanceAuthoritySource = readFileSync(
  new URL(
    "../lib/outcome-queue/v1-2-acceptance-authority.ts",
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
    expect(source).toContain("aria-label={`Set dependencies for ${row.title}`}")
    expect(source).toContain("aria-label={`Supersede ${row.title}`}")
    expect(source).toContain("aria-label={`Decline ${row.title}`}")
    expect(source).toContain("<DialogTitle>Supersede outcome</DialogTitle>")
    expect(source).toContain("<DialogTitle>Set outcome dependencies</DialogTitle>")
    expect(source).toContain('type="checkbox"')
    expect(source).toContain('<Label htmlFor="replacement-title">')
    expect(source).toContain('id="replacement-title"')
  })

  it("refreshes current truth after a typed stale mutation result", () => {
    expect(source).toContain('if (result.status === "STALE") router.refresh()')
    expect(source).toContain('if (result.status === "UNAUTHORIZED") router.refresh()')
  })

  it("records authority only from an accepted exact-scope approve decision", () => {
    expect(source).toContain("recordOutcomeAuthorityGrant")
    expect(source).toContain("Record authority")
    expect(source).toContain("shouldOfferOutcomeAuthorityBinding")
    expect(actionSource).toContain("isOutcomeAuthorityBindingAllowed(item, approval)")
    expect(authoritySource).toContain("pg_advisory_xact_lock")
    expect(authoritySource).toContain("authority-grant-allocation")
    expect(authoritySource).toContain("ensureDbEvidence")
    expect(authoritySource).toContain("transaction.insert(governanceEvent)")
    expect(authoritySource).toContain("transaction.insert(eventLog)")
    expect(actionSource).toContain("reuseActiveScope: true")
    expect(actionSource).toContain("shouldRebindOutcomeAuthority")
    expect(actionSource).toContain("matchOutcomeAuthorityGrant")
    expect(actionSource).toContain("expectedVersion: item.version")
    expect(actionSource).toContain("scope: item.outcomeKey")
    expect(actionSource).toContain("allowedActions: [item.authorityAction]")
    expect(actionSource).toContain('"authority expansion"')
    expect(actionSource).toContain('"issue #357"')
    expect(authoritySource).toContain("reason: draft.reason")
    expect(authoritySource).toContain("draft.expiresAt.toISOString()")
  })

  it("exposes bounded Primary actions for the two V1.2 acceptance authority proofs", () => {
    expect(source).toContain("recordV12AcceptanceAuthority")
    expect(source).toContain("revokeV12AcceptanceAuthority")
    expect(source).toContain("Approve proof")
    expect(source).toContain("Revoke proof authority")
    expect(source).toContain("V1_2_ACCEPTANCE_AUTHORITY_SCOPES")
    expect(actionSource).toContain('"acceptance:v1-2:authority-blocked"')
    expect(acceptanceAuthoritySource).toContain('"acceptance:v1-2:dependency-blocked"')
    expect(acceptanceAuthoritySource).toContain('item.authorityLevel === "A0_READ_ONLY"')
    expect(acceptanceAuthoritySource).toContain('item.authorityAction === "outcome:execute"')
    expect(actionSource).toContain("isCanonicalV12AcceptanceCandidate")
    expect(actionSource).toContain("isExactV12AcceptanceGrant")
    expect(actionSource).toContain("pg_advisory_xact_lock")
    expect(actionSource).toContain("V1_2_ACCEPTANCE_AUTHORITY_ATOMICITY_WALL")
    expect(actionSource).toContain("v12AcceptanceAuthorityRefs")
    expect(acceptanceAuthoritySource).toContain("ADR-V12-${suffix}")
    expect(acceptanceAuthoritySource).toContain("GRANT-V12-${suffix}")
    expect(actionSource).toContain("V1_2_ACCEPTANCE_AUTHORITY_REFERENCE_COLLISION_WALL")
    expect(actionSource).toContain("expiresAt: null")
    expect(source).toContain("!acceptanceAuthorityProof")
    expect(source).toContain('row.lifecycleState === "active" && !acceptanceAuthorityProof')
    expect(source).toContain('row.lifecycleState === "blocked" && !acceptanceAuthorityProof')
  })
})
