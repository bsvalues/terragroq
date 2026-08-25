import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { runNodeBaseline } from "@/lib/fabric/run-baseline.mjs"

const NODE = { transport: "ssh", host: "h", user: "u", os: "linux" }

/**
 * The gate reaches nodes through the broker now, so a test node has to be a node the broker will
 * resolve. Supplying the registry the caller would have read is what `runAllBaselines` does in
 * production; without it the broker reads from disk and refuses every name, which is correct
 * behaviour and useless for testing what a step records.
 */
const RUN = (name: string, extra: Record<string, unknown>) => ({
  registry: { [name]: NODE },
  fabricRoot: path.join(tmpdir(), "fabric-gate-audit-no-ledger"),
  ...extra,
}) as never

describe("the gate records what it did", () => {
  it("writes one ledger entry per step", async () => {
    // The gate starts and stops a workload on every node. Before this it wrote nothing down, so the
    // plane's most consequential actions were the only ones absent from the record.
    const entries: Array<[string, string, number | string]> = []
    await runNodeBaseline("atlas", NODE, RUN("atlas", {
      exec: async () => ({ stdout: "ok", stderr: "" }),
      audit: async (node: string, action: string, rc: number | string) => { entries.push([node, action, rc]) },
    }))
    expect(entries.map((e) => e[1])).toEqual([
      "baseline.reach", "baseline.containers", "baseline.start",
      "baseline.push", "baseline.pull", "baseline.stop",
    ])
    expect(entries.every((e) => e[0] === "atlas")).toBe(true)
  })

  it("records a failed step with its exit code, not only successes", async () => {
    const entries: Array<[string, number | string]> = []
    await runNodeBaseline("omen", NODE, RUN("omen", {
      exec: async () => { throw Object.assign(new Error("ssh exited 255"), { code: 255, stderr: "Permission denied (publickey)." }) },
      audit: async (_n: string, action: string, rc: number | string) => { entries.push([action, rc]) },
    }))
    // An audit holding only successes describes a system nobody has ever operated.
    expect(entries[0]).toEqual(["baseline.reach", 255])
  })

  it("does not let a broken ledger change the outcome it is describing", async () => {
    // Recording an action must never alter that action's result. Compared against a working ledger
    // rather than asserted as "all ok", because a stubbed exec legitimately fails the hash-verified
    // push step -- and a test that expects success there would be testing the stub, not the code.
    const exec = async () => ({ stdout: "ok", stderr: "" })
    const withLedger = await runNodeBaseline("atlas", NODE, RUN("atlas", { exec, audit: async () => {} }))
    const withBroken = await runNodeBaseline("atlas", NODE, RUN("atlas", {
      exec,
      audit: async () => { throw new Error("AUDIT_UNAVAILABLE") },
    }))
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

describe("the preflight refuses before the node is touched", () => {
  it("refuses a ledger that is present but is not a file", async () => {
    // The preflight was a zero-byte append, on the reasoning that it fails for every reason a real
    // write would fail. It does not: on Node 24 `appendFile(dir, "")` succeeds -- the open is allowed
    // and writing nothing is a no-op -- while `appendFile(dir, "x")` throws EISDIR. So the very case
    // the preflight was written against, an `audit.log` that is a directory, passed it; the mutation
    // ran and only the real append afterwards raised. That is the loud-unrecorded-mutation this
    // function exists to prevent, one layer further down.
    const { requireLedger } = await import("@/lib/fabric/audit.mjs")
    const os = await import("node:os")
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-preflight-"))
    await fs.mkdir(path.join(root, "audit.log"))
    await expect(requireLedger(root)).rejects.toThrow(/AUDIT_UNAVAILABLE/)
  })

  it("accepts a writable root and leaves the ledger empty", async () => {
    // Proving the ledger works must not itself pollute it: the preflight creates the log exactly as
    // the first real write would, and adds no line.
    const { requireLedger } = await import("@/lib/fabric/audit.mjs")
    const os = await import("node:os")
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-ok-"))
    await expect(requireLedger(root)).resolves.toBeUndefined()
    expect((await fs.stat(path.join(root, "audit.log"))).size).toBe(0)
  })
})
