#!/usr/bin/env node
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const HELLO_HTTPS_PORT = 3543
export const HELLO_UPSTREAM_PORT = 3201
export const HELLO_HTTPS_ORIGIN = `https://williamos.lan:${HELLO_HTTPS_PORT}`
const LISTEN_HOSTS = Object.freeze(["192.168.88.9", "100.97.194.84"])
const DEVICE_HEADER = "x-williamos-device-cert"
const DEVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"])

export function buildHelloProxyUpstreamHeaders(headers, device = null) {
  const forwarded = {}
  const approvedOrigin = headers?.origin === HELLO_HTTPS_ORIGIN ? HELLO_HTTPS_ORIGIN : null
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase()
    if (!HOP_HEADERS.has(normalized) && normalized !== "forwarded" && !normalized.startsWith("x-forwarded-")
      && normalized !== DEVICE_HEADER && normalized !== "host" && normalized !== "origin" && value !== undefined) {
      forwarded[normalized] = value
    }
  }
  forwarded.host = `williamos.lan:${HELLO_HTTPS_PORT}`
  forwarded["x-forwarded-host"] = forwarded.host
  forwarded["x-forwarded-port"] = String(HELLO_HTTPS_PORT)
  forwarded["x-forwarded-proto"] = "https"
  if (approvedOrigin) forwarded.origin = approvedOrigin
  if (device && DEVICE_NAME.test(device)) forwarded[DEVICE_HEADER] = device
  return forwarded
}

function downstreamHeaders(headers) {
  const result = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== "server" && value !== undefined) result[name.toLowerCase()] = value
  }
  result["strict-transport-security"] = "max-age=31536000"
  return result
}

function verifiedDevice(socket) {
  if (socket?.authorized !== true || typeof socket.getPeerCertificate !== "function") return null
  const name = socket.getPeerCertificate()?.subject?.CN
  return typeof name === "string" && DEVICE_NAME.test(name) ? name : null
}

export function createHelloHttpsProxy(tlsMaterial) {
  return https.createServer(tlsMaterial, (request, response) => {
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: HELLO_UPSTREAM_PORT,
      method: request.method,
      path: request.url,
      headers: buildHelloProxyUpstreamHeaders(request.headers, verifiedDevice(request.socket)),
    }, (upstreamResponse) => {
      upstream.setTimeout(31 * 60 * 1000, () => upstream.destroy(new Error("UPSTREAM_TIMEOUT")))
      response.writeHead(upstreamResponse.statusCode ?? 502, downstreamHeaders(upstreamResponse.headers))
      upstreamResponse.pipe(response)
    })
    upstream.setTimeout(30_000, () => upstream.destroy(new Error("UPSTREAM_CONNECT_TIMEOUT")))
    upstream.on("socket", (socket) => {
      const connected = () => upstream.setTimeout(31 * 60 * 1000, () => upstream.destroy(new Error("UPSTREAM_TIMEOUT")))
      if (socket.connecting) socket.once("connect", connected)
      else connected()
    })
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
      response.end("Hello Application runtime unavailable")
    })
    request.pipe(upstream)
  })
}

export async function startHelloHttpsProxy({
  tlsRoot = "C:\\ProgramData\\WilliamOS\\tls",
  listenHosts = LISTEN_HOSTS,
} = {}) {
  const pfx = fs.readFileSync(path.join(tlsRoot, "hermes-williamos.pfx"))
  const passphrase = fs.readFileSync(path.join(tlsRoot, "hermes-williamos.passphrase"), "utf8").trim()
  if (passphrase.length < 32 || /[\r\n\0]/.test(passphrase)) throw new Error("HELLO_HTTPS_PASSPHRASE_INVALID")
  let clientCa = null
  try { clientCa = fs.readFileSync(path.join(tlsRoot, "williamos-root-ca.cer")) } catch { clientCa = null }
  const tlsMaterial = clientCa
    ? { pfx, passphrase, ca: clientCa, requestCert: true, rejectUnauthorized: false }
    : { pfx, passphrase }
  const servers = []
  for (const host of listenHosts) {
    const server = createHelloHttpsProxy(tlsMaterial)
    server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"))
    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(HELLO_HTTPS_PORT, host, resolve)
    })
    servers.push(server)
    process.stdout.write(`HELLO_HTTPS_LISTENER_READY|HOST=${host}|PORT=${HELLO_HTTPS_PORT}\n`)
  }
  return servers
}

async function main() {
  await startHelloHttpsProxy()
  process.stdout.write(`HELLO_HTTPS_READY|ORIGIN=${HELLO_HTTPS_ORIGIN}|UPSTREAM=http://127.0.0.1:${HELLO_UPSTREAM_PORT}\n`)
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`HELLO_HTTPS_FAILED|${String(error?.code ?? error?.message ?? "UNKNOWN").split("|")[0]}\n`)
    process.exitCode = 1
  })
}
