#!/usr/bin/node
import dns from "node:dns/promises"
import crypto from "node:crypto"
import http from "node:http"
import net from "node:net"
import { allowedHostForOperation, authorizeConnect, continueConnectAuthorization, isDeniedDestination } from "./aegis-remote-dev-runtime-authority.mjs"

const HOSTS = new Set(["ssh.github.com", "api.github.com", "api.nuget.org", "globalcdn.nuget.org"])
const sessions = new Map()
function ticketAuthority(request) {
  const header = String(request.headers["proxy-authorization"] ?? "")
  const direct = /^WilliamOS ([A-Za-z0-9+/]+={0,2})$/.exec(header)
  if (direct) return { operation: String(request.headers["x-williamos-operation"] ?? ""), ticket: direct[1] }
  const basic = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(header)
  if (!basic) throw new Error("proxy authority denied")
  const decoded = Buffer.from(basic[1], "base64")
  if (decoded.toString("base64") !== basic[1]) throw new Error("proxy authority encoding differs")
  const separator = decoded.indexOf(58)
  if (separator !== 10 || decoded.subarray(0, separator).toString("ascii") !== "WilliamOS") throw new Error("proxy authority identity differs")
  const ticket = decoded.subarray(separator + 1).toString("ascii")
  const operation = JSON.parse(Buffer.from(ticket, "base64").toString("utf8"))?.payload?.operation
  return { operation, ticket }
}
function denyProxy(client, status) {
  if (status === 407) {
    client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="WilliamOS"\r\nConnection: close\r\n\r\n')
    return
  }
  client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
}
async function resolveExact(host) {
  const values = [...await dns.resolve4(host), ...await dns.resolve6(host).catch(() => [])]
  if (!values.length || values.some(isDeniedDestination)) throw new Error("destination denied")
  return values[0]
}
function authorizeBrokerConnect(ticket, operation, host) {
  const key = crypto.createHash("sha256").update(ticket, "ascii").digest("hex")
  const existing = sessions.get(key)
  if (existing) return continueConnectAuthorization(existing, operation, host)
  const authorization = authorizeConnect(ticket, operation, host)
  sessions.set(key, authorization)
  return authorization
}
const server = http.createServer((_request, response) => { response.writeHead(405, { Connection: "close" }); response.end() })
server.on("connect", async (request, client, head) => {
  try {
    const match = /^([a-z0-9.-]+):443$/.exec(request.url ?? "")
    if (!match || !HOSTS.has(match[1])) throw new Error("endpoint denied")
    const authorization = ticketAuthority(request)
    if (!allowedHostForOperation(authorization.operation, match[1])) throw new Error("operation authority denied")
    authorizeBrokerConnect(authorization.ticket, authorization.operation, match[1])
    const upstream = net.createConnection({ host: await resolveExact(match[1]), port: 443 })
    upstream.setTimeout(30_000)
    upstream.once("connect", () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); upstream.pipe(client); client.pipe(upstream) })
    upstream.once("error", () => client.destroy()); upstream.once("timeout", () => upstream.destroy())
  } catch {
    denyProxy(client, request.headers["proxy-authorization"] === undefined ? 407 : 403)
  }
})
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"))
server.listen(17734, "127.0.0.1")
