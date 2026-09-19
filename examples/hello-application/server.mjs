import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL("./src/", import.meta.url))

const STATIC_ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
])

function writeResponse(response, statusCode, headers, body, headOnly = false) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
    "x-content-type-options": "nosniff",
    ...headers,
  })
  response.end(headOnly ? undefined : body)
}

async function buildSelfContainedDocument(sourceRoot) {
  const [document, styles, application] = await Promise.all([
    readFile(path.join(sourceRoot, "index.html"), "utf8"),
    readFile(path.join(sourceRoot, "styles.css"), "utf8"),
    readFile(path.join(sourceRoot, "app.js"), "utf8"),
  ])
  const browserApplication = application.replaceAll("export function ", "function ")
  return document
    .replace('<link rel="stylesheet" href="/styles.css" />', `<style>${styles}</style>`)
    .replace('<script type="module" src="/app.js"></script>', `<script>${browserApplication}</script>`)
}

export function createHelloApplicationServer({ sourceRoot = DEFAULT_SOURCE_ROOT } = {}) {
  const resolvedSourceRoot = path.resolve(sourceRoot)

  return createServer(async (request, response) => {
    const method = request.method ?? "GET"
    if (method !== "GET" && method !== "HEAD") {
      writeResponse(response, 405, {
        allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
      }, "Method not allowed")
      return
    }

    const requestUrl = new URL(request.url ?? "/", "http://hello.application")
    if (requestUrl.pathname === "/healthz") {
      const body = JSON.stringify({ name: "Hello Application", status: "ready" })
      writeResponse(response, 200, {
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json; charset=utf-8",
      }, body, method === "HEAD")
      return
    }

    if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
      try {
        const body = await buildSelfContainedDocument(resolvedSourceRoot)
        writeResponse(response, 200, {
          "content-length": Buffer.byteLength(body),
          "content-type": "text/html; charset=utf-8",
        }, body, method === "HEAD")
      } catch {
        writeResponse(response, 500, { "content-type": "text/plain; charset=utf-8" }, "Application unavailable\n", method === "HEAD")
      }
      return
    }

    const asset = STATIC_ASSETS.get(requestUrl.pathname)
    if (!asset) {
      writeResponse(response, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found\n", method === "HEAD")
      return
    }

    const [fileName, contentType] = asset
    const filePath = path.join(resolvedSourceRoot, fileName)
    try {
      const body = await readFile(filePath)
      writeResponse(response, 200, {
        "content-length": body.byteLength,
        "content-type": contentType,
      }, body, method === "HEAD")
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown read failure"
      writeResponse(response, 500, { "content-type": "text/plain; charset=utf-8" }, `Application asset unavailable: ${reason}`)
    }
  })
}

export async function startHelloApplication({
  host = process.env.HOST ?? "127.0.0.1",
  port = Number.parseInt(process.env.PORT ?? "4317", 10),
  sourceRoot = DEFAULT_SOURCE_ROOT,
} = {}) {
  const server = createHelloApplicationServer({ sourceRoot })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })
  return server
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  const server = await startHelloApplication()
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Hello Application did not bind a TCP port")
  console.log(JSON.stringify({
    event: "hello-application-ready",
    host: address.address,
    port: address.port,
  }))

  const close = () => {
    server.close((error) => {
      if (error) process.exitCode = 1
    })
  }
  process.stdin.once("end", close)
  process.once("SIGINT", close)
  process.once("SIGTERM", close)
  process.stdin.resume()
}
