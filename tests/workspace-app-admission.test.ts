import { describe, expect, it, vi } from "vitest"

import { admitWorkspaceApp, williamOsOrigin } from "@/lib/environment/workspace-app"

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
})
