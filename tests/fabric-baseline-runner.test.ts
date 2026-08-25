import crypto from "node:crypto"
import { mkdir, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { BASELINE_STEPS, PROBE_CONTAINER as PROBE_CONTAINER_TS } from "../lib/fabric/baseline"
import {
  BASELINE_STEP_IDS,
  PROBE_CONTAINER,
  buildWindowsSshCommand,
  quoteForCmd,
  nodePassed,
  parseRegistry,
  runNodeBaseline,
  summarise,
} from "../lib/fabric/run-baseline.mjs"

const NODE = { transport: "ssh", host: "10.0.0.1", user: "svc" }

/**
 * A fabric root that deliberately does not exist, so neither the gate's own audit nor the broker's
 * can reach the real ledger from a unit test. Previously the default root was used, which on a
 * developer machine that HAS a fabric directory meant the suite appended to the lab's live audit log.
 */
const NO_LEDGER = path.join(tmpdir(), "fabric-baseline-runner-no-ledger")

/**
 * Undo the broker's POSIX transport.
 *
 * The gate now reaches every node through `brokeredExec`, which carries a POSIX body as base64 --
 * `echo '<b64>' | base64 -d | bash` -- because literal bodies were being torn apart by cmd quoting
 * before ssh ever saw them. The fake node therefore receives the encoded form, and decoding it here
 * is what keeps this double faithful to the real transport instead of pretending the wrapper is not
 * there. A command that is not wrapped is returned unchanged.
 */
function decodePosix(command: string): string {
  const encoded = /^echo '([A-Za-z0-9+/=]+)' \| base64 -d \| bash$/.exec(command)?.[1]
  return encoded ? Buffer.from(encoded, "base64").toString("utf8") : command
}

/** Every node in these tests is reachable by the name the test uses; policy is proved elsewhere. */
const registryOf = (name: string, node: Record<string, unknown>) => ({ [name]: node })

/**
 * The options every unit test needs: a real registry entry, and a ledger that is not the lab's.
 *
 * `requireAudit: false` is stated rather than inherited. These tests exercise step logic against a
 * fake node and have no ledger; the guarantee that a MUTATING step refuses without one is a separate
 * claim, proved in its own test below against a real temporary ledger. Opting out here in silence is
 * how the guarantee would come back undone.
 */
const runOpts = (name: string, node: Record<string, unknown>, exec: unknown) =>
  ({ exec, registry: registryOf(name, node), fabricRoot: NO_LEDGER, requireAudit: false }) as never

/**
 * Alter a hex string so it is guaranteed to differ from the original.
 *
 * The fakes need a value that is definitely NOT the real digest. Doing that by overwriting the first
 * character with a constant is the obvious approach and it is quietly wrong: whenever the digest
 * already began with that character the "corrupted" value equalled the original, the runner
 * correctly reported success, and the test failed roughly one run in sixteen. That is #833 -- a
 * suite that returned both answers for the same commit, which makes it useless as a merge gate.
 *
 * Choosing the replacement relative to the original character removes the coincidence entirely.
 */
function corruptHex(hex: string): string {
  return hex.replace(/^./, (c) => (c === "0" ? "1" : "0"))
}

/**
 * An honest Linux node: it really writes the payload it was given and really hashes it, so a bug in
 * the runner's own hashing shows up as a failure rather than being masked by a canned digest.
 */
function honestNode(overrides: { corruptPull?: boolean; wrongPushHash?: boolean; failAt?: string } = {}) {
  const files = new Map<string, string>()
  const calls: string[] = []
  return {
    calls,
    exec: async (_file: string, args: string[]) => {
      const command = decodePosix(args[args.length - 1])
      calls.push(command)
      if (overrides.failAt && command.includes(overrides.failAt)) {
        throw Object.assign(new Error("boom"), { stderr: `ssh: ${overrides.failAt} refused` })
      }
      if (command === "hostname") return { stdout: "node-1\n" }
      if (command.includes("docker ps -q | wc -l")) return { stdout: "3\n" }
      if (command.includes("docker run -d")) return { stdout: "deadbeefcafe\n" }
      if (command.startsWith("printf %s ")) {
        const payload = /printf %s '([0-9a-f]+)'/.exec(command)?.[1] ?? ""
        const target = /> (\S+)/.exec(command)?.[1] ?? ""
        files.set(target, payload)
        const digest = crypto.createHash("sha256").update(payload).digest("hex")
        const wrong = corruptHex(digest)
        return { stdout: `${overrides.wrongPushHash ? wrong : digest}\n` }
      }
      if (command.startsWith("cat ")) {
        const stored = files.get(command.slice(4).trim()) ?? ""
        // The flipped character must differ from the original one. Appending a fixed "f" left the
        // payload untouched whenever it already ended in "f" -- a 1-in-16 flake in the double, which
        // would have read as an intermittent bug in the runner.
        const corrupted = `${stored.slice(0, -1)}${stored.at(-1) === "f" ? "0" : "f"}`
        return { stdout: `${overrides.corruptPull ? corrupted : stored}\n` }
      }
      if (command.includes("rm -f")) return { stdout: "cleaned\n" }
      throw new Error(`unexpected command: ${command}`)
    },
  }
}

describe("baseline gate constants stay pinned to the UI definition", () => {
  // The executor is .mjs so a CLI can run it without a build step, which means it cannot import the
  // .ts step definitions. These assertions are the seam: if either copy moves, "4/4" quietly starts
  // meaning something else and the gate stops being comparable across runs.
  it("uses the same probe container name as the typed module", () => {
    expect(PROBE_CONTAINER).toBe(PROBE_CONTAINER_TS)
  })

  it("runs exactly the steps the typed module declares, in order", () => {
    expect(BASELINE_STEP_IDS).toEqual(BASELINE_STEPS.map((step) => step.id))
  })
})

describe("windows ssh wrapper", () => {
  // Windows OpenSSH hangs in teardown when its stdio are parent-supplied pipes/files, so ssh is run
  // through cmd.exe with the shell owning the redirection. These cases guard the command string: a
  // quoting slip here would silently redirect to the wrong path or split an argument, and the gate
  // would report an unreachable node rather than a broken probe.
  it("leaves simple arguments unquoted", () => {
    expect(buildWindowsSshCommand(["-o", "BatchMode=yes", "bsval@10.0.0.1", "hostname"], "o.txt", "e.txt"))
      .toBe("ssh -o BatchMode=yes bsval@10.0.0.1 hostname > o.txt 2> e.txt")
  })

  it("quotes paths containing spaces, which every Windows profile path can have", () => {
    const command = buildWindowsSshCommand(["-i", "C:\\Users\\a b\\key"], "C:\\temp\\o u.txt", "e.txt")
    expect(command).toContain('"C:\\Users\\a b\\key"')
    expect(command).toContain('> "C:\\temp\\o u.txt"')
  })

  it("quotes arguments carrying shell metacharacters rather than letting cmd interpret them", () => {
    for (const arg of ["a&b", "a|b", "a>b", "a<b", "a^b", "a(b)"]) {
      expect(quoteForCmd(arg)).toBe(`"${arg}"`)
    }
  })

  it("escapes embedded quotes", () => {
    expect(quoteForCmd('say "hi"')).toBe('"say \\"hi\\""')
  })

  it("keeps the remote command as a single argument", () => {
    const remote = "docker rm -f probe >/dev/null 2>&1; docker run -d --name probe alpine sleep 60"
    const command = buildWindowsSshCommand(["host", remote], "o.txt", "e.txt")
    expect(command).toContain(`"${remote}"`)
  })
})

describe("registry parsing", () => {
  // Windows PowerShell 5.1's `Set-Content -Encoding UTF8` writes a BOM. The registry edit that fixed
  // OMEN's username did exactly that, and JSON.parse rejects it -- so the whole gate reported
  // REGISTRY_UNAVAILABLE, including the owner-facing button. The reader must survive its writers.
  it("reads a registry written with a UTF-8 BOM", () => {
    const bom = String.fromCharCode(0xfeff)
    expect(parseRegistry(`${bom}{"omen":{"host":"10.0.0.1"}}`)).toEqual({ omen: { host: "10.0.0.1" } })
  })

  it("still reads a registry written without one", () => {
    expect(parseRegistry('{"omen":{"host":"10.0.0.1"}}')).toEqual({ omen: { host: "10.0.0.1" } })
  })

  it("does not swallow genuinely malformed JSON", () => {
    expect(() => parseRegistry('{"omen":')).toThrow()
  })
})

describe("runNodeBaseline", () => {
  it("passes every step against an honest node", async () => {
    const node = honestNode()
    const results = await runNodeBaseline("n1", NODE, runOpts("n1", NODE, node.exec))
    expect(results.map((r) => r.step)).toEqual(BASELINE_STEP_IDS)
    expect(nodePassed(results)).toBe(true)
  })

  it("stops after reach fails, because every later step would be noise", async () => {
    const node = honestNode({ failAt: "hostname" })
    const results = await runNodeBaseline("n1", NODE, runOpts("n1", NODE, node.exec))
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ step: "reach", ok: false })
    expect(results[0].detail).toContain("refused")
  })

  it("keeps probing after a middle step fails, so one outage does not hide another", async () => {
    const node = honestNode({ failAt: "docker run -d" })
    const results = await runNodeBaseline("n1", NODE, runOpts("n1", NODE, node.exec))
    expect(results.find((r) => r.step === "start")?.ok).toBe(false)
    expect(results.find((r) => r.step === "push")?.ok).toBe(true)
    expect(nodePassed(results)).toBe(false)
  })

  it("fails push when the node's hash disagrees, not merely when the write errors", async () => {
    const node = honestNode({ wrongPushHash: true })
    const results = await runNodeBaseline("n1", NODE, runOpts("n1", NODE, node.exec))
    const push = results.find((r) => r.step === "push")
    expect(push?.ok).toBe(false)
    expect(push?.detail).toContain("hash mismatch")
  })

  it("fails pull when the round trip alters a byte", async () => {
    const node = honestNode({ corruptPull: true })
    const results = await runNodeBaseline("n1", NODE, runOpts("n1", NODE, node.exec))
    const pull = results.find((r) => r.step === "pull")
    expect(pull?.ok).toBe(false)
    expect(pull?.detail).toContain("round trip altered the file")
  })

  it("sends a fresh payload each run, so a stale file cannot pass the transfer steps", async () => {
    const first = honestNode()
    const second = honestNode()
    await runNodeBaseline("n1", NODE, runOpts("n1", NODE, first.exec))
    await runNodeBaseline("n1", NODE, runOpts("n1", NODE, second.exec))
    const payloadOf = (calls: string[]) => /printf %s '([0-9a-f]+)'/.exec(calls.find((c) => c.startsWith("printf")) ?? "")?.[1]
    expect(payloadOf(first.calls)).not.toBe(payloadOf(second.calls))
  })
})

