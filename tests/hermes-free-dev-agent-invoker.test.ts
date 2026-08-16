// tests/hermes-free-dev-agent-invoker.test.ts
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { afterEach, describe, expect, it } from "vitest"

const repoRoot = path.resolve(import.meta.dirname, "..")
const invokerPath = path.join(repoRoot, "scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1")
const invoker = () => fs.readFileSync(invokerPath, "utf8")

const powershellHost = () => ["pwsh", "powershell"].find((candidate) => {
  try { return spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8", windowsHide: true, timeout: 60_000 }).status === 0 }
  catch { return false }
})

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

const runId = "0000000000000000-run-1"

function laneFixture(mutate: (policy: any) => void = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-invoker-")); roots.push(root)
  const worktreesRoot = path.join(root, "worktrees"); fs.mkdirSync(worktreesRoot)
  const foreign = path.join(root, "foreign"); fs.mkdirSync(foreign)
  const policy = {
    schemaVersion: 2, packetSchemaVersion: 2, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001",
    model: { id: "williamos-qwen3-4b:64k" },
    placement: {
      workspaceMode: "OWNED_WORKTREE", allowedWorkspaceRoots: [worktreesRoot],
      dockerConfig: path.join(root, "docker-config"), composeProject: "williamos-hermes-agent",
    },
    execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"], promptMaxChars: 60000, timeoutSeconds: 1800 },
    build: { image: "williamos-hermes-agent:0.20.0-fa83af3", imageId: "sha256:0" },
    containment: { network: "williamos_free_agent_internal" },
    promotion: {
      status: "PILOT_AUTHORIZED",
      requiredEvidence: ["IMAGE_BUILD_PROVEN", "OWNED_WORKTREE_CONFINEMENT_PROVEN"],
      satisfiedEvidence: { IMAGE_BUILD_PROVEN: "sha256:0", OWNED_WORKTREE_CONFINEMENT_PROVEN: "bootstrap-owned-1" },
    },
  }
  mutate(policy)
  const policyPath = path.join(root, "policy.json"); fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2))
  const packetPath = path.join(root, "packet.json")
  fs.writeFileSync(packetPath, JSON.stringify({
    schemaVersion: 2, workOrderId: policy.workOrderId, model: policy.model.id, prompt: "Deliver WO-1.",
    maximumTurns: 20, toolsets: ["file", "terminal"], workspaceMode: "OWNED_WORKTREE", workspacePath: foreign, runId,
  }, null, 2))
  const composeFile = path.join(root, "compose.yaml"); fs.writeFileSync(composeFile, "")
  return { root, foreign, policyPath, packetPath, composeFile, quarantinePath: path.join(root, "Q") }
}

function runInvoker(host: string, fixture: ReturnType<typeof laneFixture>) {
  const result = spawnSync(host, [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", invokerPath,
    "-PacketPath", fixture.packetPath, "-PolicyPath", fixture.policyPath,
    "-WorkspacePath", fixture.foreign, "-RunId", runId,
    "-QuarantinePath", fixture.quarantinePath, "-ComposeFile", fixture.composeFile,
  ], { encoding: "utf8", windowsHide: true, timeout: 120_000 })
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` }
}

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
  it("retains the v1 packet field set, baseline wall, and completion line for BASELINE_CLONE policies", () => {
    const source = invoker()
    expect(source).toContain('@("maximumTurns", "model", "prompt", "schemaVersion", "toolsets", "workOrderId", "workspaceRoot")')
    expect(source).toContain("HERMES_FREE_AGENT_BASELINE_WALL")
    expect(source).toContain('Write-Output "HERMES_FREE_AGENT_COMPLETE runId=$runId workspace=$runWorkspace"')
  })
  it("takes the durable quarantine marker path from the caller and accepts a promoted policy", () => {
    const source = invoker()
    expect(source).toContain("[string]$QuarantinePath")
    expect(source).toContain("$markerPath = [IO.Path]::GetFullPath($QuarantinePath)")
    // PowerShell variable names are case-insensitive: an internal `$quarantinePath` would
    // alias — and destroy — the `$QuarantinePath` parameter.
    expect(source).not.toContain("$quarantinePath")
    expect(source).toContain("HERMES_FREE_AGENT_QUARANTINE_PATH_WALL")
    expect(source).toContain('$policy.promotion.status -ne "PILOT_AUTHORIZED" -and $policy.promotion.status -ne "PROMOTED"')
    expect(source).toContain("HERMES_FREE_AGENT_EVIDENCE_WALL")
    expect(source).toContain("HERMES_FREE_AGENT_WORKSPACE_CONTENT_WALL")
  })
  it("parses as PowerShell when a PowerShell host is available", () => {
    const host = powershellHost()
    if (!host) return
    const check = spawnSync(host, ["-NoProfile", "-Command", `$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath '${invokerPath.replace(/'/g, "''")}')); exit 0`], { encoding: "utf8", windowsHide: true, timeout: 60_000 })
    expect(check.status, check.stderr).toBe(0)
  })
})

// Behavioural proof that the owned-mode walls actually fire. Every wall exercised here is
// reached before the first `docker` call (mutex → quarantine → policy → packet → promotion →
// evidence → workspace), so no container runtime is needed. Windows-only: the invoker's path
// and named-mutex semantics are Win32.
describe("Hermes free development agent invoker — owned-mode walls fire before any Docker call", () => {
  const host = process.platform === "win32" ? powershellHost() : undefined
  it.runIf(host)("refuses a workspace outside the policy's allowed roots", () => {
    const { status, output } = runInvoker(host!, laneFixture())
    expect(status, output).not.toBe(0)
    expect(output).toContain("HERMES_FREE_AGENT_WORKSPACE_ROOT_WALL")
  })
  it.runIf(host)("refuses the lane while a declared evidence line is unproven", () => {
    const fixture = laneFixture((policy) => { policy.promotion.satisfiedEvidence.OWNED_WORKTREE_CONFINEMENT_PROVEN = null })
    const { status, output } = runInvoker(host!, fixture)
    expect(status, output).not.toBe(0)
    expect(output).toContain("HERMES_FREE_AGENT_EVIDENCE_WALL")
    expect(output).not.toContain("HERMES_FREE_AGENT_WORKSPACE_ROOT_WALL")
  })
  it.runIf(host)("refuses a pre-existing quarantine marker at the caller's path", () => {
    const fixture = laneFixture()
    fs.writeFileSync(fixture.quarantinePath, "ACTIVE_CONTAINER=x")
    const { status, output } = runInvoker(host!, fixture)
    expect(status, output).not.toBe(0)
    expect(output).toContain("HERMES_FREE_AGENT_QUARANTINE_WALL")
  })
})
