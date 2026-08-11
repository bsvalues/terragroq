#!/usr/bin/node
import dns from "node:dns/promises"
import http from "node:http"
import net from "node:net"
import { allowedHostForOperation, authorizeConnect, isDeniedDestination } from "./aegis-remote-dev-runtime-authority.mjs"

const HOSTS = new Set(["ssh.github.com", "api.github.com", "api.nuget.org", "globalcdn.nuget.org"])
async function resolveExact(host) {
  const values = [...await dns.resolve4(host), ...await dns.resolve6(host).catch(() => [])]
  if (!values.length || values.some(isDeniedDestination)) throw new Error("destination denied")
  return values[0]
}
const server = http.createServer((_request, response) => { response.writeHead(405, { Connection: "close" }); response.end() })
server.on("connect", async (request, client, head) => {
  try {
    const match = /^([a-z0-9.-]+):443$/.exec(request.url ?? "")
    if (!match || !HOSTS.has(match[1])) throw new Error("endpoint denied")
    const authorization = /^(?:WilliamOS) ([A-Za-z0-9+/]+={0,2})$/.exec(String(request.headers["proxy-authorization"] ?? ""))
    const operation = String(request.headers["x-williamos-operation"] ?? "")
    if (!authorization || !allowedHostForOperation(operation, match[1])) throw new Error("operation authority denied")
    authorizeConnect(authorization[1], operation, match[1])
    const upstream = net.createConnection({ host: await resolveExact(match[1]), port: 443 })
    upstream.setTimeout(30_000)
    upstream.once("connect", () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); upstream.pipe(client); client.pipe(upstream) })
    upstream.once("error", () => client.destroy()); upstream.once("timeout", () => upstream.destroy())
  } catch { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n") }
})
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"))
server.listen(17734, "127.0.0.1")
