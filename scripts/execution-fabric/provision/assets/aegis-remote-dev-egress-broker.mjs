#!/usr/bin/node
import dns from "node:dns/promises"
import http from "node:http"
import net from "node:net"

const HOSTS = new Set(["ssh.github.com", "api.github.com", "api.nuget.org", "globalcdn.nuget.org"])
function denied(address) {
  const lower = address.toLowerCase()
  return address === "192.168.1.156" || lower === "::ffff:192.168.1.156" || lower === "::1" || address.startsWith("10.") || address.startsWith("127.") || address.startsWith("169.254.") || address.startsWith("192.168.") || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(address) || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:")
}
async function resolveExact(host) {
  const values = [...await dns.resolve4(host), ...await dns.resolve6(host).catch(() => [])]
  if (!values.length || values.some(denied)) throw new Error("destination denied")
  return values[0]
}
const server = http.createServer((_request, response) => { response.writeHead(405, { Connection: "close" }); response.end() })
server.on("connect", async (request, client, head) => {
  try {
    const match = /^([a-z0-9.-]+):443$/.exec(request.url ?? "")
    if (!match || !HOSTS.has(match[1])) throw new Error("endpoint denied")
    const upstream = net.createConnection({ host: await resolveExact(match[1]), port: 443 })
    upstream.setTimeout(30_000)
    upstream.once("connect", () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); upstream.pipe(client); client.pipe(upstream) })
    upstream.once("error", () => client.destroy()); upstream.once("timeout", () => upstream.destroy())
  } catch { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n") }
})
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"))
server.listen(17734, "127.0.0.1")
