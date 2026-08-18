import crypto from "node:crypto"
import fs from "node:fs"
import https from "node:https"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Authenticate an agent to the cockpit as an enrolled DEVICE.
 *
 * The receipt gate is only as good as who may obtain a receipt, so the CLI cannot simply be trusted
 * to say who it is. The cockpit already has the right mechanism: an ed25519 credential the owner
 * enrolled once, proving itself per-session against a server-issued challenge. That is also the
 * direction the topology settled on -- the client initiates a device-authenticated session to HERMES,
 * and its durable identity is the enrolled credential rather than an address.
 *
 * The proof string is built by `lib/device-auth/contract.ts` itself. Re-deriving that format here
 * would be a second definition of what a signature covers, which is how a signature scheme quietly
 * stops matching the thing that verifies it.
 */

const CREDENTIAL_PATH = process.env.WILLIAMOS_DEVICE_CREDENTIAL
  ?? path.join(os.homedir(), ".williamos", "device-credential.json")

export const DEFAULT_COCKPIT = process.env.WILLIAMOS_COCKPIT_URL ?? "https://192.168.88.9:3443"

export function loadDeviceCredential(file = CREDENTIAL_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"))
  if (!raw?.credentialId || !raw?.privateKeyPkcs8) {
    throw new Error(`DEVICE_CREDENTIAL_INVALID: ${file} needs { credentialId, privateKeyPkcs8 }`)
  }
  return raw
}

/**
 * The cockpit presents a certificate from its own authority, which no public root vouches for, so
 * verification is PINNED to that authority.
 *
 * There is deliberately no "skip verification" switch. This client exists to prove an identity to the
 * management plane; a transport that accepts any certificate lets anything on the path impersonate
 * the cockpit and harvest the very proof being sent. An unverifiable endpoint is refused rather than
 * trusted -- the same reading the gate already applies to an unreadable ledger.
 */
function tlsOptions() {
  const ca = process.env.WILLIAMOS_COCKPIT_CA
  if (!ca) {
    throw new Error(
      "COCKPIT_CA_REQUIRED: set WILLIAMOS_COCKPIT_CA to the cockpit authority's certificate. "
      + "The cockpit uses its own CA, and this client will not talk to an endpoint it cannot verify.",
    )
  }
  return { ca: fs.readFileSync(ca) }
}

export function requestJson(url, { method = "GET", body, cookie, origin } = {}) {
  const target = new URL(url)
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const transport = target.protocol === "https:" ? https : http
  const headers = {
    accept: "application/json",
    // Both are required by validateDeviceMutationOrigin for any device mutation.
    "x-williamos-device": "1",
    origin: origin ?? target.origin,
  }
  if (payload !== undefined) {
    headers["content-type"] = "application/json"
    headers["content-length"] = Buffer.byteLength(payload)
  }
  if (cookie) headers.cookie = cookie

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      { method, headers, timeout: 20_000, ...(target.protocol === "https:" ? tlsOptions() : {}) },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8")
          let json = null
          try { json = JSON.parse(text) } catch { /* non-JSON bodies are reported as text */ }
          resolve({ status: response.statusCode, json, text, setCookie: response.headers["set-cookie"] ?? [] })
        })
      },
    )
    request.on("timeout", () => { request.destroy(new Error("COCKPIT_TIMEOUT")) })
    request.on("error", reject)
    if (payload !== undefined) request.write(payload)
    request.end()
  })
}

/** Exchange the enrolled credential for a device session cookie. */
export async function openDeviceSession({ baseUrl = DEFAULT_COCKPIT, credential, projectRoot = process.cwd() } = {}) {
  const device = credential ?? loadDeviceCredential()
  const origin = new URL(baseUrl).origin

  const { buildDeviceProof, DEVICE_SESSION_COOKIE } = await import(
    pathToFileURL(path.join(projectRoot, "lib", "device-auth", "contract.ts")).href
  )

  const challenge = await requestJson(`${baseUrl}/api/device/session/challenge`, {
    method: "POST",
    body: { credentialId: device.credentialId },
    origin,
  })
  if (challenge.status !== 200 || !challenge.json?.challengeId) {
    throw new Error(`DEVICE_CHALLENGE_REFUSED (${challenge.status}): ${challenge.text.slice(0, 200)}`)
  }

  const proof = buildDeviceProof({
    purpose: "authenticate",
    challengeId: challenge.json.challengeId,
    challenge: challenge.json.challenge,
    origin,
    expiresAt: challenge.json.expiresAt,
  })
  const key = crypto.createPrivateKey({
    key: Buffer.from(device.privateKeyPkcs8, "base64"),
    format: "der",
    type: "pkcs8",
  })
  const signature = crypto.sign(null, Buffer.from(proof), key).toString("base64url")

  const completed = await requestJson(`${baseUrl}/api/device/session/complete`, {
    method: "POST",
    body: { challengeId: challenge.json.challengeId, challenge: challenge.json.challenge, signature },
    origin,
  })
  if (completed.status !== 200) {
    throw new Error(`DEVICE_SESSION_REFUSED (${completed.status}): ${completed.text.slice(0, 200)}`)
  }

  const cookie = completed.setCookie
    .map((entry) => entry.split(";")[0])
    .find((entry) => entry.startsWith(`${DEVICE_SESSION_COOKIE}=`))
  if (!cookie) throw new Error("DEVICE_SESSION_COOKIE_MISSING")
  return { cookie, origin, expiresAt: completed.json?.expiresAt ?? null }
}
