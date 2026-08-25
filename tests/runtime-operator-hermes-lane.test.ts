import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { afterEach, describe, expect, it } from "vitest"

import {
  buildHermesPacket,
  collectPatch,
  dispatchHermesLocal,
  hermesRunId,
  prepareHermesLocalBase,
} from "../scripts/runtime-operator/williamos-adapters.mjs"

/**
 * WO-0030: the resident local lane, wired into the runtime-operator contract.
 *
 * The provider is not rebuilt or re-asserted here. What is tested is the four seams the kernel owns:
 * the packet its invoker validates, the reconciliation of two self-owning workspaces, the work-context
 * receipt every lane is equipped with, and where the patch is collected from.
 */

// The invoker's owned-worktree field wall, verbatim: it sorts the packet's own field names and
// refuses any difference at all, so this list is the contract rather than a description of it.
const INVOKER_PACKET_FIELDS = [
  "kernelSessionId", "maximumTurns", "model", "prompt", "runId", "schemaVersion",
  "statePath", "toolsets", "workOrderId", "workspaceMode", "workspacePath",
]
const INVOKER_RUN_ID = /^[A-Za-z0-9-]{8,64}$/
const BASE_SHA = "1f2e3d4c5b6a798877665544332211aabbccddee"
const BASELINE_SHA = "45f90fa59fe47e5f1aa505e9ec710ec2deb37a48"
const BUNDLE_HEAD_SHA = "9a8b7c6d5e4f32100123456789abcdef01234567"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

const policyFor = (worktreesRoot: string) => ({
  schemaVersion: 2,
  packetSchemaVersion: 3,
  workOrderId: "WO-HERMES-FREE-DEV-AGENT-001",
  placement: {
    workspaceMode: "OWNED_WORKTREE",
    allowedWorkspaceRoots: [worktreesRoot],
    baselineWorkspace: path.join(path.dirname(worktreesRoot), "baseline"),
    baselineCommit: BASELINE_SHA,
    baselineBundle: path.join(path.dirname(worktreesRoot), "williamos-baseline.bundle"),
    baselineBundleRef: "refs/remotes/origin/main",
  },
  model: { id: "williamos-qwen3-4b:64k" },
  execution: {
    maximumTurns: 20,
    allowedToolsets: ["file", "terminal"],
    timeoutSeconds: 1800,
    promptMaxChars: 60000,
  },
})

type Call = { command: string; args: string[]; cwd?: string }

const gitArgs = (args: string[]) => args[0] === "--no-replace-objects" ? args.slice(1) : args

function fixture(overrides: { policy?: (worktreesRoot: string) => Record<string, unknown> } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wo-0030-hermes-")); roots.push(base)
  const repositoryPath = path.join(base, "repo")
  const root = path.join(base, "kernel")
  const runtimeRoot = path.join(base, "hermes-bridge")
  const worktreesRoot = path.join(runtimeRoot, "worktrees")
  const workspace = path.join(root, "workspace", "wo-0030-1f2e3d4c5b6a")
  fs.mkdirSync(path.join(repositoryPath, "config", "execution-fabric"), { recursive: true })
  fs.mkdirSync(path.join(repositoryPath, "scripts", "execution-fabric", "hermes-agent"), { recursive: true })
  fs.mkdirSync(path.join(root, "state", "requests"), { recursive: true })
  fs.mkdirSync(workspace, { recursive: true })
  const baselineWorkspace = path.join(runtimeRoot, "baseline")
  const baselineBundle = path.join(runtimeRoot, "williamos-baseline.bundle")
  fs.mkdirSync(baselineWorkspace, { recursive: true })
  fs.writeFileSync(baselineBundle, "test bundle fixture\n")
  const invokerPath = path.join(repositoryPath, "scripts", "execution-fabric", "hermes-agent", "invoke-hermes-free-dev-agent.ps1")
  fs.writeFileSync(invokerPath, "# reviewed invoker; never executed by this test\n")
  const policyPath = path.join(repositoryPath, "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json")
  fs.writeFileSync(policyPath, `${JSON.stringify({ ...policyFor(worktreesRoot), ...(overrides.policy?.(worktreesRoot) ?? {}) }, null, 2)}\n`)
  const owned = path.join(worktreesRoot, "runtime-operator-wo-0030")
  return { base, repositoryPath, root, runtimeRoot, worktreesRoot, workspace, owned, invokerPath, policyPath, baselineWorkspace, baselineBundle }
}

