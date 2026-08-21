import { describe, expect, it } from "vitest"

import { exceedsLineCap, guardLineRequest, MAX_LINE_BYTES } from "@/lib/environment/line-guard"

/**
 * The Line's POST is cookie-authenticated and state-changing, so it must refuse the cross-site CSRF
 * shape an adversarial review demonstrated (simple content types, no preflight) and oversized bodies
 * (model-call amplification). These assert the guard closes both while leaving the real same-origin
 * JSON client untouched.
 */
function req(headers: Record<string, string>): Request {
  return new Request("https://192.168.88.9:3443/api/environment/line", { method: "POST", headers })
}

const SAME_ORIGIN = "https://192.168.88.9:3443"
const proxied = { "x-forwarded-proto": "https", "x-forwarded-host": "192.168.88.9:3443" }

describe("guardLineRequest", () => {
  it("admits the real same-origin JSON request the Desk sends", () => {
    expect(guardLineRequest(req({ "content-type": "application/json", origin: SAME_ORIGIN, ...proxied }))).toBeNull()
    // charset parameter is fine
    expect(guardLineRequest(req({ "content-type": "application/json; charset=utf-8", origin: SAME_ORIGIN, ...proxied }))).toBeNull()
  })

  it("refuses the CORS simple content types a cross-site form can send without preflight", () => {
    for (const contentType of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      expect(guardLineRequest(req({ "content-type": contentType, ...proxied }))).toEqual({
        status: 415,
        error: "UNSUPPORTED_MEDIA_TYPE",
      })
    }
  })

  it("refuses a request with no content type at all", () => {
    expect(guardLineRequest(req({ ...proxied }))).toEqual({ status: 415, error: "UNSUPPORTED_MEDIA_TYPE" })
  })

  it("refuses a cross-origin request even when it declares JSON", () => {
    expect(guardLineRequest(req({ "content-type": "application/json", origin: "https://evil.example", ...proxied }))).toEqual({
      status: 403,
      error: "CROSS_ORIGIN_REFUSED",
    })
  })

  it("allows a JSON request with no Origin header (server-to-server), since only browsers attach one", () => {
    expect(guardLineRequest(req({ "content-type": "application/json", ...proxied }))).toBeNull()
  })

  it("matches Origin against the forwarded host, not a spoofable one", () => {
    // Same forwarded origin the proxy stamps; a hostile Host cannot widen it because the proxy
    // overwrites forwarded headers.
    expect(guardLineRequest(req({ "content-type": "application/json", origin: SAME_ORIGIN, ...proxied }))).toBeNull()
    expect(guardLineRequest(req({ "content-type": "application/json", origin: "https://192.168.88.9:3000", ...proxied }))).toEqual({
      status: 403,
      error: "CROSS_ORIGIN_REFUSED",
    })
  })

  it("rejects an oversized declared Content-Length fast", () => {
    expect(guardLineRequest(req({ "content-type": "application/json", origin: SAME_ORIGIN, "content-length": String(MAX_LINE_BYTES + 1), ...proxied }))).toEqual({
      status: 413,
      error: "MESSAGE_TOO_LARGE",
    })
    expect(guardLineRequest(req({ "content-type": "application/json", origin: SAME_ORIGIN, "content-length": String(MAX_LINE_BYTES), ...proxied }))).toBeNull()
  })
})

describe("exceedsLineCap", () => {
  it("catches an oversized body when the Content-Length header lied or was absent", () => {
    expect(exceedsLineCap("a".repeat(MAX_LINE_BYTES))).toBe(false)
    expect(exceedsLineCap("a".repeat(MAX_LINE_BYTES + 1))).toBe(true)
  })

  it("measures bytes, not code units, so multibyte input cannot smuggle past the cap", () => {
    // Each '€' is 3 UTF-8 bytes; a string of them well under the cap in length can exceed it in bytes.
    const euros = "€".repeat(MAX_LINE_BYTES / 2)
    expect(euros.length).toBeLessThan(MAX_LINE_BYTES)
    expect(exceedsLineCap(euros)).toBe(true)
  })
})

import { readBoundedJson } from "@/lib/environment/line-guard"

/** Build a POST Request whose body streams the given bytes (optionally lying about Content-Length). */
function streamingReq(payload: string, headers: Record<string, string> = {}): Request {
  return new Request("https://192.168.88.9:3443/api/environment/line", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: payload,
    // @ts-expect-error Node's undici needs duplex to send a body stream
    duplex: "half",
  })
}

describe("readBoundedJson bounds the actual bytes", () => {
  it("parses a normal JSON body", async () => {
    const r = await readBoundedJson(streamingReq(JSON.stringify({ text: "hi", worldId: "w1" })))
    expect(r).toEqual({ ok: true, value: { text: "hi", worldId: "w1" } })
  })

  it("rejects a small text beside a huge ignored field — the P2 bypass — while streaming, not after buffering", async () => {
    const payload = JSON.stringify({ text: "hi", junk: "x".repeat(MAX_LINE_BYTES * 2) })
    const r = await readBoundedJson(streamingReq(payload))
    expect(r).toEqual({ ok: false, status: 413, error: "MESSAGE_TOO_LARGE" })
  })

  it("rejects an oversized body even when Content-Length lies about being small", async () => {
    const payload = JSON.stringify({ text: "x".repeat(MAX_LINE_BYTES * 2) })
    const r = await readBoundedJson(streamingReq(payload, { "content-length": "10" }))
    expect(r).toEqual({ ok: false, status: 413, error: "MESSAGE_TOO_LARGE" })
  })

  it("returns INVALID_BODY on malformed JSON within the cap", async () => {
    const r = await readBoundedJson(streamingReq("{ not json"))
    expect(r).toEqual({ ok: false, status: 400, error: "INVALID_BODY" })
  })
})
