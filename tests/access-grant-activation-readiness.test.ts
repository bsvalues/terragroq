import { describe, expect, it } from "vitest"
import { POST as acceptPost } from "@/app/api/access-grants/accept/route"
import { POST as issuePost } from "@/app/api/access-grants/issue/route"
import { getAccessGrantReadiness } from "@/lib/access-grants/readiness"
import { persistAccessGrantAuditEventPreview } from "@/lib/access-grants/persistence"

describe("access grant activation readiness", () => {
  it("reports access grants as disabled and scaffolded", () => {
    expect(getAccessGrantReadiness()).toMatchObject({
      enabled: false,
      configured: false,
      runtimeMode: "disabled",
      issueRoute: "disabled",
      acceptRoute: "disabled",
      persistence: "scaffolded-disabled",
      auditWriter: "scaffolded-disabled",
      limiter: "scaffolded-disabled",
    })
  })

  it("keeps audit persistence disabled and redacted", () => {
    const result = persistAccessGrantAuditEventPreview(
      { enabled: false },
      {
        correlationId: "corr-disabled",
        metadata: {
          rawToken: "wag_secret",
          tokenPrefix: "wag_1234",
        },
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "runtime_disabled",
      auditEvent: {
        outcome: "disabled",
        reasonCode: "PERSISTENCE_DISABLED",
      },
    })
    expect(JSON.stringify(result)).not.toContain("wag_secret")
    expect(JSON.stringify(result)).toContain("wag_1234")
  })

  it("returns disabled response for issue route without granting access", async () => {
    const response = await issuePost()
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(payload).toMatchObject({
      ok: false,
      error: "ACCESS_GRANTS_DISABLED",
      readiness: {
        enabled: false,
        issueRoute: "disabled",
      },
      auditPreview: {
        outcome: "disabled",
        reasonCode: "RUNTIME_DISABLED",
      },
    })
  })

  it("returns disabled response for accept route without leaking raw token", async () => {
    const request = new Request("https://example.test/api/access-grants/accept", {
      method: "POST",
      body: JSON.stringify({ token: "wag_secret" }),
    })
    const response = await acceptPost(request)
    const payload = await response.json()
    const serialized = JSON.stringify(payload)

    expect(response.status).toBe(403)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(payload).toMatchObject({
      ok: false,
      error: "ACCESS_GRANTS_DISABLED",
      reason: "runtime_disabled",
      readiness: {
        enabled: false,
        acceptRoute: "disabled",
      },
    })
    expect(serialized).not.toContain("wag_secret")
  })
})
