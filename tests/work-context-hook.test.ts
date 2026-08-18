import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import {
  CONSEQUENTIAL_COMMANDS,
  MUTATING_TOOLS,
  RECEIPT_RELATIVE_PATH,
  classifyToolCall,
  formatRefusal,
  isInside,
  reservationVerdict,
} from "../scripts/governance/work-context-hook.mjs"

const run = promisify(execFile)
const ROOT = "/repo"
const roots: string[] = []
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

const classify = (toolName: string, toolInput: Record<string, unknown>) =>
  classifyToolCall({ toolName, toolInput, projectRoot: ROOT })

describe("what the gate stops", () => {
  it("gates every tool whose purpose is to change a file", () => {
    for (const tool of MUTATING_TOOLS) {
      expect(classify(tool, { file_path: `${ROOT}/lib/thing.ts` }).gated).toBe(true)
    }
  })

  it("never gates reads -- gating them pushes an agent toward working blind", () => {
    for (const tool of ["Read", "Grep", "Glob", "WebFetch"]) {
      expect(classify(tool, { file_path: `${ROOT}/lib/thing.ts` }).gated).toBe(false)
    }
  })

  it("gates consequential shell commands", () => {
    for (const command of [
      "git commit -m x",
      "git push origin main",
      "gh pr merge 12 --squash",
      "gh pr create --title x",
      "git reset --hard origin/main",
      "rm -rf build",
      "npm publish",
    ]) {
      expect(classify("Bash", { command }).gated).toBe(true)
    }
  })

  it("leaves ordinary inspection commands alone, or the gate just relocates the work", () => {
    for (const command of ["git status", "git log --oneline -5", "npm test", "ls -la", "git diff"]) {
      expect(classify("Bash", { command }).gated).toBe(false)
    }
  })

  it("gates a mutating tool that arrives without a resolvable target rather than waving it through", () => {
    expect(classify("Write", {}).gated).toBe(true)
  })
})

describe("the two exemptions, which must not become bypasses", () => {
  it("does not gate writes outside the project root", () => {
    expect(classify("Write", { file_path: "/tmp/scratch/notes.md" }).gated).toBe(false)
  })

  it("allows writing the receipt itself, or context could never be established", () => {
    expect(classify("Write", { file_path: path.join(ROOT, RECEIPT_RELATIVE_PATH) }).gated).toBe(false)
  })

  it("does not exempt anything else under the receipt's directory", () => {
    expect(classify("Write", { file_path: path.join(ROOT, ".williamos", "other.json") }).gated).toBe(true)
  })

  it("does not let a traversal path escape the project root check", () => {
    expect(classify("Write", { file_path: path.join(ROOT, "lib", "..", "app", "x.ts") }).gated).toBe(true)
  })
})

describe("reservation is decided, not argued", () => {
  it("permits a mutation inside a reserved path", () => {
    expect(reservationVerdict(path.join(ROOT, "lib/fabric/x.mjs"), ["lib/fabric"], ROOT).ok).toBe(true)
  })

  it("refuses a mutation outside every reserved path, naming the file and the reservation", () => {
    const verdict = reservationVerdict(path.join(ROOT, "app/page.tsx"), ["lib/fabric"], ROOT)
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toContain("app")
    expect(verdict.detail).toContain("lib/fabric")
  })

  it("refuses when the receipt reserves nothing at all", () => {
    expect(reservationVerdict(path.join(ROOT, "a.ts"), [], ROOT).ok).toBe(false)
  })

  it("treats a reserved file as well as a reserved directory", () => {
    expect(reservationVerdict(path.join(ROOT, "package.json"), ["package.json"], ROOT).ok).toBe(true)
  })

  it("does not treat a prefix match as containment", () => {
    // "lib/fabric-old" must not satisfy a reservation of "lib/fabric".
    expect(reservationVerdict(path.join(ROOT, "lib/fabric-old/x.ts"), ["lib/fabric"], ROOT).ok).toBe(false)
  })
})

describe("isInside", () => {
  it("is true for a path equal to the root", () => {
    expect(isInside(ROOT, ROOT)).toBe(true)
  })

  it("is false for a sibling that shares a prefix", () => {
    expect(isInside("/repo/lib", "/repo/libextra/x")).toBe(false)
  })
})

describe("refusal message", () => {
  it("names the failed premise and how to establish it", () => {
    const message = formatRefusal({ failure: "FAILED_SCOPE_COLLISION", detail: "x is outside" })
    expect(message).toContain("FAILED_SCOPE_COLLISION")
    expect(message).toContain("x is outside")
    expect(message).toContain(RECEIPT_RELATIVE_PATH)
  })
})

describe("the hook as the harness actually runs it", () => {
  // The unit tests above prove the decisions; this proves the wiring -- exit code 2 is what makes
  // Claude Code block the call, so a hook that decided correctly and exited 0 would be inert.
  const hookPath = path.resolve(__dirname, "..", "scripts", "governance", "work-context-hook.mjs")

  const invoke = async (payload: string, projectRoot: string) => {
    const pending = run("node", [hookPath], {
      env: { ...process.env, WILLIAMOS_PROJECT_ROOT: projectRoot },
      timeout: 30_000,
    })
    pending.child.stdin?.end(payload)
    try {
      const { stdout, stderr } = await pending
      return { code: 0, stdout, stderr }
    } catch (error) {
      const failure = error as { code?: number; stderr?: string; stdout?: string }
      return { code: failure.code ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" }
    }
  }

  it("blocks a mutation with exit 2 when no receipt exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wc-hook-")); roots.push(root)
    const result = await invoke(
      JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(root, "lib", "x.ts") } }),
      root,
    )
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("FAILED_CONTEXT_NOT_PROVEN")
  })

  it("allows a read through untouched", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wc-hook-")); roots.push(root)
    const result = await invoke(
      JSON.stringify({ tool_name: "Read", tool_input: { file_path: path.join(root, "x.ts") } }),
      root,
    )
    expect(result.code).toBe(0)
  })

  it("blocks rather than opens the gate when the event cannot be parsed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wc-hook-")); roots.push(root)
    const result = await invoke("{not json", root)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("could not be parsed")
  })
})

describe("consequential command list", () => {
  it("is expressed as patterns so the set is reviewable rather than buried in a conditional", () => {
    expect(CONSEQUENTIAL_COMMANDS.length).toBeGreaterThan(5)
    expect(CONSEQUENTIAL_COMMANDS.every((pattern) => pattern instanceof RegExp)).toBe(true)
  })
})
