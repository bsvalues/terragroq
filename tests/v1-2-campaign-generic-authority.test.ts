import { beforeEach, describe, expect, it, vi } from "vitest"

const boundary = vi.hoisted(() => ({
  getUserId: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: {
    select: boundary.select,
    transaction: boundary.transaction,
    update: boundary.update,
  },
}))
vi.mock("@/lib/session", () => ({
  getUserId: boundary.getUserId,
}))
vi.mock("@/lib/registers/events", () => ({ logEvent: vi.fn() }))
vi.mock("@/lib/governance/events", () => ({ appendGovernanceEvent: vi.fn() }))
vi.mock("@/lib/governance/artifacts", () => ({ writeArtifact: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  createAuthorityGrantWithResult,
  revokeAuthorityGrant,
} from "@/app/actions/authority"

function selectedRows(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  query.limit.mockResolvedValue(rows)
  return query
}

describe("V1.2 campaign generic authority boundary", () => {
  beforeEach(() => {
    boundary.getUserId.mockReset()
    boundary.select.mockReset()
    boundary.transaction.mockReset()
    boundary.update.mockReset()
    boundary.getUserId.mockResolvedValue("primary-1")
  })

  it("rejects protected campaign scope before generic grant allocation", async () => {
    await expect(createAuthorityGrantWithResult({
      authorityLevel: "A0_READ_ONLY",
      scope: "campaign:v1-2:queue-evidence-drilldown",
      allowedActions: ["outcome:execute"],
    })).rejects.toThrow("V1_2_BOUND_AUTHORITY_ACTION_REQUIRED")
    expect(boundary.transaction).not.toHaveBeenCalled()
  })

  it("rejects protected acceptance scopes before generic grant allocation", async () => {
    await expect(createAuthorityGrantWithResult({
      authorityLevel: "A0_READ_ONLY",
      scope: "acceptance:v1-2:authority-blocked",
      allowedActions: ["outcome:execute"],
    })).rejects.toThrow("V1_2_BOUND_AUTHORITY_ACTION_REQUIRED")
    expect(boundary.transaction).not.toHaveBeenCalled()
  })

  it("rejects generic revocation of a campaign grant", async () => {
    boundary.select.mockReturnValue(selectedRows([{
      id: 7,
      scope: "campaign:v1-2:queue-evidence-drilldown",
    }]))
    await expect(revokeAuthorityGrant(7, "generic revoke"))
      .rejects.toThrow("V1_2_BOUND_AUTHORITY_ACTION_REQUIRED")
    expect(boundary.update).not.toHaveBeenCalled()
  })
})
