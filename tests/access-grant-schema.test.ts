import { getTableName } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import {
  accessGrant,
  accessGrantEvent,
  accessGrantSession,
  authorityGrant,
} from "@/lib/db/schema"
import {
  ACCESS_GRANT_DENIED_SCOPES,
  ACCESS_GRANT_EVENT_TYPES,
  ACCESS_GRANT_RESOURCE_TYPES,
  ACCESS_GRANT_SCOPES,
  ACCESS_GRANT_STATUSES,
  DEFERRED_ACCESS_GRANT_SCOPES,
} from "@/lib/access-grants/constants"

describe("access grant schema foundation", () => {
  it("adds separate access grant tables without reusing authority grants", () => {
    expect(getTableName(accessGrant)).toBe("access_grant")
    expect(getTableName(accessGrantSession)).toBe("access_grant_session")
    expect(getTableName(accessGrantEvent)).toBe("access_grant_event")
    expect(getTableName(authorityGrant)).toBe("authority_grant")
  })

  it("keeps initial access scopes read-only", () => {
    expect(ACCESS_GRANT_SCOPES).toEqual(
      expect.arrayContaining([
        "grant:evidence.read",
        "grant:work_order.read",
        "grant:decision_packet.read",
        "grant:readiness.read",
        "grant:brain_council_packet.read",
        "grant:hermes_packet.read",
        "grant:project_brief.read",
        "grant:builder_packet.read",
      ]),
    )
    expect(ACCESS_GRANT_SCOPES.every((scope) => scope.endsWith(".read"))).toBe(true)
    expect(DEFERRED_ACCESS_GRANT_SCOPES).toContain("grant:work_order.comment_limited")
  })

  it("keeps dangerous scopes out of the valid scope list", () => {
    for (const denied of ACCESS_GRANT_DENIED_SCOPES) {
      expect(ACCESS_GRANT_SCOPES).not.toContain(denied)
    }
  })

  it("defines bounded statuses, resource types, and audit event constants", () => {
    expect(ACCESS_GRANT_STATUSES).toEqual(["active", "expired", "revoked", "exhausted"])
    expect(ACCESS_GRANT_RESOURCE_TYPES).toContain("evidence_packet")
    expect(ACCESS_GRANT_RESOURCE_TYPES).toContain("work_order_packet")
    expect(ACCESS_GRANT_EVENT_TYPES).toContain("access_grant_created")
    expect(ACCESS_GRANT_EVENT_TYPES).toContain("access_grant_scope_denied")
    expect(ACCESS_GRANT_EVENT_TYPES).toContain("access_grant_revoked")
  })
})
