import { spawnSync } from "node:child_process"
import { expect, it } from "vitest"

// Include the standalone appliance suites in the repository's normal Vitest selection.
// HTTP and DOM checks run on all platforms; the real PowerShell collector fixture is Windows-only.
it("passes the standalone HERMES appliance runtime suites", () => {
  const result = spawnSync(process.execPath, [
    "--test",
    "tests/hermes-console-adapter.test.mjs",
    "tests/hermes-console-ui.test.mjs",
    "tests/hermes-console-collector.test.mjs",
  ], { encoding: "utf8", timeout: 110_000 })
  expect(result.error, result.error?.message).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}, 120_000)