describe("command dialect follows the node's OS, not its transport", () => {
  // OMEN is a Windows node reached over ssh. The gate assumed ssh meant Linux and sent it
  // `docker ps -q | wc -l`, so a healthy cockpit was reported as failing at "containers".
  const winNode = { transport: "ssh", host: "10.0.0.2", user: "svc", os: "windows" }
  const LINUX_NODE = { ...winNode, os: "linux" }

  const decode = (command: string) => {
    const encoded = /-EncodedCommand (\S+)/.exec(command)?.[1] ?? ""
    return Buffer.from(encoded, "base64").toString("utf16le")
  }

  it("sends PowerShell to a windows node over ssh, base64-encoded so no shell can mangle it", async () => {
    const calls: string[] = []
    const exec = async (_file: string, args: string[]) => {
      calls.push(args[args.length - 1])
      return { stdout: "OMEN\n" }
    }
    await runNodeBaseline("omen", winNode, runOpts("omen", winNode, exec))
    expect(calls[0]).toContain("powershell -NoProfile -EncodedCommand")
    expect(decode(calls[0])).toBe("$env:COMPUTERNAME")
    expect(decode(calls[1])).toContain("Measure-Object")
    expect(calls.join(" ")).not.toContain("wc -l")
  })

  it("still sends POSIX to a linux node over ssh, now carried by the broker's base64 transport", async () => {
    const calls: string[] = []
    const exec = async (_file: string, args: string[]) => {
      calls.push(args[args.length - 1])
      return { stdout: "node-1\n" }
    }
    await runNodeBaseline("atlas", LINUX_NODE, runOpts("atlas", LINUX_NODE, exec))

    // Both halves matter and they are different claims. The dialect is still POSIX -- that is the
    // OMEN regression this suite exists to prevent. And the body now travels base64-wrapped, because
    // the gate reaches the node through `brokeredExec` rather than building its own ssh arguments.
    // Asserting only the decoded form would let the transport revert to the raw path unnoticed.
    expect(calls[0]).toMatch(/^echo '[A-Za-z0-9+/=]+' \| base64 -d \| bash$/)
    expect(decodePosix(calls[0])).toBe("hostname")
    expect(decodePosix(calls[1])).toContain("wc -l")
  })
})

