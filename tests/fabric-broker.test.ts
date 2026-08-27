import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { BrokerDenied, brokeredExec, resolveBrokeredNode, auditBrokerAction } from "@/lib/fabric/broker.mjs"
import { requireLedger } from "@/lib/fabric/audit.mjs"

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

  it("refuses a required audit before it touches the node, not after", async () => {
    // CONT-EXPV2-AUDIT-FAIL-LOUD. The ordering is the whole requirement. Auditing after the fact can
    // only ever tell the caller that a mutation it has ALREADY made is missing from the record --
    // that converts a silent unrecorded mutation into a loud one and governs nothing. So a caller
    // whose evidence is part of its action checks first, and the node is never reached.
    const root = await fabricRoot(REGISTRY)
    const absent = path.join(tmpdir(), "no-such-fabric-root-required-abc")
    let reached = false
    const exec = async () => { reached = true; return { stdout: "", stderr: "" } }

    await expect(
      brokeredExec("atlas", "hostname", { fabricRoot: absent, registry: REGISTRY, exec, requireAudit: true }),
    ).rejects.toThrow(/AUDIT_UNAVAILABLE/)
    expect(reached).toBe(false)

    // The same call against a real ledger runs and is recorded, so the refusal above is about the
    // missing ledger and not about `requireAudit` refusing everything.
    await brokeredExec("atlas", "hostname", { fabricRoot: root, exec, requireAudit: true })
    expect(reached).toBe(true)
    expect(await readFile(path.join(root, "audit.log"), "utf8")).toContain("atlas")
  })

  it("does not let a ledger's absence become permanent once it exists", async () => {
    // The memo used to cache the answer either way, so "there is no ledger here" was true for the
    // process lifetime: a ledger created a second later was never noticed, and every action after it
    // completed unrecorded while the ledger sat there. Only presence is cached now -- a ledger cannot
    // appear and then un-appear, so caching `true` is sound and caching `false` is a decision to stop
    // looking.
    const root = path.join(await mkdtemp(path.join(tmpdir(), "fabric-late-")), "fabric")

    // Absent: skipped, as before, and a required caller is refused.
    await expect(auditBrokerAction(root, "atlas", "exec", 0, "before")).resolves.toBeUndefined()
    await expect(requireLedger(root)).rejects.toThrow(/AUDIT_UNAVAILABLE/)

    // The ledger arrives afterwards, in the same process.
    await mkdir(path.join(root, "keys"), { recursive: true })
    await writeFile(path.join(root, "nodes.json"), JSON.stringify(REGISTRY), "utf8")

    await expect(requireLedger(root)).resolves.toBeUndefined()
    await auditBrokerAction(root, "atlas", "exec", 0, "after")
    const log = await readFile(path.join(root, "audit.log"), "utf8")
    expect(log).toContain("after")
    // The call made while the ledger was genuinely absent stays absent. Nothing is back-filled: the
    // record says what was written when, and inventing the earlier line would be the same lie the
    // silent skip was telling.
    expect(log).not.toContain("before")
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
