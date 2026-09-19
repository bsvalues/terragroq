import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

import { createHelloApplicationServer } from "../server.mjs"
import { nextPulseSnapshot } from "../src/app.js"

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

async function start() {
  const server = createHelloApplicationServer()
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  return `http://127.0.0.1:${address.port}`
}

describe("Hello Application", () => {
  it("advances the visible pulse state", () => {
    assert.deepEqual(nextPulseSnapshot({ count: 8 }, new Date("2026-09-19T20:01:02.000Z")), {
      count: 9,
      detail: "Signal 009 received at 20:01:02 UTC",
      status: "Pulse 009 received.",
    })
  })

  it("serves the application and health endpoint", async () => {
    const origin = await start()
    const page = await fetch(`${origin}/`)
    const health = await fetch(`${origin}/healthz`)

    assert.equal(page.status, 200)
    const document = await page.text()
    assert.match(document, /Hello Application/)
    assert.doesNotMatch(document, /(?:script[^>]+src|link[^>]+stylesheet)/i)
    assert.deepEqual(await health.json(), { name: "Hello Application", status: "ready" })
  })

  it("does not expose arbitrary filesystem paths", async () => {
    const origin = await start()
    const response = await fetch(`${origin}/not-an-asset`)

    assert.equal(response.status, 404)
  })
})
