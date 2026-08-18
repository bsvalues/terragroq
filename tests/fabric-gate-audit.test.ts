import { describe, expect, it } from "vitest"

import { runNodeBaseline } from "@/lib/fabric/run-baseline.mjs"

const NODE = { transport: "ssh", host: "h", user: "u", os: "linux" }

describe("the gate records what it did", () => {
  it("writes one ledger entry per step", async () => {
    // The gate starts and stops a workload on every node. Before this it wrote nothing down, so the
    // plane's most consequential actions were the only ones absent from the record.
    const entries: Array<[string, string, number | string]> = []
    await runNodeBaseline("atlas", NODE, {
      exec: async () => ({ stdout: "ok", stderr: "" }),
      audit: async (node: string, action: string, rc: number | string) => { entries.push([node, action, rc]) },
    } as never)
    expect(entries.map((e) => e[1])).toEqual([
      "baseline.reach", "baseline.containers", "baseline.start",
      "baseline.push", "baseline.pull", "baseline.stop",
    ])
    expect(entries.every((e) => e[0] === "atlas")).toBe(true)
  })

  it("records a failed step with its exit code, not only successes", async () => {
    const entries: Array<[string, number | string]> = []
    await runNodeBaseline("omen", NODE, {
      exec: async () => { throw Object.assign(new Error("ssh exited 255"), { code: 255, stderr: "Permission denied (publickey)." }) },
      audit: async (_n: string, action: string, rc: number | string) => { entries.push([action, rc]) },
    } as never)
    // An audit holding only successes describes a system nobody has ever operated.
    expect(entries[0]).toEqual(["baseline.reach", 255])
  })

  it("does not let a broken ledger change the outcome it is describing", async () => {
    // Recording an action must never alter that action's result. Compared against a working ledger
    // rather than asserted as "all ok", because a stubbed exec legitimately fails the hash-verified
    // push step -- and a test that expects success there would be testing the stub, not the code.
    const exec = async () => ({ stdout: "ok", stderr: "" })
    const withLedger = await runNodeBaseline("atlas", NODE, { exec, audit: async () => {} } as never)
    const withBroken = await runNodeBaseline("atlas", NODE, {
      exec,
      audit: async () => { throw new Error("AUDIT_UNAVAILABLE") },
    } as never)
    expect(withBroken.map((r: { step: string; ok: boolean }) => [r.step, r.ok]))
      .toEqual(withLedger.map((r: { step: string; ok: boolean }) => [r.step, r.ok]))
  })
})
