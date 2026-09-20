import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"
import { ResidentModelExecutionBackend } from "@/scripts/hermes-bridge/execution-backend.mjs"
import { createHermesKernelClient } from "@/scripts/hermes-bridge/hermes-kernel-client.mjs"
import * as service from "@/lib/hello-application/proposal-service.mjs"

import {
  applyHelloApplicationProposal,
  createHelloApplicationProposal,
  getHelloApplicationProposal,
  governedPrompt,
} from "@/lib/hello-application/proposal-service.mjs"

const roots: string[] = []
const sourcePath = (root: string, relativePath: string) => path.join(root, ...relativePath.split("/"))

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim()
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hello-proposal-"))
  roots.push(root)
  const repositoryRoot = path.join(root, "source")
  const runtimeRoot = path.join(root, "runtime")
  fs.mkdirSync(repositoryRoot)
  fs.cpSync(path.join(process.cwd(), "examples", "hello-application"), path.join(repositoryRoot, "examples", "hello-application"), { recursive: true })
  fs.mkdirSync(path.join(repositoryRoot, "config", "execution-fabric"), { recursive: true })
  fs.cpSync(path.join(process.cwd(), "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"), path.join(repositoryRoot, "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"))
  git(repositoryRoot, ["init", "--initial-branch=main"])
  git(repositoryRoot, ["config", "user.name", "Test Owner"])
  git(repositoryRoot, ["config", "user.email", "owner@example.test"])
  git(repositoryRoot, ["config", "core.autocrlf", "false"])
  fs.writeFileSync(path.join(repositoryRoot, "owner-note.txt"), "baseline\n")
  fs.writeFileSync(path.join(repositoryRoot, ".gitignore"), ".env\n")
  git(repositoryRoot, ["add", "."])
  git(repositoryRoot, ["commit", "-m", "hello baseline"])
  return { repositoryRoot, runtimeRoot }
}

const validation = async () => ({
  status: "passed",
  command: "node --test examples/hello-application/test/hello.test.mjs",
  output: "contained test passed",
})

