/**
 * The resident continuation runner as a CONTRACT (#1015).
 *
 * `TERRAFUSION_LOCALOPS_FIRST_PRODUCT_JOURNEY` was read as `BLOCKED_CODEX_PROVIDER`. It was not.
 * Measured on HERMES 2026-08-26, the cycle never reached lane selection at all:
 *
 *   - the scheduled task ran an ambient checkout (`terragroq-review`) that was dirty and 406/691
 *     lines divergent from `origin/main` in `williamos-adapters.mjs`
 *   - it passed `--env-file` straight through, so `192.168.88.5` won after ATLAS moved to `.8`,
 *     and every cycle died in `loadWorkOrders` with `connect ETIMEDOUT`
 *   - `resident-kernel-cli.mjs` collapsed that to the bare token `RESIDENT_KERNEL_WALL`, producing
 *     158 KB of a log that said the same unhelpful thing every five minutes
 *
 * Meanwhile the provider reroute was already proven in production -- `provider-status.json` records
 * WO-0030 dispatched to `claude` with `rerouted: true`. The blocker was deployment drift, not Codex.
 *
 * These assert the properties whose absence is invisible: a runner that executes unknown code, or
 * silently falls back to a stale address, looks exactly like one that works right up until its
 * evidence is trusted.
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

import {
  RESIDENT_KERNEL_DATABASE_CONNECT_WALL,
  RESIDENT_KERNEL_WALL,
  classifyResidentKernelFailure,
  formatResidentKernelFailure,
  sanitizeCause,
} from "../scripts/runtime-operator/resident-kernel-diagnostics.mjs"

const RUNNER = path.join(process.cwd(), "deploy", "hermes", "williamos-continuation", "start-williamos-continuation.ps1")
const CLI = path.join(process.cwd(), "scripts", "runtime-operator", "resident-kernel-cli.mjs")

const runnerText = fs.readFileSync(RUNNER, "utf8")
const cliText = fs.readFileSync(CLI, "utf8")

/** Drop comment-based help and `#` line comments, leaving only executable text. */
function executableOnly(text: string) {
  return text
    .replace(/<#[\s\S]*?#>/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n")
}

describe("the resident cycle runs a pinned, clean, known revision", () => {
  const code = executableOnly(runnerText)

  it("is declared in the repository rather than only as a hand-typed scheduled task", () => {
    expect(fs.existsSync(RUNNER)).toBe(true)
  })

  it("requires the source and its expected commit, with no defaults to fall back on", () => {
    // A default here would silently restore the ambient-checkout assumption.
    expect(code).toMatch(/\[Parameter\(Mandatory = \$true\)\]\[string\]\$Source/)
    expect(code).toMatch(/\[Parameter\(Mandatory = \$true\)\]\[string\]\$ExpectedCommit/)
    expect(code).not.toMatch(/\$Source\s*=\s*"/)
    expect(code).not.toMatch(/\$ExpectedCommit\s*=\s*"/)
  })

  it("refuses every way the source can be untrustworthy, before running the cycle", () => {
    const runIndex = code.indexOf("$node --no-warnings $cli")
    expect(runIndex).toBeGreaterThan(-1)
    for (const refusal of [
      "SOURCE_MISSING",
      "SOURCE_NOT_A_REPOSITORY",
      "SOURCE_NOT_WORKTREE_ROOT",
      "SOURCE_HEAD_UNREADABLE",
      "SOURCE_REVISION_DRIFT",
      "SOURCE_STATUS_UNREADABLE",
      "SOURCE_DIRTY",
      "SOURCE_MISSING_CLI",
    ]) {
      const at = code.indexOf(refusal)
      expect(at, `${refusal} must be reachable`).toBeGreaterThan(-1)
      expect(at, `${refusal} must refuse before the cycle runs`).toBeLessThan(runIndex)
    }
    expect(code).toMatch(/function Deny-Cycle[\s\S]*exit 1/)
  })

  it("proves the revision by comparing HEAD to the expected commit", () => {
    expect(code).toMatch(/\$head\.Output\s+-ine\s+\$ExpectedCommit/)
  })

  it("treats untracked files as drift too, not only tracked modifications", () => {
    // A stray script dropped into scripts/ changes what runs as surely as an edit does.
    expect(code).toMatch(/status",\s*"--porcelain/)
  })
})

describe("the resident cycle resolves its authority host instead of trusting a file", () => {
  const code = executableOnly(runnerText)

  it("calls the canonical resolver and exports only the resolved value", () => {
    expect(code).toContain("resolve-authority-registry-url.mjs")
    expect(code).toMatch(/\$env:DATABASE_URL\s*=\s*\$resolvedUrl/)
  })

  it("never passes the env file straight through to the kernel again", () => {
    // `--env-file` is precisely what let 192.168.88.5 outlive the lease change.
    expect(code).not.toContain("--env-file")
  })

  it("names no other machine by address in anything it executes", () => {
    const local = new Set(["127.0.0.1", "0.0.0.0"])
    const literals = (code.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []).filter((a) => !local.has(a))
    expect(literals).toEqual([])
  })

  it("refuses rather than starting when resolution fails", () => {
    const refusal = code.indexOf("AUTHORITY_HOST_UNRESOLVED")
    const runIndex = code.indexOf("$node --no-warnings $cli")
    expect(refusal).toBeGreaterThan(-1)
    expect(runIndex).toBeGreaterThan(refusal)
    expect(code).toContain("RESOLVED_URL_UNUSABLE")
  })

  it("never writes the resolved connection string anywhere durable", () => {
    expect(code).not.toMatch(/Write-Boot\s+"[^"]*\$resolvedUrl/)
    expect(code).not.toMatch(/Out-File[^\n]*\$resolvedUrl/)
    expect(code).not.toMatch(/Write-(Output|Host)[^\n]*\$resolvedUrl/)
  })

  it("neutralises PowerShell 5.1's native-stderr trap around both native calls", () => {
    expect(code).toMatch(/function Invoke-GitProbe[\s\S]*\$ErrorActionPreference\s*=\s*"Continue"/)
    expect(code).toMatch(/\$resolverExit\s*=\s*\$LASTEXITCODE/)
    expect(code).not.toMatch(/@resolverArgs\s+2>&1/)
  })
})

describe("an unknown failure stays about plumbing, and says what broke", () => {
  it("classifies a connection timeout as a database-connect wall, not a bare token", () => {
    const verdict = classifyResidentKernelFailure(
      Object.assign(new Error("connect ETIMEDOUT 192.168.88.5:15432"), { code: "ETIMEDOUT" }),
    )
    expect(verdict.wall).toBe(RESIDENT_KERNEL_DATABASE_CONNECT_WALL)
    expect(verdict.code).toBe("ETIMEDOUT")
    expect(verdict.cause).toContain("ETIMEDOUT")
  })

  it("recognises a connection failure from the message even with no code", () => {
    const verdict = classifyResidentKernelFailure(new Error("connect ECONNREFUSED 192.168.88.8:15432"))
    expect(verdict.wall).toBe(RESIDENT_KERNEL_DATABASE_CONNECT_WALL)
  })

  it("redacts the host identity while keeping the port and syscall legible", () => {
    const cause = sanitizeCause("connect ETIMEDOUT 192.168.88.5:15432")
    expect(cause).not.toContain("192.168.88.5")
    expect(cause).toContain("<authority-host>")
    expect(cause).toContain("15432")
    expect(cause).toContain("ETIMEDOUT")
  })

  it("never lets a connection string reach the log", () => {
    const cause = sanitizeCause("error for postgresql://williamos:hunter2@192.168.88.8:15432/williamos?sslmode=disable")
    expect(cause).not.toContain("hunter2")
    expect(cause).not.toContain("williamos:")
    expect(cause).toContain("<redacted-url>")
  })

  it("redacts lab hostnames but leaves loopback legible", () => {
    expect(sanitizeCause("connect EHOSTUNREACH hermes.local:3443")).toContain("<authority-host>")
    expect(sanitizeCause("connect ECONNREFUSED localhost:3100")).toContain("localhost")
  })

  it("passes an explicitly typed wall through under its own name", () => {
    const verdict = classifyResidentKernelFailure(new Error("AUTHORITY_ACTIVATION_WALL"))
    expect(verdict.wall).toBe("AUTHORITY_ACTIVATION_WALL")
    expect(verdict.typed).toBe(true)
  })

  it("still names the generic class for a genuinely unrecognised failure, but keeps the cause", () => {
    const verdict = classifyResidentKernelFailure(new Error("something nobody anticipated"))
    expect(verdict.wall).toBe(RESIDENT_KERNEL_WALL)
    expect(verdict.cause).toBe("something nobody anticipated")
  })

  it("formats one stable line carrying class, code and cause", () => {
    const line = formatResidentKernelFailure(
      classifyResidentKernelFailure(Object.assign(new Error("connect ETIMEDOUT 10.0.0.1:15432"), { code: "ETIMEDOUT" })),
    )
    expect(line).toMatch(/^RESIDENT_KERNEL_DATABASE_CONNECT_WALL code=ETIMEDOUT cause=/)
    expect(line.split("\n")).toHaveLength(1)
  })

  it("is what the CLI actually reports, so the log cannot regress to a bare token", () => {
    expect(cliText).toContain("classifyResidentKernelFailure")
    expect(cliText).toContain("formatResidentKernelFailure")
    // The old fallback built the token inline from a regex match; that must be gone.
    expect(cliText).not.toMatch(/\?\?\s*"RESIDENT_KERNEL_WALL"/)
  })

  it("keeps the owner-decision exit code tied to the same typed walls as before", () => {
    expect(cliText).toMatch(/AUTHORITY_ACTIVATION_WALL\|RUNTIME_READINESS_WALL/)
  })
})
