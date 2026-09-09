import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { unavailableHermesStatus, validateHermesStatus } from "./lib/status-contract.mjs"

const root = fileURLToPath(new URL("./public/", import.meta.url))
const statusPath = process.env.HERMES_STATUS_PATH || "C:\\ProgramData\\Hermes\\status\\current.json"
export const host = "127.0.0.1"
if (process.env.HERMES_CONSOLE_HOST && process.env.HERMES_CONSOLE_HOST !== host) {
  throw new Error("HERMES_CONSOLE_REQUIRES_LOOPBACK")
}
const port = Number(process.env.HERMES_CONSOLE_PORT || 3210)
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
])

function headers(type) {
  return {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  }
}

async function getStatus() {
  try {
    const parsed = JSON.parse(await readFile(statusPath, "utf8"))
    return validateHermesStatus(parsed)
  } catch {
    return unavailableHermesStatus("Appliance status unavailable")
  }
}

export const server = createServer(async (request, response) => {
  if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
    response.writeHead(405, { ...headers("text/plain; charset=utf-8"), Allow: "GET, HEAD" })
    response.end("Method not allowed")
    return
  }
  const pathname = new URL(request.url, "http://127.0.0.1").pathname
  if (pathname === "/api/status") {
    const body = `${JSON.stringify(await getStatus())}\n`
    response.writeHead(200, headers("application/json; charset=utf-8"))
    response.end(request.method === "HEAD" ? undefined : body)
    return
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1)
  if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) {
    response.writeHead(404, headers("text/plain; charset=utf-8"))
    response.end("Not found")
    return
  }
  try {
    const body = await readFile(join(root, relative))
    response.writeHead(200, headers(contentTypes.get(extname(relative)) || "application/octet-stream"))
    response.end(request.method === "HEAD" ? undefined : body)
  } catch {
    response.writeHead(404, headers("text/plain; charset=utf-8"))
    response.end("Not found")
  }
})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => process.stdout.write(`HERMES_CONSOLE_READY http://${host}:${port}\n`))
}
