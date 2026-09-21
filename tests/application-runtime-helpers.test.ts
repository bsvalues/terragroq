import http from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { createStaticServer } from "@/scripts/application-runtime/server.mjs"
import { readContainedPreview } from "@/scripts/application-runtime/read-preview.mjs"
const servers: http.Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))) })
async function listen(server: http.Server) {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return (server.address() as { port: number }).port
}
describe("owned server and fixed bounded reader", () => {
  it("serves immutable bytes and fixed health without evaluating application code or accepting routes", async () => {
    const html = Buffer.from('<!doctype html><script>throw new Error("NEVER_EVALUATE")</script>')
    const port = await listen(createStaticServer(html))
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe(html.toString())
    expect(await (await fetch(`http://127.0.0.1:${port}/healthz`)).text()).toBe("ready\n")
    expect((await fetch(`http://127.0.0.1:${port}/../secret`)).status).toBe(404)
    expect((await fetch(`http://127.0.0.1:${port}/`, { method: "POST" })).status).toBe(404)
    expect(() => createStaticServer(Buffer.alloc(1_000_001))).toThrow("ARTIFACT_LIMIT")
  })
  it("uses fixed loopback requests, validates mode, and enforces streamed limits", async () => {
    const port = await listen(createStaticServer(Buffer.from("<!doctype html><p>OK</p>")))
    const seen: object[] = []
    const request: typeof http.get = ((options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => { seen.push(options); return http.get({ ...options, port }, callback) }) as typeof http.get
    expect((await readContainedPreview("preview", request)).toString()).toContain("OK")
    expect((await readContainedPreview("health", request)).toString()).toBe("ready\n")
    expect(seen).toEqual([{ hostname: "127.0.0.1", port: 8080, path: "/", timeout: 2500 }, { hostname: "127.0.0.1", port: 8080, path: "/healthz", timeout: 2500 }])
    await expect(readContainedPreview("../../secret", request)).rejects.toThrow("READER_MODE_INVALID")
    const large = await listen(http.createServer((_req, res) => { res.writeHead(200); res.write(Buffer.alloc(600_000)); res.end(Buffer.alloc(400_001)) }))
    const oversized: typeof http.get = ((options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => http.get({ ...options, port: large }, callback)) as typeof http.get
    await expect(readContainedPreview("preview", oversized)).rejects.toThrow("READER_LIMIT")
  })
  it("keeps its deadline active when a response stalls after headers", async () => {
    const port = await listen(http.createServer((_req, res) => { res.writeHead(200); res.write("<") }))
    const request: typeof http.get = ((options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => http.get({ ...options, port }, callback)) as typeof http.get
    await expect(readContainedPreview("preview", request)).rejects.toThrow("READER_TIMEOUT")
  })
})
