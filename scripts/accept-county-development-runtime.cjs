const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const http = require("node:http")
const path = require("node:path")
const { chromium } = require("playwright")

const origin = (process.env.COUNTY_ACCEPTANCE_ORIGIN || "http://127.0.0.1:3200").replace(/\/$/, "")
const previewOrigin = (process.env.COUNTY_ACCEPTANCE_PREVIEW_ORIGIN || "http://127.0.0.1:3102").replace(/\/$/, "")
const terraFusionRoot = process.env.COUNTY_ACCEPTANCE_TERRAFUSION_ROOT
const evidenceRoot = process.env.COUNTY_ACCEPTANCE_EVIDENCE_ROOT || path.join(process.cwd(), "county-acceptance-evidence")
const expectedDeploymentId = process.env.COUNTY_ACCEPTANCE_EXPECTED_DEPLOYMENT_ID || "ci-county-development"
const ownerEmail = process.env.COUNTY_ACCEPTANCE_OWNER_EMAIL || "county.bundle@example.gov"
const ownerPassword = process.env.COUNTY_ACCEPTANCE_OWNER_PASSWORD || "County-Bundle-Acceptance-2026!"
const prompt = "Reply with the exact token COUNTY_LOCAL_OK and nothing else."

if (!terraFusionRoot || !path.isAbsolute(terraFusionRoot)) {
  throw new Error("COUNTY_ACCEPTANCE_TERRAFUSION_ROOT must be an absolute path")
}

const readmePath = path.join(terraFusionRoot, "README.md")
if (!fs.existsSync(readmePath)) throw new Error(`Acceptance file is missing: ${readmePath}`)

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
const consoleErrors = []
const pageErrors = []
const externalRequests = []
const observations = []

function observe(code, detail = {}) {
  observations.push({ at: new Date().toISOString(), code, ...detail })
}

async function poll(description, operation, timeoutMs = 60_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await operation()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`${description} did not become true before timeout${lastError ? `: ${lastError.message}` : ""}`)
}

