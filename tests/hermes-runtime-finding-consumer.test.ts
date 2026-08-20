import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

import { createHermesOutcomeQueueRuntime } from "../scripts/hermes-bridge/outcome-queue-runtime.mjs"

const root = path.resolve(import.meta.dirname, "..")

describe("HERMES native runtime finding consumer boundary", () => {
  it("exposes the neutral database consumer through the existing lazy pool", async () => {
    const consume = vi.fn(async () => ({ status: "RUNTIME_FINDINGS_CONSUMED", queuedChildren: 0 }))
    const createRuntimeFindingConsumer = vi.fn(({ withPool, now }) => {
      expect(typeof withPool).toBe("function")
      expect(typeof now).toBe("function")
      return consume
    })
    const runtime = createHermesOutcomeQueueRuntime({
      databaseUrl: "database-url-not-opened",
      createRuntimeFindingConsumer,
      createPool: vi.fn(() => { throw new Error("injected consumer must not open the pool") }),
    })
    await expect(runtime.consumeRuntimeFindings()).resolves.toMatchObject({ queuedChildren: 0 })
    expect(createRuntimeFindingConsumer).toHaveBeenCalledOnce()
    expect(consume).toHaveBeenCalledOnce()
    await runtime.close()
  })

  it("imports no retired operator, worker, adapter, filesystem activation, or nested execution surface", () => {
    const neutral = [
      "scripts/runtime-findings/policy.mjs",
      "scripts/runtime-findings/db-consumer.mjs",
      "scripts/hermes-bridge/outcome-queue-runtime.mjs",
      "scripts/hermes-bridge/cli.mjs",
    ].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n")
    expect(neutral).not.toMatch(/from\s+["'][^"']*runtime-operator\//)
    expect(neutral).not.toMatch(/operational-kernel|native-adapters|worker-lanes|codex\s+exec/i)
    expect(neutral).not.toMatch(/control[\\/]activation|WILLIAMOS_RUNTIME_ROOT/)
    expect(fs.readFileSync(path.join(root, "scripts/hermes-bridge/supervisor.ps1"), "utf8"))
      .not.toMatch(/runtime-findings|runtime-operator|codex\s+exec/i)
  })
})
