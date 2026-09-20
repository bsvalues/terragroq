import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { validateHelloApplicationInContainer } from "@/lib/hello-application/proposal-validation.mjs"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hello-validator-"))
  roots.push(root)
  const repositoryRoot = path.join(root, "repository")
  const runtimeRoot = path.join(root, "runtime")
  const workspacePath = path.join(runtimeRoot, "worktrees", "validate-1")
  fs.mkdirSync(path.join(repositoryRoot, "config", "execution-fabric"), { recursive: true })
  fs.cpSync(path.join(process.cwd(), "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"), path.join(repositoryRoot, "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"))
  fs.cpSync(path.join(process.cwd(), "examples", "hello-application"), path.join(workspacePath, "examples", "hello-application"), { recursive: true })
  return { repositoryRoot, runtimeRoot, workspacePath }
}

describe("contained Hello proposal validation", () => {
  it("runs only the fixed test in a policy-pinned, no-network, read-only container", async () => {
    const { repositoryRoot, runtimeRoot, workspacePath } = fixture()
    const calls: Array<{ command: string; args: string[]; options: { env?: NodeJS.ProcessEnv } }> = []
    const result = await validateHelloApplicationInContainer({
      repositoryRoot, runtimeRoot, workspacePath,
      commandRunner: async (command, args, options) => {
        calls.push({ command, args, options })
        if (args[0] === "image") return { code: 0, stdout: "sha256:612bd343622ef393269a0cb2b2e3f042927b53d7e5aa2641855df377cbc81613\n", stderr: "" }
        return { code: 0, stdout: "contained success", stderr: "" }
      },
    })

    expect(result).toEqual({ status: "passed", command: "node --test examples/hello-application/test/hello.test.mjs", output: "contained success" })
    const run = calls.find((call) => call.args[0] === "run")!
    expect(run.command).toBe("docker")
    expect(run.options.env?.DOCKER_CONFIG).toBe("D:\\HermesServices\\williamos-hermes-agent\\docker-config")
    expect(run.args).toEqual(expect.arrayContaining([
      "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
      "--cpus", "1", "--memory", "512m", "--pids-limit", "64", "--user", "10000:10000",
      "--entrypoint", "node", "sha256:612bd343622ef393269a0cb2b2e3f042927b53d7e5aa2641855df377cbc81613",
      "--test", "examples/hello-application/test/hello.test.mjs",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    ]))
    expect(run.args).toContain(`type=bind,src=${workspacePath},dst=/workspace,readonly`)
    expect(calls.at(-1)?.args.slice(0, 2)).toEqual(["rm", "-f"])
  })

  it("refuses an invalid workspace before starting Docker and sanitizes runner failures", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    const outside = path.join(runtimeRoot, "outside")
    fs.mkdirSync(outside)
    let calls = 0
    await expect(validateHelloApplicationInContainer({ repositoryRoot, runtimeRoot, workspacePath: outside, commandRunner: async () => { calls += 1; return { code: 0, stdout: "", stderr: "" } } }))
      .rejects.toThrow("HELLO_PROPOSAL_WORKTREE_INVALID")
    expect(calls).toBe(0)

    const second = fixture()
    await expect(validateHelloApplicationInContainer({
      ...second,
      commandRunner: async (_command, args) => {
        if (args[0] === "image") return { code: 0, stdout: "sha256:612bd343622ef393269a0cb2b2e3f042927b53d7e5aa2641855df377cbc81613", stderr: "" }
        if (args[0] === "run") throw new Error("untrusted container output")
        return { code: 0, stdout: "", stderr: "" }
      },
    })).rejects.toThrow("HELLO_PROPOSAL_VALIDATION_FAILED")
  })

  it("rejects a timed-out validator even when it reports success and retains only the output tail", async () => {
    const { repositoryRoot, runtimeRoot, workspacePath } = fixture()
    await expect(validateHelloApplicationInContainer({
      repositoryRoot, runtimeRoot, workspacePath,
      commandRunner: async (_command, args) => {
        if (args[0] === "image") return { code: 0, stdout: "sha256:612bd343622ef393269a0cb2b2e3f042927b53d7e5aa2641855df377cbc81613", stderr: "" }
        if (args[0] === "run") return { code: 0, timedOut: true, stdout: "passed", stderr: "" }
        return { code: 0, stdout: "", stderr: "" }
      },
    })).rejects.toThrow("HELLO_PROPOSAL_VALIDATION_FAILED")
  })
})
