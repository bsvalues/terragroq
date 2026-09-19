import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  applyHelloApplicationProposal,
  createHelloApplicationProposal,
} from "@/lib/hello-application/proposal-service.mjs"

const roots: string[] = []

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
  git(repositoryRoot, ["init", "--initial-branch=main"])
  git(repositoryRoot, ["config", "user.name", "Test Owner"])
  git(repositoryRoot, ["config", "user.email", "owner@example.test"])
  fs.writeFileSync(path.join(repositoryRoot, "outside.txt"), "baseline\n")
  git(repositoryRoot, ["add", "."])
  git(repositoryRoot, ["commit", "-m", "hello baseline"])
  return { repositoryRoot, runtimeRoot }
}

describe("Hello Application governed HERMES proposals", () => {
  it("keeps the canonical source unchanged until explicit apply, then applies the exact tested multi-file patch", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    const canonicalHtml = path.join(repositoryRoot, "examples", "hello-application", "src", "index.html")
    const canonicalCss = path.join(repositoryRoot, "examples", "hello-application", "src", "styles.css")
    const htmlBefore = fs.readFileSync(canonicalHtml, "utf8")
    const cssBefore = fs.readFileSync(canonicalCss, "utf8")

    const proposal = await createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        const html = path.join(workspacePath, "examples", "hello-application", "src", "index.html")
        const css = path.join(workspacePath, "examples", "hello-application", "src", "styles.css")
        fs.writeFileSync(html, fs.readFileSync(html, "utf8").replace("data-hermes-state=\"placeholder\"", "data-hermes-state=\"placeholder\" data-governed=\"true\""))
        fs.appendFileSync(css, "\n[data-governed=\"true\"] { outline-color: #ff6b35; }\n")
        return { threadId: "thread-1", turnId: "turn-1", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })

    expect(proposal).toMatchObject({
      status: "READY_FOR_REVIEW",
      requestedBy: "owner",
      model: "williamos-qwen3-4b:64k",
      changedPaths: [
        "examples/hello-application/src/index.html",
        "examples/hello-application/src/styles.css",
      ],
      validation: expect.objectContaining({ status: "passed", command: "node --test examples/hello-application/test/hello.test.mjs" }),
    })
    expect(proposal.reviewPatch).toContain("diff --git")
    expect(proposal.reviewPatch).toContain("data-governed")
    expect(fs.readFileSync(canonicalHtml, "utf8")).toBe(htmlBefore)
    expect(fs.readFileSync(canonicalCss, "utf8")).toBe(cssBefore)
    expect(git(repositoryRoot, ["status", "--porcelain"])).toBe("")

    const applied = await applyHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
    })

    expect(applied).toMatchObject({ status: "APPLIED", changedPaths: proposal.changedPaths })
    expect(fs.readFileSync(canonicalHtml, "utf8")).toContain('data-governed="true"')
    expect(fs.readFileSync(canonicalCss, "utf8")).toContain("outline-color: #ff6b35")
    expect(git(repositoryRoot, ["diff", "--name-only"])).toBe([
      "examples/hello-application/src/index.html",
      "examples/hello-application/src/styles.css",
    ].join("\n"))
  })

  it("re-derives patch paths at apply and refuses a digest-valid patch that contains an unreserved path", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    const proposal = await createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", "index.html"), "\n<!-- reviewed -->\n")
        fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", "styles.css"), "\n/* reviewed */\n")
        return { threadId: "thread-scope", turnId: "turn-scope", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })
    const patchPath = path.join(runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.patch`)
    const receiptPath = path.join(runtimeRoot, "hello-application-proposals", `${proposal.proposalId}.json`)
    fs.writeFileSync(path.join(repositoryRoot, "outside.txt"), "tampered\n")
    const outsidePatch = execFileSync("git", ["-C", repositoryRoot, "diff", "--binary", "--full-index", "HEAD", "--", "outside.txt"])
    git(repositoryRoot, ["restore", "--source=HEAD", "--", "outside.txt"])
    const tamperedPatch = Buffer.concat([fs.readFileSync(patchPath), outsidePatch])
    fs.writeFileSync(patchPath, tamperedPatch)
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    receipt.patchSha256 = crypto.createHash("sha256").update(tamperedPatch).digest("hex")
    receipt.reviewPatch = tamperedPatch.toString("utf8")
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)

    await expect(applyHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
    })).rejects.toThrow("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
    expect(fs.readFileSync(path.join(repositoryRoot, "outside.txt"), "utf8").replaceAll("\r\n", "\n")).toBe("baseline\n")
  })

  it("rejects a resident turn that changes anything outside the exact Hello source reservation", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    await expect(createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        fs.writeFileSync(path.join(workspacePath, "outside.txt"), "escape")
        fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", "styles.css"), "\n/* one allowed change */\n")
        return { threadId: "thread-2", turnId: "turn-2", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })).rejects.toThrow("HELLO_PROPOSAL_PATH_REFUSED:outside.txt")
    expect(git(repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("rejects ignored writes and stale apply without mutating canonical source", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    await expect(createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", "index.html"), "\n<!-- one -->\n")
        fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", "styles.css"), "\n/* two */\n")
        return { threadId: "thread-3", turnId: "turn-3", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [".env"] }
      },
    })).rejects.toThrow("HELLO_PROPOSAL_IGNORED_PATH_REFUSED")

    const proposal = await createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", "index.html"), "\n<!-- safe -->\n")
        fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", "styles.css"), "\n/* safe */\n")
        return { threadId: "thread-4", turnId: "turn-4", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })
    fs.writeFileSync(path.join(repositoryRoot, "owner-note.txt"), "new head")
    git(repositoryRoot, ["add", "owner-note.txt"])
    git(repositoryRoot, ["commit", "-m", "advance canonical head"])

    await expect(applyHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      proposalId: proposal.proposalId,
    })).rejects.toThrow("HELLO_PROPOSAL_STALE_BASE")
    expect(fs.readFileSync(path.join(repositoryRoot, "examples", "hello-application", "src", "index.html"))).not.toContain("<!-- safe -->")
  })
})
