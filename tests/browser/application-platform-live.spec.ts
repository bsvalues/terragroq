import { expect, test, type APIResponse, type Response } from "@playwright/test"
import fs from "node:fs"

const liveEnabled = process.env.WILLIAMOS_LIVE_APPLICATION_ACCEPTANCE?.trim() === "1"
const liveOrigin = process.env.WILLIAMOS_LIVE_APPLICATION_ORIGIN?.trim()
const storageState = process.env.WILLIAMOS_E2E_STORAGE_STATE?.trim()
const expectedFinalSha = process.env.WILLIAMOS_LIVE_EXPECTED_FINAL_SHA?.trim()
const resetRequest = "Add a Reset board button below the counter, style it as a secondary action, and implement reset behavior with accessible status text. Modify all three source files."

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  expect(value && typeof value === "object" && !Array.isArray(value)).toBe(true)
  return value as JsonRecord
}

async function json(response: Response | APIResponse): Promise<JsonRecord> {
  expect(response.ok()).toBe(true)
  return record(await response.json())
}

function streamedProposal(body: string): JsonRecord {
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => record(JSON.parse(line)))
  const terminal = lines.at(-1)
  expect(terminal?.type).toBe("proposal")
  return record(terminal?.proposal)
}

function applicationList(payload: JsonRecord): JsonRecord[] {
  expect(Array.isArray(payload.applications)).toBe(true)
  expect(payload.invalid).toEqual([])
  return payload.applications as JsonRecord[]
}

