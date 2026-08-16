// tests/hermes-free-dev-agent-invoker.test.ts
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

const repoRoot = path.resolve(import.meta.dirname, "..")
const invokerPath = path.join(repoRoot, "scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1")
const invoker = () => fs.readFileSync(invokerPath, "utf8")

describe("Hermes free development agent invoker (v2 owned-worktree mode)", () => {
  it("accepts WorkspacePath and RunId only in OWNED_WORKTREE mode and validates the workspace", () => {
    const source = invoker()
    expect(source).toContain("[string]$WorkspacePath")
    expect(source).toContain("[string]$RunId")
    expect(source).toContain('$policy.placement.workspaceMode -eq "OWNED_WORKTREE"')
    expect(source).toContain("HERMES_FREE_AGENT_WORKSPACE_MODE_WALL")
    expect(source).toContain("HERMES_FREE_AGENT_WORKSPACE_ROOT_WALL")
    expect(source).toContain("HERMES_FREE_AGENT_WORKSPACE_SYMLINK_WALL")
    expect(source).toContain("HERMES_FREE_AGENT_CANONICAL_REPOSITORY_WALL")
    expect(source).toContain("HERMES_FREE_AGENT_RUN_ID_WALL")
  })
  it("requires the exact v2 packet field set and the raised prompt budget", () => {
    const source = invoker()
    expect(source).toContain('@("maximumTurns", "model", "prompt", "runId", "schemaVersion", "toolsets", "workOrderId", "workspaceMode", "workspacePath")')
    expect(source).toContain("$policy.execution.promptMaxChars")
    expect(source).toContain('$packet.workspaceMode -ne "OWNED_WORKTREE"')
  })
  it("keeps the v1 baseline-clone path byte-for-byte for BASELINE_CLONE policies", () => {
    const source = invoker()
    expect(source).toContain('@("maximumTurns", "model", "prompt", "schemaVersion", "toolsets", "workOrderId", "workspaceRoot")')
    expect(source).toContain("HERMES_FREE_AGENT_BASELINE_WALL")
    expect(source).toContain('Write-Output "HERMES_FREE_AGENT_COMPLETE runId=$runId workspace=$runWorkspace"')
  })
  it("parses as PowerShell when a PowerShell host is available", () => {
    const host = ["pwsh", "powershell"].find((candidate) => spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8", windowsHide: true }).status === 0)
    if (!host) return
    const check = spawnSync(host, ["-NoProfile", "-Command", `$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath '${invokerPath.replace(/'/g, "''")}')); exit 0`], { encoding: "utf8", windowsHide: true, timeout: 60_000 })
    expect(check.status, check.stderr).toBe(0)
  })
})
