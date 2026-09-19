import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  applyHelloApplicationProposal,
  createHelloApplicationProposal,
  governedPrompt,
  runGovernedResidentChange,
} from "@/lib/hello-application/proposal-service.mjs"
import { applyGovernedMarkerChange } from "@/scripts/hello-application/apply-governed-marker-change.mjs"

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
  it("gives the resident an explicit file-edit contract and self-corrects an incomplete first turn", async () => {
    const prompt = governedPrompt()
    expect(prompt).toContain("If the codemod reports a drift error, stop")
    expect(prompt).toContain("node scripts/hello-application/apply-governed-marker-change.mjs")
    expect(prompt).toContain('id="governance-marker"')
    expect(prompt).toContain("git diff --name-only")
    expect(prompt).toContain("Do not substitute prose or fenced code blocks for file edits")

    let changedPaths: string[] = []
    const prompts: string[] = []
    const client = {
      async runTurn({ prompt: turnPrompt }: { prompt: string }) {
        prompts.push(turnPrompt)
        if (prompts.length === 2) {
          changedPaths = [
            "examples/hello-application/src/app.js",
            "examples/hello-application/src/index.html",
            "examples/hello-application/src/styles.css",
          ]
        }
        return { threadId: "thread-resident", turnId: `turn-${prompts.length}`, status: "completed" }
      },
    }

    const result = await runGovernedResidentChange({
      client,
      threadId: "thread-resident",
      readChangedPaths: async () => changedPaths,
      timeoutMs: 1_000,
    })

    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain("Actual changed paths: none")
    expect(prompts[1]).toContain("Make all three on-disk edits")
    expect(result.turn.turnId).toBe("turn-2")
    expect(result.changedPaths).toEqual(changedPaths)
  })

  it("recovers a resident completion-contract failure without retrying infrastructure walls", async () => {
    let calls = 0
    const changedPaths = [
      "examples/hello-application/src/app.js",
      "examples/hello-application/src/index.html",
      "examples/hello-application/src/styles.css",
    ]
    const prompts: string[] = []
    const invalidOutput = Object.assign(new Error("invalid resident output"), {
      name: "AppServerTurnEndedError",
      status: "failed",
      detail: "RESIDENT_MODEL_TURN_OUTPUT_INVALID:sentinel_missing",
    })
    const client = {
      async runTurn({ prompt }: { prompt: string }) {
        prompts.push(prompt)
        calls += 1
        if (calls === 1) throw invalidOutput
        return { threadId: "thread-recovery", turnId: "turn-recovered", status: "completed" }
      },
    }

    const result = await runGovernedResidentChange({
      client,
      threadId: "thread-recovery",
      readChangedPaths: async () => changedPaths,
      timeoutMs: 1_000,
    })

    expect(calls).toBe(2)
    expect(prompts[1]).toContain("All three required edits already exist on disk")
    expect(prompts[1]).not.toContain("Your first action must be")
    expect(prompts[1]).not.toContain("apply-governed-marker-change.mjs")
    expect(result.turn.turnId).toBe("turn-recovered")
  })

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
        applyGovernedMarkerChange({ repositoryRoot: workspacePath })
        return { threadId: "thread-1", turnId: "turn-1", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })

    expect(proposal).toMatchObject({
      status: "READY_FOR_REVIEW",
      requestedBy: "owner",
      model: "williamos-qwen3-4b:64k",
      changedPaths: [
        "examples/hello-application/src/app.js",
        "examples/hello-application/src/index.html",
        "examples/hello-application/src/styles.css",
      ],
      validation: expect.objectContaining({ status: "passed", command: "node --test examples/hello-application/test/hello.test.mjs" }),
    })
    expect(proposal.reviewPatch).toContain("diff --git")
    expect(proposal.reviewPatch).toContain("Governed by HERMES")
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
    expect(fs.readFileSync(canonicalHtml, "utf8")).toContain('id="governance-marker"')
    expect(fs.readFileSync(canonicalCss, "utf8")).toContain(".governance-marker {")
    expect(git(repositoryRoot, ["diff", "--name-only"])).toBe([
      "examples/hello-application/src/app.js",
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
        applyGovernedMarkerChange({ repositoryRoot: workspacePath })
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

  it("rejects an incomplete two-file resident change", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    await expect(createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", "index.html"), "\n<!-- incomplete -->\n")
        fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", "styles.css"), "\n/* incomplete */\n")
        return { threadId: "thread-two", turnId: "turn-two", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })).rejects.toThrow("HELLO_PROPOSAL_EXACT_FILE_SET_REQUIRED")
    expect(git(repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("rejects three allowed files when the governed marker semantics are absent", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    await expect(createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        for (const target of ["app.js", "index.html", "styles.css"]) {
          fs.appendFileSync(path.join(workspacePath, "examples", "hello-application", "src", target), "\n/* unrelated allowed edit */\n")
        }
        return { threadId: "thread-semantic", turnId: "turn-semantic", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })).rejects.toThrow("HELLO_PROPOSAL_GOVERNED_MARKER_INVALID")
    expect(git(repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("rejects a marker whose governed style contract was altered", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    await expect(createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        applyGovernedMarkerChange({ repositoryRoot: workspacePath })
        const stylesPath = path.join(workspacePath, "examples/hello-application/src/styles.css")
        const styles = fs.readFileSync(stylesPath, "utf8")
        fs.writeFileSync(stylesPath, styles.replace(
          /(\.governance-marker \{[\s\S]*?)background: var\(--porcelain\);/,
          "$1background: linear-gradient(red, blue);",
        ))
        return { threadId: "thread-style", turnId: "turn-style", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })).rejects.toThrow("HELLO_PROPOSAL_GOVERNED_MARKER_INVALID")
    expect(git(repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("rejects exact governed contract text hidden only inside comments", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    await expect(createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        fs.appendFileSync(path.join(workspacePath, "examples/hello-application/src/index.html"), [
          "\n<!--",
          '        <p class="status-value" id="pulse-status" data-hermes-state="placeholder">Awaiting WilliamOS connection</p>',
          '        <p id="governance-marker" class="governance-marker">Governed by HERMES · build ready</p>',
          "-->\n",
        ].join("\n"))
        fs.appendFileSync(path.join(workspacePath, "examples/hello-application/src/styles.css"), [
          "\n/*",
          ".governance-marker {",
          "  display: inline-flex;",
          "  margin: -1rem 0 2rem;",
          "  padding: 0.38rem 0.55rem;",
          "  border: 1px solid var(--steel);",
          "  background: var(--porcelain);",
          "  color: var(--graphite);",
          '  font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;',
          "  font-size: 0.72rem;",
          "  font-weight: 700;",
          "  letter-spacing: 0.035em;",
          "}",
          "*/\n",
        ].join("\n"))
        fs.appendFileSync(path.join(workspacePath, "examples/hello-application/src/app.js"), [
          "\n/*",
          '  const governanceMarker = root.getElementById("governance-marker")',
          '    const pulseNumber = String(snapshot.count).padStart(3, "0")',
          "    countOutput.textContent = pulseNumber",
          "    if (governanceMarker) governanceMarker.textContent = `Governed by HERMES · pulse ${pulseNumber}`",
          "*/\n",
        ].join("\n"))
        return { threadId: "thread-comments", turnId: "turn-comments", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })).rejects.toThrow("HELLO_PROPOSAL_GOVERNED_MARKER_INVALID")
    expect(git(repositoryRoot, ["status", "--porcelain"])).toBe("")
  })

  it("rejects a resident that moves the governed worktree head", async () => {
    const { repositoryRoot, runtimeRoot } = fixture()
    await expect(createHelloApplicationProposal({
      repositoryRoot,
      runtimeRoot,
      requestedBy: "owner",
      residentTurn: async ({ workspacePath }) => {
        for (const target of ["app.js", "index.html", "styles.css"]) {
          fs.appendFileSync(path.join(workspacePath, "examples/hello-application/src", target), "\n/* resident extra */\n")
        }
        git(workspacePath, ["add", "examples/hello-application/src"])
        git(workspacePath, ["commit", "-m", "resident moved head"])
        applyGovernedMarkerChange({ repositoryRoot: workspacePath })
        return { threadId: "thread-head", turnId: "turn-head", model: "williamos-qwen3-4b:64k", ignoredPathsCreated: [] }
      },
    })).rejects.toThrow("HELLO_PROPOSAL_RESIDENT_HEAD_MUTATED")
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
        applyGovernedMarkerChange({ repositoryRoot: workspacePath })
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