test.describe.serial("live Focus Board owner acceptance", () => {
  test.skip(!liveEnabled, "set WILLIAMOS_LIVE_APPLICATION_ACCEPTANCE=1 for the separately authorized live controller phase")
  test.use({ storageState: storageState || undefined })

  test.beforeAll(() => {
    expect(liveOrigin, "live acceptance requires explicit WILLIAMOS_LIVE_APPLICATION_ORIGIN").toBeTruthy()
    const origin = new URL(liveOrigin!)
    expect(origin.protocol).toBe("https:")
    expect(origin.pathname).toBe("/")
    expect(origin.search).toBe("")
    expect(origin.hash).toBe("")
    expect(storageState, "live acceptance requires authenticated WILLIAMOS_E2E_STORAGE_STATE").toBeTruthy()
    expect(fs.statSync(storageState!).isFile(), "authenticated storage state must already exist").toBe(true)
    expect(expectedFinalSha, "live acceptance requires explicit WILLIAMOS_LIVE_EXPECTED_FINAL_SHA").toMatch(/^[0-9a-f]{40}$/)
  })

  test("creates, runs, rejects Cerebras, applies resident Reset, and preserves terminal truth", async ({ page }) => {
    test.setTimeout(3_000_000)
    const origin = new URL(liveOrigin!).origin
    const initialCatalog = await json(await page.request.get(`${origin}/api/applications`))
    const initialApplications = applicationList(initialCatalog)
    expect(initialApplications, "the disposable applications root must be empty before acceptance; never overwrite or delete an owner repository").toEqual([])
    expect(initialApplications.some((application) => record(application.manifest).id === "focus-board")).toBe(false)

    const shell = await page.goto(`${origin}/?project=williamos`, { waitUntil: "domcontentloaded" })
    expect(shell?.ok()).toBe(true)
    expect(new URL(page.url()).pathname).not.toBe("/sign-in")
    await page.getByRole("button", { name: "Create application" }).click()
    const dialog = page.getByRole("dialog", { name: "Create application" })
    await dialog.getByLabel("Application name").fill("Focus Board")
    await dialog.getByLabel(/Application ID/).fill("focus-board")
    const createResponse = page.waitForResponse((response) => response.url() === `${origin}/api/applications` && response.request().method() === "POST")
    await dialog.getByRole("button", { name: "Create application" }).click()
    const created = record((await json(await createResponse)).application)
    const manifest = record(created.manifest)
    expect(created.projectKey).toBe("focus-board")
    expect(manifest).toEqual({
      schemaVersion: 1,
      id: "focus-board",
      displayName: "Focus Board",
      adapter: "static-web-v1",
      source: { document: "src/index.html", styles: "src/styles.css", script: "src/app.js", test: "test/application.test.mjs" },
      ai: { writablePaths: ["src/index.html", "src/styles.css", "src/app.js"] },
    })
    const initialHead = String(created.head)
    expect(initialHead).toMatch(/^[0-9a-f]{40,64}$/)
    await expect(page).toHaveURL(new RegExp("[?&]project=focus-board(?:&|$)"))

    const controls = page.getByRole("region", { name: "Focus Board runtime and HERMES change controls" })
    await expect(controls).toBeVisible()
    const startResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/focus-board/application-runtime") && response.request().method() === "POST", { timeout: 300_000 })
    await controls.getByRole("button", { name: "Start application" }).click()
    const initialRuntimePayload = await json(await startResponse)
    const initialRuntime = record(initialRuntimePayload.runtime)
    const initialActive = record(initialRuntime.active)
    expect(initialRuntime.observed).toBe("running")
    expect(initialActive.sourceHead).toBe(initialHead)
    const initialGeneration = String(initialActive.generation)
    const initialArtifact = String(initialActive.artifactSha256)
    await expect(controls.getByText("Runtime running", { exact: false })).toBeVisible({ timeout: 300_000 })

    const iframe = page.locator('iframe[title="Running Focus Board application"]')
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts")
    const preview = page.frameLocator('iframe[title="Running Focus Board application"]')
    await preview.getByRole("textbox", { name: "What would you like to do?" }).fill("Prove Focus Board is interactive")
    await preview.getByRole("button", { name: "Add task" }).click()
    await expect(preview.getByText("0 of 1 complete")).toBeVisible()

    const assistant = page.getByRole("region", { name: "Ask HERMES to develop Focus Board" })
    const route = assistant.getByRole("combobox", { name: "AI execution route" })
    await route.selectOption("cerebras-qwen-3-8-27b")
    const cerebrasRequest = assistant.getByLabel("Ask HERMES to change Focus Board")
    await cerebrasRequest.fill("Make the Focus Board heading more concise for review. Do not add Reset behavior yet.")
    await assistant.getByRole("checkbox", { name: /approve sending it with the allowlisted application source to Cerebras/i }).check()
    const cerebrasResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/focus-board/application-proposals") && response.request().method() === "POST", { timeout: 600_000 })
    await assistant.getByRole("button", { name: "Ask HERMES via Cerebras" }).click()
    const cerebrasProposal = streamedProposal(await (await cerebrasResponse).text())
    expect(cerebrasProposal).toMatchObject({
      schemaVersion: 4,
      applicationId: "focus-board",
      status: "READY_FOR_REVIEW",
      executionRoute: "cerebras-qwen-3-8-27b",
      executionProvider: "cerebras",
      executionNode: "cerebras-api",
      model: "qwen-3.8-27b",
      baseSha: initialHead,
    })
    const provider = record(cerebrasProposal.providerExecution)
    expect(provider.actualModel).toBe("qwen-3.8-27b")
    expect(Number(provider.promptTokens)).toBeGreaterThan(0)
    expect(Number(provider.completionTokens)).toBeGreaterThan(0)
    expect(Number(provider.totalTokens)).toBeGreaterThan(0)
    expect(Number(provider.durationMs)).toBeGreaterThan(0)
    await expect(assistant.getByText("Proposal ready for review.")).toBeVisible()
    await assistant.getByRole("button", { name: "Reject proposal" }).click()
    await assistant.getByLabel("Rejection reason").fill("External proposal was evidence-only; use the reviewed resident route for the Reset change.")
    const rejectResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/application-proposals/${String(cerebrasProposal.proposalId)}`) && response.request().method() === "PATCH")
    await assistant.getByRole("button", { name: "Confirm rejection" }).click()
    const rejected = record((await json(await rejectResponse)).proposal)
    expect(rejected.status).toBe("REJECTED")
    await expect(assistant.getByText("Rejected", { exact: true })).toBeVisible()
    const afterReject = applicationList(await json(await page.request.get(`${origin}/api/applications`)))
    expect(afterReject.find((application) => record(application.manifest).id === "focus-board")?.head).toBe(initialHead)
    await expect(assistant.getByRole("button", { name: "Review next proposal" })).toBeVisible()

    await route.selectOption("hermes-local")
    await expect(route).toHaveValue("hermes-local")
    await cerebrasRequest.fill(resetRequest)
    const localResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/focus-board/application-proposals") && response.request().method() === "POST", { timeout: 2_100_000 })
    await assistant.getByRole("button", { name: "Ask HERMES", exact: true }).click()
    const localProposal = streamedProposal(await (await localResponse).text())
    expect(localProposal).toMatchObject({
      schemaVersion: 4,
      applicationId: "focus-board",
      status: "READY_FOR_REVIEW",
      executionRoute: "hermes-local",
      executionProvider: "hermes-local",
      executionNode: "hermes-node",
      model: "williamos-qwen3-4b:64k",
      providerExecution: null,
      baseSha: initialHead,
      changedPaths: ["src/app.js", "src/index.html", "src/styles.css"],
      validation: { status: "passed", command: "node --test test/application.test.mjs" },
    })
    const candidateHead = String(localProposal.candidateSha)
    expect(candidateHead).toMatch(/^[0-9a-f]{40,64}$/)
    expect(candidateHead).not.toBe(initialHead)
    await expect(assistant.getByText("Proposal ready for review.")).toBeVisible({ timeout: 2_100_000 })

    const applyResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/application-proposals/${String(localProposal.proposalId)}/apply`) && response.request().method() === "POST")
    const rebuildResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/focus-board/application-runtime") && response.request().method() === "POST", { timeout: 300_000 })
    await assistant.getByRole("button", { name: "Apply proposal" }).click()
    const applied = record((await json(await applyResponse)).proposal)
    expect(applied).toMatchObject({ status: "APPLIED", appliedCommit: candidateHead, providerExecution: null })
    const rebuiltPayload = await json(await rebuildResponse)
    const rebuiltActive = record(record(rebuiltPayload.runtime).active)
    expect(rebuiltActive.sourceHead).toBe(candidateHead)
    expect(rebuiltActive.generation).not.toBe(initialGeneration)
    expect(rebuiltActive.artifactSha256).not.toBe(initialArtifact)
    const truth = record(rebuiltPayload.truth)
    expect(truth.activeProjectHead).toBe(candidateHead)
    expect(record(truth.runtimeBuild).sha).toBe(expectedFinalSha)
    const runtimeTruth = controls.getByLabel("Focus Board runtime truth")
    await expect(runtimeTruth.getByText(candidateHead, { exact: false })).toBeVisible({ timeout: 300_000 })
    await expect(runtimeTruth.getByText(expectedFinalSha!, { exact: false })).toBeVisible({ timeout: 300_000 })
    await expect(assistant.getByText("Applied", { exact: true })).toBeVisible()
    await expect(assistant.getByRole("button", { name: "Review next proposal" })).toBeVisible()

    await expect(preview.getByRole("button", { name: /reset board/i })).toBeVisible({ timeout: 300_000 })
    await preview.getByRole("button", { name: /reset board/i }).click()
    await expect(preview.getByText("0 of 0 complete")).toBeVisible()
    await expect(preview.getByRole("status")).toContainText(/reset|cleared/i)
    await expect(assistant.getByText("Applied", { exact: true })).toBeVisible()
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts")
  })
})
