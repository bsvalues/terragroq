import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { server, host } from "../scripts/lab-control/hermes/console/server.mjs"
let base
before(async () => {
  await new Promise(resolve => server.listen(0, host, resolve))
  base = `http://${host}:${server.address().port}`
})
after(async () => { await new Promise(resolve => server.close(resolve)) })
for (const method of ["GET", "HEAD"]) {
  test(`${method} serves the appliance Console`, async () => {
    const response = await fetch(base + "/", { method, redirect: "manual" })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("location"), null)
    assert.match(response.headers.get("content-type"), /text\/html/)
    if (method === "HEAD") assert.equal(await response.text(), "")
  })
  test(`${method} preserves the read-only status API`, async () => {
    const response = await fetch(base + "/api/status", { method })
    assert.equal(response.status, 200)
    assert.match(response.headers.get("content-type"), /application\/json/)
    if (method === "HEAD") assert.equal(await response.text(), "")
    else assert.equal((await response.json()).schema, "hermes-console-status/1")
  })
}
test("refuses mutations and unknown files", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const response = await fetch(base + "/api/status", { method })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get("allow"), "GET, HEAD")
  }
  for (const path of ["/public/index.html", "/unknown", "/server.mjs"]) {
    assert.equal((await fetch(base + path)).status, 404)
  }
})
test("rejects non-loopback configured hosts", () => {
  const result = spawnSync(process.execPath, ["scripts/lab-control/hermes/console/server.mjs"], {
    env: { ...process.env, HERMES_CONSOLE_HOST: "0.0.0.0" }, encoding: "utf8", timeout: 5000,
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /HERMES_CONSOLE_REQUIRES_LOOPBACK/)
})

test("serves the appliance interface assets", async () => {
  for (const path of ["/app.js", "/styles.css"]) assert.equal((await fetch(base + path)).status, 200)
})
