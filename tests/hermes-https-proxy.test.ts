import { describe, expect, it } from "vitest"

import { DEVICE_AUTH_HEADER, validateDeviceMutationOrigin } from "@/lib/device-auth/contract"
import {
  DEVICE_HEADER,
  HERMES_HTTPS_HOST,
  HERMES_HTTPS_ORIGIN,
  HERMES_HTTPS_PORT,
  HERMES_UPSTREAM_ORIGIN,
  buildDownstreamHeaders,
  buildTlsServerOptions,
  buildUpstreamHeaders,
  verifiedDeviceName,
} from "@/scripts/hermes-https-proxy.mjs"

/** A socket stub shaped like the parts of tls.TLSSocket this proxy actually reads. */
function socketWith({ authorized, CN }: { authorized: boolean; CN?: unknown }) {
  return { authorized, getPeerCertificate: () => (CN === undefined ? {} : { subject: { CN } }) }
}

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

describe("HERMES HTTPS proxy device identity", () => {
  it("keeps the proxy-asserted identity header distinct from the client-asserted one", () => {
    // These two must never share a name: the client sets DEVICE_AUTH_HEADER, while DEVICE_HEADER is
    // asserted by the proxy and trusted as identity. One name for both meant the proxy stripped a
    // header the app requires, and would have let the two paths be confused for each other.
    expect(DEVICE_HEADER).not.toBe(DEVICE_AUTH_HEADER)
  })

  it("never lets a client assert the certificate identity header", () => {
    // The app treats this header as proof of identity, so an inbound copy must not survive -- with
    // or without a certificate of the client's own, and whatever casing it arrives in.
    expect(buildUpstreamHeaders({ host: "h", [DEVICE_HEADER]: "williams-iphone" })[DEVICE_HEADER])
      .toBeUndefined()
    expect(buildUpstreamHeaders({ host: "h", "X-WilliamOS-Device-Cert": "williams-iphone" })[DEVICE_HEADER])
      .toBeUndefined()
  })

  it("still forwards the client's device-mutation header untouched", () => {
    expect(buildUpstreamHeaders({ host: "h", [DEVICE_AUTH_HEADER]: "1" })[DEVICE_AUTH_HEADER]).toBe("1")
  })

  it("replaces a spoofed device header with the name TLS actually proved", () => {
    const headers = buildUpstreamHeaders({ host: "h", [DEVICE_HEADER]: "attacker" }, "hermes-desktop")
    expect(headers[DEVICE_HEADER]).toBe("hermes-desktop")
  })

  it("reports a device only when the certificate chain verified", () => {
    expect(verifiedDeviceName(socketWith({ authorized: true, CN: "williams-iphone" }))).toBe("williams-iphone")
    // An unverified peer is the self-signed case: any CN could be chosen, so it must not be trusted.
    expect(verifiedDeviceName(socketWith({ authorized: false, CN: "williams-iphone" }))).toBeNull()
    expect(verifiedDeviceName(null)).toBeNull()
    expect(verifiedDeviceName({})).toBeNull()
  })

  it("refuses certificate subjects that are not plain device names", () => {
    for (const CN of ["", "-leading", ".leading", "has space", "evil\r\nx-forwarded-proto: http", "a".repeat(65), 7, null]) {
      expect(verifiedDeviceName(socketWith({ authorized: true, CN }))).toBeNull()
    }
    expect(verifiedDeviceName(socketWith({ authorized: true }))).toBeNull()
    expect(verifiedDeviceName(socketWith({ authorized: true, CN: "a".repeat(64) }))).toBe("a".repeat(64))
  })

  it("asks for client certificates without ever requiring one", () => {
    const options = buildTlsServerOptions({ pfx: "PFX", passphrase: "P", clientCa: "CA" })
    expect(options.requestCert).toBe(true)
    // rejectUnauthorized must stay false: true would refuse every device that has not enrolled,
    // which would lock the owner out of his own cockpit the moment client auth was switched on.
    expect(options.rejectUnauthorized).toBe(false)
    expect(options.ca).toBe("CA")
  })

  it("does not request client certificates when there is no CA to verify them against", () => {
    const options = buildTlsServerOptions({ pfx: "PFX", passphrase: "P", clientCa: null })
    expect(options.requestCert).toBeUndefined()
    expect(options.ca).toBeUndefined()
    expect(options).toEqual({ pfx: "PFX", passphrase: "P" })
  })
})
