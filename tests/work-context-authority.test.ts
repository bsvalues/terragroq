import { describe, expect, it } from "vitest"

import { hashRecord } from "@/lib/governance/hash"
import {
  deriveWorkContextAuthority,
  validateWorkContextRequest,
  type WorkContextAuthorityGrantRow,
  type WorkContextWorkOrderRow,
} from "@/lib/governance/work-context-authority"

const allowed = ["app/api/governance/work-context/route.ts", "lib/governance/work-context-authority.ts"]
const forbidden = ["scripts/hermes-bridge/**"]
const workOrder: WorkContextWorkOrderRow = {
  id: 71,
  userId: "owner-1",
  ref: "WO-EXPV2-DELIVERY-001",
  status: "active",
  goal: "WILLIAMOS_EXPERIENCE_V2",
  authorityLevel: "A2_WRITE_OWN",
  authorityGrantId: 91,
  agent: "codex",
  allowedFiles: allowed,
  forbiddenFiles: forbidden,
  updatedAt: "2026-08-29T18:00:00.000Z",
}

function grant(overrides: Partial<WorkContextAuthorityGrantRow> = {}): WorkContextAuthorityGrantRow {
  const draft = {
    userId: "owner-1",
    ref: "GRANT-EXPV2-DELIVERY-001",
    workOrderId: 71,
    grantedBy: "owner-1",
    grantedTo: "codex",
    authorityLevel: "A2_WRITE_OWN",
    scope: "WO-EXPV2-DELIVERY-001",
    allowedActions: [...allowed].reverse(),
    blockedActions: [...forbidden],
    reason: "Exact Experience V2 delivery reservation.",
    status: "active",
    expiresAt: "2026-08-30T18:00:00.000Z",
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    createdAt: "2026-08-29T18:00:00.000Z",
  }
  return { id: 91, ...draft, contentHash: hashRecord(draft), ...overrides }
}

describe("server-derived work-context authority", () => {
  it("accepts only a work-order reference plus reconciliation context", () => {
    expect(validateWorkContextRequest({
      workOrderRef: workOrder.ref,
      existingSubsystem: "integrating",
      topologySource: "canonical-registry",
      collisions: [],
      remainingParentAcceptance: "continue Experience V2",
    })).toMatchObject({ ok: true })
  })

  it.each(["authorityLevel", "reservedPaths", "mainSha", "doctrineDigest", "workOrderVersion", "grantVersion", "reservationVersion"])(
    "rejects the client-supplied machine claim %s",
    (field) => expect(validateWorkContextRequest({
      workOrderRef: workOrder.ref,
      existingSubsystem: "integrating",
      topologySource: "canonical-registry",
      collisions: [],
      remainingParentAcceptance: "continue Experience V2",
      [field]: "manufactured",
    })).toMatchObject({ ok: false, detail: expect.stringContaining(field) }),
  )

  it("derives owner, outcome, authority, exact normalized reservation and immutable versions", () => {
    const result = deriveWorkContextAuthority({ ownerUserId: "owner-1", workOrder, grant: grant(), now: new Date("2026-08-29T19:00:00Z") })
    expect(result).toMatchObject({
      ok: true,
      authority: {
        parentOutcome: "WILLIAMOS_EXPERIENCE_V2",
        authorityLevel: "A2_WRITE_OWN",
        reservedPaths: [...allowed].sort(),
        forbiddenPaths: forbidden,
        grantVersion: grant().contentHash,
      },
    })
    expect(result.authority?.workOrderVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(result.authority?.reservationVersion).toMatch(/^[0-9a-f]{64}$/)
  })

  it("uses reciprocal database ids instead of parsing the human-readable grant scope", () => {
    const result = deriveWorkContextAuthority({
      ownerUserId: "owner-1",
      workOrder,
      grant: grant({ scope: "WILLIAMOS_EXPERIENCE_V2 exact delivery" }),
      now: new Date("2026-08-29T19:00:00Z"),
    })
    expect(result.ok).toBe(true)
  })

  it("changes the Work Order snapshot when a database Date version moves", () => {
    const first = deriveWorkContextAuthority({ ownerUserId: "owner-1", workOrder: { ...workOrder, updatedAt: new Date("2026-08-29T18:00:00Z") }, grant: grant() })
    const moved = deriveWorkContextAuthority({ ownerUserId: "owner-1", workOrder: { ...workOrder, updatedAt: new Date("2026-08-29T18:01:00Z") }, grant: grant() })
    expect(first.authority?.workOrderVersion).not.toBe(moved.authority?.workOrderVersion)
  })

  it.each([
    ["foreign work order", { workOrder: { ...workOrder, userId: "somebody-else" } }],
    ["inactive work order", { workOrder: { ...workOrder, status: "review" } }],
    ["unbound grant", { grant: grant({ id: 92 }) }],
    ["foreign grant", { grant: grant({ userId: "somebody-else" }) }],
    ["wrong work order", { grant: grant({ workOrderId: 72 }) }],
    ["wrong recipient", { grant: grant({ grantedTo: "operator" }) }],
    ["revoked grant", { grant: grant({ revokedAt: "2026-08-29T18:30:00Z" }) }],
    ["expired grant", { grant: grant({ expiresAt: "2026-08-29T18:30:00Z" }) }],
    ["widened allowlist", { grant: grant({ allowedActions: [...allowed, "app/**"] }) }],
    ["weakened blocklist", { grant: grant({ blockedActions: [] }) }],
    ["missing content hash", { grant: grant({ contentHash: "" }) }],
  ])("fails closed for %s", (_label, change) => {
    const result = deriveWorkContextAuthority({
      ownerUserId: "owner-1",
      workOrder: (change.workOrder ?? workOrder) as WorkContextWorkOrderRow,
      grant: (change.grant ?? grant()) as WorkContextAuthorityGrantRow,
      now: new Date("2026-08-29T19:00:00Z"),
    })
    expect(result.ok).toBe(false)
  })
})