function residentChange(relativePaths: string[]) {
  return async ({ workspacePath }: { workspacePath: string }) => {
    for (const relativePath of relativePaths) fs.appendFileSync(sourcePath(workspacePath, relativePath), "\n/* resident request change */\n")
    return { threadId: "thread-1", turnId: "turn-1", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
  }
}

describe("Hello Application governed HERMES proposals", () => {
  it("gives the resident the exact owner request and a bounded generic contract", () => {
    const prompt = governedPrompt("Make the footer explain the AI loop")

    expect(prompt).toContain("Make the footer explain the AI loop")
    expect(prompt).toContain("examples/hello-application/src/app.js")
    expect(prompt).toContain("examples/hello-application/src/index.html")
    expect(prompt).toContain("examples/hello-application/src/styles.css")
    expect(prompt).toContain("node --test examples/hello-application/test/hello.test.mjs")
    expect(prompt).toContain("Do not run Git")
    expect(prompt).toContain("Do not use network access")
    expect(prompt).not.toContain("apply-governed-marker-change.mjs")
  })

  it("refuses invalid owner requests before creating a workspace", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    let residentCalls = 0
    const residentTurn = async () => { residentCalls += 1; throw new Error("must not run") }

    for (const requestText of [" ", "x".repeat(2_001), "valid\0request"]) {
      await expect(createHelloApplicationProposal({ repositoryRoot, runtimeRoot, requestedBy: "owner", requestText, residentTurn, validateWorkspace: validation }))
        .rejects.toThrow("HELLO_PROPOSAL_REQUEST_INVALID")
    }
    expect(residentCalls).toBe(0)
    expect(fs.existsSync(path.join(runtimeRoot, "worktrees"))).toBe(false)
  })

  it("creates a reviewable one-file request with observed milestones and schema-v2 provenance", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    const baseSha = git(repositoryRoot, ["rev-parse", "HEAD"])
    const stages: string[] = []
    const proposal = await createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      requestText: "  Explain the local AI loop in the footer  ",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: validation,
      onProgress: (event: { stage: string }) => stages.push(event.stage),
    })

    expect(stages).toEqual(["accepted", "workspace_ready", "resident_started", "resident_finished", "validation_started", "ready_for_review"])
    expect(proposal.progress.map((event: { stage: string }) => event.stage)).toEqual(stages)
    expect(getHelloApplicationProposal({ runtimeRoot, requestedBy: "owner", proposalId: proposal.proposalId }).progress).toEqual(proposal.progress)
    expect(proposal).toMatchObject({
      schemaVersion: 2,
      status: "READY_FOR_REVIEW",
      requestText: "Explain the local AI loop in the footer",
      requestSha256: crypto.createHash("sha256").update("Explain the local AI loop in the footer").digest("hex"),
      executionNode: "hermes-node",
      appliedCommit: null,
      baseSha,
      changedPaths: ["examples/hello-application/src/index.html"],
      validation: { status: "passed", command: "node --test examples/hello-application/test/hello.test.mjs", output: "contained test passed" },
    })
    expect(git(repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it.each(["sync", "async"])("isolates %s progress observer failures, including persisted READY", async (kind) => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Observer isolation",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
      onProgress: () => { if (kind === "sync") throw new Error("observer"); return Promise.reject(new Error("observer")) },
    })
    expect(proposal.status).toBe("READY_FOR_REVIEW")
    expect(proposal.progress).toHaveLength(6)
  })

  it("recovers malformed completion with edits intact and the exact owner request in both prompts", async () => {
    const prompts: string[] = []
    const changedPaths = ["examples/hello-application/src/app.js"]
    const failure = Object.assign(new Error("invalid"), { name: "AppServerTurnEndedError", status: "failed", detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:sentinel_missing" })
    const result = await service.runGovernedResidentChange({ threadId: "thread-one", requestText: "Keep the existing edit and explain the pulse",
      readChangedPaths: async () => changedPaths,
      client: { runTurn: async ({ prompt }) => { prompts.push(prompt); if (prompts.length === 1) throw failure; return { turnId: "turn-two", status: "completed" } } },
    })
    expect(result.attempts).toBe(2)
    expect(result.changedPaths).toEqual(changedPaths)
    expect(prompts.every((prompt) => prompt.includes("Keep the existing edit and explain the pulse"))).toBe(true)
    expect(prompts[1]).toContain("Preserve the existing edits")
    expect(prompts[1]).not.toContain("apply-governed-marker-change")
    let calls = 0
    await expect(service.runGovernedResidentChange({ threadId: "thread-one", requestText: "bounded", maximumAttempts: 20,
      readChangedPaths: async () => changedPaths,
      client: { runTurn: async () => { calls++; throw failure } },
    })).rejects.toBe(failure)
    expect(calls).toBe(3)
    for (const error of [new Error("infrastructure"), Object.assign(new Error("wall"), { name: "AppServerTurnEndedError", status: "interrupted", detail: failure.detail })]) {
      calls = 0
      await expect(service.runGovernedResidentChange({ threadId: "thread-one", requestText: "bounded", readChangedPaths: async () => changedPaths,
        client: { runTurn: async () => { calls++; throw error } },
      })).rejects.toBe(error)
      expect(calls).toBe(1)
    }
  })

  it.each(["ignored", "null", "packet_hash", "workspace", "missing_record", "early_failure", "good"])("reads default resident session evidence: %s", async (mode) => {
    const setup = fixture()
    const threadId = crypto.randomUUID()
    const runIds = [crypto.randomUUID(), crypto.randomUUID()]
    let attempt = 0
    vi.spyOn(ResidentModelExecutionBackend.prototype, "runCodexClient").mockImplementation(async ({ workspacePath }: any) => ({
      connect: async () => {}, startThread: async () => threadId, close: () => {},
      runTurn: async () => {
        attempt++
        if (attempt === 1) fs.appendFileSync(sourcePath(workspacePath, "examples/hello-application/src/app.js"), "\n/* retained after malformed completion */\n")
        const threadRoot = path.join(setup.runtimeRoot, "hermes-kernel", "threads", threadId)
        const recordPath = path.join(threadRoot, "session.json")
        const session = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, "utf8")) : { schemaVersion: 1, threadId, workspacePath, createdAt: new Date().toISOString(), turns: [] }
        const packet = { schemaVersion: 3, runId: runIds[attempt - 1], model: "actual-placed-model", placement: { computeId: "actual-compute" }, workspaceMode: "OWNED_WORKTREE", workspacePath: mode === "workspace" ? setup.repositoryRoot : workspacePath }
        const packetBytes = Buffer.from(JSON.stringify(packet))
        const turnRoot = path.join(threadRoot, "turns", String(attempt))
        fs.mkdirSync(turnRoot, { recursive: true })
        fs.writeFileSync(path.join(turnRoot, "packet.json"), packetBytes)
        session.turns.push({ turnId: packet.runId, at: new Date().toISOString(), exitCode: mode === "early_failure" ? 1 : 0,
          packetSha256: mode === "packet_hash" ? "0".repeat(64) : crypto.createHash("sha256").update(packetBytes).digest("hex"), harvested: attempt === 2,
          ...(attempt === 1 && mode === "ignored" ? { ignoredPathsCreated: [".env"] } : mode === "null" ? { ignoredPathsCreated: null } : {}),
        })
        if (mode === "missing_record" && attempt === 2) session.turns.shift()
        fs.writeFileSync(recordPath, JSON.stringify(session))
        if (attempt === 1) throw Object.assign(new Error("malformed completion"), { name: "AppServerTurnEndedError", status: "failed", detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:sentinel_missing" })
        return { threadId, turnId: packet.runId, status: "completed" }
      },
    }) as any)
    const result = createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Preserve the requested change", validateWorkspace: validation })
    if (mode === "good") {
      const proposal = await result
      expect(proposal.model).toBe("actual-placed-model")
      expect(proposal.executionNode).toBe("actual-compute")
      expect(proposal.reviewPatch).toContain("retained after malformed completion")
      expect(attempt).toBe(2)
    } else await expect(result).rejects.toThrow(mode === "ignored" || mode === "null" ? "HELLO_PROPOSAL_IGNORED_PATH_REFUSED" : "HELLO_PROPOSAL_RESIDENT_EVIDENCE_INVALID")
  })

  it("rejects .env evidence written by the real kernel client with a successful harvested turn", async () => {
    const setup = fixture()
    fs.mkdirSync(setup.runtimeRoot)
    const policyPath = path.join(setup.repositoryRoot, "config/execution-fabric/hermes-free-dev-agent-v2.policy.json")
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"))
    policy.placement.allowedWorkspaceRoots = [path.join(setup.runtimeRoot, "worktrees")]
    fs.writeFileSync(policyPath, JSON.stringify(policy))
    const invokerPath = path.join(setup.runtimeRoot, "fake-invoker.ps1")
    fs.writeFileSync(invokerPath, "# command runner injected in test\n")
    vi.spyOn(ResidentModelExecutionBackend.prototype, "runCodexClient").mockImplementation(async ({ workspacePath }: any) => createHermesKernelClient({
      workspacePath, runtimeRoot: setup.runtimeRoot, policyPath, invokerPath, timeoutMs: 1_800_000,
      commandRunner: async ({ command, args, cwd }: { command: string; args: string[]; cwd: string }) => {
        if (command === "git") return { code: 0, stdout: execFileSync(command, args, { cwd, encoding: "utf8", windowsHide: true }), stderr: "" }
        fs.appendFileSync(sourcePath(workspacePath, "examples/hello-application/src/app.js"), "\n/* allowed edit */\n")
        fs.writeFileSync(path.join(workspacePath, ".env"), "ignored fixture content\n")
        const runId = args[args.indexOf("-RunId") + 1]
        const output = { result: "READY_FOR_VALIDATION", workOrder: "WO-1", branch: "codex/x", commit: null, prUrl: null,
          merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0, ownerTouchCount: 0,
          blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE", blockedAction: null,
          authorityBoundary: null, minimumChoice: null, approveConsequence: null, denyConsequence: null, findings: [] }
        return { code: 0, stderr: "", stdout: `HERMES_TURN_OUTPUT runId=${runId}\n${JSON.stringify(output)}\nHERMES_TURN_OUTPUT_END\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=fixture\n` }
      },
    } as any))
    await expect(createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update pulse", validateWorkspace: validation })).rejects.toThrow("HELLO_PROPOSAL_IGNORED_PATH_REFUSED")
    const threads = path.join(setup.runtimeRoot, "hermes-kernel", "threads")
    const session = JSON.parse(fs.readFileSync(path.join(threads, fs.readdirSync(threads)[0], "session.json"), "utf8"))
    expect(session.turns[0]).toMatchObject({ exitCode: 0, harvested: true, ignoredPathsCreated: [".env"] })
  })

  it("accepts content phrases that resemble patch metadata and a materially different second Apply", async () => {
    const setup = fixture()
    const first = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Explain copying",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(sourcePath(workspacePath, "examples/hello-application/src/index.html"), "\n<!-- copy this explanation; rename this label; new mode wording -->\n")
        return { threadId: "t-one", turnId: "r-one", model: "model", ignoredPathsCreated: [] }
      }, validateWorkspace: validation,
    })
    const applied = await applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: first.proposalId, validateWorkspace: validation })
    const second = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Make the focus border thicker",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(sourcePath(workspacePath, "examples/hello-application/src/styles.css"), "\nbutton:focus-visible { outline-width: 4px; }\n")
        return { threadId: "t-two", turnId: "r-two", model: "model", ignoredPathsCreated: [] }
      }, validateWorkspace: validation,
    })
    expect(second.baseSha).toBe(applied.appliedCommit)
    const secondApplied = await applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: second.proposalId, validateWorkspace: validation })
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD^"])).toBe(applied.appliedCommit)
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(secondApplied.appliedCommit)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it.each(["requestSha256", "proposalCommit", "progress", "appliedCommit", "validation", "changedPaths", "threadId", "turnId", "createdAt", "status", "extraField"])("rejects malformed v2 %s as RECEIPT_INVALID", async (field) => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const target = path.join(setup.runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.json`)
    const value = JSON.parse(fs.readFileSync(target, "utf8"))
    value[field] = field === "requestSha256" ? "0".repeat(64) : field === "progress" ? [] : field === "changedPaths" ? [value.changedPaths[0], value.changedPaths[0]] : field === "threadId" ? "../escape" : field === "turnId" ? null : "invalid"
    fs.writeFileSync(target, JSON.stringify(value))
    expect(() => getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId })).toThrow("HELLO_PROPOSAL_RECEIPT_INVALID")
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })).rejects.toThrow("HELLO_PROPOSAL_RECEIPT_INVALID")
  })

  it("detects canonical trusted-server changes during validation and preserves that external edit", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const before = fs.readFileSync(sourcePath(setup.repositoryRoot, proposal.changedPaths[0]))
    const server = sourcePath(setup.repositoryRoot, "examples/hello-application/server.mjs")
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId,
      validateWorkspace: async () => { fs.appendFileSync(server, "\n// external server mutation\n"); return validation() },
    })).rejects.toThrow("HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH")
    expect(fs.readFileSync(server, "utf8")).toContain("external server mutation")
    expect(fs.readFileSync(sourcePath(setup.repositoryRoot, proposal.changedPaths[0]))).toEqual(before)
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
  })

  it.each(["receipt_prewrite", "published", "receipt_replace"])("recovers %s failure with exact unrelated owner index/worktree preservation", async (stage) => {
    const setup = fixture()
    fs.writeFileSync(path.join(setup.repositoryRoot, "owner-note.txt"), "staged owner bytes\n")
    git(setup.repositoryRoot, ["add", "owner-note.txt"])
    fs.appendFileSync(path.join(setup.repositoryRoot, "owner-note.txt"), "unstaged owner bytes\n")
    const ownerIndex = git(setup.repositoryRoot, ["ls-files", "--stage", "--", "owner-note.txt"])
    const ownerBytes = fs.readFileSync(path.join(setup.repositoryRoot, "owner-note.txt"))
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const before = fs.readFileSync(sourcePath(setup.repositoryRoot, proposal.changedPaths[0]))
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
      transactionOperations: { checkpoint: (observed: string) => { if (observed === stage) throw new Error("injected disk failure") } },
    })).rejects.toThrow("injected disk failure")
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
    expect(fs.readFileSync(sourcePath(setup.repositoryRoot, proposal.changedPaths[0]))).toEqual(before)
    expect(git(setup.repositoryRoot, ["ls-files", "--stage", "--", "owner-note.txt"])).toBe(ownerIndex)
    expect(fs.readFileSync(path.join(setup.repositoryRoot, "owner-note.txt"))).toEqual(ownerBytes)
    expect(git(setup.repositoryRoot, ["status", "--porcelain", "--", "examples/hello-application"])).toBe("")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("READY_FOR_REVIEW")
    expect(fs.readdirSync(path.join(setup.runtimeRoot, "hello-application-proposals")).some((name) => name.endsWith(".tmp"))).toBe(false)
  })

  it.each(["restore_file", "external_ref"])("quarantines unprovable %s recovery without overwriting external state", async (failure) => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    let external = ""
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
      transactionOperations: { checkpoint: (stage: string) => {
        if (stage === "published") {
          if (failure === "external_ref") { git(setup.repositoryRoot, ["commit", "--allow-empty", "-m", "external advance"]); external = git(setup.repositoryRoot, ["rev-parse", "HEAD"]) }
          throw new Error("after CAS failure")
        }
        if (stage === "restore_file" && failure === "restore_file") throw new Error("restore failed")
      } },
    })).rejects.toThrow("HELLO_PROPOSAL_ROLLBACK_FAILED")
    if (external) expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(external)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
    expect(service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })[0].status).toBe("QUARANTINED_ROLLBACK_FAILED")
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })).rejects.toThrow("HELLO_PROPOSAL_NOT_APPLICABLE")
  })

  it("refuses a stale base before touching the target", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    git(setup.repositoryRoot, ["commit", "--allow-empty", "-m", "owner advance"])
    const before = fs.readFileSync(sourcePath(setup.repositoryRoot, proposal.changedPaths[0]))
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })).rejects.toThrow("HELLO_PROPOSAL_STALE_BASE")
    expect(fs.readFileSync(sourcePath(setup.repositoryRoot, proposal.changedPaths[0]))).toEqual(before)
  })

  it("rejects a digest-valid out-of-scope patch without partial writes", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const outside = path.join(setup.repositoryRoot, "owner-note.txt")
    const original = fs.readFileSync(outside)
    fs.writeFileSync(outside, "unreserved edit\n")
    const outsidePatch = execFileSync("git", ["-C", setup.repositoryRoot, "diff", "--binary", "--full-index", "--", "owner-note.txt"])
    fs.writeFileSync(outside, original)
    const target = path.join(setup.runtimeRoot, "hello-application-proposals", proposal.proposalId)
    const patch = Buffer.concat([fs.readFileSync(`${target}.patch`), outsidePatch])
    fs.writeFileSync(`${target}.patch`, patch)
    const receipt = JSON.parse(fs.readFileSync(`${target}.json`, "utf8"))
    receipt.patchSha256 = crypto.createHash("sha256").update(patch).digest("hex")
    fs.writeFileSync(`${target}.json`, JSON.stringify(receipt))
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })).rejects.toThrow("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it.each(["before_publish", "published", "restore_file"])("preserves unowned target bytes introduced at %s", async (boundary) => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const target = sourcePath(setup.repositoryRoot, proposal.changedPaths[0])
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
      transactionOperations: { checkpoint: (stage: string) => {
        if (stage === boundary) fs.writeFileSync(target, "external owner bytes\n")
        if (stage === "published" && boundary === "restore_file") throw new Error("start recovery")
      } },
    })).rejects.toThrow("HELLO_PROPOSAL_ROLLBACK_FAILED")
    expect(fs.readFileSync(target, "utf8")).toBe("external owner bytes\n")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
  })

  it("recovers an actual APPLIED receipt rename error after CAS", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const receipt = path.join(setup.runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.json`)
    const rename = fs.renameSync
    let sawPublished = false
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === receipt) { sawPublished = git(setup.repositoryRoot, ["rev-parse", "HEAD"]) !== proposal.baseSha; throw new Error("injected rename failure") }
      return rename(from, to)
    })
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })).rejects.toThrow("injected rename failure")
    expect(sawPublished).toBe(true)
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("READY_FOR_REVIEW")
  })

  it("uses the quarantine receipt when independent marker creation fails", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const write = fs.writeFileSync
    vi.spyOn(fs, "writeFileSync").mockImplementation((target, ...args) => {
      if (String(target).endsWith(".quarantine")) throw new Error("marker disk failure")
      return write(target, ...args as [any, any])
    })
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
      transactionOperations: { checkpoint: (stage: string) => { if (["published", "restore_file"].includes(stage)) throw new Error("injected recovery failure") } },
    })).rejects.toThrow("HELLO_PROPOSAL_ROLLBACK_FAILED")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
  })

  it("accepts a nonempty two-file subset and refuses no-op, ignored, outside, and HEAD mutations", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    const proposal = await createHelloApplicationProposal({
      repositoryRoot, runtimeRoot, requestedBy: "owner", requestText: "Improve signal copy",
      residentTurn: residentChange(["examples/hello-application/src/app.js", "examples/hello-application/src/styles.css"]), validateWorkspace: validation,
    })
    expect(proposal.changedPaths).toEqual(["examples/hello-application/src/app.js", "examples/hello-application/src/styles.css"])

    await expect(createHelloApplicationProposal({
      repositoryRoot, runtimeRoot, requestedBy: "owner", requestText: "Do nothing",
      residentTurn: async () => ({ threadId: "thread-empty", turnId: "turn-empty", model: "model", ignoredPathsCreated: [] }), validateWorkspace: validation,
    })).rejects.toThrow("HELLO_PROPOSAL_NO_CHANGE")

    await expect(createHelloApplicationProposal({
      repositoryRoot, runtimeRoot, requestedBy: "owner", requestText: "Escape",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(path.join(workspacePath, "owner-note.txt"), "escape\n")
        return { threadId: "thread-outside", turnId: "turn-outside", model: "model", ignoredPathsCreated: [] }
      }, validateWorkspace: validation,
    })).rejects.toThrow("HELLO_PROPOSAL_PATH_REFUSED:owner-note.txt")

    await expect(createHelloApplicationProposal({
      repositoryRoot, runtimeRoot, requestedBy: "owner", requestText: "Ignore",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(sourcePath(workspacePath, "examples/hello-application/src/app.js"), "\n/* allowed */\n")
        return { threadId: "thread-ignore", turnId: "turn-ignore", model: "model", ignoredPathsCreated: [".env"] }
      }, validateWorkspace: validation,
    })).rejects.toThrow("HELLO_PROPOSAL_IGNORED_PATH_REFUSED")

    await expect(createHelloApplicationProposal({
      repositoryRoot, runtimeRoot, requestedBy: "owner", requestText: "Move head",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(sourcePath(workspacePath, "examples/hello-application/src/app.js"), "\n/* commit */\n")
        git(workspacePath, ["add", "examples/hello-application/src/app.js"])
        git(workspacePath, ["commit", "-m", "resident head mutation"])
        return { threadId: "thread-head", turnId: "turn-head", model: "model", ignoredPathsCreated: [] }
      }, validateWorkspace: validation,
    })).rejects.toThrow("HELLO_PROPOSAL_RESIDENT_HEAD_MUTATED")
  })

  it("applies through isolated validation, commits only receipt paths, and preserves unrelated staged owner work", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    fs.writeFileSync(path.join(repositoryRoot, "owner-note.txt"), "staged by owner\n")
    git(repositoryRoot, ["add", "owner-note.txt"])
    const baseSha = git(repositoryRoot, ["rev-parse", "HEAD"])
    const proposal = await createHelloApplicationProposal({
      repositoryRoot, runtimeRoot, requestedBy: "owner", requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    const applied = await applyHelloApplicationProposal({ repositoryRoot, runtimeRoot, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })

    expect(applied.status).toBe("APPLIED")
    expect(applied.appliedCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(git(repositoryRoot, ["show", "-s", "--format=%P", applied.appliedCommit!])).toBe(baseSha)
    expect(git(repositoryRoot, ["show", "--format=", "--name-only", applied.appliedCommit!])).toBe("examples/hello-application/src/index.html")
    expect(git(repositoryRoot, ["diff", "--cached", "--name-only"])).toBe("owner-note.txt")
    expect(git(repositoryRoot, ["diff", "--name-only"])).toBe("")
  })

  it("rolls back a failed contained apply validation and leaves the receipt ready", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    const proposal = await createHelloApplicationProposal({
      repositoryRoot, runtimeRoot, requestedBy: "owner", requestText: "Update text",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    await expect(applyHelloApplicationProposal({
      repositoryRoot, runtimeRoot, requestedBy: "owner", proposalId: proposal.proposalId,
      validateWorkspace: async () => { throw new Error("HELLO_PROPOSAL_VALIDATION_FAILED") },
    })).rejects.toThrow("HELLO_PROPOSAL_VALIDATION_FAILED")
    expect(git(repositoryRoot, ["diff", "--name-only"])).toBe("")
    expect(getHelloApplicationProposal({ runtimeRoot, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("READY_FOR_REVIEW")
  })

  it("continues to read a schema-v1 receipt", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    const proposal = await createHelloApplicationProposal({
      repositoryRoot, runtimeRoot, requestedBy: "owner", requestText: "Update text",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    const receiptPath = path.join(runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.json`)
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    receipt.schemaVersion = 1
    delete receipt.requestText
    delete receipt.requestSha256
    delete receipt.executionNode
    delete receipt.progress
    delete receipt.appliedCommit
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`)

    expect(getHelloApplicationProposal({ runtimeRoot, requestedBy: "owner", proposalId: proposal.proposalId }).schemaVersion).toBe(1)
    const applied = await applyHelloApplicationProposal({ repositoryRoot, runtimeRoot, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })
    expect(applied.status).toBe("APPLIED")
    expect(getHelloApplicationProposal({ runtimeRoot, requestedBy: "owner", proposalId: proposal.proposalId }).appliedCommit).toBe(applied.appliedCommit)
  })
})
