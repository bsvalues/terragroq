import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"

// This platform-owned server never imports application JavaScript or accepts a filesystem path.
export function createStaticServer(bytes) {
  const artifact = Buffer.from(bytes)
  if (artifact.length > 1_000_000) throw new Error("ARTIFACT_LIMIT")
  new TextDecoder("utf-8", { fatal: true }).decode(artifact)
  const server = http.createServer((request, response) => {
  if (request.method !== "GET" || !["/", "/healthz"].includes(request.url)) {
    response.writeHead(404); response.end(); return
  }
  const body = request.url === "/healthz" ? Buffer.from("ready\n") : artifact
  response.writeHead(200, { "content-type": request.url === "/" ? "text/html; charset=utf-8" : "text/plain", "content-length": body.length, "cache-control": "no-store" })
  response.end(body)
  })
  server.maxConnections = 8
  server.requestTimeout = 3000
  server.headersTimeout = 3000
  return server
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createStaticServer(fs.readFileSync("/opt/williamos/artifact.html")).listen(8080, "127.0.0.1")
}
