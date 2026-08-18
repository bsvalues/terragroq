import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"

import { afterEach, describe, expect, it } from "vitest"

import { DEVICE_SESSION_COOKIE, buildDeviceProof, verifyDeviceProof } from "@/lib/device-auth/contract"
import { openDeviceSession, requestJson } from "../scripts/governance/device-session.mjs"

/**
 * The device client decides WHO may obtain a work-context receipt, so "it looks right" is not a
 * standard it can be held to.
 *
 * The stub verifies the signature with the cockpit's own `verifyDeviceProof`. If the real server-side
 * verifier accepts what the client produced, the two halves genuinely agree about what a signature
 * covers -- a stub that accepted any signature would prove nothing, which is why the wrong-key case
 * below exists to show the check can actually fail.
 */

const servers: http.Server[] = []
afterEach(() => { for (const server of servers.splice(0)) server.close() })

const CREDENTIAL_ID = "cred-abcdefghijklmnopqrst"

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  return {
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  }
}

interface StubOptions {
  publicKeySpki: string
  challengeStatus?: number
  completeStatus?: number
  omitCookie?: boolean
}

/** A cockpit-shaped stub that records what it received, so request shaping is checkable. */
function stub(options: StubOptions) {
  const seen: { url: string; headers: http.IncomingHttpHeaders; body: Record<string, string> | null }[] = []
  let signatureValid: boolean | null = null
  const challengeId = crypto.randomUUID()
  const challenge = crypto.randomBytes(32).toString("base64url")
  // Issued ONCE. Recomputing it per request made the complete call sign a different expiry than the
  // challenge advertised, and expiresAt is part of the signed proof -- so the stub, not the client,
  // was producing the mismatch.
  const expiresAt = new Date(Date.now() + 60_000).toISOString()

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      const body = raw ? JSON.parse(raw) : null
      seen.push({ url: request.url ?? "", headers: request.headers, body })
      const origin = String(request.headers.origin)

      if (request.url?.endsWith("/challenge")) {
        response.writeHead(options.challengeStatus ?? 200, { "content-type": "application/json" })
        response.end(JSON.stringify({ challengeId, challenge, expiresAt }))
        return
      }
      if (request.url?.endsWith("/complete")) {
        // Built with the contract's OWN builder, not a copy of it. Hand-rolling the format here would
        // make the test a second definition of what a signature covers -- the very thing the client
        // avoids by importing the builder.
        const proof = buildDeviceProof({
          purpose: "authenticate",
          challengeId,
          challenge,
          origin,
          expiresAt,
        })
        signatureValid = verifyDeviceProof({
          proof,
          signature: String(body?.signature),
          publicKeySpki: options.publicKeySpki,
        })
        const headers: Record<string, string | string[]> = { "content-type": "application/json" }
        if (!options.omitCookie) headers["set-cookie"] = [DEVICE_SESSION_COOKIE + "=tok-123; Path=/; HttpOnly"]
        response.writeHead(options.completeStatus ?? 200, headers)
        response.end(JSON.stringify({ authenticated: true, expiresAt }))
        return
      }
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ ok: true }))
    })
  })
  servers.push(server)
  return {
    listen: () => new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve("http://127.0.0.1:" + (server.address() as AddressInfo).port))
    }),
    seen,
    signatureValid: () => signatureValid,
  }
}

const open = (baseUrl: string, privateKeyPkcs8: string) => openDeviceSession({
  baseUrl,
  credential: { credentialId: CREDENTIAL_ID, privateKeyPkcs8 },
  projectRoot: process.cwd(),
})

describe("device session client", () => {
  it("signs a proof the cockpit's own verifier accepts", async () => {
    const device = keypair()
    const server = stub({ publicKeySpki: device.publicKeySpki })
    const session = await open(await server.listen(), device.privateKeyPkcs8)
    expect(server.signatureValid()).toBe(true)
    expect(session.cookie).toBe(DEVICE_SESSION_COOKIE + "=tok-123")
  })

  it("is rejected when it signs with the wrong key, so the check above is not vacuous", async () => {
    const device = keypair()
    const other = keypair()
    const server = stub({ publicKeySpki: other.publicKeySpki })
    await open(await server.listen(), device.privateKeyPkcs8)
    expect(server.signatureValid()).toBe(false)
  })

  it("sends the headers the cockpit's origin check requires", async () => {
    // validateDeviceMutationOrigin rejects anything without x-williamos-device: 1 and a trusted origin.
    const device = keypair()
    const server = stub({ publicKeySpki: device.publicKeySpki })
    const baseUrl = await server.listen()
    await open(baseUrl, device.privateKeyPkcs8)
    for (const call of server.seen) {
      expect(call.headers["x-williamos-device"]).toBe("1")
      expect(call.headers.origin).toBe(baseUrl)
      expect(call.headers["content-type"]).toBe("application/json")
    }
    expect(server.seen[0].body).toEqual({ credentialId: CREDENTIAL_ID })
    expect(Object.keys(server.seen[1].body ?? {}).sort()).toEqual(["challenge", "challengeId", "signature"])
  })

  it("refuses a declined challenge rather than signing something arbitrary", async () => {
    const device = keypair()
    const server = stub({ publicKeySpki: device.publicKeySpki, challengeStatus: 403 })
    await expect(open(await server.listen(), device.privateKeyPkcs8)).rejects.toThrow(/DEVICE_CHALLENGE_REFUSED/)
  })

  it("refuses declined authentication", async () => {
    const device = keypair()
    const server = stub({ publicKeySpki: device.publicKeySpki, completeStatus: 401 })
    await expect(open(await server.listen(), device.privateKeyPkcs8)).rejects.toThrow(/DEVICE_SESSION_REFUSED/)
  })

  it("refuses a 200 carrying no session cookie, instead of returning an empty credential", async () => {
    const device = keypair()
    const server = stub({ publicKeySpki: device.publicKeySpki, omitCookie: true })
    await expect(open(await server.listen(), device.privateKeyPkcs8)).rejects.toThrow(/DEVICE_SESSION_COOKIE_MISSING/)
  })
})

describe("transport verification is not optional", () => {
  it("refuses an https endpoint when no cockpit CA is configured", async () => {
    // No bypass switch, by design: this client exists to prove an identity, and a transport that
    // trusts any certificate lets anything on the path harvest that proof.
    const previous = process.env.WILLIAMOS_COCKPIT_CA
    delete process.env.WILLIAMOS_COCKPIT_CA
    try {
      await expect(requestJson("https://127.0.0.1:1/api/anything")).rejects.toThrow(/COCKPIT_CA_REQUIRED/)
    } finally {
      if (previous !== undefined) process.env.WILLIAMOS_COCKPIT_CA = previous
    }
  })
})
