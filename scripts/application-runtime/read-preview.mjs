import http from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"

/** The injection seam is for local helper tests; the CLI has no endpoint, route or path option.
 * @returns {Promise<Buffer>}
 */
export async function readContainedPreview(mode, makeRequest = http.get) {
  if (!["health", "preview"].includes(mode)) throw new Error("READER_MODE_INVALID")
  const maximum = mode === "health" ? 32 : 1_000_000
  return new Promise((resolve, reject) => {
    let request, retry
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true; clearTimeout(timer); clearTimeout(retry)
      if (error) { request?.destroy(); reject(error) } else resolve(result)
    }
    const timer = setTimeout(() => finish(new Error("READER_TIMEOUT")), 3000)
    const attempt = () => {
      request = makeRequest({ hostname: "127.0.0.1", port: 8080, path: mode === "health" ? "/healthz" : "/", timeout: 2500 }, (response) => {
        let size = 0
        const chunks = []
        if (response.statusCode !== 200 || Number(response.headers["content-length"]) > maximum) { response.destroy(); finish(new Error("READER_RESPONSE_INVALID")); return }
        response.on("data", (chunk) => {
          size += chunk.length
          if (size > maximum) { response.destroy(); finish(new Error("READER_LIMIT")); return }
          chunks.push(chunk)
        })
        response.on("end", () => finish(null, Buffer.concat(chunks)))
        response.on("error", () => finish(new Error("READER_UNAVAILABLE")))
      })
      request.on("timeout", () => finish(new Error("READER_TIMEOUT")))
      request.on("error", (error) => {
        // Readiness can precede the Node server's loopback bind. Retry only that race within
        // the same deadline; the reader never changes endpoint or accepts a client route.
        if (!settled && mode === "health" && error.code === "ECONNREFUSED") retry = setTimeout(attempt, 25)
        else finish(new Error("READER_UNAVAILABLE"))
      })
    }
    attempt()
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) { process.stderr.write("READER_MODE_INVALID\n"); process.exitCode = 1 }
  else readContainedPreview(process.argv[2]).then((bytes) => process.stdout.write(bytes)).catch(() => { process.stderr.write("READER_UNAVAILABLE\n"); process.exitCode = 1 })
}
