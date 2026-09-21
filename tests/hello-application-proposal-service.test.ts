import { execFileSync, spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

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

function runClaimProcess(script: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

function waitForFileSync(target: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  while (!fs.existsSync(target)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${target}`)
    Atomics.wait(sleeper, 0, 0, 5)
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

  it("rejects a ready proposal into one durable terminal audit state without touching canonical source", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: validation,
    })
    const rejectProposal = (service as typeof service & {
      rejectHelloApplicationProposal: (options: Record<string, unknown>) => Record<string, any>
    }).rejectHelloApplicationProposal

    const rejected = rejectProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      reason: "Superseded by a clearer owner request.",
    })

    expect(rejected).toMatchObject({
      schemaVersion: 2,
      proposalId: proposal.proposalId,
      status: "REJECTED",
      appliedAt: null,
      appliedCommit: null,
      rejectionReason: "Superseded by a clearer owner request.",
      reviewPatch: proposal.reviewPatch,
    })
    expect(Date.parse(rejected.rejectedAt)).toBeGreaterThanOrEqual(Date.parse(proposal.createdAt))
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }))
      .toEqual(rejected)
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
    await expect(applyHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      validateWorkspace: validation,
    })).rejects.toThrow("HELLO_PROPOSAL_NOT_APPLICABLE")
  })

  it("resumes an exact durable rejection claim after a process crash and is idempotent once terminal", async () => {
    const setup = fixture()
    const reason = "Superseded by a clearer owner request."
    const proposal = await createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: validation,
    })
    const proposalRoot = path.join(setup.runtimeRoot, "hello-application-proposals")
    const receiptPath = path.join(proposalRoot, `${proposal.proposalId}.json`)
    const inflightPath = path.join(proposalRoot, `${proposal.proposalId}.inflight`)
    const ready = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    const rejectStartedAt = new Date(Date.parse(proposal.createdAt) + 60_000).toISOString()
    fs.writeFileSync(inflightPath, JSON.stringify({
      ...ready,
      status: "REJECT_IN_PROGRESS",
      rejectStartedAt,
      rejectionReason: reason,
    }))

    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }))
      .toMatchObject({ status: "REJECT_IN_PROGRESS", rejectStartedAt, rejectionReason: reason })

    const rejected = service.rejectHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      reason,
    })
    expect(rejected).toMatchObject({ status: "REJECTED", rejectedAt: rejectStartedAt, rejectionReason: reason })
    expect(fs.existsSync(inflightPath)).toBe(false)
    expect(service.rejectHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      reason,
    })).toEqual(rejected)
    expect(() => service.rejectHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      reason: "A different reason must not rewrite the audit record.",
    })).toThrow("HELLO_PROPOSAL_NOT_APPLICABLE")
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("accepts an exact peer terminal that wins while a durable rejection claim is resumed", async () => {
    const setup = fixture()
    const reason = "Superseded by a clearer owner request."
    const proposal = await createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: validation,
    })
    const proposalRoot = path.join(setup.runtimeRoot, "hello-application-proposals")
    const receiptPath = path.join(proposalRoot, `${proposal.proposalId}.json`)
    const inflightPath = path.join(proposalRoot, `${proposal.proposalId}.inflight`)
    const ready = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    const rejectStartedAt = new Date(Date.parse(proposal.createdAt) + 60_000).toISOString()
    fs.writeFileSync(inflightPath, JSON.stringify({
      ...ready,
      status: "REJECT_IN_PROGRESS",
      rejectStartedAt,
      rejectionReason: reason,
    }))
    const readFile = fs.readFileSync
    let receiptReads = 0
    let injected = false
    let peerResult: unknown
    vi.spyOn(fs, "readFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
      if (String(target) === receiptPath) {
        receiptReads += 1
        if (!injected && receiptReads === 2) {
          injected = true
          peerResult = service.rejectHelloApplicationProposal({
            ...setup,
            requestedBy: "owner",
            proposalId: proposal.proposalId,
            reason,
          })
        }
      }
      return readFile(target, options as never)
    }) as typeof fs.readFileSync)

    const rejected = service.rejectHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      reason,
    })

    expect(injected).toBe(true)
    expect(rejected).toEqual(peerResult)
    expect(rejected).toMatchObject({ status: "REJECTED", rejectedAt: rejectStartedAt, rejectionReason: reason })
    expect(fs.existsSync(inflightPath)).toBe(false)
    expect(fs.existsSync(path.join(proposalRoot, `${proposal.proposalId}.quarantine`))).toBe(false)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("accepts a byte-identical peer rejection that wins during terminal publication", async () => {
    const setup = fixture()
    const reason = "Superseded by a clearer owner request."
    const proposal = await createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: validation,
    })
    const rename = fs.renameSync
    let injected = false
    vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      if (!injected && String(source).endsWith(".reject")) {
        injected = true
        rename(source, destination)
        throw new Error("peer published the identical terminal receipt")
      }
      return rename(source, destination)
    })

    const rejected = service.rejectHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      reason,
    })

    expect(injected).toBe(true)
    expect(rejected).toMatchObject({ status: "REJECTED", rejectionReason: reason })
    const proposalRoot = path.join(setup.runtimeRoot, "hello-application-proposals")
    expect(fs.existsSync(path.join(proposalRoot, `${proposal.proposalId}.quarantine`))).toBe(false)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }))
      .toEqual(rejected)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("accepts a byte-identical peer rejection that wins while the first process verifies its claim", async () => {
    const setup = fixture()
    const reason = "Superseded by a clearer owner request."
    const proposal = await createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: validation,
    })
    const proposalRoot = path.join(setup.runtimeRoot, "hello-application-proposals")
    const inflight = path.join(proposalRoot, `${proposal.proposalId}.inflight`)
    const readFile = fs.readFileSync
    let injected = false
    let peerResult: unknown
    vi.spyOn(fs, "readFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
      if (!injected && String(target) === inflight && fs.existsSync(inflight)) {
        injected = true
        peerResult = service.rejectHelloApplicationProposal({
          ...setup,
          requestedBy: "owner",
          proposalId: proposal.proposalId,
          reason,
        })
      }
      return readFile(target, options as never)
    }) as typeof fs.readFileSync)

    const rejected = service.rejectHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      reason,
    })

    expect(injected).toBe(true)
    expect(peerResult).toEqual(rejected)
    expect(rejected).toMatchObject({ status: "REJECTED", rejectionReason: reason })
    expect(fs.existsSync(path.join(proposalRoot, `${proposal.proposalId}.quarantine`))).toBe(false)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }))
      .toEqual(rejected)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("fails closed for invalid, repeated, and apply-in-progress rejection transitions", async () => {
    const setup = fixture()
    const rejectProposal = (service as typeof service & {
      rejectHelloApplicationProposal: (options: Record<string, unknown>) => Record<string, any>
    }).rejectHelloApplicationProposal
    const proposal = await createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: validation,
    })

    for (const reason of [
      " ",
      "x".repeat(501),
      "bad\0reason",
      "multi\nline",
      "multi\u2028line",
      "multi\u2029line",
      "\u2028leading separator",
      "trailing separator\u2029",
    ]) {
      expect(() => rejectProposal({
        ...setup,
        requestedBy: "owner",
        proposalId: proposal.proposalId,
        reason,
      })).toThrow("HELLO_PROPOSAL_REJECTION_INVALID")
    }
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status)
      .toBe("READY_FOR_REVIEW")

    rejectProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, reason: "No longer wanted." })
    expect(() => rejectProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      reason: "Repeated rejection.",
    })).toThrow("HELLO_PROPOSAL_NOT_APPLICABLE")

    const applying = await createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Change the pulse label",
      residentTurn: residentChange(["examples/hello-application/src/app.js"]),
      validateWorkspace: validation,
    })
    service.claimHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: applying.proposalId })
    expect(() => rejectProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: applying.proposalId,
      reason: "Do not apply this version.",
    })).toThrow("HELLO_PROPOSAL_NOT_APPLICABLE")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: applying.proposalId }).status)
      .toBe("APPLY_IN_PROGRESS")
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

  it("fails closed before READY when the proposal worktree cannot be removed", async () => {
    const setup = fixture()
    const stages: string[] = []
    let workspace = ""

    await expect(createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: async ({ workspacePath }: { workspacePath: string }) => {
        workspace = workspacePath
        git(setup.repositoryRoot, ["worktree", "lock", workspacePath])
        return validation()
      },
      onProgress: (event: { stage: string }) => stages.push(event.stage),
    })).rejects.toThrow("HELLO_PROPOSAL_WORKTREE_CLEANUP_FAILED")

    expect(stages).toEqual(["accepted", "workspace_ready", "resident_started", "resident_finished", "validation_started"])
    expect(service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })).toEqual([])
    const proposalRoot = path.join(setup.runtimeRoot, "hello-application-proposals")
    expect(fs.existsSync(proposalRoot) ? fs.readdirSync(proposalRoot) : []).toEqual([])
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")

    git(setup.repositoryRoot, ["worktree", "unlock", workspace])
    git(setup.repositoryRoot, ["worktree", "remove", "--force", workspace])
  })

  it("removes proposal artifacts when receipt publication becomes uncertain after patch creation", async () => {
    const setup = fixture()
    const rename = fs.renameSync
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(target).includes("hello-application-proposals") && String(target).endsWith(".json")) {
        rename(source, target)
        throw new Error("controlled receipt publish failure")
      }
      return rename(source, target)
    })

    await expect(createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: validation,
    })).rejects.toThrow("controlled receipt publish failure")

    expect(service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })).toEqual([])
    const proposalRoot = path.join(setup.runtimeRoot, "hello-application-proposals")
    expect(fs.existsSync(proposalRoot) ? fs.readdirSync(proposalRoot) : []).toEqual([])
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it.each(["patch", "receipt"])("publishes an inspectable quarantine when %s cleanup cannot be verified", async (lockedArtifact) => {
    const setup = fixture()
    const rename = fs.renameSync
    const remove = fs.rmSync
    let patchRemoved = false
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(target).includes("hello-application-proposals") && String(target).endsWith(".json")) {
        rename(source, target)
        throw new Error("controlled receipt publish failure")
      }
      return rename(source, target)
    })
    vi.spyOn(fs, "rmSync").mockImplementation(((target: fs.PathLike, options?: fs.RmDirOptions) => {
      const value = String(target)
      if ((lockedArtifact === "patch" && value.endsWith(".patch"))
        || (lockedArtifact === "receipt" && value.endsWith(".json"))) throw new Error(`${lockedArtifact} cleanup locked`)
      const result = remove(target, options)
      if (value.endsWith(".patch")) patchRemoved = true
      return result
    }) as typeof fs.rmSync)

    await expect(createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Update the footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]),
      validateWorkspace: validation,
    })).rejects.toThrow("HELLO_PROPOSAL_ARTIFACT_CLEANUP_FAILED")

    const listed = service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ status: "QUARANTINED_ROLLBACK_FAILED", reviewPatch: expect.stringContaining("resident request change") })
    await expect(applyHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      proposalId: listed[0].proposalId,
      validateWorkspace: validation,
    })).rejects.toThrow("HELLO_PROPOSAL_NOT_APPLICABLE")
    const names = fs.readdirSync(path.join(setup.runtimeRoot, "hello-application-proposals"))
    expect(names).toContain(`${listed[0].proposalId}.patch`)
    expect(names).toContain(`${listed[0].proposalId}.quarantine`)
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false)
    expect(patchRemoved).toBe(lockedArtifact === "receipt")
  })

  it.each([
    ["one 524,288-byte allowed file", (workspacePath: string) => {
      fs.writeFileSync(sourcePath(workspacePath, "examples/hello-application/src/app.js"), Buffer.alloc(524_288, "a"))
    }],
    ["an aggregate over one MiB", (workspacePath: string) => {
      for (const relativePath of [
        "examples/hello-application/src/app.js",
        "examples/hello-application/src/index.html",
        "examples/hello-application/src/styles.css",
      ]) fs.writeFileSync(sourcePath(workspacePath, relativePath), Buffer.alloc(400_000, "a"))
    }],
  ])("rejects %s before snapshot, diff, validation, or READY", async (_label, mutate) => {
    const setup = fixture()
    const stages: string[] = []
    const validateWorkspace = vi.fn(validation)

    await expect(createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Make a bounded source change",
      residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
        mutate(workspacePath)
        return { threadId: "thread-size", turnId: "turn-size", model: "model", ignoredPathsCreated: [] }
      },
      validateWorkspace,
      onProgress: (event: { stage: string }) => stages.push(event.stage),
    })).rejects.toThrow("HELLO_PROPOSAL_SOURCE_SIZE_REFUSED")

    expect(validateWorkspace).not.toHaveBeenCalled()
    expect(stages).not.toContain("validation_started")
    expect(stages).not.toContain("ready_for_review")
    expect(service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })).toEqual([])
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("bounds Apply validation sources before reading a full snapshot or invoking validation", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    const target = path.resolve(sourcePath(setup.repositoryRoot, "examples/hello-application/src/app.js"))
    const lstat = fs.lstatSync
    vi.spyOn(fs, "lstatSync").mockImplementation(((candidate: fs.PathLike, options?: unknown) => {
      const result = lstat(candidate, options as never)
      if (path.resolve(String(candidate)) === target) Object.assign(result, { size: 524_288 })
      return result
    }) as typeof fs.lstatSync)
    const validateWorkspace = vi.fn(validation)

    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace }))
      .rejects.toThrow("HELLO_PROPOSAL_SOURCE_SIZE_REFUSED")
    expect(validateWorkspace).not.toHaveBeenCalled()
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("READY_FOR_REVIEW")
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it.each(["before descriptor stat", "after descriptor stat"])("rejects source growth %s without invoking validation", async (phase) => {
    const setup = fixture()
    const validateWorkspace = vi.fn(validation)
    const openSync = fs.openSync
    const fstatSync = fs.fstatSync
    let target = ""
    let targetDescriptor: number | undefined
    let grew = false
    const growToExclusiveLimit = () => {
      const remaining = 524_288 - fs.statSync(target).size
      if (remaining > 0) fs.appendFileSync(target, Buffer.alloc(remaining, "a"))
      grew = true
    }
    vi.spyOn(fs, "openSync").mockImplementation(((candidate: fs.PathLike, flags: any, mode?: any) => {
      const descriptor = openSync(candidate, flags, mode)
      if (target && path.resolve(String(candidate)) === target) targetDescriptor = descriptor
      return descriptor
    }) as typeof fs.openSync)
    vi.spyOn(fs, "fstatSync").mockImplementation(((descriptor: number, options?: any) => {
      if (descriptor === targetDescriptor && !grew && phase === "before descriptor stat") growToExclusiveLimit()
      const stat = fstatSync(descriptor, options)
      if (descriptor === targetDescriptor && !grew && phase === "after descriptor stat") growToExclusiveLimit()
      return stat
    }) as typeof fs.fstatSync)

    await expect(createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Make a bounded source change",
      residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
        target = path.resolve(sourcePath(workspacePath, "examples/hello-application/src/app.js"))
        fs.appendFileSync(target, "\n/* resident request change */\n")
        return { threadId: "thread-race", turnId: "turn-race", model: "model", ignoredPathsCreated: [] }
      },
      validateWorkspace,
    })).rejects.toThrow("HELLO_PROPOSAL_SOURCE_SIZE_REFUSED")

    expect(grew).toBe(true)
    expect(validateWorkspace).not.toHaveBeenCalled()
    expect(service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })).toEqual([])
  })

  it("accepts host-verified allowed edits after malformed completion without paying for a second model turn", async () => {
    const changedPaths = ["examples/hello-application/src/app.js"]
    const failure = Object.assign(new Error("invalid"), {
      name: "AppServerTurnEndedError",
      status: "failed",
      detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:NO_ACCEPTABLE_OUTPUT",
    })
    const runTurn = vi.fn(async () => { throw failure })
    const verifyAttempt = vi.fn(async () => ({ turnId: "turn-one" }))

    const result = await service.runGovernedResidentChange({
      threadId: "thread-one",
      requestText: "Keep the existing edit and explain the pulse",
      readChangedPaths: async () => changedPaths,
      verifyAttempt,
      client: { runTurn },
    })

    expect(result).toMatchObject({
      attempts: 1,
      changedPaths,
      turnId: "turn-one",
      completionMode: "HOST_OBSERVED_OUTPUT_INVALID",
    })
    expect(runTurn).toHaveBeenCalledOnce()
    expect(verifyAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, failure }))
  })

  it("retries malformed completion without a trusted turn binding and keeps the exact owner request in both prompts", async () => {
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

  it("keeps the correction retry when trusted evidence has no allowed edit to review", async () => {
    const failure = Object.assign(new Error("invalid"), {
      name: "AppServerTurnEndedError",
      status: "failed",
      detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:NO_ACCEPTABLE_OUTPUT",
    })
    let attempt = 0
    const result = await service.runGovernedResidentChange({
      threadId: "thread-one",
      requestText: "Make one reviewable change",
      verifyAttempt: async () => ({ turnId: `turn-${attempt}` }),
      readChangedPaths: async () => attempt === 1 ? [] : ["examples/hello-application/src/app.js"],
      client: {
        runTurn: async () => {
          attempt++
          if (attempt === 1) throw failure
          return { turnId: "turn-two", status: "completed" }
        },
      },
    })

    expect(result).toMatchObject({
      attempts: 2,
      turnId: "turn-two",
      completionMode: "MODEL_OUTPUT_VALID",
      changedPaths: ["examples/hello-application/src/app.js"],
    })
  })

  it("shares one 5,400,000ms aggregate deadline while preserving the full kernel turn budget", async () => {
    const failure = Object.assign(new Error("invalid"), { name: "AppServerTurnEndedError", status: "failed", detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:sentinel_missing" })
    const budgets: number[] = []
    let now = 10_000
    let attempts = 0
    const result = await service.runGovernedResidentChange({
      threadId: "thread-one",
      requestText: "Use one bounded deadline",
      timeoutMs: 5_400_000,
      now: () => now,
      readChangedPaths: async () => ["examples/hello-application/src/app.js"],
      client: { runTurn: async ({ timeoutMs }) => {
        budgets.push(timeoutMs)
        attempts++
        now += attempts < 3 ? 1_800_000 : 100
        if (attempts < 3) throw failure
        return { turnId: "turn-three", status: "completed" }
      } },
    })

    expect(result.attempts).toBe(3)
    expect(budgets).toEqual([1_800_000, 1_800_000, 1_800_000])
  })

  it.each([
    Object.assign(new Error("kernel deadline detail"), { name: "AppServerTimeoutError" }),
    Object.assign(new Error("transport deadline detail"), { code: "APP_SERVER_TIMEOUT" }),
  ])("maps a real kernel timeout to the stable proposal timeout code", async (timeoutError) => {
    const readChangedPaths = vi.fn(async () => ["examples/hello-application/src/app.js"])
    const runTurn = vi.fn(async () => { throw timeoutError })

    await expect(service.runGovernedResidentChange({
      threadId: "thread-one",
      requestText: "Report a stable resident timeout",
      readChangedPaths,
      client: { runTurn },
    })).rejects.toThrow("HELLO_PROPOSAL_RESIDENT_TIMEOUT")

    expect(runTurn).toHaveBeenCalledOnce()
    expect(readChangedPaths).not.toHaveBeenCalled()
  })

  it("does not begin another resident retry after the aggregate deadline is exhausted", async () => {
    const failure = Object.assign(new Error("invalid"), { name: "AppServerTurnEndedError", status: "failed", detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:sentinel_missing" })
    let now = 20_000
    const budgets: number[] = []

    await expect(service.runGovernedResidentChange({
      threadId: "thread-one",
      requestText: "Stop at the aggregate deadline",
      timeoutMs: 5_400_000,
      now: () => now,
      readChangedPaths: async () => ["examples/hello-application/src/app.js"],
      client: { runTurn: async ({ timeoutMs }) => {
        budgets.push(timeoutMs)
        now += 3_600_001
        throw failure
      } },
    })).rejects.toThrow("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
    expect(budgets).toEqual([1_800_000])
  })

  it.each(["evidence verification", "changed-path inspection"])("enforces the resident deadline across slow %s", async (phase) => {
    let now = 30_000
    let pathReads = 0

    await expect(service.runGovernedResidentChange({
      threadId: "thread-one",
      requestText: "Bound the complete resident attempt",
      timeoutMs: 5_400_000,
      now: () => now,
      verifyAttempt: async () => { if (phase === "evidence verification") now += 5_400_000 },
      readChangedPaths: async () => {
        pathReads++
        if (phase === "changed-path inspection") now += 5_400_000
        return ["examples/hello-application/src/app.js"]
      },
      client: { runTurn: async () => ({ turnId: "turn-one", status: "completed" }) },
    })).rejects.toThrow("HELLO_PROPOSAL_RESIDENT_TIMEOUT")

    expect(pathReads).toBe(phase === "evidence verification" ? 0 : 1)
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
        if (mode === "missing_record" && attempt === 1) session.turns.shift()
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
      expect(proposal.turnId).toBe(runIds[0])
      expect(attempt).toBe(1)
      const session = JSON.parse(fs.readFileSync(path.join(setup.runtimeRoot, "hermes-kernel", "threads", threadId, "session.json"), "utf8"))
      expect(session.turns).toHaveLength(1)
      expect(session.turns[0]).toMatchObject({ turnId: runIds[0], exitCode: 0, harvested: false })
    } else await expect(result).rejects.toThrow(mode === "ignored" || mode === "null" ? "HELLO_PROPOSAL_IGNORED_PATH_REFUSED" : "HELLO_PROPOSAL_RESIDENT_EVIDENCE_INVALID")
  })

  it("accepts one real-kernel edit after its malformed self-report without a correction turn", async () => {
    const setup = fixture()
    fs.mkdirSync(setup.runtimeRoot)
    const policyPath = path.join(setup.repositoryRoot, "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json")
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"))
    policy.placement.allowedWorkspaceRoots = [path.join(setup.runtimeRoot, "worktrees")]
    fs.writeFileSync(policyPath, JSON.stringify(policy))
    const invokerPath = path.join(setup.runtimeRoot, "fake-invoker.ps1")
    fs.writeFileSync(invokerPath, "# command runner injected in test\n")
    const turnBudgets: number[] = []
    let attempt = 0
    vi.spyOn(ResidentModelExecutionBackend.prototype, "runCodexClient").mockImplementation(async ({ workspacePath, timeoutMs }: any) => createHermesKernelClient({
      workspacePath,
      runtimeRoot: setup.runtimeRoot,
      policyPath,
      invokerPath,
      timeoutMs,
      commandRunner: async ({ command, args, cwd, timeoutMs: turnTimeoutMs }: { command: string; args: string[]; cwd: string; timeoutMs: number }) => {
        if (command === "git") return { code: 0, stdout: execFileSync(command, args, { cwd, encoding: "utf8", windowsHide: true }), stderr: "" }
        attempt++
        turnBudgets.push(turnTimeoutMs)
        const runId = args[args.indexOf("-RunId") + 1]
        if (attempt === 1) {
          fs.appendFileSync(sourcePath(workspacePath, "examples/hello-application/src/app.js"), "\n/* retained correction edit */\n")
          return { code: 0, stderr: "", stdout: `Session: session-one\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=fixture\n` }
        }
        const output = { result: "READY_FOR_VALIDATION", workOrder: "WO-1", branch: "codex/x", commit: null, prUrl: null,
          merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0, ownerTouchCount: 0,
          blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE", blockedAction: null,
          authorityBoundary: null, minimumChoice: null, approveConsequence: null, denyConsequence: null, findings: [] }
        return { code: 0, stderr: "", stdout: `Session: session-one\nHERMES_TURN_OUTPUT runId=${runId}\n${JSON.stringify(output)}\nHERMES_TURN_OUTPUT_END\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=fixture\n` }
      },
    } as any))

    const proposal = await createHelloApplicationProposal({
      ...setup,
      requestedBy: "owner",
      requestText: "Preserve the edit after one malformed self-report",
      validateWorkspace: validation,
    })

    expect(proposal.reviewPatch).toContain("retained correction edit")
    expect(turnBudgets).toEqual([1_800_000])
    const threadsRoot = path.join(setup.runtimeRoot, "hermes-kernel", "threads")
    const session = JSON.parse(fs.readFileSync(path.join(threadsRoot, fs.readdirSync(threadsRoot)[0], "session.json"), "utf8"))
    expect(session.turns).toHaveLength(1)
    expect(session.turns[0]).toMatchObject({ turnId: proposal.turnId, exitCode: 0, harvested: false })
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
  }, 15_000)

  it("publishes APPLY_IN_PROGRESS before validation and refuses another Apply while active", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    let validationStarted!: () => void
    let releaseValidation!: () => void
    const started = new Promise<void>((resolve) => { validationStarted = resolve })
    const release = new Promise<void>((resolve) => { releaseValidation = resolve })
    const firstApply = applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId,
      validateWorkspace: async () => { validationStarted(); await release; return validation() },
    })
    await started
    let secondOutcome: Promise<string> | undefined
    try {
      const current = getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId })
      expect(current).toMatchObject({
        status: "APPLY_IN_PROGRESS",
        applyStartedAt: expect.any(String),
        reviewPatch: proposal.reviewPatch,
      })
      expect(new Date(current.applyStartedAt).toISOString()).toBe(current.applyStartedAt)
      expect(service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })[0].status).toBe("APPLY_IN_PROGRESS")

      secondOutcome = applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })
        .then(() => "unexpected success", (error: Error) => error.message)
      const settled = await Promise.race([
        secondOutcome,
        new Promise<string>((resolve) => setTimeout(() => resolve("still queued"), 100)),
      ])
      expect(settled).toBe("HELLO_PROPOSAL_NOT_APPLICABLE")
    } finally {
      releaseValidation()
      await firstApply
      await secondOutcome
    }
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("APPLIED")
  })

  it("claims proposal B before applyQueue while proposal A is still validating", async () => {
    const setup = fixture()
    const first = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    const second = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update focus styling",
      residentTurn: residentChange(["examples/hello-application/src/styles.css"]), validateWorkspace: validation,
    })
    let firstValidationStarted!: () => void
    let releaseFirstValidation!: () => void
    const started = new Promise<void>((resolve) => { firstValidationStarted = resolve })
    const release = new Promise<void>((resolve) => { releaseFirstValidation = resolve })
    const firstApply = applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: first.proposalId,
      validateWorkspace: async () => { firstValidationStarted(); await release; return validation() },
    })
    await started
    const secondOutcome = applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: second.proposalId, validateWorkspace: validation })
      .then((value) => ({ value }), (error: Error) => ({ error }))
    try {
      expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: second.proposalId }).status).toBe("APPLY_IN_PROGRESS")
      expect(service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })
        .find((proposal) => proposal.proposalId === second.proposalId)?.status).toBe("APPLY_IN_PROGRESS")
    } finally {
      releaseFirstValidation()
      await firstApply
    }
    const result = await secondOutcome
    expect("error" in result ? result.error.message : "unexpected success").toBe("HELLO_PROPOSAL_STALE_BASE")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: second.proposalId }).status).toBe("READY_FOR_REVIEW")
  }, 15_000)

  it("exclusively claims a synthetic receipt across independent processes without a second mutation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hello-proposal-claim-"))
    roots.push(root)
    const runtimeRoot = path.join(root, "runtime")
    const proposalRoot = path.join(runtimeRoot, "hello-application-proposals")
    const proposalId = "44444444-4444-4444-8444-444444444444"
    const patch = Buffer.from("synthetic review evidence\n")
    const requestText = "Synthetic exclusive claim"
    const progress = [
      ["accepted", "Request accepted", "2026-09-20T01:00:00.000Z"],
      ["workspace_ready", "Isolated workspace ready", "2026-09-20T01:00:01.000Z"],
      ["resident_started", "HERMES is editing the isolated workspace", "2026-09-20T01:00:02.000Z"],
      ["resident_finished", "HERMES editing finished", "2026-09-20T01:00:03.000Z"],
      ["validation_started", "Contained validation started", "2026-09-20T01:00:04.000Z"],
      ["ready_for_review", "Proposal ready for review", "2026-09-20T01:00:05.000Z"],
    ].map(([stage, detail, at]) => ({ stage, detail, at }))
    const receipt = {
      schemaVersion: 2, proposalId, status: "READY_FOR_REVIEW", requestedBy: "owner", requestText,
      requestSha256: crypto.createHash("sha256").update(requestText).digest("hex"), executionNode: "synthetic-node",
      progress, createdAt: "2026-09-20T00:59:59.000Z", appliedAt: null, appliedCommit: null,
      baseSha: "a".repeat(40), proposalCommit: "b".repeat(40), branch: `codex/hermes-hello-${proposalId}`,
      changedPaths: ["examples/hello-application/src/index.html"], patchSha256: crypto.createHash("sha256").update(patch).digest("hex"),
      threadId: "thread-synthetic", turnId: "turn-synthetic", model: "synthetic-model",
      validation: { status: "passed", command: "node --test examples/hello-application/test/hello.test.mjs", output: "synthetic pass" },
    }
    fs.mkdirSync(proposalRoot, { recursive: true })
    fs.writeFileSync(path.join(proposalRoot, `${proposalId}.json`), `${JSON.stringify(receipt, null, 2)}\n`)
    fs.writeFileSync(path.join(proposalRoot, `${proposalId}.patch`), patch)
    const gate = path.join(root, "start")
    const mutation = path.join(root, "mutations")
    const readyOne = path.join(root, "ready-one")
    const readyTwo = path.join(root, "ready-two")
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/hello-application/proposal-service.mjs")).href
    const script = `
      import fs from "node:fs";
      import * as service from ${JSON.stringify(moduleUrl)};
      fs.writeFileSync(process.env.CLAIM_READY, "ready");
      while (!fs.existsSync(process.env.CLAIM_GATE)) await new Promise(resolve => setTimeout(resolve, 2));
      let outcome;
      try {
        const claim = service.claimHelloApplicationProposal({ runtimeRoot: process.env.CLAIM_RUNTIME, proposalId: process.env.CLAIM_ID, requestedBy: "owner" });
        fs.appendFileSync(process.env.CLAIM_MUTATION, process.pid + "\\n");
        outcome = { state: "claimed", status: claim.marker.status };
      } catch (error) {
        outcome = { state: "refused", error: error instanceof Error ? error.message : String(error) };
      }
      console.log(JSON.stringify(outcome));
    `
    const common = { CLAIM_RUNTIME: runtimeRoot, CLAIM_ID: proposalId, CLAIM_GATE: gate, CLAIM_MUTATION: mutation }
    const one = runClaimProcess(script, { ...common, CLAIM_READY: readyOne })
    const two = runClaimProcess(script, { ...common, CLAIM_READY: readyTwo })
    await vi.waitFor(() => {
      expect(fs.existsSync(readyOne)).toBe(true)
      expect(fs.existsSync(readyTwo)).toBe(true)
    })
    fs.writeFileSync(gate, "go")
    const children = await Promise.all([one, two])
    expect(children.map((child) => child.code)).toEqual([0, 0])
    const outcomes = children.map((child) => JSON.parse(child.stdout.trim()))
    expect(outcomes.map((outcome) => outcome.state).sort()).toEqual(["claimed", "refused"])
    expect(outcomes.find((outcome) => outcome.state === "claimed")).toMatchObject({ status: "APPLY_IN_PROGRESS" })
    expect(outcomes.find((outcome) => outcome.state === "refused")).toMatchObject({ error: "HELLO_PROPOSAL_NOT_APPLICABLE" })
    expect(fs.readFileSync(mutation, "utf8").trim().split("\n")).toHaveLength(1)
    expect(JSON.parse(fs.readFileSync(path.join(proposalRoot, `${proposalId}.inflight`), "utf8"))).toMatchObject({
      proposalId,
      status: "APPLY_IN_PROGRESS",
    })
  })

  it("claims synchronously and cleans its exact marker when repository preflight fails", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    const marker = path.join(setup.runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.inflight`)
    const attempt = applyHelloApplicationProposal({ ...setup, repositoryRoot: path.join(setup.repositoryRoot, "missing"),
      requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
    }).then(() => ({ error: "unexpected success" }), (error: Error) => ({ error: error.message }))

    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("APPLY_IN_PROGRESS")
    const outcome = await attempt
    expect(outcome.error).not.toBe("unexpected success")
    expect(fs.existsSync(marker)).toBe(false)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("READY_FOR_REVIEW")
  })

  it("releases A without observing or quarantining successor B after the exact delete", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    const proposalRoot = path.join(setup.runtimeRoot, "hello-application-proposals")
    const marker = path.join(proposalRoot, `${proposal.proposalId}.inflight`)
    const quarantine = path.join(proposalRoot, `${proposal.proposalId}.quarantine`)
    const childReady = path.join(setup.runtimeRoot, "successor-ready")
    const releaseGate = path.join(setup.runtimeRoot, "release-successor")
    const startGate = path.join(setup.runtimeRoot, "start-successor")
    const claimed = path.join(setup.runtimeRoot, "successor-claimed")
    const validating = path.join(setup.runtimeRoot, "successor-validating")
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/hello-application/proposal-service.mjs")).href
    const script = `
      import fs from "node:fs";
      import { applyHelloApplicationProposal } from ${JSON.stringify(moduleUrl)};
      fs.writeFileSync(process.env.SUCCESSOR_READY, "ready");
      while (!fs.existsSync(process.env.SUCCESSOR_START)) await new Promise(resolve => setTimeout(resolve, 2));
      while (fs.existsSync(process.env.SUCCESSOR_MARKER)) await new Promise(resolve => setTimeout(resolve, 2));
      const attempt = applyHelloApplicationProposal({
        repositoryRoot: process.env.SUCCESSOR_REPOSITORY,
        runtimeRoot: process.env.SUCCESSOR_RUNTIME,
        requestedBy: "owner",
        proposalId: process.env.SUCCESSOR_ID,
        validateWorkspace: async () => {
          fs.writeFileSync(process.env.SUCCESSOR_VALIDATING, "validating");
          while (!fs.existsSync(process.env.SUCCESSOR_RELEASE)) await new Promise(resolve => setTimeout(resolve, 2));
          return ${JSON.stringify(await validation())};
        },
      });
      fs.writeFileSync(process.env.SUCCESSOR_CLAIMED, "claimed");
      let outcome;
      try { outcome = { value: await attempt }; }
      catch (error) { outcome = { error: error instanceof Error ? error.message : String(error) }; }
      console.log(JSON.stringify(outcome));
    `
    const successor = runClaimProcess(script, {
      SUCCESSOR_READY: childReady,
      SUCCESSOR_START: startGate,
      SUCCESSOR_MARKER: marker,
      SUCCESSOR_REPOSITORY: setup.repositoryRoot,
      SUCCESSOR_RUNTIME: setup.runtimeRoot,
      SUCCESSOR_ID: proposal.proposalId,
      SUCCESSOR_CLAIMED: claimed,
      SUCCESSOR_VALIDATING: validating,
      SUCCESSOR_RELEASE: releaseGate,
    })
    await vi.waitFor(() => expect(fs.existsSync(childReady)).toBe(true))

    const remove = fs.rmSync
    const unlink = fs.unlinkSync
    const waitForSuccessor = () => waitForFileSync(claimed)
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      const result = remove(target, options)
      if (String(target) === marker) waitForSuccessor()
      return result
    })
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      const result = unlink(target)
      if (String(target) === marker) waitForSuccessor()
      return result
    })

    const firstAttempt = applyHelloApplicationProposal({ ...setup, repositoryRoot: path.join(setup.repositoryRoot, "missing"),
      requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
    }).then(() => ({ error: "unexpected success" }), (error: Error) => ({ error: error.message }))
    fs.writeFileSync(startGate, "start")
    try {
      const first = await firstAttempt
      expect(first.error).toContain("ENOENT")
      await vi.waitFor(() => expect(fs.existsSync(validating)).toBe(true), { timeout: 10_000 })
      expect(fs.existsSync(quarantine)).toBe(false)
      expect(fs.readdirSync(proposalRoot).some((name) => name.endsWith(".release"))).toBe(false)
      expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("APPLY_IN_PROGRESS")
    } finally {
      fs.writeFileSync(releaseGate, "release")
    }
    const child = await successor
    expect(child.code).toBe(0)
    const outcome = JSON.parse(child.stdout.trim())
    expect(outcome.error).toBeUndefined()
    expect(outcome.value.status).toBe("APPLIED")
    expect(fs.existsSync(quarantine)).toBe(false)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("APPLIED")
  })

  it("quarantines when the exact public claim unlink fails", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    const marker = path.join(setup.runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.inflight`)
    const unlink = fs.unlinkSync
    let attempted = false
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (String(target) === marker) {
        attempted = true
        throw new Error("claim unlink failed")
      }
      return unlink(target)
    })

    const outcome = await applyHelloApplicationProposal({ ...setup, repositoryRoot: path.join(setup.repositoryRoot, "missing"),
      requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
    }).then(() => ({ error: "unexpected success" }), (error: Error) => ({ error: error.message }))

    expect(attempted).toBe(true)
    expect(outcome.error).toBe("HELLO_PROPOSAL_ROLLBACK_FAILED")
    expect(fs.existsSync(marker)).toBe(true)
    expect(fs.readdirSync(path.dirname(marker)).some((name) => name.endsWith(".release"))).toBe(false)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
  })

  it("never removes a changed claim marker when queued preflight fails", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    const marker = path.join(setup.runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.inflight`)
    const attempt = applyHelloApplicationProposal({ ...setup, repositoryRoot: path.join(setup.repositoryRoot, "missing"),
      requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
    }).then(() => ({ error: "unexpected success" }), (error: Error) => ({ error: error.message }))
    const foreign = Buffer.from('{"foreign":"claim"}\n')
    expect(fs.existsSync(marker)).toBe(true)
    fs.writeFileSync(marker, foreign)

    const outcome = await attempt
    expect(outcome.error).toBe("HELLO_PROPOSAL_ROLLBACK_FAILED")
    expect(fs.readFileSync(marker)).toEqual(foreign)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
  })

  it("removes APPLY_IN_PROGRESS after a confirmed validation failure and restores READY", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update text",
      residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation,
    })
    const inflight = path.join(setup.runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.inflight`)
    const validateWorkspace = vi.fn(async () => {
      expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("APPLY_IN_PROGRESS")
      throw new Error("controlled validation failure")
    })

    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace }))
      .rejects.toThrow("controlled validation failure")

    expect(validateWorkspace).toHaveBeenCalledOnce()
    expect(fs.existsSync(inflight)).toBe(false)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("READY_FOR_REVIEW")
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

  it.each(["restore_file", "restore_index"])("preserves an external commit at the %s recovery boundary", async (boundary) => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const target = sourcePath(setup.repositoryRoot, proposal.changedPaths[0])
    let external: { head: string; index: string; bytes: Buffer } | undefined
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
      transactionOperations: { checkpoint: (stage: string) => {
        if (stage === (boundary === "restore_file" ? "published" : "index_synced")) throw new Error("start recovery")
        if (stage === boundary) {
          // The file race adopts the transaction's exact bytes; content equality is not ownership.
          if (boundary === "restore_index") fs.writeFileSync(target, "external owner committed bytes\n")
          git(setup.repositoryRoot, ["add", "--", proposal.changedPaths[0]])
          git(setup.repositoryRoot, ["commit", "-m", "owner adopts target during recovery"])
          external = { head: git(setup.repositoryRoot, ["rev-parse", "HEAD"]), index: git(setup.repositoryRoot, ["ls-files", "--stage"]), bytes: fs.readFileSync(target) }
        }
      } },
    })).rejects.toThrow("HELLO_PROPOSAL_ROLLBACK_FAILED")
    expect(external).toBeDefined()
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(external!.head)
    expect(git(setup.repositoryRoot, ["ls-files", "--stage"])).toBe(external!.index)
    expect(fs.readFileSync(target)).toEqual(external!.bytes)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
  })

  it("fails closed after an actual child process exits at published", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/hello-application/proposal-service.mjs")).href
    const script = `
      import { applyHelloApplicationProposal } from ${JSON.stringify(moduleUrl)};
      await applyHelloApplicationProposal({
        ...${JSON.stringify({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId })},
        validateWorkspace: async () => (${JSON.stringify(await validation())}),
        transactionOperations: { checkpoint: stage => { if (stage === "published") process.exit(86); } }
      });
    `
    let exitStatus: number | null = null
    try { execFileSync(process.execPath, ["--input-type=module", "-e", script], { windowsHide: true, timeout: 30_000, stdio: "pipe" }) }
    catch (error) { exitStatus = (error as { status: number }).status }
    expect(exitStatus).toBe(86)
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).not.toBe(proposal.baseSha)
    const prefix = path.join(setup.runtimeRoot, "hello-application-proposals", proposal.proposalId)
    expect(JSON.parse(fs.readFileSync(`${prefix}.json`, "utf8")).status).toBe("READY_FOR_REVIEW")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("APPLY_IN_PROGRESS")
    expect(service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })[0].status).toBe("APPLY_IN_PROGRESS")
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })).rejects.toThrow("HELLO_PROPOSAL_NOT_APPLICABLE")
    // APPLY_IN_PROGRESS is authoritative only while it remains bound to the stored READY receipt.
    fs.rmSync(`${prefix}.json`)
    expect(() => service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })).toThrow("HELLO_PROPOSAL_RECEIPT_INVALID")
  })

  it.each(["restore_file", "restore_index"])("preserves an external index-only change at %s", async (boundary) => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const target = sourcePath(setup.repositoryRoot, proposal.changedPaths[0])
    let ownerState: { index: string; bytes: Buffer } | undefined
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
      transactionOperations: { checkpoint: (stage: string) => {
        if (stage === (boundary === "restore_file" ? "published" : "index_synced")) throw new Error("start recovery")
        if (stage === boundary) {
          if (boundary === "restore_index") fs.writeFileSync(target, "external owner staged bytes\n")
          git(setup.repositoryRoot, ["add", "--", proposal.changedPaths[0]])
          ownerState = { index: git(setup.repositoryRoot, ["ls-files", "--stage"]), bytes: fs.readFileSync(target) }
        }
      } },
    })).rejects.toThrow("HELLO_PROPOSAL_ROLLBACK_FAILED")
    expect(ownerState).toBeDefined()
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
    expect(git(setup.repositoryRoot, ["ls-files", "--stage"])).toBe(ownerState!.index)
    expect(fs.readFileSync(target)).toEqual(ownerState!.bytes)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
  })

  it.each(["invalid_json", "bad_hash", "mismatched_projection"])("refuses a %s in-flight journal", async (corruption) => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const prefix = path.join(setup.runtimeRoot, "hello-application-proposals", proposal.proposalId)
    const journal = { ...JSON.parse(fs.readFileSync(`${prefix}.json`, "utf8")), status: "APPLY_IN_PROGRESS", applyStartedAt: new Date().toISOString() }
    if (corruption === "bad_hash") journal.requestSha256 = "0".repeat(64)
    if (corruption === "mismatched_projection") journal.requestedBy = "different owner"
    fs.writeFileSync(`${prefix}.inflight`, corruption === "invalid_json" ? "{" : JSON.stringify(journal))
    expect(() => getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId })).toThrow("HELLO_PROPOSAL_RECEIPT_INVALID")
    expect(() => service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })).toThrow("HELLO_PROPOSAL_RECEIPT_INVALID")
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })).rejects.toThrow("HELLO_PROPOSAL_RECEIPT_INVALID")
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("refuses journal publication failure before canonical mutation", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const open = fs.openSync
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      if (String(target).endsWith(".inflight") && flags === "wx") throw new Error("journal publication failed")
      return open(target, flags, mode)
    })
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation })).rejects.toThrow("journal publication failed")
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("READY_FOR_REVIEW")
    expect(fs.readdirSync(path.join(setup.runtimeRoot, "hello-application-proposals")).some((name) => /\.(?:tmp|inflight)$/.test(name))).toBe(false)
  })

  it("quarantines a partial exclusive claim write instead of restoring READY", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const write = fs.writeSync
    let injected = false
    vi.spyOn(fs, "writeSync").mockImplementation((descriptor, buffer, offset, length, position) => {
      if (!injected && Buffer.isBuffer(buffer) && buffer.toString("utf8").includes('"status": "APPLY_IN_PROGRESS"')) {
        injected = true
        write(descriptor, buffer, offset, Math.min(length, 16), position)
        throw new Error("partial claim write")
      }
      return write(descriptor, buffer, offset, length, position)
    })

    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation }))
      .rejects.toThrow("HELLO_PROPOSAL_ROLLBACK_FAILED")
    expect(injected).toBe(true)
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
  })

  it("retains authoritative quarantine when rollback journal removal fails", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const unlink = fs.unlinkSync
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (String(target).endsWith(".inflight")) throw new Error("journal removal failed")
      return unlink(target)
    })
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
      transactionOperations: { checkpoint: (stage: string) => { if (stage === "published") throw new Error("start recovery") } },
    })).rejects.toThrow("HELLO_PROPOSAL_ROLLBACK_FAILED")
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
  })

  it("persists the in-flight projection before canonical writes and lets APPLIED supersede failed marker cleanup", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    const inflight = path.join(setup.runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.inflight`)
    const original = fs.readFileSync(sourcePath(setup.repositoryRoot, proposal.changedPaths[0]))
    const unlink = fs.unlinkSync
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (String(target) === inflight) throw new Error("journal cleanup locked")
      return unlink(target)
    })
    let observed = false
    const applied = await applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId, validateWorkspace: validation,
      transactionOperations: { checkpoint: (stage: string) => {
        if (stage === "canonical_write") {
          observed = true
          expect(JSON.parse(fs.readFileSync(inflight, "utf8")).status).toBe("APPLY_IN_PROGRESS")
          expect(fs.readFileSync(sourcePath(setup.repositoryRoot, proposal.changedPaths[0]))).toEqual(original)
          expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("APPLY_IN_PROGRESS")
        }
      } },
    })
    expect(observed).toBe(true)
    expect(fs.existsSync(inflight)).toBe(true)
    expect(applied.status).toBe("APPLIED")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("APPLIED")
    expect(service.listHelloApplicationProposals({ ...setup, requestedBy: "owner" })[0].status).toBe("APPLIED")
  })

  it("recovers rather than finalizing a locked validation worktree after CAS", async () => {
    const setup = fixture()
    const proposal = await createHelloApplicationProposal({ ...setup, requestedBy: "owner", requestText: "Update footer", residentTurn: residentChange(["examples/hello-application/src/index.html"]), validateWorkspace: validation })
    let workspace = ""
    let sawPublished = false
    await expect(applyHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId,
      validateWorkspace: async ({ workspacePath }: { workspacePath: string }) => { workspace = workspacePath; return validation() },
      transactionOperations: { checkpoint: (stage: string) => {
        if (stage === "published") {
          sawPublished = git(setup.repositoryRoot, ["rev-parse", "HEAD"]) !== proposal.baseSha
          git(setup.repositoryRoot, ["worktree", "lock", workspace])
        }
      } },
    })).rejects.toThrow("HELLO_PROPOSAL_WORKTREE_CLEANUP_FAILED")
    expect(sawPublished).toBe(true)
    expect(fs.existsSync(workspace)).toBe(true)
    expect(git(setup.repositoryRoot, ["worktree", "list", "--porcelain"])).toContain(workspace.replaceAll("\\", "/"))
    expect(git(setup.repositoryRoot, ["rev-parse", "HEAD"])).toBe(proposal.baseSha)
    expect(git(setup.repositoryRoot, ["status", "--porcelain"])).toBe("")
    expect(getHelloApplicationProposal({ ...setup, requestedBy: "owner", proposalId: proposal.proposalId }).status).toBe("READY_FOR_REVIEW")
    expect(fs.existsSync(path.join(setup.runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.inflight`))).toBe(false)
    git(setup.repositoryRoot, ["worktree", "unlock", workspace])
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

  it("routes an explicitly approved Cerebras model without calling the local resident and persists schema-v3 execution truth", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    const residentTurn = vi.fn(async () => { throw new Error("local fallback must not run") })
    const cerebrasTurn = vi.fn(async ({ workspacePath, model }: { workspacePath: string; model: string }) => {
      fs.appendFileSync(sourcePath(workspacePath, "examples/hello-application/src/app.js"), "\n/* cerebras route */\n")
      fs.appendFileSync(sourcePath(workspacePath, "examples/hello-application/src/styles.css"), "\n/* cerebras route */\n")
      return {
        threadId: "cerebras-thread",
        turnId: "cerebras-turn",
        model,
        executionNode: "cerebras-api",
        ignoredPathsCreated: [],
        providerExecution: {
          route: "external",
          provider: "cerebras",
          bridgeNode: "hermes-node",
          inferenceNode: "cerebras-api",
          mode: "credential-bridge-one-shot",
          requestedModel: "qwen-3.8-27b",
          actualModel: "qwen-3.8-27b",
          externalEgress: true,
          promptTokens: 58,
          completionTokens: 50,
          totalTokens: 108,
          calculatedCostUsd: 0.00013192,
          maxCostUsd: 0.03,
          contextDigest: `sha256:${"a".repeat(64)}`,
          durationMs: 517,
        },
      }
    })
    const stages: Array<{ stage: string; detail: string }> = []

    const proposal = await createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      requestText: "Make a governed two-file external change",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalEgressApproved: true,
      externalRoutingEnabled: true,
      residentTurn,
      cerebrasTurn,
      validateWorkspace: validation,
      onProgress: ({ stage, detail }: { stage: string; detail: string }) => stages.push({ stage, detail }),
    })

    expect(residentTurn).not.toHaveBeenCalled()
    expect(cerebrasTurn).toHaveBeenCalledWith(expect.objectContaining({ model: "qwen-3.8-27b" }))
    expect(proposal).toMatchObject({
      schemaVersion: 3,
      status: "READY_FOR_REVIEW",
      model: "qwen-3.8-27b",
      executionNode: "cerebras-api",
      providerExecution: {
        provider: "cerebras",
        actualModel: "qwen-3.8-27b",
        calculatedCostUsd: 0.00013192,
        externalEgress: true,
      },
    })
    expect(stages.map((entry) => entry.detail)).toContain("HERMES sent the bounded request to Cerebras")
    expect(stages.map((entry) => entry.detail)).toContain("Cerebras returned a bounded change")

    const applied = await applyHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      validateWorkspace: validation,
    })
    expect(applied.status).toBe("APPLIED")
    expect(applied.providerExecution).toEqual(proposal.providerExecution)
  })

  it("never falls back to the local resident after an external route failure", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    const residentTurn = vi.fn(async () => { throw new Error("local fallback must not run") })
    const cerebrasTurn = vi.fn(async () => { throw new Error("EXTERNAL_API_OUTAGE") })

    await expect(createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      requestText: "Keep this request external",
      executionRoute: "cerebras-gpt-oss-120b",
      externalEgressApproved: true,
      externalRoutingEnabled: true,
      residentTurn,
      cerebrasTurn,
      validateWorkspace: validation,
    })).rejects.toThrow("EXTERNAL_API_OUTAGE")

    expect(cerebrasTurn).toHaveBeenCalledOnce()
    expect(residentTurn).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(runtimeRoot, "hello-application-proposals"))).toBe(false)
  })
})
