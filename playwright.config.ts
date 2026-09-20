import { defineConfig } from "@playwright/test"

const baseURL = process.env.WILLIAMOS_E2E_BASE_URL?.trim()
  || "https://williamos.lan:3543"

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  outputDir: "output/playwright",
  use: {
    baseURL,
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    ignoreHTTPSErrors: true,
    storageState: process.env.WILLIAMOS_E2E_STORAGE_STATE?.trim() || undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
})