/** A recording stand-in for the process runner: no git, no pwsh, no container. */
function recorder(calls: Call[], answers: { staged?: string; registered?: string[]; completionRunId?: string; session?: string } = {}) {
  return async (command: string, args: string[], options: { cwd?: string } = {}) => {
    calls.push({ command, args, cwd: options.cwd })
    const actual = command === "git" ? gitArgs(args) : args
    if (command === "git" && actual[0] === "rev-parse" && actual[1] === "HEAD") {
      return { stdout: `${options.cwd?.endsWith("baseline") ? BASELINE_SHA : BASE_SHA}\n`, stderr: "" }
    }
    if (command === "git" && actual[0] === "rev-parse" && actual[1]?.startsWith("refs/williamos/base-cache/")) {
      return { stdout: `${BASE_SHA}\n`, stderr: "" }
    }
    if (command === "git" && actual[0] === "rev-parse" && actual[1] === "refs/williamos/bundle-head") {
      return { stdout: `${BUNDLE_HEAD_SHA}\n`, stderr: "" }
    }
    if (command === "git" && actual[0] === "status") return { stdout: "", stderr: "" }
    if (command === "git" && actual[0] === "bundle" && actual[1] === "list-heads") {
      return { stdout: `${BUNDLE_HEAD_SHA} refs/remotes/origin/main\n`, stderr: "" }
    }
    if (command === "git" && actual[0] === "diff") return { stdout: answers.staged ?? "", stderr: "" }
    if (command === "git" && actual[0] === "worktree" && actual[1] === "list") {
      return { stdout: (answers.registered ?? []).map((tree) => `worktree ${tree}\nHEAD ${BASE_SHA}\ndetached\n`).join("\n"), stderr: "" }
    }
    if (command === "pwsh") {
      const runId = answers.completionRunId ?? args[args.indexOf("-RunId") + 1]
      return { stdout: `Session:  ${answers.session ?? "sess-aa11bb22"}\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=x\n`, stderr: "" }
    }
    return { stdout: "", stderr: "" }
  }
}

function identities(...values: string[]) {
  const queue = [...values]
  return () => queue.shift() ?? "exhausted-identity"
}

// Deliberately a short, obviously fake stub: the patch wall refuses credential-shaped text and
// cannot tell a fixture from the real thing.
const WORK_CONTEXT = { token: "stub", facts: { workOrderRef: "WO-0030" } }

describe("the packet is the one the invoker validates", () => {
  it("carries exactly the invoker's owned-worktree field set, valued from the reviewed policy", () => {
    const packet = buildHermesPacket({
      policy: policyFor("C:\\worktrees"),
      prompt: "do the bounded work",
      runId: "wo-0030-aaaaaaaa-1111",
      workspacePath: "C:\\worktrees\\runtime-operator-wo-0030",
      statePath: "C:\\hermes-kernel\\threads\\t1\\kernel-state",
    })
    expect(Object.keys(packet).sort()).toEqual([...INVOKER_PACKET_FIELDS].sort())
    expect(packet).toMatchObject({
      schemaVersion: 3,
      workOrderId: "WO-HERMES-FREE-DEV-AGENT-001",
      model: "williamos-qwen3-4b:64k",
      maximumTurns: 20,
      toolsets: ["file", "terminal"],
      workspaceMode: "OWNED_WORKTREE",
      // A fresh thread resumes nothing, and the invoker reads null as "start a session".
      kernelSessionId: null,
    })
  })

  it("copies the policy's toolsets rather than aliasing them", () => {
    const policy = policyFor("C:\\worktrees")
    const packet = buildHermesPacket({ policy, prompt: "p", runId: "r", workspacePath: "w", statePath: "s" })
    expect(packet.toolsets).not.toBe(policy.execution.allowedToolsets)
  })

  it("refuses a policy that declares no packet schema instead of shipping an undefined one", () => {
    const policy = { ...policyFor("C:\\worktrees"), packetSchemaVersion: undefined }
    expect(() => buildHermesPacket({ policy, prompt: "p", runId: "r", workspacePath: "w", statePath: "s" }))
      .toThrow("PROVIDER_LANE_POLICY_WALL")
  })

  it("mints a run id inside the alphabet the invoker names its container from", () => {
    const runId = hermesRunId("WO-0030/remediation", "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa")
    expect(runId).toMatch(INVOKER_RUN_ID)
    expect(hermesRunId("", "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa")).toMatch(INVOKER_RUN_ID)
  })
})

