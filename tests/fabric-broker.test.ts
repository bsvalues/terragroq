import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { BrokerDenied, brokeredExec, resolveBrokeredNode, auditBrokerAction } from "@/lib/fabric/broker.mjs"

/** A throwaway fabric root, so tests never touch the real registry or the real ledger. */
async function fabricRoot(registry: Record<string, unknown>) {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-broker-"))
  await mkdir(path.join(root, "keys"), { recursive: true })
  await writeFile(path.join(root, "nodes.json"), JSON.stringify(registry), "utf8")
  return root
}

const REGISTRY = { atlas: { transport: "ssh", host: "h", user: "u", os: "linux" } }

describe("brokered execution", () => {
  it("denies a node that is not in the registry", async () => {
    // A typo that silently reaches a different host is how a management plane starts acting on a
    // machine nobody authorised.
    const root = await fabricRoot(REGISTRY)
    await expect(resolveBrokeredNode("atlss", { fabricRoot: root })).rejects.toBeInstanceOf(BrokerDenied)
  })

  it("records the refusal, not just the successes", async () => {
    const root = await fabricRoot(REGISTRY)
    await brokeredExec("nowhere", "hostname", { fabricRoot: root }).catch(() => {})
    const log = await readFile(path.join(root, "audit.log"), "utf8")
    // An audit that only records what worked describes a system nobody has ever operated.
    expect(log).toContain("nowhere")
    expect(log).toContain("rc=denied")
  })

  it("records a successful action in the same tab-separated format the CLI writes", async () => {
    const root = await fabricRoot(REGISTRY)
    await brokeredExec("atlas", "hostname", {
      fabricRoot: root,
      exec: async () => ({ stdout: "atlas", stderr: "" }),
    })
    const fields = (await readFile(path.join(root, "audit.log"), "utf8")).trim().split(String.fromCharCode(9))
    expect(fields[1]).toBe("atlas")
    expect(fields[2]).toBe("exec")
    expect(fields[3]).toBe("rc=0")
    expect(Number(fields[0])).toBeGreaterThan(1_700_000_000)
  })

  it("records a failure with the reason, then rethrows", async () => {
    const root = await fabricRoot(REGISTRY)
    const failing = async () => { throw Object.assign(new Error("ssh exited 255"), { stderr: "Permission denied (publickey).", code: 255 }) }
    await expect(brokeredExec("atlas", "hostname", { fabricRoot: root, exec: failing })).rejects.toThrow()
    const log = await readFile(path.join(root, "audit.log"), "utf8")
    expect(log).toContain("rc=255")
    expect(log).toContain("Permission denied")
  })

  it("pins host keys on every brokered connection", async () => {
    const root = await fabricRoot(REGISTRY)
    let seen: string[] = []
    await brokeredExec("atlas", "hostname", {
      fabricRoot: root,
      exec: async (_f: string, args: string[]) => { seen = args; return { stdout: "", stderr: "" } },
    })
    expect(seen).toContain("StrictHostKeyChecking=yes")
    expect(seen.some((a) => a.includes("known_hosts"))).toBe(true)
  })

  it("surfaces the operator-readable reason from CLIXML stderr", async () => {
    const root = await fabricRoot(REGISTRY)
    const payload = "#< CLIXML" + String.fromCharCode(10) + "<Objs><S S=\"Error\">disk full</S></Objs>"
    const result = await brokeredExec("atlas", "hostname", {
      fabricRoot: root,
      exec: async () => ({ stdout: "", stderr: payload }),
    })
    expect(result.stderr).toBe("disk full")
  })

  it("skips a ledger that is absent, and reports one that is broken", async () => {
    // These are different states. A machine with no fabric directory is not misconfigured, it simply
    // has no ledger; a directory that exists but cannot be appended to is a real fault worth raising.
    // Auditing every gate step made the difference matter: treating absent as broken meant six
    // throwing filesystem calls per node on machines that never had a ledger.
    await expect(auditBrokerAction(path.join(tmpdir(), "no-such-fabric-root-xyz"), "n", "exec", 0, "x"))
      .resolves.toBeUndefined()

    const root = await mkdtemp(path.join(tmpdir(), "fabric-broken-"))
    await mkdir(path.join(root, "audit.log"))
    await expect(auditBrokerAction(root, "n", "exec", 0, "x")).rejects.toThrow(/AUDIT_UNAVAILABLE/)
  })
})
