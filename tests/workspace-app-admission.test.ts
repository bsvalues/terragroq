import { describe, expect, it, vi } from "vitest"

import { admitWorkspaceApp, inspectWorkspaceApp, williamOsOrigin } from "@/lib/environment/workspace-app"

function htmlResponse(body = "<title>TerraFusion</title>", init: ResponseInit = {}, url = "http://tf.test:5000/") {
  const response = new Response(body, {
    status: 200,
    ...init,
    headers: { "content-type": "text/html", ...init.headers },
  })
  Object.defineProperty(response, "url", { value: url })
  return response
}

describe("running workspace app admission", () => {
  it("uses the configured WilliamOS identity rather than client-controlled forwarding headers", () => {
    expect(williamOsOrigin("https://williamos.example/auth", "http://internal:3000/api/environment/space"))
      .toBe("https://williamos.example")
    expect(williamOsOrigin(null, "http://internal:3000/api/environment/space")).toBe("http://internal:3000")
  })
  it("admits only a live, identified, frameable server-owned endpoint", async () => {
    const fetcher = vi.fn(async () => htmlResponse()) as unknown as typeof fetch
    await expect(admitWorkspaceApp("http://tf.test:5000", "https://williamos.test", fetcher)).resolves.toEqual({
      ok: true,
      url: "http://tf.test:5000/",
    })
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: "GET", redirect: "follow" }))
  })

  it.each(["javascript:alert(1)", "http://owner:secret@tf.test/"])("rejects an invalid configured URL: %s", async (url) => {
    await expect(admitWorkspaceApp(url, "https://williamos.test", vi.fn() as never)).resolves.toEqual({ ok: false, reason: "URL_INVALID" })
  })

  it("rejects redirects away from the configured serving origin", async () => {
    const fetcher = vi.fn(async () => htmlResponse(undefined, {}, "https://attacker.test/")) as unknown as typeof fetch
    await expect(admitWorkspaceApp("http://tf.test:5000", "https://williamos.test", fetcher)).resolves.toEqual({ ok: false, reason: "UNREACHABLE" })
  })

  it("rejects a live page that is not TerraFusion", async () => {
    const fetcher = vi.fn(async () => htmlResponse("<title>Another app</title>")) as unknown as typeof fetch
    await expect(admitWorkspaceApp("http://tf.test:5000", "https://williamos.test", fetcher)).resolves.toEqual({ ok: false, reason: "IDENTITY_MISMATCH" })
  })

  it.each<HeadersInit>([
    { "x-frame-options": "DENY" },
    { "x-frame-options": "SAMEORIGIN" },
    { "content-security-policy": "default-src 'self'; frame-ancestors 'none'" },
  ])("rejects an endpoint whose response refuses the WilliamOS frame: %o", async (headers) => {
    const fetcher = vi.fn(async () => htmlResponse(undefined, { headers })) as unknown as typeof fetch
    await expect(admitWorkspaceApp("http://tf.test:5000", "https://williamos.test", fetcher)).resolves.toEqual({ ok: false, reason: "EMBEDDING_REFUSED" })
  })

  it("accepts an explicit TerraFusion identity header without reading identity from presentation", async () => {
    const fetcher = vi.fn(async () => htmlResponse("<main>ready</main>", { headers: { "x-williamos-workspace-app": "terrafusion" } })) as unknown as typeof fetch
    await expect(admitWorkspaceApp("http://tf.test:5000", "https://williamos.test", fetcher)).resolves.toMatchObject({ ok: true })
  })

  it("returns bounded exact attached Preview evidence without raw response material", async () => {
    const fetcher = vi.fn(async () => htmlResponse(
      "<html><title>TerraFusion secret-build-marker</title></html>",
      { headers: { "x-private-runtime-token": "must-not-escape" } },
      "http://tf.test:5000/app",
    )) as unknown as typeof fetch

    const evidence = await inspectWorkspaceApp(
      "http://tf.test:5000/app#client-fragment",
      "https://williamos.test",
      fetcher,
      () => new Date("2026-08-30T02:00:00.000Z"),
    )

    expect(evidence).toEqual({
      schemaVersion: 1,
      status: "attached",
      reason: null,
      configuredUrl: "http://tf.test:5000/app",
      admittedUrl: "http://tf.test:5000/app",
      origin: "http://tf.test:5000",
      identity: "TerraFusion",
      reachable: true,
      frameable: true,
      checkedAt: "2026-08-30T02:00:00.000Z",
      limitations: { dom: "unavailable", console: "unavailable", network: "unavailable" },
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(evidence)).not.toContain("secret-build-marker")
    expect(JSON.stringify(evidence)).not.toContain("must-not-escape")
  })

  it.each([
    ["not configured", null, vi.fn(), "NOT_CONFIGURED", false, false],
    ["unreachable", "http://tf.test:5000", vi.fn(async () => { throw new Error("private socket detail") }), "UNREACHABLE", false, false],
    ["identity mismatch", "http://tf.test:5000", vi.fn(async () => htmlResponse("<title>Other app private body</title>")), "IDENTITY_MISMATCH", true, true],
    ["embedding refused", "http://tf.test:5000", vi.fn(async () => htmlResponse(undefined, { headers: { "x-frame-options": "DENY" } })), "EMBEDDING_REFUSED", true, false],
  ] as const)("returns typed safe evidence when Preview is %s", async (_case, configured, fetcher, reason, reachable, frameable) => {
    const evidence = await inspectWorkspaceApp(
      configured,
      "https://williamos.test",
      fetcher as unknown as typeof fetch,
      () => new Date("2026-08-30T02:01:00.000Z"),
    )

    expect(evidence).toMatchObject({
      status: "unavailable", reason, reachable, frameable,
      admittedUrl: null, identity: "unverified",
      checkedAt: "2026-08-30T02:01:00.000Z",
    })
    expect(JSON.stringify(evidence)).not.toContain("private")
  })

  it("keeps its semantic fingerprint stable across checks and changes it when evidence changes", async () => {
    const attached = vi.fn(async () => htmlResponse()) as unknown as typeof fetch
    const first = await inspectWorkspaceApp("http://tf.test:5000", "https://williamos.test", attached, () => new Date("2026-08-30T02:02:00.000Z"))
    const later = await inspectWorkspaceApp("http://tf.test:5000", "https://williamos.test", attached, () => new Date("2026-08-30T02:03:00.000Z"))
    const changed = await inspectWorkspaceApp("http://tf.test:5001", "https://williamos.test", vi.fn(async () => { throw new Error("down") }) as unknown as typeof fetch)

    expect(later.checkedAt).not.toBe(first.checkedAt)
    expect(later.fingerprint).toBe(first.fingerprint)
    expect(changed.fingerprint).not.toBe(first.fingerprint)
  })
})
