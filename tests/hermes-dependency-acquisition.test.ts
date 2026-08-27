import { describe, expect, it } from "vitest"

import { OUTCOME_QUEUE_SQL } from "@/scripts/hermes-bridge/outcome-queue-source.mjs"

/**
 * The grant-backed routed-dependency acquisition lane (v2 authority). A SEPARATE acquire query for
 * outcome_queue_item rows carrying a canonicalDependencyId, so the resident loop can autonomously
 * acquire a runtime_control:control PROVISION under a CONCRETE scoped grant — WITHOUT weakening the
 * legacy bounded-authority fence (authoritySubject='operator', authorityAction='outcome:execute',
 * protected-content regex) that guards ordinary goal outcomes.
 *
 * Assertions are string-level over OUTCOME_QUEUE_SQL — the single source of truth the runtime and the
 * DB share. SQL planner validity is exercised separately against real Postgres.
 */

const legacy = OUTCOME_QUEUE_SQL.acquire
const dep = OUTCOME_QUEUE_SQL.acquireDependency

describe("routed-dependency acquisition SQL — the grant-backed lane", () => {
  it("exists as a distinct query reusing the SAME lease/fence UPDATE", () => {
    expect(typeof dep).toBe("string")
    expect(dep).toContain(`"fencingToken" = q."fencingToken" + 1`)
    expect(dep).toContain(`"version" = q."version" + 1`)
    expect(dep).toContain("FOR UPDATE OF q SKIP LOCKED")
    expect(dep).toContain("RETURNING")
  })

  it("gates on canonicalDependencyId and a LIVE routed dependency + live parent WO", () => {
    expect(dep).toContain(`q."canonicalDependencyId" IS NOT NULL`)
    expect(dep).toContain(`FROM "routed_dependency" AS dep`)
    expect(dep).toContain(`dep."routingState" IN ('raised', 'routed', 'accepted')`)
    expect(dep).toContain(`FROM "work_order" AS dep_wo`)
    expect(dep).toContain(`dep_wo."status" = 'active'`)
  })

  it("requires a CONCRETE active authority grant — never trusts 'matched' alone", () => {
    expect(dep).toContain(`q."authorityState" = 'matched'`)
    expect(dep).toContain(`FROM "authority_grant" AS dep_grant`)
    expect(dep).toContain(`dep_grant."ref" = q."authorityGrantRef"`)
    expect(dep).toContain(`dep_grant."grantedTo" = q."authoritySubject"`)
    expect(dep).toContain(`dep_grant."scope" = q."outcomeKey"`)
    expect(dep).toContain(`dep_grant."status" = 'active'`)
    expect(dep).toContain(`dep_grant."revokedAt" IS NULL`)
    expect(dep).toContain(`dep_grant."authorityLevel" = q."authorityLevel"`)
    // Bound to the exact work order (never a null-WO grant).
    expect(dep).toContain(`dep_grant."workOrderId" IS NOT NULL`)
    // Capability actually permitted / not blocked.
    expect(dep).toContain(`dep_grant."allowedActions"`)
    expect(dep).toContain(`dep_grant."blockedActions"`)
  })

  it("carries a STRUCTURED hard-deny (capability classes, NOT lexical content)", () => {
    expect(dep).toContain(`q."envelopeClass" = 'data' AND q."envelopeCapability" = 'destructive'`)
    expect(dep).toContain(`q."envelopeClass" = 'delivery' AND q."envelopeCapability" = 'release'`)
    expect(dep).toContain(`q."envelopeClass" = 'secrets'`)
    // runtime_control is deliberately NOT hard-denied — it is exactly what this lane authorizes.
    expect(dep).not.toContain(`q."envelopeClass" = 'runtime_control'`)
  })

  it("does NOT apply the legacy bounded-authority fence or protected-content regex", () => {
    expect(dep).not.toContain(`q."authorityAction" = 'outcome:execute'`)
    expect(dep).not.toContain(`q."authoritySubject" = 'operator'`)
    expect(dep).not.toContain("terrafusion")
    expect(dep).not.toContain("taxpayer")
    expect(dep).not.toMatch(/!~\*/) // no negated case-insensitive content regex
  })
})

describe("legacy bounded-authority lane — untouched", () => {
  it("still enforces the fence exactly as before", () => {
    expect(legacy).toContain(`q."authorityAction" = 'outcome:execute'`)
    expect(legacy).toContain(`q."authoritySubject" = 'operator'`)
    expect(legacy).toContain("terrafusion") // protected-content regex intact
    expect(legacy).toMatch(/!~\*/)
  })

  it("never enters the dependency lane: no routed_dependency / grant-join origin", () => {
    expect(legacy).not.toContain(`FROM "routed_dependency" AS dep`)
    expect(legacy).not.toContain(`FROM "authority_grant" AS dep_grant`)
  })
})

describe("the leased row carries the dependency identity (seam branch depends on it)", () => {
  it("acquire RETURNING (QUEUE_COLUMNS) includes canonicalDependencyId + envelope columns", () => {
    // The legacy acquire's WHERE never mentions these columns, so their presence proves the RETURNING
    // list carries them. Without canonicalDependencyId on the leased row, the runtime cannot tell a
    // projection from a goal and walls it as HERMES_OUTCOME_QUEUE_GOAL_WALL.
    for (const col of [
      `q."canonicalDependencyId"`,
      `q."envelopeResource"`,
      `q."envelopeClass"`,
      `q."envelopeCapability"`,
      `q."envelopeDigest"`,
    ]) {
      expect(legacy).toContain(col)
      expect(dep).toContain(col)
    }
  })
})

describe("divergence guard — both lanes share identical serialization", () => {
  const SERIALIZATION = [
    `occupied_slot."lifecycleReason" = 'PROVIDER_UNAVAILABLE'`,
    `WHERE completed_dependency."lifecycleState" IS DISTINCT FROM 'completed'`,
    `live."lifecycleReason" IS DISTINCT FROM 'PROVIDER_UNAVAILABLE'`,
    `q."riskClass" IN ('R0', 'R1')`,
  ]
  it("one-active-slot / deps-satisfied / in-flight blocks are present in BOTH", () => {
    for (const frag of SERIALIZATION) {
      expect(legacy).toContain(frag)
      expect(dep).toContain(frag)
    }
  })
})