async function startPreviewServer() {
  const previewUrl = new URL(previewOrigin)
  if (previewUrl.protocol !== "http:" || !loopbackHosts.has(previewUrl.hostname.toLowerCase()) || !previewUrl.port) {
    throw new Error("COUNTY_ACCEPTANCE_PREVIEW_ORIGIN must be one loopback HTTP origin with an explicit port")
  }
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>TerraFusion County Preview</title></head>
<body>
  <main>
    <h1 data-testid="terrafusion-county-preview">TerraFusion County Preview</h1>
    <p data-testid="terrafusion-preview-boundary">Local County developer preview</p>
  </main>
</body>
</html>`
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-williamos-workspace-app": "TerraFusion",
    })
    response.end(html)
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(Number(previewUrl.port), previewUrl.hostname, () => {
      server.off("error", reject)
      resolve()
    })
  })
  return server
}

async function closeServer(server) {
  if (!server) return
  await new Promise((resolve) => server.close(() => resolve()))
}

async function openWilliam(page) {
  const rail = page.getByTestId("william-conversation-rail")
  if ((await rail.getAttribute("data-open")) !== "true") {
    await page.getByRole("button", { name: "Open William conversation" }).click()
  }
  await rail.waitFor({ state: "visible", timeout: 30_000 })
  return rail
}

async function main() {
  await fsp.mkdir(evidenceRoot, { recursive: true })
  const originalReadme = await fsp.readFile(readmePath, "utf8")
  const marker = `COUNTY_BROWSER_ACCEPTANCE_${Date.now()}`
  const previewServer = await startPreviewServer()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("request", (request) => {
    try {
      const url = new URL(request.url())
      if ((url.protocol === "http:" || url.protocol === "https:") && !loopbackHosts.has(url.hostname.toLowerCase())) {
        externalRequests.push(url.toString())
      }
    } catch {
      // Non-URL browser resources do not create a network boundary.
    }
  })

  try {
    await page.goto(`${origin}/sign-up`, { waitUntil: "networkidle", timeout: 90_000 })
    const banner = page.getByTestId("county-development-profile-banner")
    await banner.waitFor({ state: "visible", timeout: 30_000 })
    assert.equal(await banner.getAttribute("data-boundary-valid"), "true")
    assert.match(await banner.innerText(), /COUNTY DEVELOPMENT/i)
    assert.match(await banner.innerText(), /LOCAL ONLY/i)
    const bannerTitle = await banner.getAttribute("title")
    assert.match(bannerTitle || "", new RegExp(expectedDeploymentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
    assert.doesNotMatch(`${await page.content()} ${bannerTitle || ""}`, /192\.168\.88\.9/)
    observe("COUNTY_BOUNDARY_VISIBLE", { bannerTitle })
    await page.screenshot({ path: path.join(evidenceRoot, "01-county-sign-up.png"), fullPage: true })

    await page.getByLabel("Primary Operator name").fill("County Bundle Acceptance")
    await page.getByLabel("Email").fill(ownerEmail)
    await page.getByLabel("Password").fill(ownerPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL((url) => url.origin === origin && url.pathname === "/", { timeout: 90_000 })
    await page.waitForLoadState("networkidle")

    const fileTree = page.getByRole("navigation", { name: "Workspace files" })
    await fileTree.waitFor({ state: "visible", timeout: 90_000 })
    assert.match(await fileTree.innerText(), /TERRAFUSION/i)
    observe("OWNER_WORKSPACE_OPENED")

    const readmeButton = fileTree.locator('button[title="README.md"]')
    await readmeButton.waitFor({ state: "visible", timeout: 30_000 })
    await readmeButton.click()

    const editor = page.locator('[aria-label="README.md"] .cm-content')
    await editor.waitFor({ state: "visible", timeout: 30_000 })
    await editor.click()
    await page.keyboard.press("Control+End")
    await page.keyboard.insertText(`\n\n${marker}\n`)
    await page.keyboard.press("Control+S")

    await poll("saved README marker", async () => (await fsp.readFile(readmePath, "utf8")).includes(marker), 30_000)
    observe("REAL_FILE_EDIT_SAVED", { path: "README.md", marker })

    await page.reload({ waitUntil: "networkidle", timeout: 90_000 })
    await page.getByRole("navigation", { name: "Workspace files" }).waitFor({ state: "visible", timeout: 90_000 })
    await page.getByRole("tab", { name: /README\.md/ }).waitFor({ state: "visible", timeout: 30_000 })
    const restoredEditor = page.locator('[aria-label="README.md"] .cm-content')
    await restoredEditor.waitFor({ state: "visible", timeout: 30_000 })
    assert.match(await restoredEditor.innerText(), new RegExp(marker))
    observe("SPACE_FILE_AND_LAYOUT_RESTORED")

    await page.getByRole("button", { name: /^(Restore|Focus) Terminal$/ }).click()
    const terminal = page.getByRole("region", { name: "Project terminal" })
    await terminal.waitFor({ state: "visible", timeout: 30_000 })
    const statusButton = terminal.getByRole("button", { name: "What has changed" })
    await statusButton.waitFor({ state: "visible", timeout: 30_000 })
    await statusButton.click()
    await poll("bounded project operation", async () => {
      const text = await terminal.innerText()
      return text.includes("README.md") && text.includes("exit 0") ? text : ""
    }, 60_000)
    observe("BOUNDED_PROJECT_OPERATION_EXECUTED", { operation: "repo.status" })

    await page.getByRole("button", { name: /^(Restore|Focus) Developer preview$/ }).click()
    const previewFrameElement = page.locator('iframe[title="Running TerraFusion application"]')
    await previewFrameElement.waitFor({ state: "visible", timeout: 60_000 })
    const previewFrame = page.frameLocator('iframe[title="Running TerraFusion application"]')
    await previewFrame.getByTestId("terrafusion-county-preview").waitFor({ state: "visible", timeout: 60_000 })
    assert.match(await previewFrame.getByTestId("terrafusion-preview-boundary").innerText(), /Local County developer preview/i)
    observe("DEVELOPER_PREVIEW_ATTACHED", { previewOrigin })

    const rail = await openWilliam(page)
    const composer = page.getByLabel("Message William")
    await composer.waitFor({ state: "visible", timeout: 30_000 })
    await poll("William composer readiness", async () => await composer.isEnabled(), 90_000)
    await composer.fill(prompt)
    await page.getByRole("button", { name: "Send to William" }).click()

    const responseText = await poll("local William response", async () => {
      return page.evaluate(() => {
        const railElement = document.querySelector('[data-testid="william-conversation-rail"]')
        if (!railElement) return ""
        const articles = Array.from(railElement.querySelectorAll("article"))
        const response = articles.find((article) => article.querySelector("span")?.textContent?.trim() === "William")
        return response?.querySelector("p")?.textContent?.trim() || ""
      })
    }, 240_000, 1_000)
    assert.ok(responseText.length > 0)
    assert.equal(await rail.locator('[role="alert"]').count(), 0)
    observe("LOCAL_ASSISTANT_RESPONDED", { response: responseText.slice(0, 500) })
    await page.screenshot({ path: path.join(evidenceRoot, "02-county-workspace-local-ai.png"), fullPage: true })

    await page.reload({ waitUntil: "networkidle", timeout: 90_000 })
    await page.getByRole("tab", { name: /README\.md/ }).waitFor({ state: "visible", timeout: 30_000 })
    await page.locator('iframe[title="Running TerraFusion application"]').waitFor({ state: "visible", timeout: 60_000 })
    await page.frameLocator('iframe[title="Running TerraFusion application"]')
      .getByTestId("terrafusion-county-preview").waitFor({ state: "visible", timeout: 60_000 })
    const restoredRail = await openWilliam(page)
    await poll("persisted owner prompt", async () => (await restoredRail.innerText()).includes(prompt), 60_000)
    await poll("persisted William response", async () => (await restoredRail.innerText()).includes(responseText), 60_000)
    observe("CONVERSATION_AND_PREVIEW_LAYOUT_RESTORED")

    assert.deepEqual(externalRequests, [], `External browser requests were observed: ${externalRequests.join(", ")}`)
    assert.deepEqual(pageErrors, [], `Page errors were observed: ${pageErrors.join(" | ")}`)
    assert.deepEqual(consoleErrors, [], `Console errors were observed: ${consoleErrors.join(" | ")}`)
    assert.ok((await fsp.readFile(readmePath, "utf8")).includes(marker))

    await fsp.writeFile(path.join(evidenceRoot, "acceptance.json"), JSON.stringify({
      schema: "williamos.county-development.browser-acceptance.v1",
      result: "PASS",
      observedAt: new Date().toISOString(),
      origin,
      previewOrigin,
      expectedDeploymentId,
      terraFusionRoot,
      file: "README.md",
      marker,
      response: responseText,
      externalRequests,
      consoleErrors,
      pageErrors,
      observations,
    }, null, 2))
  } catch (error) {
    await page.screenshot({ path: path.join(evidenceRoot, "failure.png"), fullPage: true }).catch(() => {})
    await fsp.writeFile(path.join(evidenceRoot, "acceptance.json"), JSON.stringify({
      schema: "williamos.county-development.browser-acceptance.v1",
      result: "FAIL",
      observedAt: new Date().toISOString(),
      origin,
      previewOrigin,
      expectedDeploymentId,
      terraFusionRoot,
      error: error instanceof Error ? error.stack || error.message : String(error),
      externalRequests,
      consoleErrors,
      pageErrors,
      observations,
    }, null, 2))
    throw error
  } finally {
    await browser.close()
    await closeServer(previewServer)
    // The checkout is a disposable acceptance fixture, but restoring it makes the script safe to run locally too.
    await fsp.writeFile(readmePath, originalReadme)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
