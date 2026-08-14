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

export function buildUpstreamHeaders(headers) {
  const forwarded = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase()
    if (
      !HOP_BY_HOP_HEADERS.has(normalizedName)
      && normalizedName !== "forwarded"
      && !normalizedName.startsWith("x-forwarded-")
      && value !== undefined
    ) {
      forwarded[normalizedName] = value
    }
  }
  forwarded.host = "192.168.88.9:3443"
  forwarded["x-forwarded-host"] = "192.168.88.9:3443"
  forwarded["x-forwarded-port"] = "3443"
  forwarded["x-forwarded-proto"] = "https"
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

export function createHermesHttpsProxy({ pfx, passphrase }) {
  return https.createServer({ pfx, passphrase }, (request, response) => {
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: 3100,
      method: request.method,
      path: request.url,
      headers: buildUpstreamHeaders(request.headers),
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
  if (passphrase.length < 32 || /[\r\n\0]/.test(passphrase)) throw new Error("TLS_PASSPHRASE_INVALID")
  const server = createHermesHttpsProxy({ pfx, passphrase })
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