describe("a mutating step will not run without a ledger it can actually write", () => {
  // The review that found this was right, and the commit that introduced the brokered transport had
  // claimed the opposite: routing through the broker was only HALF the fix. `requireAudit` defaults
  // to false in `brokeredExec`, so a start / transfer / force-stop cycle still ran against a fabric
  // root with no ledger and left nothing behind.
  const REAL_EXEC = async () => ({ stdout: "ok", stderr: "" })

  it("refuses start, push and stop when the ledger is absent, and reaches the node for neither", async () => {
    const calls: string[] = []
    const exec = async (_f: string, args: string[]) => { calls.push(String(args.at(-1))); return { stdout: "ok" } }

    const results = await runNodeBaseline("atlas", NODE, {
      exec,
      registry: registryOf("atlas", NODE),
      fabricRoot: path.join(tmpdir(), "fabric-runner-definitely-absent"),
      audit: async () => {},
    } as never)

    // The reads still run -- they change nothing, so an absent ledger is not a reason to refuse them.
    const byStep = new Map(results.map((r) => [r.step, r]))
    expect(byStep.get("reach")?.ok).toBe(true)
    expect(byStep.get("containers")?.ok).toBe(true)

    // The three that change the node do not.
    for (const step of ["start", "push", "stop"] as const) {
      expect(byStep.get(step)?.ok, step).toBe(false)
      expect(byStep.get(step)?.detail, step).toContain("AUDIT_UNAVAILABLE")
    }
    expect(calls.some((c) => c.includes("docker run"))).toBe(false)
  })

  it("refuses when the ledger exists but cannot be appended to", async () => {
    // Presence is not writability. A root that exists while `audit.log` is a DIRECTORY passed the
    // first version of the preflight, the mutation ran, and only the append afterwards complained --
    // a loud unrecorded mutation, not a governed one.
    //
    // The gate stops at the very first step here rather than at the first mutating one, and that is
    // the older `auditFabricAction` guarantee doing its job: a ledger that cannot be written must not
    // quietly become a ledger that is not written, so even a read refuses. What this test pins is the
    // consequence that matters -- nothing on the node is touched after the refusal.
    const root = await mkdtemp(path.join(tmpdir(), "fabric-unwritable-"))
    await mkdir(path.join(root, "audit.log"))
    const calls: string[] = []
    const exec = async (_f: string, args: string[]) => { calls.push(String(args.at(-1))); return { stdout: "ok" } }

    const results = await runNodeBaseline("atlas", NODE, {
      exec,
      registry: registryOf("atlas", NODE),
      fabricRoot: root,
      audit: async () => {},
    } as never)

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ step: "reach", ok: false })
    expect(results[0].detail).toContain("AUDIT_UNAVAILABLE")
    expect(calls.some((c) => c.includes("docker run"))).toBe(false)
    expect(calls.some((c) => c.includes("printf %s"))).toBe(false)
  })

  it("runs the mutating steps once the ledger is real, and records them", async () => {
    // The refusals above must be about the ledger, not about mutating steps being refused generally.
    const root = await mkdtemp(path.join(tmpdir(), "fabric-writable-"))
    const node = honestNode()

    const results = await runNodeBaseline("atlas", NODE, {
      exec: node.exec,
      registry: registryOf("atlas", NODE),
      fabricRoot: root,
    } as never)

    expect(results.find((r: { step: string }) => r.step === "start")?.ok).toBe(true)
    const log = await readFile(path.join(root, "audit.log"), "utf8")
    expect(log).toContain("baseline.start")
    expect(log).toContain("atlas")
  })
})

describe("summarise", () => {
  it("counts a node as passing only when all six steps passed", async () => {
    const good = await runNodeBaseline("good", NODE, runOpts("good", NODE, honestNode().exec))
    const bad = await runNodeBaseline("bad", NODE, runOpts("bad", NODE, honestNode({ failAt: "docker run -d" }).exec))
    const summary = summarise({ ranAt: "now", results: [...good, ...bad] })
    expect(summary).toMatchObject({ passedCount: 1, total: 2 })
    expect(summary.nodes.find((n) => n.node === "bad")?.firstFailure).toMatchObject({ step: "start" })
  })

  it("reports the earliest failing step, not the last one recorded", async () => {
    const results = await runNodeBaseline("n1", NODE, runOpts("n1", NODE, honestNode({ failAt: "docker" }).exec))
    const summary = summarise({ ranAt: "now", results })
    expect(summary.nodes[0].firstFailure).toMatchObject({ step: "containers" })
  })
})

describe("corruptHex", () => {
  it("changes the value for every possible leading character", () => {
    for (const c of "0123456789abcdef") {
      const original = `${c}${"a".repeat(63)}`
      expect(corruptHex(original)).not.toBe(original)
      expect(corruptHex(original)).toHaveLength(original.length)
    }
  })
})