describe("two workspaces that each own themselves", () => {
  it("ignores replacement refs when deciding whether a requested SHA belongs to the governed lineage", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "wo-0030-real-git-")); roots.push(base)
    const source = path.join(base, "source")
    const baselineWorkspace = path.join(base, "baseline")
    const baselineBundle = path.join(base, "williamos-baseline.bundle")
    fs.mkdirSync(source)
    const realGit = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
    realGit(source, ["init", "--quiet"])
    realGit(source, ["config", "user.email", "test@williamos.local"])
    realGit(source, ["config", "user.name", "WilliamOS test"])
    fs.writeFileSync(path.join(source, "baseline.txt"), "baseline\n")
    realGit(source, ["add", "baseline.txt"])
    realGit(source, ["commit", "--quiet", "-m", "baseline"])
    const baselineCommit = realGit(source, ["rev-parse", "HEAD"])
    fs.writeFileSync(path.join(source, "head.txt"), "bundle head\n")
    realGit(source, ["add", "head.txt"])
    realGit(source, ["commit", "--quiet", "-m", "head"])
    const bundleHead = realGit(source, ["rev-parse", "HEAD"])
    realGit(source, ["update-ref", "refs/remotes/origin/main", bundleHead])
    realGit(source, ["bundle", "create", baselineBundle, "refs/remotes/origin/main"])
    execFileSync("git", ["clone", "--quiet", source, baselineWorkspace], { encoding: "utf8" })
    realGit(baselineWorkspace, ["config", "user.email", "test@williamos.local"])
    realGit(baselineWorkspace, ["config", "user.name", "WilliamOS test"])
    realGit(baselineWorkspace, ["checkout", "--quiet", "--detach", baselineCommit])

    // This commit object is present locally but is unrelated to the governed history. A replacement
    // makes ordinary Git pretend it is the bundle head while leaving HEAD and status perfectly clean.
    const tree = realGit(baselineWorkspace, ["rev-parse", `${baselineCommit}^{tree}`])
    const unrelated = realGit(baselineWorkspace, ["commit-tree", tree, "-m", "unrelated requested base"])
    realGit(baselineWorkspace, ["replace", unrelated, bundleHead])

    const policy = {
      ...policyFor(path.join(base, "worktrees")),
      placement: {
        ...policyFor(path.join(base, "worktrees")).placement,
        baselineWorkspace,
        baselineBundle,
        baselineCommit,
      },
    }
    const runner = async (command: string, args: string[], options: { cwd?: string } = {}) => ({
      stdout: execFileSync(command, args, { cwd: options.cwd, encoding: "utf8" }),
      stderr: "",
    })
    await expect(prepareHermesLocalBase({ policy, requestedBaseSha: unrelated, runner }))
      .rejects.toThrow("PROVIDER_LANE_BASE_SHA_UNAVAILABLE_WALL")
  })

  it("imports the exact requested SHA through the governed bundle without moving the pinned baseline", async () => {
    const { baselineWorkspace, baselineBundle } = fixture()
    const calls: Call[] = []
    const prepared = await prepareHermesLocalBase({
      policy: policyFor(path.join(path.dirname(baselineWorkspace), "worktrees")),
      requestedBaseSha: BASE_SHA,
      runner: recorder(calls),
    })

    expect(prepared).toEqual({ repositoryPath: baselineWorkspace, baseSha: BASE_SHA })
    expect(calls).toContainEqual({
      command: "git",
      args: ["--no-replace-objects", "bundle", "verify", baselineBundle],
      cwd: baselineWorkspace,
    })
    expect(calls).toContainEqual({
      command: "git",
      args: ["--no-replace-objects", "fetch", "--no-tags", baselineBundle, "refs/remotes/origin/main:refs/williamos/bundle-head"],
      cwd: baselineWorkspace,
    })
    expect(calls).toContainEqual({
      command: "git",
      args: ["--no-replace-objects", "merge-base", "--is-ancestor", BASE_SHA, BUNDLE_HEAD_SHA],
      cwd: baselineWorkspace,
    })
    expect(calls).toContainEqual({
      command: "git",
      args: ["--no-replace-objects", "update-ref", `refs/williamos/base-cache/${BASE_SHA}`, BASE_SHA],
      cwd: baselineWorkspace,
    })
    expect(calls.filter((call) => call.command === "git" && gitArgs(call.args)[0] === "rev-parse" && gitArgs(call.args)[1] === "HEAD"))
      .toHaveLength(2)
    expect(calls.filter((call) => call.command === "git").every((call) => call.args[0] === "--no-replace-objects"))
      .toBe(true)
  })

  it("refuses a requested SHA the governed bundle does not contain", async () => {
    const { baselineWorkspace } = fixture()
    const calls: Call[] = []
    const baseRunner = recorder(calls)
    const runner = async (command: string, args: string[], options: { cwd?: string } = {}) => {
      const actual = gitArgs(args)
      if (command === "git" && actual[0] === "cat-file" && actual[2] === `${BASE_SHA}^{commit}`) {
        throw new Error("unknown commit")
      }
      return baseRunner(command, args, options)
    }
    await expect(prepareHermesLocalBase({
      policy: policyFor(path.join(path.dirname(baselineWorkspace), "worktrees")),
      requestedBaseSha: BASE_SHA,
      runner,
    })).rejects.toThrow("PROVIDER_LANE_BASE_SHA_UNAVAILABLE_WALL")
    expect(calls.some((call) => gitArgs(call.args)[0] === "fetch")).toBe(true)
  })

  it("runs the lane in a provider-side worktree at the kernel workspace's own HEAD", async () => {
    const { root, repositoryPath, workspace, owned, worktreesRoot, baselineWorkspace } = fixture()
    const calls: Call[] = []
    const dispatched = await dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "bounded work",
      workContext: WORK_CONTEXT,
      runner: recorder(calls),
      newId: identities("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"),
    })

    // The tree the lane edits is the provider's, under the root its policy allows -- never the
    // kernel's workspace, which the provider would refuse to mount.
    expect(dispatched).toBe(owned)
    expect(dispatched.startsWith(worktreesRoot)).toBe(true)
    expect(dispatched).not.toBe(workspace)
    // ...and it is parked at the commit the kernel workspace is on, or the patch would be foreign.
    expect(calls).toContainEqual({
      command: "git",
      args: ["--no-replace-objects", "worktree", "add", "--detach", owned, BASE_SHA],
      cwd: baselineWorkspace,
    })
  })

  it("stops before invocation when a required task target is absent at the requested base", async () => {
    const { root, repositoryPath, workspace } = fixture()
    const calls: Call[] = []
    const baseRunner = recorder(calls)
    const runner = async (command: string, args: string[], options: { cwd?: string } = {}) => {
      const actual = gitArgs(args)
      if (command === "git" && actual[0] === "cat-file" && actual[2]?.endsWith(":scripts/runtime-operator/worker-lanes.mjs")) {
        throw new Error("missing")
      }
      return baseRunner(command, args, options)
    }
    await expect(dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "bounded work",
      requiredBasePaths: ["scripts/runtime-operator/worker-lanes.mjs"],
      runner,
      newId: identities("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"),
    })).rejects.toThrow("TASK_BASELINE_DRIFT_WALL:scripts/runtime-operator/worker-lanes.mjs")
    expect(calls.some((call) => call.command === "pwsh")).toBe(false)
    expect(calls.some((call) => ["worktree", "reset", "clean"].includes(gitArgs(call.args)[0]))).toBe(false)
  })

  it("carries what the kernel workspace already had staged into the provider's tree", async () => {
    const { root, repositoryPath, workspace, owned } = fixture()
    const calls: Call[] = []
    await dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "remediate",
      workContext: WORK_CONTEXT,
      runner: recorder(calls, { staged: "diff --git a/x b/x\n" }),
      newId: identities("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"),
    })
    // A remediation round that started from pristine base would silently revert the round before it.
    const applied = calls.find((call) => call.command === "git" && gitArgs(call.args)[0] === "apply")
    expect(applied?.cwd).toBe(owned)
    // The carried patch is scratch, not evidence: it does not outlive the dispatch.
    expect(fs.existsSync(path.join(root, "state", "requests", "wo-0030-hermes-carried.patch"))).toBe(false)
  })

  it("does not carry a patch when the kernel workspace has nothing staged", async () => {
    const { root, repositoryPath, workspace } = fixture()
    const calls: Call[] = []
    await dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "first round",
      workContext: WORK_CONTEXT,
      runner: recorder(calls),
      newId: identities("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"),
    })
    expect(calls.some((call) => call.command === "git" && call.args[0] === "apply")).toBe(false)
  })

  it("hands the invoker a packet and parameters that agree with each other", async () => {
    const { root, repositoryPath, workspace, owned, runtimeRoot, policyPath, invokerPath } = fixture()
    const calls: Call[] = []
    await dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "bounded work",
      workContext: WORK_CONTEXT,
      runner: recorder(calls),
      newId: identities("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"),
    })
    const packetPath = path.join(root, "state", "requests", "wo-0030-hermes-packet.json")
    const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"))
    const statePath = path.join(runtimeRoot, "hermes-kernel", "threads", "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "kernel-state")

    expect(Object.keys(packet).sort()).toEqual([...INVOKER_PACKET_FIELDS].sort())
    expect(packet.workspacePath).toBe(owned)
    expect(packet.statePath).toBe(statePath)
    expect(packet.prompt).toBe("bounded work")
    expect(packet.runId).toMatch(INVOKER_RUN_ID)

    // Every one of these is compared against the packet by the invoker; a mismatch is a wall.
    const invocation = calls.find((call) => call.command === "pwsh")
    expect(invocation?.args).toEqual([
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", invokerPath,
      "-PacketPath", packetPath, "-PolicyPath", policyPath, "-WorkspacePath", owned, "-RunId", packet.runId,
      "-QuarantinePath", path.join(runtimeRoot, "hermes-kernel", "HERMES_FREE_AGENT_QUARANTINED"),
      "-StatePath", statePath,
    ])
    // The state directory exists before the container is asked to mount it as its HERMES_HOME.
    expect(fs.existsSync(statePath)).toBe(true)
  })

  it("equips the lane with the #831 work-context receipt, in the tree it will actually edit", async () => {
    const { root, repositoryPath, workspace, owned } = fixture()
    await dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "bounded work",
      workContext: WORK_CONTEXT,
      runner: recorder([]),
      newId: identities("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"),
    })
    // Gitignored, so it is equipment and never patch content.
    expect(JSON.parse(fs.readFileSync(path.join(owned, ".williamos", "work-context.json"), "utf8"))).toEqual(WORK_CONTEXT)
    expect(fs.existsSync(path.join(workspace, ".williamos", "work-context.json"))).toBe(false)
  })

  it("resumes the same session on the next round, in the same worktree", async () => {
    const { root, repositoryPath, workspace, owned, runtimeRoot } = fixture()
    await dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "first round",
      workContext: WORK_CONTEXT,
      runner: recorder([], { session: "sess-aa11bb22" }),
      newId: identities("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"),
    })
    const second: Call[] = []
    await dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "second round",
      workContext: WORK_CONTEXT,
      runner: recorder(second, { registered: [owned] }),
      newId: identities("cccccccc-3333-4333-8333-cccccccccccc"),
    })
    const packet = JSON.parse(fs.readFileSync(path.join(root, "state", "requests", "wo-0030-hermes-packet.json"), "utf8"))

    // The session the first round reported is what the second round resumes...
    expect(packet.kernelSessionId).toBe("sess-aa11bb22")
    // ...against the same thread state, or --resume would have nothing to read.
    expect(packet.statePath).toBe(path.join(runtimeRoot, "hermes-kernel", "threads", "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "kernel-state"))
    // A registered worktree is reset, not added again -- and cleaned of ignored content, which is
    // what the invoker refuses to mount.
    expect(second.some((call) => gitArgs(call.args)[0] === "worktree" && gitArgs(call.args)[1] === "add")).toBe(false)
    expect(second).toContainEqual({ command: "git", args: ["--no-replace-objects", "reset", "--hard", BASE_SHA], cwd: owned })
    expect(second).toContainEqual({ command: "git", args: ["--no-replace-objects", "clean", "-fdx"], cwd: owned })
  })

  it("refuses to adopt a directory in the allowed root that is not its own worktree", async () => {
    const { root, repositoryPath, workspace, owned } = fixture()
    fs.mkdirSync(owned, { recursive: true })
    await expect(dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "bounded work",
      workContext: WORK_CONTEXT,
      runner: recorder([]),
      newId: identities("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"),
    })).rejects.toThrow("PROVIDER_WORKSPACE_RECONCILIATION_WALL")
  })

  it("believes only a completion that names this run", async () => {
    const { root, repositoryPath, workspace } = fixture()
    await expect(dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "bounded work",
      workContext: WORK_CONTEXT,
      // Whatever produced this line, it was not the run we started.
      runner: recorder([], { completionRunId: "wo-0030-someone-elses-run" }),
      newId: identities("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"),
    })).rejects.toThrow("PROVIDER_LANE_COMPLETION_WALL")
  })

  it("refuses a policy whose workspace mode is not the owned worktree this seam assumes", async () => {
    const { root, repositoryPath, workspace } = fixture({
      policy: (worktreesRoot) => ({
        placement: { workspaceMode: "BASELINE_CLONE", allowedWorkspaceRoots: [worktreesRoot] },
      }),
    })
    await expect(dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "bounded work",
      runner: recorder([]),
    })).rejects.toThrow("PROVIDER_LANE_WORKSPACE_WALL")
  })

  it("refuses a container deadline it cannot outlive, rather than orphaning the container", async () => {
    const { root, repositoryPath, workspace } = fixture({
      policy: (worktreesRoot) => ({
        execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"], timeoutSeconds: 7200, promptMaxChars: 60000 },
        placement: { workspaceMode: "OWNED_WORKTREE", allowedWorkspaceRoots: [worktreesRoot] },
      }),
    })
    await expect(dispatchHermesLocal({
      root, repositoryPath, workOrderId: "WO-0030", workspace, prompt: "bounded work",
      runner: recorder([]),
    })).rejects.toThrow("PROVIDER_LANE_TIMEOUT_WALL")
  })
})

