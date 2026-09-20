import { expect, test } from "@playwright/test"

const runtimeUrl = "/api/projects/hello-application/preview"
const ownerStorageState = process.env.WILLIAMOS_E2E_STORAGE_STATE?.trim()

test.beforeAll(() => {
  expect(
    ownerStorageState,
    "the browser gate requires an authenticated owner session; set WILLIAMOS_E2E_STORAGE_STATE to a Playwright storage-state file captured for this WilliamOS origin",
  ).toBeTruthy()
})

test("the Hello Application controls are reachable and Refresh replaces visible preview content", async ({ page }) => {
  let previewLoads = 0

  await page.route("**/api/projects/hello-application/runtime", async (route) => {
    if (route.request().method() !== "GET") {
      await route.abort("blockedbyclient")
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runtime: {
          state: "running",
          pid: 4242,
          url: runtimeUrl,
          error: null,
        },
        truth: {
          runtimeBuild: {
            sha: "a".repeat(40),
            builtAt: "2026-09-20T00:00:00.000Z",
          },
          activeProjectHead: "b".repeat(40),
        },
      }),
    })
  })

  await page.route("**/api/projects/hello-application/proposals", async (route) => {
    if (route.request().method() !== "GET") {
      await route.abort("blockedbyclient")
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ proposals: [] }),
    })
  })

  await page.route("**/api/projects/hello-application/execution-routes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [
          { id: "hermes-local", label: "Local HERMES — williamos-qwen3-4b:64k (default)", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true },
          { id: "cerebras-gpt-oss-120b", label: "Cerebras — gpt-oss-120b (external, metered)", provider: "cerebras", model: "gpt-oss-120b", external: true, metered: true, available: true },
          { id: "cerebras-qwen-3-8-27b", label: "Cerebras — qwen-3.8-27b (external, metered)", provider: "cerebras", model: "qwen-3.8-27b", external: true, metered: true, available: true },
        ],
      }),
    })
  })

  await page.route("**/api/projects/hello-application/preview", async (route) => {
    previewLoads += 1
    const generation = previewLoads
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: { "cache-control": "no-store" },
      body: `<!doctype html><html><body><main><h1>Browser gate preview ${generation}</h1><p>Visible generation ${generation}</p></main></body></html>`,
    })
  })

  const response = await page.goto("/?project=hello-application", {
    waitUntil: "domcontentloaded",
  })
  expect(response?.ok(), "the WilliamOS shell document should load").toBe(true)

  const destination = new URL(page.url())
  expect(
    destination.pathname,
    "the configured browser state is not an authenticated WilliamOS owner session",
  ).not.toBe("/sign-in")
  expect(destination.searchParams.get("project")).toBe("hello-application")

  const controls = page.getByRole("region", {
    name: "Hello Application runtime and HERMES change controls",
  })
  await expect(controls).toBeVisible()
  await expect(controls.getByText("Runtime running", { exact: false })).toBeVisible()
  const truth = page.getByLabel("Hello Application runtime truth")
  await expect(truth.getByText(`Runtime build ${"a".repeat(40)}`)).toBeVisible()
  await expect(truth.getByText(`Active project HEAD ${"b".repeat(40)}`)).toBeVisible()
  await expect(page.getByRole("textbox", {
    name: "Ask HERMES to change this application",
  })).toBeVisible()

  const preview = page.frameLocator('iframe[title="Running Hello Application application"]')
  await expect(preview.getByRole("heading", { name: "Browser gate preview 1" })).toBeVisible()
  expect(previewLoads).toBe(1)

  await controls.getByRole("button", { name: "Refresh preview" }).click()

  await expect(preview.getByRole("heading", { name: "Browser gate preview 2" })).toBeVisible()
  expect(previewLoads).toBe(2)
})

test("the explicit Cerebras route is reachable and never silently becomes local", async ({ page }) => {
  let submitted: unknown = null
  await page.route("**/api/projects/hello-application/runtime", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runtime: { state: "running", pid: 4242, url: runtimeUrl, error: null },
        truth: { runtimeBuild: { sha: "a".repeat(40), builtAt: "2026-09-20T00:00:00.000Z" }, activeProjectHead: "a".repeat(40) },
      }),
    })
  })
  await page.route("**/api/projects/hello-application/execution-routes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        defaultRoute: "hermes-local",
        routes: [
          { id: "hermes-local", label: "Local HERMES — williamos-qwen3-4b:64k (default)", provider: "hermes-local", model: "williamos-qwen3-4b:64k", external: false, metered: false, available: true },
          { id: "cerebras-qwen-3-8-27b", label: "Cerebras — qwen-3.8-27b (external, metered)", provider: "cerebras", model: "qwen-3.8-27b", external: true, metered: true, available: true },
        ],
      }),
    })
  })
  await page.route("**/api/projects/hello-application/proposals", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposals: [] }) })
      return
    }
    submitted = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({ type: "error", error: "EXTERNAL_API_OUTAGE" })}\n`,
    })
  })

  await page.goto("/?project=hello-application", { waitUntil: "domcontentloaded" })
  const controls = page.getByRole("region", { name: "Hello Application runtime and HERMES change controls" })
  const route = controls.getByRole("combobox", { name: "AI execution route" })
  await expect(route).toHaveValue("hermes-local")
  await route.selectOption("cerebras-qwen-3-8-27b")
  await expect(controls.getByText(/External and metered.*No local fallback\./)).toBeVisible()
  const approval = controls.getByRole("checkbox", { name: /I confirm this request contains only public or sanitized content/i })
  const request = controls.getByRole("textbox", { name: "Ask HERMES to change this application" })
  const ask = controls.getByRole("button", { name: "Ask HERMES via Cerebras" })
  await request.fill("Add a visible routed marker")
  await approval.check()
  await request.fill("Add a visible routed marker safely")
  await expect(approval).not.toBeChecked()
  await expect(ask).toBeDisabled()
  await approval.check()
  await ask.click()
  await expect(controls.getByText("HERMES request failed: EXTERNAL_API_OUTAGE")).toBeVisible()
  expect(submitted).toEqual({
    requestText: "Add a visible routed marker safely",
    executionRoute: "cerebras-qwen-3-8-27b",
    externalEgressApproved: true,
  })

  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(controls.getByRole("combobox", { name: "AI execution route" })).toHaveValue("hermes-local")
})
