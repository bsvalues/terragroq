const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const http = require("node:http")
const path = require("node:path")
const { chromium } = require("playwright")

const origin = (process.env.COUNTY_ACCEPTANCE_ORIGIN || "http://127.0.0.1:3200").replace(/\/$/, "")
const previewOrigin = (process.env.COUNTY_ACCEPTANCE_PREVIEW_ORIGIN || "http://127.0.0.1:3102").replace(/\/$/, "")
const terraFusionRoot = process.env.COUNTY_ACCEPTANCE_TERRAFUSION_ROOT
const expectedTerraFusionSha = process.env.COUNTY_ACCEPTANCE_TERRAFUSION_SHA || null
const evidenceRoot = process.env.COUNTY_ACCEPTANCE_EVIDENCE_ROOT || path.join(process.cwd(), "county-acceptance-evidence")
const browserProfile = process.env.COUNTY_ACCEPTANCE_BROWSER_PROFILE
  || path.join(process.env.RUNNER_TEMP || path.dirname(evidenceRoot), "county-acceptance-browser-profile")
const expectedDeploymentId = process.env.COUNTY_ACCEPTANCE_EXPECTED_DEPLOYMENT_ID || "ci-county-development"
const ownerEmail = process.env.COUNTY_ACCEPTANCE_OWNER_EMAIL || "county.bundle@example.gov"
const ownerPassword = process.env.COUNTY_ACCEPTANCE_OWNER_PASSWORD || "County-Bundle-Acceptance-2026!"
const prompt = "Reply with the exact token COUNTY_LOCAL_OK and nothing else."

if (!terraFusionRoot || !path.isAbsolute(terraFusionRoot)) {
  throw new Error("COUNTY_ACCEPTANCE_TERRAFUSION_ROOT must be an absolute path")
}

const readmePath = path.join(terraFusionRoot, "README.md")
const packagePath = path.join(terraFusionRoot, "package.json")
if (!fs.existsSync(readmePath)) throw new Error(`Acceptance file is missing: ${readmePath}`)
if (!fs.existsSync(packagePath)) throw new Error(`Second acceptance file is missing: ${packagePath}`)

