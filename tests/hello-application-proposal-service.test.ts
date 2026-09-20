import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  applyHelloApplicationProposal,
  createHelloApplicationProposal,
  getHelloApplicationProposal,
  governedPrompt,
} from "@/lib/hello-application/proposal-service.mjs"

const roots: string[] = []
const sourcePath = (root: string, relativePath: string) => path.join(root, ...relativePath.split("/"))

afterEach(() => {
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
  fs.writeFileSync(path.join(repositoryRoot, "owner-note.txt"), "baseline\n")
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
  })
})
