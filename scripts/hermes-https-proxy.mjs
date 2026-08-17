#!/usr/bin/env node
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const HERMES_HTTPS_ORIGIN = "https://192.168.88.9:3443"
export const HERMES_HTTPS_HOST = "192.168.88.9"
export const HERMES_HTTPS_PORT = 3443
export const HERMES_UPSTREAM_ORIGIN = "http://127.0.0.1:3100"

const TLS_ROOT = "C:\\ProgramData\\WilliamOS\\tls"
const TLS_PFX_PATH = path.join(TLS_ROOT, "hermes-williamos.pfx")
const TLS_PASSPHRASE_PATH = path.join(TLS_ROOT, "hermes-williamos.passphrase")
const TLS_CLIENT_CA_PATH = path.join(TLS_ROOT, "williamos-root-ca.cer")

// The header the app trusts to mean "TLS itself proved which device this is". It is stripped from
// every inbound request below, so a client cannot assert it; only this proxy can. The app listens on
// loopback, so this proxy is the only path that reaches it.
//
// Deliberately NOT "x-williamos-device": that name already belongs to the device-mutation contract
// in lib/device-auth/contract.ts, where the CLIENT sets it. Reusing it here meant this proxy stripped
// a header the app requires, and gave one header two contradictory meanings -- client-asserted in one
// path, proxy-asserted-and-trusted in the other. Those must not share a name.
export const DEVICE_HEADER = "x-williamos-device-cert"

// A device name is used as an identity claim, so it is constrained to a conservative shape rather
// than passed through: a certificate subject is attacker-influenced if a CA is ever mis-issued, and
// header injection through a CN is not a failure worth risking.
const DEVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export function buildUpstreamHeaders(headers, device = null) {
  const forwarded = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase()
    if (
      !HOP_BY_HOP_HEADERS.has(normalizedName)
      && normalizedName !== "forwarded"
      && !normalizedName.startsWith("x-forwarded-")
      && normalizedName !== DEVICE_HEADER
      && value !== undefined
    ) {
      forwarded[normalizedName] = value
    }
  }
  forwarded.host = "192.168.88.9:3443"
  forwarded["x-forwarded-host"] = "192.168.88.9:3443"
  forwarded["x-forwarded-port"] = "3443"
  forwarded["x-forwarded-proto"] = "https"
  // Set last, and only from a verified certificate, so it cannot be reached by any inbound value.
  if (device) forwarded[DEVICE_HEADER] = device
  return forwarded
}

export function buildDownstreamHeaders(headers) {
  const forwarded = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== "server" && value !== undefined) {
      forwarded[name.toLowerCase()] = value
    }
  }
  forwarded["strict-transport-security"] = "max-age=31536000"
  return forwarded
}

/** The device name TLS proved, or null when no certificate was presented or it did not verify. */
export function verifiedDeviceName(socket) {
  if (!socket || typeof socket.getPeerCertificate !== "function") return null
  // Node reports the chain verdict here. Without this check a self-signed certificate carrying any
  // chosen CN would be accepted, which would turn the device header into a free-text impersonation.
  if (socket.authorized !== true) return null
  const certificate = socket.getPeerCertificate()
  const name = certificate?.subject?.CN
  return typeof name === "string" && DEVICE_NAME_PATTERN.test(name) ? name : null
}

/**
 * TLS options for the listener.
 *
 * requestCert with rejectUnauthorized:false asks every device for a certificate but still serves the
 * ones that have none: an enrolled device is recognised by TLS and never sees a sign-in page, while
 * anything else falls through to the ordinary password path. Enrolment therefore cannot lock the
 * owner out of his own cockpit. Client authentication is enabled only when a CA is actually
 * available to verify against -- asking for certificates with nothing to check them against would
 * accept any certificate at all.
 */
export function buildTlsServerOptions({ pfx, passphrase, clientCa }) {
  const options = { pfx, passphrase }
  if (clientCa) {
    options.ca = clientCa
    options.requestCert = true
    options.rejectUnauthorized = false
  }
  return options
}

export function createHermesHttpsProxy({ pfx, passphrase, clientCa }) {
  return https.createServer(buildTlsServerOptions({ pfx, passphrase, clientCa }), (request, response) => {
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: 3100,
      method: request.method,
      path: request.url,
      headers: buildUpstreamHeaders(request.headers, verifiedDeviceName(request.socket)),
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, buildDownstreamHeaders(upstreamResponse.headers))
      upstreamResponse.pipe(response)
    })
    upstream.setTimeout(30_000, () => upstream.destroy(new Error("UPSTREAM_TIMEOUT")))
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
      response.end("HERMES application unavailable")
    })
    request.pipe(upstream)
  })
}

async function main() {
  const pfx = fs.readFileSync(TLS_PFX_PATH)
  const passphrase = fs.readFileSync(TLS_PASSPHRASE_PATH, "utf8").trim()
  // Absent client CA means device certificates are simply not offered; the password path still
  // works, so a missing anchor degrades the feature rather than the cockpit.
  let clientCa = null
  try { clientCa = fs.readFileSync(TLS_CLIENT_CA_PATH) } catch { clientCa = null }
  if (passphrase.length < 32 || /[\r\n\0]/.test(passphrase)) throw new Error("TLS_PASSPHRASE_INVALID")
  const server = createHermesHttpsProxy({ pfx, passphrase, clientCa })
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"))
  server.listen(HERMES_HTTPS_PORT, HERMES_HTTPS_HOST, () => {
    process.stdout.write(`HERMES_HTTPS_READY|ORIGIN=${HERMES_HTTPS_ORIGIN}|UPSTREAM=${HERMES_UPSTREAM_ORIGIN}\n`)
  })
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`HERMES_HTTPS_FAILED|CODE=${String(error?.code ?? error?.message ?? "UNKNOWN").split("|")[0]}\n`)
    process.exitCode = 1
  })
}