const terraFusionSha = execFileSync("git", ["-C", terraFusionRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
if (expectedTerraFusionSha) assert.equal(terraFusionSha, expectedTerraFusionSha)

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
const consoleErrors = []
const pageErrors = []
const externalRequests = []
const externalWebSockets = []
const observations = []

function observe(code, detail = {}) {
  observations.push({ at: new Date().toISOString(), code, ...detail })
}

function externalNetworkUrl(rawUrl, protocols) {
  try {
    const url = new URL(rawUrl)
    return protocols.has(url.protocol) && !loopbackHosts.has(url.hostname.toLowerCase())
  } catch {
    return true
  }
}

function attachPageObservers(page) {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("request", (request) => {
    if (externalNetworkUrl(request.url(), new Set(["http:", "https:"]))) externalRequests.push(request.url())
  })
  page.on("websocket", (socket) => {
    if (externalNetworkUrl(socket.url(), new Set(["ws:", "wss:"]))) externalWebSockets.push(socket.url())
  })
}

async function launchOwnerSurface() {
  const context = await chromium.launchPersistentContext(browserProfile, {
    headless: true,
    viewport: { width: 1600, height: 1000 },
  })
  const page = context.pages()[0] || await context.newPage()
  attachPageObservers(page)
  return { context, page }
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
<head>
  <meta charset="utf-8">
  <title>WilliamOS degraded developer preview fixture</title>
  <style>
    body { margin: 0; padding: 32px; font: 16px system-ui, sans-serif; background: #111827; color: #f9fafb; }
    main { max-width: 760px; margin: auto; padding: 28px; border: 1px solid #4b5563; border-radius: 14px; background: #1f2937; }
    strong { color: #fbbf24; }
    button { margin-top: 18px; padding: 10px 16px; border-radius: 8px; border: 0; cursor: pointer; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main data-testid="degraded-developer-preview-fixture">
    <h1>Degraded developer preview fixture</h1>
    <p><strong>TerraFusion runtime is not started by the offline-package CI job.</strong></p>
    <p>This neutral loopback fixture proves that WilliamOS keeps an admitted developer Preview interactive beside source work. It is not TerraFusion product or county-business acceptance.</p>
    <p>Source-pinned TerraFusion checkout: <code data-testid="preview-source-sha">${terraFusionSha}</code></p>
    <button type="button" data-testid="preview-interaction">Verify preview interactivity</button>
    <p data-testid="preview-interaction-result" aria-live="polite">No interaction yet</p>
  </main>
  <script>
    let count = 0;
    const result = document.querySelector('[data-testid="preview-interaction-result"]');
    document.querySelector('[data-testid="preview-interaction"]').addEventListener('click', () => {
      count += 1;
      result.textContent = 'Interaction ' + count + ' accepted locally';
    });
  </script>
</body>
</html>`
  const server = http.createServer((_request, response) => {
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

async function focusDeveloperPreview(page) {
  await page.getByRole("button", { name: /^(Restore|Focus) Developer preview$/ }).click()
  const frameElement = page.locator('iframe[title="Running TerraFusion application"]')
  await frameElement.waitFor({ state: "visible", timeout: 60_000 })
  const frame = page.frameLocator('iframe[title="Running TerraFusion application"]')
  await frame.getByTestId("degraded-developer-preview-fixture").waitFor({ state: "visible", timeout: 60_000 })
  assert.match(await frame.getByTestId("degraded-developer-preview-fixture").innerText(), /not TerraFusion product or county-business acceptance/i)
  assert.equal((await frame.getByTestId("preview-source-sha").innerText()).trim(), terraFusionSha)
  await frame.getByTestId("preview-interaction").click()
  await poll("interactive degraded Preview", async () => /Interaction 1 accepted locally/.test(
    await frame.getByTestId("preview-interaction-result").innerText(),
  ))
  return frame
}

async function assertSplitFiles(page, marker) {
  const primaryTabs = page.getByRole("tablist", { name: "primary editor tabs" })
  const secondaryTabs = page.getByRole("tablist", { name: "secondary editor tabs" })
  await primaryTabs.waitFor({ state: "visible", timeout: 60_000 })
  await secondaryTabs.waitFor({ state: "visible", timeout: 60_000 })
  const primaryReadme = primaryTabs.getByRole("tab", { name: /README\.md/ })
  const secondaryPackage = secondaryTabs.getByRole("tab", { name: /package\.json/ })
  await primaryReadme.waitFor({ state: "visible", timeout: 30_000 })
  await secondaryPackage.waitFor({ state: "visible", timeout: 30_000 })
  assert.equal(await primaryReadme.getAttribute("aria-selected"), "true")
  assert.equal(await secondaryPackage.getAttribute("aria-selected"), "true")
  await page.locator('[data-split="true"]').first().waitFor({ state: "visible", timeout: 30_000 })

  const readmeEditor = page.locator('[aria-label="README.md"] .cm-content').first()
  const packageEditor = page.locator('[aria-label="package.json"] .cm-content').first()
  await readmeEditor.waitFor({ state: "visible", timeout: 30_000 })
  await packageEditor.waitFor({ state: "visible", timeout: 30_000 })
  assert.match(await readmeEditor.innerText(), new RegExp(marker))
  const [readmeBox, packageBox] = await Promise.all([readmeEditor.boundingBox(), packageEditor.boundingBox()])
  assert.ok(readmeBox && packageBox, "Both split editors must have measurable owner-visible geometry")
  assert.ok(Math.abs(readmeBox.x - packageBox.x) > 100, "README.md and package.json were not placed side by side")
}

async function main() {
  await fsp.mkdir(evidenceRoot, { recursive: true })
  await fsp.rm(browserProfile, { recursive: true, force: true })
  const originalReadme = await fsp.readFile(readmePath, "utf8")
  const marker = `COUNTY_BROWSER_ACCEPTANCE_${Date.now()}`
  const previewServer = await startPreviewServer()
  let ownerSurface = await launchOwnerSurface()
  let context = ownerSurface.context
  let page = ownerSurface.page

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
    observe("REAL_SOURCE_PINNED_TERRAFUSION_WORKSPACE_OPENED", { terraFusionSha })

    const readmeButton = fileTree.locator('button[title="README.md"]')
    await readmeButton.waitFor({ state: "visible", timeout: 30_000 })
    await readmeButton.click()

    const editor = page.locator('[aria-label="README.md"] .cm-content')
    await editor.waitFor({ state: "visible", timeout: 30_000 })
    await editor.click()
    await page.keyboard.press("Control+End")
    await page.keyboard.insertText(`\n\n${marker}\n`)
    await poll("inserted README marker", async () => (await editor.innerText()).includes(marker), 15_000)
    await page.keyboard.press("Control+Z")
    await poll("README undo", async () => !(await editor.innerText()).includes(marker), 15_000)
    await page.keyboard.press("Control+Y")
    await poll("README redo", async () => (await editor.innerText()).includes(marker), 15_000)
    observe("EDIT_UNDO_REDO_VERIFIED", { path: "README.md" })
    await page.keyboard.press("Control+S")

    await poll("saved README marker", async () => (await fsp.readFile(readmePath, "utf8")).includes(marker), 30_000)
    observe("REAL_FILE_EDIT_SAVED", { path: "README.md", marker })

    const packageButton = fileTree.locator('button[title="package.json"]')
    await packageButton.waitFor({ state: "visible", timeout: 30_000 })
    await packageButton.click()
    await page.locator('[aria-label="package.json"] .cm-content').waitFor({ state: "visible", timeout: 30_000 })
    observe("SECOND_REAL_FILE_OPENED", { path: "package.json" })

    await page.getByRole("button", { name: "Split editor" }).click()
    const primaryTabs = page.getByRole("tablist", { name: "primary editor tabs" })
    const secondaryTabs = page.getByRole("tablist", { name: "secondary editor tabs" })
    await secondaryTabs.waitFor({ state: "visible", timeout: 30_000 })
    await primaryTabs.getByRole("tab", { name: /README\.md/ }).click()
    await secondaryTabs.getByRole("tab", { name: /package\.json/ }).click()
    await assertSplitFiles(page, marker)
    observe("TWO_REAL_FILES_PLACED_SIDE_BY_SIDE")

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

    await focusDeveloperPreview(page)
    observe("DEGRADED_DEVELOPER_PREVIEW_FIXTURE_INTERACTIVE", {
      previewOrigin,
      limitation: "TerraFusion runtime was not started by package CI",
    })

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
    await page.screenshot({ path: path.join(evidenceRoot, "02-county-w1-before-reopen.png"), fullPage: true })

    await page.waitForTimeout(1_500)
    await context.close()
    context = null
    page = null
    observe("OWNER_SURFACE_CLOSED")

    ownerSurface = await launchOwnerSurface()
    context = ownerSurface.context
    page = ownerSurface.page
    await page.goto(origin, { waitUntil: "networkidle", timeout: 90_000 })
    await page.getByRole("navigation", { name: "Workspace files" }).waitFor({ state: "visible", timeout: 90_000 })
    observe("OWNER_SURFACE_REOPENED")

    await assertSplitFiles(page, marker)
    await focusDeveloperPreview(page)
    const restoredRail = await openWilliam(page)
    await poll("persisted owner prompt", async () => (await restoredRail.innerText()).includes(prompt), 60_000)
    await poll("persisted William response", async () => (await restoredRail.innerText()).includes(responseText), 60_000)
    observe("SPACE_FILES_SPLIT_PREVIEW_AND_CONVERSATION_RESTORED")
    await page.screenshot({ path: path.join(evidenceRoot, "03-county-w1-after-reopen.png"), fullPage: true })

    assert.deepEqual(externalRequests, [], `External browser requests were observed: ${externalRequests.join(", ")}`)
    assert.deepEqual(externalWebSockets, [], `External browser WebSockets were observed: ${externalWebSockets.join(", ")}`)
    assert.deepEqual(pageErrors, [], `Page errors were observed: ${pageErrors.join(" | ")}`)
    assert.deepEqual(consoleErrors, [], `Console errors were observed: ${consoleErrors.join(" | ")}`)
    assert.ok((await fsp.readFile(readmePath, "utf8")).includes(marker))

    await fsp.writeFile(path.join(evidenceRoot, "acceptance.json"), JSON.stringify({
      schema: "williamos.county-development.browser-acceptance.v2",
      result: "PASS",
      observedAt: new Date().toISOString(),
      origin,
      preview: {
        origin: previewOrigin,
        mode: "degraded-interactive-fixture",
        limitation: "TerraFusion runtime was not started by package CI; no TerraFusion business acceptance is claimed.",
      },
      expectedDeploymentId,
      terraFusionRoot,
      terraFusionSha,
      files: ["README.md", "package.json"],
      marker,
      response: responseText,
      externalRequests,
      externalWebSockets,
      consoleErrors,
      pageErrors,
      observations,
    }, null, 2))
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(evidenceRoot, "failure.png"), fullPage: true }).catch(() => {})
    }
    await fsp.writeFile(path.join(evidenceRoot, "acceptance.json"), JSON.stringify({
      schema: "williamos.county-development.browser-acceptance.v2",
      result: "FAIL",
      observedAt: new Date().toISOString(),
      origin,
      preview: { origin: previewOrigin, mode: "degraded-interactive-fixture" },
      expectedDeploymentId,
      terraFusionRoot,
      terraFusionSha,
      error: error instanceof Error ? error.stack || error.message : String(error),
      externalRequests,
      externalWebSockets,
      consoleErrors,
      pageErrors,
      observations,
    }, null, 2))
    throw error
  } finally {
    if (context) await context.close().catch(() => {})
    await closeServer(previewServer)
    await fsp.writeFile(readmePath, originalReadme)
    await fsp.rm(browserProfile, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
