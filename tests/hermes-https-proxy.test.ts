import { describe, expect, it } from "vitest"

import { DEVICE_AUTH_HEADER, validateDeviceMutationOrigin } from "@/lib/device-auth/contract"
import {
  HERMES_HTTPS_HOST,
  HERMES_HTTPS_ORIGIN,
  HERMES_HTTPS_PORT,
  HERMES_UPSTREAM_ORIGIN,
  buildDownstreamHeaders,
  buildUpstreamHeaders,
} from "@/scripts/hermes-https-proxy.mjs"

describe("HERMES HTTPS proxy boundary", () => {
  it("is fixed to the approved HERMES listener and loopback-only upstream", () => {
    expect(HERMES_HTTPS_ORIGIN).toBe("https://192.168.88.9:3443")
    expect(HERMES_HTTPS_HOST).toBe("192.168.88.9")
    expect(HERMES_HTTPS_PORT).toBe(3443)
    expect(HERMES_UPSTREAM_ORIGIN).toBe("http://127.0.0.1:3100")
  })

  it("removes hop-by-hop headers and records the exact HTTPS forwarding boundary", () => {
    expect(buildUpstreamHeaders({
      host: "192.168.88.9:3443",
      connection: "keep-alive",
      forwarded: "for=attacker;host=evil.example;proto=http",
      upgrade: "websocket",
      "proxy-authorization": "secret",
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-host": "evil.example",
      "x-forwarded-port": "80",
      "x-forwarded-proto": "http",
      "x-request-id": "request-1",
    })).toEqual({
      host: "192.168.88.9:3443",
      "x-forwarded-host": "192.168.88.9:3443",
      "x-forwarded-port": "3443",
      "x-forwarded-proto": "https",
      "x-request-id": "request-1",
    })
  })

  it("strips upstream hop-by-hop headers and adds the HTTPS transport policy", () => {
    expect(buildDownstreamHeaders({
      connection: "keep-alive",
      "content-type": "application/json",
      server: "Next.js",
      "transfer-encoding": "chunked",
    })).toEqual({
      "content-type": "application/json",
      "strict-transport-security": "max-age=31536000",
    })
  })

  it("preserves the external request origin required by device mutations", () => {
    const headers = buildUpstreamHeaders({
      host: "192.168.88.9:3443",
      origin: HERMES_HTTPS_ORIGIN,
      [DEVICE_AUTH_HEADER]: "1",
    })
    const request = new Request("https://127.0.0.1:3100/api/device/session/challenge", {
      method: "POST",
      headers: headers as HeadersInit,
    })

    expect(validateDeviceMutationOrigin(request, [HERMES_HTTPS_ORIGIN], {
      trustLoopbackHttpsProxy: true,
    })).toBe(HERMES_HTTPS_ORIGIN)
  })
})
