import { describe, expect, it } from "vitest"

import { runCliEntrypoint, sanitizeBridgeMessage } from "../scripts/hermes-bridge/cli.mjs"

describe("Hermes bridge CLI", () => {
  it("redacts credential-bearing database URLs from structured wall output", () => {
    expect(sanitizeBridgeMessage("connect failed for postgresql://owner:opaque-password@db.example.test/app"))
      .toBe("connect failed for postgresql://[REDACTED]@db.example.test/app")
  })

  it("flushes output and exits after a completed one-shot command", async () => {
    const events: string[] = []

    await runCliEntrypoint("cycle", {
      run: async (command: string) => {
        events.push(`run:${command}`)
        return 0
      },
      flush: async () => { events.push("flush") },
      exit: (code: number) => { events.push(`exit:${code}`) },
    })

    expect(events).toEqual(["run:cycle", "flush", "exit:0"])
  })

  it("propagates a failed command exit code after flushing output", async () => {
    const events: string[] = []

    await runCliEntrypoint("cycle", {
      run: async () => 1,
      flush: async () => { events.push("flush") },
      exit: (code: number) => { events.push(`exit:${code}`) },
    })

    expect(events).toEqual(["flush", "exit:1"])
  })
})
