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

describe("an absent ledger is not a broken one", () => {
  it("does not throw, and does not attempt a write, when there is no fabric root", async () => {
    // On a machine with no fabric directory -- CI, most obviously -- the previous behaviour attempted
    // and failed a write for every step of every node: six throwing filesystem calls per node on a
    // suite that is already timing-sensitive.
    const { auditFabricAction } = await import("@/lib/fabric/audit.mjs")
    await expect(auditFabricAction("C:/no-such-fabric-root-xyz", "n", "a", 0, "x")).resolves.toBeUndefined()
  })

  it("still reports a ledger that exists but cannot be written", async () => {
    // Absent and broken are different states, and only one of them is worth reporting.
    const { auditFabricAction } = await import("@/lib/fabric/audit.mjs")
    const os = await import("node:os")
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-"))
    // A directory where the log file must live makes appendFile fail while the root exists.
    await fs.mkdir(path.join(root, "audit.log"))
    await expect(auditFabricAction(root, "n", "a", 0, "x")).rejects.toThrow(/AUDIT_UNAVAILABLE/)
  })
})