describe("collection follows the work", () => {
  const collector = (patch: string) => {
    const calls: Call[] = []
    const runner = async (command: string, args: string[], options: { cwd?: string } = {}) => {
      calls.push({ command, args, cwd: options.cwd })
      return { stdout: args[0] === "diff" ? patch : "", stderr: "" }
    }
    return { calls, runner }
  }

  it("diffs the kernel workspace for a lane that edits it, and restores it once", async () => {
    const { calls, runner } = collector("diff --git a/x b/x\n")
    const patch = await collectPatch({ patchWorkspace: "C:\\kernel\\ws", workspace: "C:\\kernel\\ws", runner })
    expect(patch).toContain("diff --git")
    expect(calls.filter((call) => call.args[0] === "reset")).toHaveLength(1)
    expect(calls.every((call) => call.cwd === "C:\\kernel\\ws")).toBe(true)
  })

  it("diffs the provider's tree for the lane that edits that, and restores both", async () => {
    const { calls, runner } = collector("diff --git a/x b/x\n")
    await collectPatch({ patchWorkspace: "C:\\bridge\\owned", workspace: "C:\\kernel\\ws", runner })
    // Diffing the kernel workspace here is the silent failure this seam exists to prevent: it is
    // pristine, so the lane's work would come back as an empty patch.
    expect(calls.find((call) => call.args[0] === "diff")?.cwd).toBe("C:\\bridge\\owned")
    expect(calls.filter((call) => call.args[0] === "reset").map((call) => call.cwd))
      .toEqual(["C:\\bridge\\owned", "C:\\kernel\\ws"])
  })

  it("still refuses an empty patch, whichever tree it came from", async () => {
    const { runner } = collector("")
    await expect(collectPatch({ patchWorkspace: "C:\\bridge\\owned", workspace: "C:\\kernel\\ws", runner }))
      .rejects.toThrow("CODEX_PATCH_REQUIRED_WALL")
  })
})
