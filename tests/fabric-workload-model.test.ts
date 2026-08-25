import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { BASELINE_STEPS } from "@/lib/fabric/baseline"
import { runNodeBaseline } from "@/lib/fabric/run-baseline.mjs"

/**
 * The gate reaches nodes through the broker now, so a name has to be one the broker will resolve and
 * the ledger has to be one these tests are allowed to not have. Both are supplied per call rather
 * than defaulted, so a node that is deliberately unknown can still be tested elsewhere.
 */
const RUN = (name: string, node: Record<string, unknown>, exec: unknown) => ({
  exec,
  registry: { [name]: node },
  fabricRoot: path.join(tmpdir(), "fabric-workload-model-no-ledger"),
}) as never

/**
 * The gate proves lifecycle control, not that a container runtime is installed.
 *
 * "Start a workload" was written as `docker run`, which made a container runtime a requirement of
 * being managed. The cockpit node is deliberately not a service host, so it failed a gate for
 * lacking software it was never meant to run -- and the failure looked like a management-plane
 * defect rather than a mis-specified test.
 */
function recordingExec() {
  const commands: string[] = []
  const exec = async (_file: string, args: string[]) => {
    // A Windows node receives one ssh argument that itself contains
    // `powershell -NoProfile -EncodedCommand <base64>`, so the payload is decoded out of that string
    // rather than read from a separate argv entry.
    const raw = String(args[args.length - 1] ?? "")
    // A POSIX node's body arrives base64-wrapped by the broker's `encodePosix`; a Windows node's
    // arrives inside `powershell -NoProfile -EncodedCommand <utf16le base64>`. Both are unwrapped
    // here so the assertions below stay about the COMMAND rather than about its packaging.
    const posix = /^echo '([A-Za-z0-9+/=]+)' \| base64 -d \| bash$/.exec(raw)?.[1]
    const body = posix ? Buffer.from(posix, "base64").toString("utf8") : raw
    const match = /-EncodedCommand\s+([A-Za-z0-9+/=]+)/.exec(body)
    commands.push(match ? Buffer.from(match[1], "base64").toString("utf16le") : body)
    return { stdout: "1234", stderr: "" }
  }
  return { commands, exec }
}

const LINUX = { transport: "ssh", host: "h", user: "u", os: "linux" }
const OMEN = { transport: "ssh", host: "h", user: "u", os: "windows", workloads: "processes" } as const

describe("workload model decides how lifecycle is proven", () => {
  it("uses containers for a node that does not declare otherwise", async () => {
    const { commands, exec } = recordingExec()
    await runNodeBaseline("atlas", LINUX, RUN("atlas", LINUX, exec))
    expect(commands.some((c) => c.includes("docker run"))).toBe(true)
  })

  it("uses processes for a node that declares them, and never invokes docker", async () => {
    const { commands, exec } = recordingExec()
    await runNodeBaseline("omen", OMEN, RUN("omen", OMEN, exec))
    expect(commands.some((c) => c.includes("Start-Process"))).toBe(true)
    // The point of the change: a cockpit is never asked for a container runtime.
    expect(commands.some((c) => c.includes("docker"))).toBe(false)
  })

  it("stops exactly what it started, by pid", async () => {
    const { commands, exec } = recordingExec()
    await runNodeBaseline("omen", OMEN, RUN("omen", OMEN, exec))
    const stop = commands.find((c) => c.includes("Stop-Process"))
    expect(stop).toBeDefined()
    // Finding the process by name could kill something the gate never started.
    expect(stop).toContain("Get-Content")
  })

  it("verifies the workload actually ended rather than assuming the kill worked", async () => {
    const { commands, exec } = recordingExec()
    await runNodeBaseline("omen", OMEN, RUN("omen", OMEN, exec))
    const stop = commands.find((c) => c.includes("Stop-Process")) ?? ""
    expect(stop).toContain("still running")
  })

  it("keeps the same six steps for every node, whatever the workload model", () => {
    // A gate that changes shape by node cannot be compared across the fleet.
    expect(BASELINE_STEPS.map((s) => s.id)).toEqual(["reach", "containers", "start", "push", "pull", "stop"])
  })
})
