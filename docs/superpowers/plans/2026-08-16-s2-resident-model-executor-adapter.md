# S2 Resident-Model Executor Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ResidentModelExecutionBackend.runCodexClient` return a `CodexAppServerClient`-shaped adapter that drives the reviewed Hermes-Agent lane (policy v2, owned-worktree mode) and returns the orchestrator's turn JSON — with no new agent loop and no Docker in tests.

**Architecture:** New pure module `hermes-kernel-output.mjs` (harvest last fenced JSON block); new `hermes-kernel-client.mjs` (`createHermesKernelClient`: connect/startThread/resumeThread/runTurn/close, session dir per thread under `<runtimeRoot>/hermes-kernel/threads`, packet v2 → PowerShell invoker via the backend's `commandRunner`, error mapping onto existing `AppServer*` classes); `ResidentModelExecutionBackend.runCodexClient` wires it; policy v2 JSON + invoker v2 params; runbook section. Spec: `docs/superpowers/specs/2026-08-16-s2-resident-model-executor-adapter-design.md`.

**Tech Stack:** Node ESM (`.mjs`), vitest 4 (`tests/*.test.ts`), PowerShell invoker (not executed in CI), existing `scripts/hermes-bridge/*` seams.

## Global Constraints

- Selector unchanged: `WILLIAMOS_EXECUTOR === "resident-model"` (exact) — `execution-backend.mjs` `selectExecutionBackend`.
- Client surface = exactly `connect, startThread, resumeThread, runTurn, close` as consumed by `orchestrator.mjs:1558-1560, 1617-1665, 1718-1740, 2033`.
- Errors reuse `AppServerWallError`, `AppServerTimeoutError`, `AppServerTurnEndedError` from `scripts/hermes-bridge/app-server-client.mjs`.
- No Docker, PowerShell, or network in tests; the invoker is only string-inspected / parse-checked.
- Policy v2 file: `config/execution-fabric/hermes-free-dev-agent-v2.policy.json`; v1 untouched.
- Packet v2 exact fields: `schemaVersion, workOrderId, model, prompt, maximumTurns, toolsets, workspaceMode, workspacePath, runId`.
- Allowed workspace root (v2): the supervisor default `RuntimeRoot` for `bs` on HERMES-Windows (`supervisor.ps1:3` = `%USERPROFILE%\.williamos\hermes-bridge`) + `worktrees` → policy literal `C:\Users\bs\.williamos\hermes-bridge\worktrees`. The adapter derives the same from its own `runtimeRoot`. If the resident orchestrator on HERMES is launched with a different `-RuntimeRoot`, the P2 evidence line records it and the policy literal is corrected in the same reviewed change (the invoker fails closed on mismatch; it cannot silently accept another root).
- `resumeThread` fails closed unless policy `execution.sessionResumeProven === true` (false in P1).
- No fallback to Codex or cloud (RULE-0005). Fail closed everywhere.
- Commits: local only on branch `wo/s2-resident-executor-adapter`; owner pushes/PRs.
- Working rule (OMEN tooling): never write `\\` sequences through Bash heredocs — use the Write/Edit tools for source files.

---

### Task 1: Output harvester (pure)

**Files:**
- Create: `scripts/hermes-bridge/hermes-kernel-output.mjs`
- Test: `tests/hermes-kernel-output.test.ts`

**Interfaces:**
- Produces: `harvestTurnOutput(stdout: string): { ok: true, finalText: string } | { ok: false, reason: "NO_JSON_BLOCK" | "INVALID_JSON" | "NOT_AN_OBJECT" }`
  and `HERMES_FREE_AGENT_COMPLETE_PATTERN` (RegExp matching `HERMES_FREE_AGENT_COMPLETE runId=<id>`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/hermes-kernel-output.test.ts
import { describe, expect, it } from "vitest"

import { harvestTurnOutput, HERMES_FREE_AGENT_COMPLETE_PATTERN } from "../scripts/hermes-bridge/hermes-kernel-output.mjs"

const block = (body: string) => "```json\n" + body + "\n```"

describe("Hermes kernel output harvester", () => {
  it("returns the last fenced json object block as finalText", () => {
    const stdout = ["chatter", block('{"result":"A"}'), "more", block('{"result":"B","n":1}'), "HERMES_FREE_AGENT_COMPLETE runId=abc"].join("\n")
    expect(harvestTurnOutput(stdout)).toEqual({ ok: true, finalText: '{"result":"B","n":1}' })
  })
  it("accepts a bare final JSON object line when no fenced block exists", () => {
    expect(harvestTurnOutput('working...\n{"result":"READY_FOR_VALIDATION"}\n')).toEqual({ ok: true, finalText: '{"result":"READY_FOR_VALIDATION"}' })
  })
  it("fails closed on missing, invalid, or non-object output", () => {
    expect(harvestTurnOutput("nothing here")).toEqual({ ok: false, reason: "NO_JSON_BLOCK" })
    expect(harvestTurnOutput(block("{not json"))).toEqual({ ok: false, reason: "INVALID_JSON" })
    expect(harvestTurnOutput(block("[1,2]"))).toEqual({ ok: false, reason: "NOT_AN_OBJECT" })
    expect(harvestTurnOutput("")).toEqual({ ok: false, reason: "NO_JSON_BLOCK" })
  })
  it("tolerates CRLF and a language tag with trailing spaces", () => {
    expect(harvestTurnOutput("```json  \r\n{\"a\":1}\r\n```\r\n")).toEqual({ ok: true, finalText: '{"a":1}' })
  })
  it("recognises the invoker completion line", () => {
    expect(HERMES_FREE_AGENT_COMPLETE_PATTERN.test("HERMES_FREE_AGENT_COMPLETE runId=0123abcd workspace=D:\\x")).toBe(true)
    expect(HERMES_FREE_AGENT_COMPLETE_PATTERN.test("HERMES_FREE_AGENT_QUARANTINED")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/hermes-kernel-output.test.ts`
Expected: FAIL — cannot resolve `../scripts/hermes-bridge/hermes-kernel-output.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/hermes-bridge/hermes-kernel-output.mjs
/** Extracts the kernel's final turn JSON from invoker stdout. Pure; no IO. */

export const HERMES_FREE_AGENT_COMPLETE_PATTERN = /^HERMES_FREE_AGENT_COMPLETE runId=([A-Za-z0-9-]+)/m

const FENCE = /```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g

function classify(candidate) {
  let parsed
  try { parsed = JSON.parse(candidate) } catch { return { ok: false, reason: "INVALID_JSON" } }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "NOT_AN_OBJECT" }
  return { ok: true, finalText: candidate }
}

export function harvestTurnOutput(stdout) {
  const text = typeof stdout === "string" ? stdout : ""
  let last = null
  for (const match of text.matchAll(FENCE)) last = match[1]
  if (last !== null) return classify(last.trim())
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const tail = lines.at(-1)
  if (tail && tail.startsWith("{") && tail.endsWith("}")) return classify(tail)
  return { ok: false, reason: "NO_JSON_BLOCK" }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/hermes-kernel-output.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/hermes-bridge/hermes-kernel-output.mjs tests/hermes-kernel-output.test.ts
git commit -m "feat(s2): harvest the kernel's final turn JSON from invoker output"
```

---

### Task 2: Policy v2 (owned-worktree mode) + provider test

**Files:**
- Create: `config/execution-fabric/hermes-free-dev-agent-v2.policy.json`
- Modify: `tests/hermes-free-dev-agent-provider.test.ts` (append a v2 describe block)

**Interfaces:**
- Produces: policy v2 with `placement.workspaceMode`, `placement.allowedWorkspaceRoots`, `execution.promptMaxChars`, `execution.sessionResumeProven`, `packetSchemaVersion: 2`. Task 4 reads `workOrderId`, `model.id`, `execution.maximumTurns`, `execution.allowedToolsets`, `execution.promptMaxChars`, `execution.sessionResumeProven`, `placement.workspaceMode`, `promotion.status`.

- [ ] **Step 1: Write the failing test** (append to `tests/hermes-free-dev-agent-provider.test.ts`)

```ts
const policyV2 = () => JSON.parse(read("config/execution-fabric/hermes-free-dev-agent-v2.policy.json"))

describe("Hermes free development agent provider — v2 owned-worktree mode", () => {
  it("keeps every v1 containment and identity pin", () => {
    const v1 = policy(); const v2 = policyV2()
    expect(v2.schemaVersion).toBe(2)
    expect(v2.packetSchemaVersion).toBe(2)
    expect(v2.workOrderId).toBe(v1.workOrderId)
    expect(v2.providerId).toBe("hermes-agent-local-qwen-v2")
    expect(v2.runtime).toBe(v1.runtime)
    expect(v2.model).toEqual(v1.model)
    expect(v2.build).toEqual(v1.build)
    expect(v2.containment).toEqual(v1.containment)
    expect(v2.deniedActions).toEqual(v1.deniedActions)
    expect(v2.execution.allowedToolsets).toEqual(v1.execution.allowedToolsets)
    expect(v2.execution.maximumTurns).toBe(v1.execution.maximumTurns)
    expect(v2.execution.timeoutSeconds).toBe(v1.execution.timeoutSeconds)
  })
  it("admits only the orchestrator's owned worktrees as the run workspace", () => {
    const v2 = policyV2()
    expect(v2.placement).toMatchObject({
      controlNode: "omen",
      executionNode: "hermes-node",
      workspaceMode: "OWNED_WORKTREE",
      allowedWorkspaceRoots: ["C:\\Users\\bs\\.williamos\\hermes-bridge\\worktrees"],
    })
    expect(v2.placement.workspaceRoot).toBe(policy().placement.workspaceRoot)
  })
  it("raises the prompt budget for remediation prompts and keeps resume fail-closed", () => {
    const v2 = policyV2()
    expect(v2.execution.promptMaxChars).toBe(60000)
    expect(v2.execution.sessionResumeProven).toBe(false)
    expect(v2.containment.agentStatePersistence).toBe(false)
  })
  it("stays pilot-authorised pending independent review of the v2 mode", () => {
    const v2 = policyV2()
    expect(v2.promotion.status).toBe("PILOT_AUTHORIZED")
    expect(v2.promotion.requiredEvidence).toEqual([...policy().promotion.requiredEvidence, "OWNED_WORKTREE_CONFINEMENT_PROVEN"])
    expect(v2.promotion.satisfiedEvidence).toEqual({ ...policy().promotion.satisfiedEvidence, OWNED_WORKTREE_CONFINEMENT_PROVEN: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/hermes-free-dev-agent-provider.test.ts`
Expected: FAIL — ENOENT on the v2 policy file.

- [ ] **Step 3: Create the v2 policy** — copy v1 and apply exactly these edits (use the Write tool; keep every other key byte-identical to v1):
  - `"schemaVersion": 2`, add `"packetSchemaVersion": 2` after it
  - `"providerId": "hermes-agent-local-qwen-v2"`
  - in `placement`: add `"workspaceMode": "OWNED_WORKTREE"` and `"allowedWorkspaceRoots": ["C:\\Users\\bs\\.williamos\\hermes-bridge\\worktrees"]` (keep `workspaceRoot`, `baselineWorkspace`, `baselineCommit`)
  - in `execution`: add `"promptMaxChars": 60000` and `"sessionResumeProven": false`
  - in `promotion.requiredEvidence`: append `"OWNED_WORKTREE_CONFINEMENT_PROVEN"`; in `promotion.satisfiedEvidence`: add `"OWNED_WORKTREE_CONFINEMENT_PROVEN": null`

Verify structurally: `node -e` prints nothing on this box — instead run
`python -c "import json;p=json.load(open('config/execution-fabric/hermes-free-dev-agent-v2.policy.json'));print(p['placement']['workspaceMode'],p['execution']['promptMaxChars'])"` → `OWNED_WORKTREE 60000`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/hermes-free-dev-agent-provider.test.ts`
Expected: PASS (v1 6 + v2 4 tests).

- [ ] **Step 5: Commit**

```bash
git add config/execution-fabric/hermes-free-dev-agent-v2.policy.json tests/hermes-free-dev-agent-provider.test.ts
git commit -m "feat(s2): hermes free-dev-agent policy v2 — owned-worktree workspace mode, resume fail-closed"
```

---

### Task 3: Invoker v2 params (PowerShell) + static/parse test

**Files:**
- Modify: `scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1`
- Test: `tests/hermes-free-dev-agent-invoker.test.ts` (new)

**Interfaces:**
- Produces: invoker accepts `-WorkspacePath <path> -RunId <id>`; when policy `placement.workspaceMode` is `OWNED_WORKTREE` both are mandatory and packet must be v2 with the exact field set `maximumTurns, model, prompt, runId, schemaVersion, toolsets, workOrderId, workspaceMode, workspacePath`; completion line stays `HERMES_FREE_AGENT_COMPLETE runId=<RunId> workspace=<WorkspacePath>`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/hermes-free-dev-agent-invoker.test.ts`
Expected: FAIL on the first three tests (strings absent); the parse test passes.

- [ ] **Step 3: Implement invoker v2** — edits to `invoke-hermes-free-dev-agent.ps1` (Edit tool):

(a) `param(...)` — add after `$PolicyPath`:
```powershell
    ,[string]$WorkspacePath = ""
    ,[string]$RunId = ""
```

(b) Replace the packet-field / workspace validation block (currently the lines from `$expectedFields = @("maximumTurns", ...` through the `workspaceRoot` check) with a mode switch:
```powershell
    $ownedMode = ($policy.placement.workspaceMode -eq "OWNED_WORKTREE")
    if ($ownedMode) {
        $expectedFields = @("maximumTurns", "model", "prompt", "runId", "schemaVersion", "toolsets", "workOrderId", "workspaceMode", "workspacePath")
    } else {
        $expectedFields = @("maximumTurns", "model", "prompt", "schemaVersion", "toolsets", "workOrderId", "workspaceRoot")
    }
    $actualFields = @($packet.PSObject.Properties.Name | Sort-Object)
    if (Compare-Object $actualFields $expectedFields) { throw "HERMES_FREE_AGENT_PACKET_FIELDS_WALL" }
    $expectedSchema = if ($ownedMode) { 2 } else { 1 }
    if (-not ($packet.schemaVersion -is [int] -or $packet.schemaVersion -is [long]) -or $packet.schemaVersion -ne $expectedSchema) { throw "HERMES_FREE_AGENT_PACKET_SCHEMA_WALL" }
    if ($policy.promotion.status -ne "PILOT_AUTHORIZED") { throw "HERMES_FREE_AGENT_PROMOTION_WALL" }
    if ($packet.workOrderId -isnot [string] -or $packet.workOrderId -ne $policy.workOrderId) { throw "HERMES_FREE_AGENT_WORK_ORDER_WALL" }
    $promptMax = if ($ownedMode) { [int]$policy.execution.promptMaxChars } else { 16000 }
    if ($packet.prompt -isnot [string] -or [string]::IsNullOrWhiteSpace($packet.prompt) -or $packet.prompt.Length -gt $promptMax) { throw "HERMES_FREE_AGENT_PROMPT_WALL" }
    if ($packet.model -isnot [string] -or $packet.model -ne $policy.model.id) { throw "HERMES_FREE_AGENT_MODEL_WALL" }
    if (-not ($packet.maximumTurns -is [int] -or $packet.maximumTurns -is [long]) -or $packet.maximumTurns -lt 1 -or $packet.maximumTurns -gt $policy.execution.maximumTurns) { throw "HERMES_FREE_AGENT_TURN_WALL" }
    if ($ownedMode) {
        if ([string]::IsNullOrWhiteSpace($WorkspacePath) -or [string]::IsNullOrWhiteSpace($RunId)) { throw "HERMES_FREE_AGENT_WORKSPACE_MODE_WALL" }
        if ($RunId -notmatch '^[A-Za-z0-9-]{8,64}$' -or $packet.runId -ne $RunId) { throw "HERMES_FREE_AGENT_RUN_ID_WALL" }
        if ($packet.workspaceMode -ne "OWNED_WORKTREE" -or $packet.workspacePath -ne $WorkspacePath) { throw "HERMES_FREE_AGENT_WORKSPACE_MODE_WALL" }
        $resolvedWorkspace = [IO.Path]::GetFullPath($WorkspacePath)
        $allowed = @($policy.placement.allowedWorkspaceRoots | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' })
        if (-not ($allowed | Where-Object { $resolvedWorkspace.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) { throw "HERMES_FREE_AGENT_WORKSPACE_ROOT_WALL" }
        $cursor = $resolvedWorkspace
        while ($cursor -and $cursor -ne [IO.Path]::GetPathRoot($cursor)) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "HERMES_FREE_AGENT_WORKSPACE_SYMLINK_WALL" }
            $cursor = Split-Path -Parent $cursor
        }
        $toplevel = (git -C $resolvedWorkspace rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($toplevel)) { throw "HERMES_FREE_AGENT_WORKSPACE_ROOT_WALL" }
        $commonDir = (git -C $resolvedWorkspace rev-parse --path-format=absolute --git-common-dir 2>$null)
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commonDir)) { throw "HERMES_FREE_AGENT_WORKSPACE_ROOT_WALL" }
        $mainCheckout = Split-Path -Parent ([IO.Path]::GetFullPath($commonDir.Trim()).TrimEnd('\'))
        if ([IO.Path]::GetFullPath($toplevel.Trim()).TrimEnd('\') -ieq $mainCheckout) { throw "HERMES_FREE_AGENT_CANONICAL_REPOSITORY_WALL" }
    } else {
        if ($packet.workspaceRoot -isnot [string] -or $packet.workspaceRoot -ne $policy.placement.workspaceRoot) { throw "HERMES_FREE_AGENT_WORKSPACE_WALL" }
    }
```
Rationale for the canonical check (structural, no policy literal): owned worktrees created by `LocalExecutionBackend.prepareWorkspace` are `git worktree add` children of the canonical repository, so their `--git-common-dir` is `<canonical>\.git` while their `--show-toplevel` is the worktree path — the two differ. For the canonical checkout itself `--show-toplevel` equals the parent of `--git-common-dir`. Refuse exactly that equality. (Requires git ≥ 2.31 for `--path-format=absolute`; the HERMES invoker host already runs git for the baseline clone.)

(c) Workspace selection: replace
```powershell
    $runId = [guid]::NewGuid().ToString("N")
    ...
    $runWorkspace = Join-Path $runRoot $runId
```
with
```powershell
    if ($ownedMode) {
        $runId = $RunId
        $runWorkspace = $resolvedWorkspace
    } else {
        $runId = [guid]::NewGuid().ToString("N")
        $runWorkspace = Join-Path $runRoot $runId
    }
```
and guard the baseline clone (`$baseline`, `git clone` of `$baselineWorkspace`) with `if (-not $ownedMode) { ... }` so owned mode never clones.

(d) Preamble text: make the "You are operating only inside /workspace, a unique disposable clone…" sentence conditional:
```powershell
    $workspaceSentence = if ($ownedMode) { "You are operating only inside /workspace, the owned WilliamOS worktree for this Work Order. Change only the reserved paths named in the task." } else { "You are operating only inside /workspace, a unique disposable clone of the pinned WilliamOS baseline." }
```
and use `$workspaceSentence` in the here-string.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/hermes-free-dev-agent-invoker.test.ts tests/hermes-free-dev-agent-provider.test.ts`
Expected: PASS (parse check must pass on this Windows box with `powershell`).

- [ ] **Step 5: Commit**

```bash
git add scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1 tests/hermes-free-dev-agent-invoker.test.ts
git commit -m "feat(s2): invoker v2 — owned-worktree workspace mode with RunId, fail-closed workspace checks"
```

---

### Task 4: Kernel client — connect / startThread / resumeThread / close

**Files:**
- Create: `scripts/hermes-bridge/hermes-kernel-client.mjs`
- Test: `tests/hermes-kernel-client.test.ts`

**Interfaces:**
- Produces: `createHermesKernelClient({ workspacePath, runtimeRoot, commandRunner, policyPath?, invokerPath?, timeoutMs?, now?, powershellCommand?, randomUUID? })` returning `{ connect, startThread, resumeThread, runTurn, close }`; exported constants `HERMES_KERNEL_POLICY_RELATIVE = "config/execution-fabric/hermes-free-dev-agent-v2.policy.json"`, `HERMES_KERNEL_INVOKER_RELATIVE = "scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1"`, `HERMES_KERNEL_QUARANTINE_MARKER = "HERMES_FREE_AGENT_QUARANTINED"`; helper `kernelThreadsRoot(runtimeRoot)` → `<runtimeRoot>/hermes-kernel/threads`.
- Consumes: Task 1 `harvestTurnOutput`, `HERMES_FREE_AGENT_COMPLETE_PATTERN` (used in Task 5).

- [ ] **Step 1: Write the failing tests** (connect / threads / close)

```ts
// tests/hermes-kernel-client.test.ts
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { AppServerWallError } from "../scripts/hermes-bridge/app-server-client.mjs"
import {
  createHermesKernelClient,
  HERMES_KERNEL_QUARANTINE_MARKER,
  kernelThreadsRoot,
} from "../scripts/hermes-bridge/hermes-kernel-client.mjs"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

type Call = { command: string; args: string[]; cwd?: string; timeoutMs?: number; credentialAccess?: boolean }

function fixture(overrides: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kernel-")); roots.push(root)
  const runtimeRoot = path.join(root, "runtime")
  const workspacePath = path.join(runtimeRoot, "worktrees", "resident-1")
  fs.mkdirSync(workspacePath, { recursive: true })
  const policyDir = path.join(root, "policy"); fs.mkdirSync(policyDir)
  const policyPath = path.join(policyDir, "hermes-free-dev-agent-v2.policy.json")
  fs.writeFileSync(policyPath, JSON.stringify({
    schemaVersion: 2, packetSchemaVersion: 2, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001",
    model: { id: "williamos-qwen3-4b:64k" },
    placement: { workspaceMode: "OWNED_WORKTREE", allowedWorkspaceRoots: [path.join(runtimeRoot, "worktrees")] },
    execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"], promptMaxChars: 60000, sessionResumeProven: false, timeoutSeconds: 1800 },
    promotion: { status: "PILOT_AUTHORIZED" },
  }))
  const invokerPath = path.join(root, "invoke.ps1"); fs.writeFileSync(invokerPath, "# fake")
  const calls: Call[] = []
  const commandRunner = vi.fn(async (call: Call) => { calls.push(call); return { code: 0, stdout: "", stderr: "" } })
  const client = createHermesKernelClient({
    workspacePath, runtimeRoot, commandRunner, policyPath, invokerPath, timeoutMs: 1000,
    now: () => new Date("2026-08-16T20:00:00.000Z"), powershellCommand: "powershell",
    randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(),
    ...overrides,
  })
  return { root, runtimeRoot, workspacePath, policyDir, policyPath, invokerPath, calls, commandRunner, client }
}

describe("Hermes kernel client — lane checks and threads", () => {
  it("exposes exactly the client surface the orchestrator consumes", () => {
    const { client } = fixture()
    expect(Object.keys(client).sort()).toEqual(["close", "connect", "resumeThread", "runTurn", "startThread"])
    for (const name of ["connect", "startThread", "resumeThread", "runTurn", "close"]) expect(typeof (client as any)[name]).toBe("function")
  })
  it("connects when the lane is authorised, in owned-worktree mode, unquarantined, and the workspace is owned", async () => {
    const { client, calls } = fixture()
    await expect(client.connect()).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })
  it("fails closed on quarantine, wrong mode, unauthorised policy, foreign workspace, and symlinked workspace", async () => {
    const quarantined = fixture(); fs.writeFileSync(path.join(quarantined.policyDir, HERMES_KERNEL_QUARANTINE_MARKER), "ACTIVE_CONTAINER=x")
    await expect(quarantined.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_QUARANTINED" })
    await expect(quarantined.client.connect()).rejects.toBeInstanceOf(AppServerWallError)

    const clone = fixture(); const p = JSON.parse(fs.readFileSync(clone.policyPath, "utf8")); p.placement.workspaceMode = "BASELINE_CLONE"; fs.writeFileSync(clone.policyPath, JSON.stringify(p))
    await expect(clone.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE_MODE" })

    const revoked = fixture(); const q = JSON.parse(fs.readFileSync(revoked.policyPath, "utf8")); q.promotion.status = "REVOKED"; fs.writeFileSync(revoked.policyPath, JSON.stringify(q))
    await expect(revoked.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_NOT_AUTHORIZED" })

    const foreign = fixture({ workspacePath: os.tmpdir() })
    await expect(foreign.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE" })

    const linked = fixture(); const target = path.join(linked.root, "elsewhere"); fs.mkdirSync(target)
    const linkPath = path.join(linked.runtimeRoot, "worktrees", "linked"); fs.symlinkSync(target, linkPath, "junction")
    const viaLink = fixture({ runtimeRoot: linked.runtimeRoot, workspacePath: linkPath, policyPath: linked.policyPath })
    await expect(viaLink.client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_WORKSPACE" })
  })
  it("starts a thread as a session directory and refuses to resume until resume is proven", async () => {
    const { client, runtimeRoot, workspacePath } = fixture()
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath, approvalPolicy: "never", sandbox: "workspace-write", ephemeral: false })
    expect(threadId).toBe("00000000-0000-4000-8000-000000000001")
    const sessionPath = path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json")
    expect(JSON.parse(fs.readFileSync(sessionPath, "utf8"))).toEqual({
      schemaVersion: 1, threadId, workspacePath, createdAt: "2026-08-16T20:00:00.000Z", turns: [],
    })
    await expect(client.resumeThread(threadId, { cwd: workspacePath })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE" })
    await expect(client.resumeThread("unknown-thread", { cwd: workspacePath })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_UNKNOWN" })
    client.close(); client.close()
  })
  it("resumes only a known thread for the same workspace once resume is proven", async () => {
    const { client, policyPath, workspacePath, runtimeRoot } = fixture()
    const p = JSON.parse(fs.readFileSync(policyPath, "utf8")); p.execution.sessionResumeProven = true; fs.writeFileSync(policyPath, JSON.stringify(p))
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    await expect(client.resumeThread(threadId, { cwd: workspacePath })).resolves.toBe(threadId)
    const other = createHermesKernelClient({ workspacePath: path.join(runtimeRoot, "worktrees", "other"), runtimeRoot, commandRunner: async () => ({ code: 0, stdout: "", stderr: "" }), policyPath, invokerPath: path.join(runtimeRoot, "x.ps1") })
    fs.mkdirSync(path.join(runtimeRoot, "worktrees", "other"), { recursive: true })
    await expect(other.resumeThread(threadId, {})).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_WORKSPACE_MISMATCH" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/hermes-kernel-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (connect / threads / close; `runTurn` throws a placeholder wall until Task 5)

```js
// scripts/hermes-bridge/hermes-kernel-client.mjs
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { AppServerTimeoutError, AppServerTurnEndedError, AppServerWallError, sanitizeAppServerText } from "./app-server-client.mjs"
import { harvestTurnOutput, HERMES_FREE_AGENT_COMPLETE_PATTERN } from "./hermes-kernel-output.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"

export const HERMES_KERNEL_POLICY_RELATIVE = "config/execution-fabric/hermes-free-dev-agent-v2.policy.json"
export const HERMES_KERNEL_INVOKER_RELATIVE = "scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1"
export const HERMES_KERNEL_QUARANTINE_MARKER = "HERMES_FREE_AGENT_QUARANTINED"
const SESSION_SCHEMA_VERSION = 1

export function kernelThreadsRoot(runtimeRoot) {
  return path.join(path.resolve(runtimeRoot), "hermes-kernel", "threads")
}

function wall(code, method = "hermes-kernel") { return new AppServerWallError(code, method) }

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) throw new TypeError(`${name} must be a non-empty string`)
  return value
}

function realNoSymlink(target) {
  const resolved = path.resolve(target)
  const root = path.parse(resolved).root
  let cursor = root
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    if (fs.lstatSync(cursor).isSymbolicLink()) throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect")
  }
  return fs.realpathSync(resolved)
}

function isInside(child, parent) {
  const relative = path.relative(parent, child)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

export function createHermesKernelClient({
  workspacePath,
  runtimeRoot,
  commandRunner,
  policyPath = path.resolve(HERMES_KERNEL_POLICY_RELATIVE),
  invokerPath = path.resolve(HERMES_KERNEL_INVOKER_RELATIVE),
  timeoutMs = 45 * 60 * 1000,
  now = () => new Date(),
  powershellCommand = process.platform === "win32" ? "powershell" : "pwsh",
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  requiredString(workspacePath, "workspacePath"); requiredString(runtimeRoot, "runtimeRoot")
  if (typeof commandRunner !== "function") throw new TypeError("commandRunner must be a function")
  const threadsRoot = kernelThreadsRoot(runtimeRoot)
  const worktreesRoot = path.join(path.resolve(runtimeRoot), "worktrees")

  const readPolicy = () => {
    let policy
    try { policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) } catch { throw wall("RESIDENT_MODEL_LANE_POLICY_UNREADABLE", "connect") }
    if (!["PILOT_AUTHORIZED", "PROMOTED"].includes(policy?.promotion?.status)) throw wall("RESIDENT_MODEL_LANE_NOT_AUTHORIZED", "connect")
    if (policy?.placement?.workspaceMode !== "OWNED_WORKTREE") throw wall("RESIDENT_MODEL_LANE_WORKSPACE_MODE", "connect")
    return policy
  }
  const assertUnquarantined = () => {
    if (fs.existsSync(path.join(path.dirname(policyPath), HERMES_KERNEL_QUARANTINE_MARKER))) throw wall("RESIDENT_MODEL_LANE_QUARANTINED", "connect")
  }
  const assertOwnedWorkspace = () => {
    let real
    try { real = realNoSymlink(workspacePath) } catch (error) { if (error instanceof AppServerWallError) throw error; throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect") }
    let worktreesReal
    try { worktreesReal = fs.realpathSync(worktreesRoot) } catch { throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect") }
    if (!isInside(real, worktreesReal) || !fs.statSync(real).isDirectory()) throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect")
    return real
  }

  const sessionPath = (threadId) => path.join(threadsRoot, threadId, "session.json")
  const readSession = (threadId) => {
    if (typeof threadId !== "string" || !/^[0-9a-f-]{36}$/i.test(threadId)) throw wall("RESIDENT_MODEL_THREAD_UNKNOWN", "resumeThread")
    let session
    try { session = JSON.parse(fs.readFileSync(sessionPath(threadId), "utf8")) } catch { throw wall("RESIDENT_MODEL_THREAD_UNKNOWN", "resumeThread") }
    if (session?.schemaVersion !== SESSION_SCHEMA_VERSION || session.threadId !== threadId) throw wall("RESIDENT_MODEL_THREAD_UNKNOWN", "resumeThread")
    return session
  }
  const writeSession = (session) => {
    fs.mkdirSync(path.dirname(sessionPath(session.threadId)), { recursive: true })
    fs.writeFileSync(sessionPath(session.threadId), `${JSON.stringify(session, null, 2)}\n`)
  }

  const client = {
    async connect() {
      readPolicy(); assertUnquarantined(); assertOwnedWorkspace()
    },
    async startThread() {
      const threadId = randomUUID()
      writeSession({ schemaVersion: SESSION_SCHEMA_VERSION, threadId, workspacePath, createdAt: now().toISOString(), turns: [] })
      return threadId
    },
    async resumeThread(threadId) {
      const session = readSession(threadId)
      if (path.resolve(session.workspacePath) !== path.resolve(workspacePath)) throw wall("RESIDENT_MODEL_THREAD_WORKSPACE_MISMATCH", "resumeThread")
      if (readPolicy()?.execution?.sessionResumeProven !== true) throw wall("RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE", "resumeThread")
      return threadId
    },
    async runTurn() { throw wall("RESIDENT_MODEL_TURN_NOT_IMPLEMENTED", "runTurn") },
    close() {},
  }
  // Keep the surface exactly the five members the orchestrator uses.
  return Object.freeze(client)

  // Referenced by Task 5; kept here so tree-shaking/lint don't flag unused imports meanwhile.
  void AppServerTimeoutError; void AppServerTurnEndedError; void sanitizeAppServerText; void harvestTurnOutput
  void HERMES_FREE_AGENT_COMPLETE_PATTERN; void HERMES_TURN_OUTPUT_SCHEMA; void timeoutMs; void invokerPath; void powershellCommand
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/hermes-kernel-client.test.ts`
Expected: PASS (5 tests). Note the junction test relies on Windows `symlinkSync(..., "junction")`; on Linux CI `fs.symlinkSync` with type "junction" creates a directory symlink — both are reparse/symlink and are rejected by `lstat`.

- [ ] **Step 5: Commit**

```bash
git add scripts/hermes-bridge/hermes-kernel-client.mjs tests/hermes-kernel-client.test.ts
git commit -m "feat(s2): hermes kernel client — lane checks, session threads, fail-closed resume"
```

---

### Task 5: Kernel client — runTurn (packet, invoker, harvest, error mapping, evidence)

**Files:**
- Modify: `scripts/hermes-bridge/hermes-kernel-client.mjs` (replace `runTurn`; remove the `void …` tail)
- Modify: `tests/hermes-kernel-client.test.ts` (append describe block)

**Interfaces:**
- Produces: `buildKernelPacket({ policy, prompt, workspacePath, runId })` and `buildKernelPromptEpilogue()` exported; `runTurn({ threadId, prompt, turn, timeoutMs })` → `{ threadId, turnId, status: "completed", finalText }`.
- Consumes: Task 1 harvester; Task 2 policy fields; Task 3 invoker flags.

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { AppServerTimeoutError, AppServerTurnEndedError } from "../scripts/hermes-bridge/app-server-client.mjs"
import { buildKernelPacket, buildKernelPromptEpilogue } from "../scripts/hermes-bridge/hermes-kernel-client.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "../scripts/hermes-bridge/prompt.mjs"

const okResult = (runId: string, json = '{"result":"READY_FOR_VALIDATION"}') => ({
  code: 0, stderr: "", stdout: `agent chatter\n\`\`\`json\n${json}\n\`\`\`\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=D:\\w\n`,
})

describe("Hermes kernel client — runTurn", () => {
  it("builds a v2 packet with the verbatim prompt plus the output-contract epilogue", () => {
    const policy = { workOrderId: "WO-HERMES-FREE-DEV-AGENT-001", model: { id: "williamos-qwen3-4b:64k" }, execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"] } }
    const packet = buildKernelPacket({ policy, prompt: "Do the thing.", workspacePath: "D:\\w", runId: "run-1" })
    expect(Object.keys(packet).sort()).toEqual(["maximumTurns", "model", "prompt", "runId", "schemaVersion", "toolsets", "workOrderId", "workspaceMode", "workspacePath"])
    expect(packet).toMatchObject({ schemaVersion: 2, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001", model: "williamos-qwen3-4b:64k", maximumTurns: 20, toolsets: ["file", "terminal"], workspaceMode: "OWNED_WORKTREE", workspacePath: "D:\\w", runId: "run-1" })
    expect(packet.prompt.startsWith("Do the thing.\n\n")).toBe(true)
    expect(packet.prompt.endsWith(buildKernelPromptEpilogue())).toBe(true)
    expect(buildKernelPromptEpilogue()).toContain(JSON.stringify(HERMES_TURN_OUTPUT_SCHEMA))
    expect(buildKernelPromptEpilogue()).toContain("Do not commit, push, open PRs")
  })
  it("invokes the reviewed PowerShell invoker with the packet, policy, workspace and run id, then harvests finalText", async () => {
    const { client, calls, commandRunner, workspacePath, runtimeRoot, policyPath, invokerPath } = fixture()
    commandRunner.mockImplementation(async (call: Call) => { calls.push(call); return okResult(call.args[call.args.indexOf("-RunId") + 1]) })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    const turn = await client.runTurn({ threadId, prompt: "Deliver WO-1", turn: { outputSchema: HERMES_TURN_OUTPUT_SCHEMA }, timeoutMs: 5000 })
    expect(turn).toEqual({ threadId, turnId: expect.stringMatching(/^[0-9a-f-]{36}$/), status: "completed", finalText: '{"result":"READY_FOR_VALIDATION"}' })
    const call = calls.at(-1)!
    expect(call.command).toBe("powershell")
    expect(call.args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
    expect(call.args[5]).toBe(invokerPath)
    const arg = (flag: string) => call.args[call.args.indexOf(flag) + 1]
    expect(arg("-PolicyPath")).toBe(policyPath)
    expect(arg("-WorkspacePath")).toBe(fs.realpathSync(workspacePath))
    expect(arg("-RunId")).toBe(turn.turnId)
    expect(call.cwd).toBe(fs.realpathSync(workspacePath))
    expect(call.timeoutMs).toBe(5000)
    expect(call.credentialAccess).toBe(false)
    const packet = JSON.parse(fs.readFileSync(arg("-PacketPath"), "utf8"))
    expect(packet).toMatchObject({ schemaVersion: 2, runId: turn.turnId, workspaceMode: "OWNED_WORKTREE", workspacePath: fs.realpathSync(workspacePath) })
    expect(packet.prompt.startsWith("Deliver WO-1\n\n")).toBe(true)
    const session = JSON.parse(fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "session.json"), "utf8"))
    expect(session.turns).toEqual([expect.objectContaining({ turnId: turn.turnId, exitCode: 0, harvested: true, packetSha256: expect.stringMatching(/^[0-9a-f]{64}$/), stdoutSha256: expect.stringMatching(/^[0-9a-f]{64}$/), at: "2026-08-16T20:00:00.000Z" })])
    expect(fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "turns", "1", "stdout.txt"), "utf8")).toContain("HERMES_FREE_AGENT_COMPLETE")
  })
  it("refuses a turn before connect, for an unknown thread, or when the prompt exceeds the policy budget", async () => {
    const { client, workspacePath, policyPath } = fixture()
    await expect(client.runTurn({ threadId: "x", prompt: "p" })).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_NOT_CONNECTED" })
    await client.connect()
    await expect(client.runTurn({ threadId: "00000000-0000-4000-8000-0000000000ff", prompt: "p" })).rejects.toMatchObject({ code: "RESIDENT_MODEL_THREAD_UNKNOWN" })
    const threadId = await client.startThread({ cwd: workspacePath })
    const p = JSON.parse(fs.readFileSync(policyPath, "utf8")); p.execution.promptMaxChars = 40; fs.writeFileSync(policyPath, JSON.stringify(p))
    await expect(client.runTurn({ threadId, prompt: "x".repeat(41) })).rejects.toMatchObject({ code: "RESIDENT_MODEL_PROMPT_TOO_LONG" })
  })
  it("maps invoker outcomes onto the orchestrator's existing error taxonomy", async () => {
    const cases: Array<[Record<string, unknown>, (error: any) => void]> = [
      [{ code: 0, stdout: "chatter without completion", stderr: "" }, (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_INTERRUPTED") }],
      [{ code: 0, stdout: "HERMES_FREE_AGENT_COMPLETE runId=r workspace=w\n", stderr: "" }, (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_FAILED"); expect(e.detail).toBe("RESIDENT_MODEL_TURN_OUTPUT_INVALID:NO_JSON_BLOCK") }],
      [{ code: 1, stdout: "", stderr: "HERMES_FREE_AGENT_EXECUTION_WALL" }, (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_FAILED") }],
      [{ code: 1, stdout: "", stderr: "HERMES_FREE_AGENT_TIMEOUT_WALL" }, (e) => { expect(e).toBeInstanceOf(AppServerTimeoutError) }],
      [{ code: 1, stdout: "", stderr: "", timedOut: true }, (e) => { expect(e).toBeInstanceOf(AppServerTimeoutError) }],
      [{ code: 1, stdout: "", stderr: "HERMES_FREE_AGENT_IMAGE_ID_WALL" }, (e) => { expect(e).toBeInstanceOf(AppServerWallError); expect(e.code).toBe("HERMES_FREE_AGENT_IMAGE_ID_WALL") }],
      [{ code: 3, stdout: "", stderr: "boom" }, (e) => { expect(e).toBeInstanceOf(AppServerTurnEndedError); expect(e.code).toBe("APP_SERVER_TURN_INTERRUPTED") }],
    ]
    for (const [result, assert] of cases) {
      const { client, commandRunner, workspacePath } = fixture()
      commandRunner.mockImplementation(async () => result)
      await client.connect()
      const threadId = await client.startThread({ cwd: workspacePath })
      await expect(client.runTurn({ threadId, prompt: "p" })).rejects.toSatisfy((error: any) => { assert(error); return true })
    }
  })
  it("sanitises secrets out of the recorded stdout evidence", async () => {
    const { client, commandRunner, workspacePath, runtimeRoot } = fixture()
    commandRunner.mockImplementation(async (call: Call) => { const r = okResult(call.args[call.args.indexOf("-RunId") + 1]); r.stdout = `token ghp_${"a".repeat(36)}\n${r.stdout}`; return r })
    await client.connect()
    const threadId = await client.startThread({ cwd: workspacePath })
    await client.runTurn({ threadId, prompt: "p" })
    const recorded = fs.readFileSync(path.join(kernelThreadsRoot(runtimeRoot), threadId, "turns", "1", "stdout.txt"), "utf8")
    expect(recorded).not.toContain("ghp_")
    expect(recorded).toContain("[REDACTED]")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/hermes-kernel-client.test.ts`
Expected: FAIL — `buildKernelPacket` not exported; `runTurn` throws `RESIDENT_MODEL_TURN_NOT_IMPLEMENTED`.

- [ ] **Step 3: Implement runTurn** — in `hermes-kernel-client.mjs`: delete the `void …` tail; add exports and replace `runTurn`:

```js
export function buildKernelPromptEpilogue() {
  return [
    "Finish by printing exactly one fenced ```json block that satisfies the following JSON schema, and print nothing after it.",
    "Do not commit, push, open PRs, or touch paths outside the reservations named above.",
    JSON.stringify(HERMES_TURN_OUTPUT_SCHEMA),
  ].join("\n")
}

export function buildKernelPacket({ policy, prompt, workspacePath, runId }) {
  return {
    schemaVersion: 2,
    workOrderId: policy.workOrderId,
    model: policy.model.id,
    prompt: `${prompt}\n\n${buildKernelPromptEpilogue()}`,
    maximumTurns: policy.execution.maximumTurns,
    toolsets: [...policy.execution.allowedToolsets],
    workspaceMode: "OWNED_WORKTREE",
    workspacePath,
    runId,
  }
}

const WALL_TOKEN = /HERMES_FREE_AGENT_[A-Z_]+_WALL/
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex")
```

Inside `createHermesKernelClient`, keep a `let connected = false` (set true at end of `connect()`), and replace `runTurn`:

```js
    async runTurn({ threadId, prompt, timeoutMs: turnTimeoutMs = timeoutMs } = {}) {
      if (!connected) throw wall("RESIDENT_MODEL_LANE_NOT_CONNECTED", "runTurn")
      const session = readSession(threadId)
      const policy = readPolicy(); assertUnquarantined(); const workspaceReal = assertOwnedWorkspace()
      const text = requiredString(prompt, "prompt")
      const runId = randomUUID()
      const packet = buildKernelPacket({ policy, prompt: text, workspacePath: workspaceReal, runId })
      if (packet.prompt.length > (policy.execution?.promptMaxChars ?? 16000)) throw wall("RESIDENT_MODEL_PROMPT_TOO_LONG", "runTurn")
      const turnIndex = session.turns.length + 1
      const turnDir = path.join(threadsRoot, threadId, "turns", String(turnIndex))
      fs.mkdirSync(turnDir, { recursive: true })
      const packetPath = path.join(turnDir, "packet.json")
      const packetBytes = `${JSON.stringify(packet, null, 2)}\n`
      fs.writeFileSync(packetPath, packetBytes, { mode: 0o600 })
      const result = await commandRunner({
        command: powershellCommand,
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", invokerPath,
          "-PacketPath", packetPath, "-PolicyPath", policyPath, "-WorkspacePath", workspaceReal, "-RunId", runId],
        cwd: workspaceReal, timeoutMs: turnTimeoutMs, credentialAccess: false,
      })
      const exitCode = result?.exitCode ?? result?.code ?? result?.status ?? 0
      const stdout = String(result?.stdout ?? ""); const stderr = String(result?.stderr ?? "")
      const combined = `${stdout}\n${stderr}`
      const record = { turnId: runId, at: now().toISOString(), exitCode, packetSha256: sha256(packetBytes), stdoutSha256: sha256(stdout), harvested: false }
      fs.writeFileSync(path.join(turnDir, "stdout.txt"), sanitizeAppServerText(combined))
      const finish = (error) => { session.turns.push(record); writeSession(session); if (error) throw error }
      if (result?.timedOut === true || /HERMES_FREE_AGENT_TIMEOUT_WALL/.test(combined)) finish(new AppServerTimeoutError(turnTimeoutMs))
      if (/HERMES_FREE_AGENT_EXECUTION_WALL/.test(combined)) finish(new AppServerTurnEndedError("failed"))
      const token = combined.match(WALL_TOKEN)?.[0]
      if (token) finish(wall(token, "runTurn"))
      if (exitCode !== 0 || !HERMES_FREE_AGENT_COMPLETE_PATTERN.test(stdout)) finish(new AppServerTurnEndedError("interrupted"))
      const harvested = harvestTurnOutput(stdout)
      if (!harvested.ok) {
        const error = new AppServerTurnEndedError("failed"); error.detail = `RESIDENT_MODEL_TURN_OUTPUT_INVALID:${harvested.reason}`
        finish(error)
      }
      record.harvested = true
      finish(null)
      return { threadId, turnId: runId, status: "completed", finalText: harvested.finalText }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/hermes-kernel-client.test.ts tests/hermes-kernel-output.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add scripts/hermes-bridge/hermes-kernel-client.mjs tests/hermes-kernel-client.test.ts
git commit -m "feat(s2): kernel client runTurn — packet v2, reviewed invoker, JSON harvest, error mapping, evidence"
```

---

### Task 6: Wire `ResidentModelExecutionBackend.runCodexClient`

**Files:**
- Modify: `scripts/hermes-bridge/execution-backend.mjs:133-165` (remove `ResidentModelNotImplementedError` and the throwing `runCodexClient`; keep class + docs)
- Modify: `tests/hermes-execution-backend.test.ts:11-12, 44-66`

**Interfaces:**
- Consumes: Task 4/5 `createHermesKernelClient`.
- Produces: `new ResidentModelExecutionBackend({ runtimeRoot, repositoryRoot, commandRunner, kernelPolicyPath?, kernelInvokerPath? })`; `runCodexClient({ workspacePath, timeoutMs })` → kernel client. `selectExecutionBackend` unchanged.

- [ ] **Step 1: Update the failing test** — in `tests/hermes-execution-backend.test.ts`: remove `ResidentModelNotImplementedError` from the import; replace the two "refuses fail-closed" assertions with:

```ts
    // S2: the seam returns the Hermes-kernel adapter, never a Codex client.
    const client = await backend.runCodexClient({ workspacePath, timeoutMs: 1234 })
    expect(Object.keys(client).sort()).toEqual(["close", "connect", "resumeThread", "runTurn", "startThread"])
    // Lane checks are enforced by the client, not the backend: no policy here → wall on connect.
    await expect(client.connect()).rejects.toMatchObject({ code: "RESIDENT_MODEL_LANE_POLICY_UNREADABLE" })
```
Keep `await expect(backend.runCodexClient({})).rejects.toBeInstanceOf(TypeError)`. Update the test title from "refuses" wording if present.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/hermes-execution-backend.test.ts`
Expected: FAIL — `runCodexClient` rejects with `RESIDENT_MODEL_EXECUTOR_NOT_IMPLEMENTED`.

- [ ] **Step 3: Implement** — in `execution-backend.mjs`:
  - add import: `import { createHermesKernelClient, HERMES_KERNEL_INVOKER_RELATIVE, HERMES_KERNEL_POLICY_RELATIVE } from "./hermes-kernel-client.mjs"`
  - delete class `ResidentModelNotImplementedError` (search the repo: `grep -rn ResidentModelNotImplementedError` must return only the test import you removed)
  - replace the class body:

```js
/**
 * Resident local-model execution context (S2).
 *
 * Inherits every local mechanic (worktrees, commands, validation, git, cleanup) and overrides the
 * single Codex seam with the Hermes-kernel adapter: the reviewed hermes-free-dev-agent lane runs
 * against this backend's owned worktree and returns the orchestrator's turn JSON. No agent loop
 * lives here (WO-WILLIAMOS-HERMES-KERNEL-V1 §1).
 */
export class ResidentModelExecutionBackend extends LocalExecutionBackend {
  constructor({ kernelPolicyPath, kernelInvokerPath, ...options } = {}) {
    super(options)
    this.isResidentModel = true
    this.kernelPolicyPath = path.resolve(kernelPolicyPath ?? path.join(this.repositoryRoot, HERMES_KERNEL_POLICY_RELATIVE))
    this.kernelInvokerPath = path.resolve(kernelInvokerPath ?? path.join(this.repositoryRoot, HERMES_KERNEL_INVOKER_RELATIVE))
  }

  async runCodexClient({ workspacePath, timeoutMs } = {}) {
    return createHermesKernelClient({
      workspacePath: requiredString(workspacePath, "workspacePath"),
      runtimeRoot: this.runtimeRoot,
      commandRunner: this.commandRunner,
      policyPath: this.kernelPolicyPath,
      invokerPath: this.kernelInvokerPath,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/hermes-execution-backend.test.ts tests/hermes-kernel-client.test.ts`
Expected: PASS. Also `grep -rn "ResidentModelNotImplementedError" scripts tests` → no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/hermes-bridge/execution-backend.mjs tests/hermes-execution-backend.test.ts
git commit -m "feat(s2): resident-model backend returns the Hermes-kernel client through the Codex seam"
```

---

### Task 7: Orchestrator cycle through the kernel client (end-to-end, deterministic)

**Files:**
- Test: `tests/hermes-kernel-orchestrator-cycle.test.ts` (new)

**Interfaces:**
- Consumes: `createHermesOrchestrator` (`orchestrator.mjs`), the continuity fixture shape from `tests/goal-operator-continuity.test.ts` (copy its `PersistedRuntimeLedger`, `runtimeRoot`, `outcome`, `queueBinding`, `registeredContract` helpers verbatim — do not import test files), `createHermesKernelClient`.

- [ ] **Step 1: Write the failing test** — copy from `tests/goal-operator-continuity.test.ts` lines 1–~330 the imports, constants (`owner`, `outcomeId`, `workOrderId`, `workOrderRef`, `prNumber`, `commit`, `mergeSha`, `registeredCommand`, `registeredContract`, `changedPaths`, `registeredValidators`, `acquisitionKey`, `queueBinding`), `PersistedRuntimeLedger`, `runtimeRoot()`, `outcome()`, `afterEach`, and the `lifecycle` object; then add ONE test:

```ts
import { createHermesKernelClient } from "../scripts/hermes-bridge/hermes-kernel-client.mjs"

const kernelJson = JSON.stringify({
  result: "READY_FOR_VALIDATION", workOrder: "WO-WOS-V1.1-003", branch: "codex/wos-v1-1-continuity-recovery",
  commit: null, prUrl: null, merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0,
  ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE",
  blockedAction: null, authorityBoundary: null, minimumChoice: null, approveConsequence: null, denyConsequence: null,
})

describe("Hermes orchestrator over the resident-model kernel client", () => {
  it("completes one fenced delivery when the kernel lane returns the turn JSON", async () => {
    const root = runtimeRoot()
    let clock = Date.parse("2026-08-16T20:00:00.000Z"); const now = () => new Date(clock)
    const ledger = new PersistedRuntimeLedger(now)
    const projectCheckpoint = (input: Record<string, unknown>) => (projectOutcomeRuntimeCheckpoint as any)({ ...input, query: ledger.query })
    const projectLease = (input: Record<string, unknown>) => (projectOutcomeRuntimeLease as any)({ ...input, query: ledger.query })
    // kernel lane fixture: policy v2 next to a fake invoker; workspace = the orchestrator's owned worktree
    const worktreesRoot = path.join(root, "worktrees"); const workspacePath = path.join(worktreesRoot, "wos-v1-1-continuity-recovery"); fs.mkdirSync(workspacePath, { recursive: true })
    const policyDir = path.join(root, "policy"); fs.mkdirSync(policyDir)
    const policyPath = path.join(policyDir, "hermes-free-dev-agent-v2.policy.json")
    fs.writeFileSync(policyPath, JSON.stringify({ schemaVersion: 2, packetSchemaVersion: 2, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001", model: { id: "williamos-qwen3-4b:64k" }, placement: { workspaceMode: "OWNED_WORKTREE", allowedWorkspaceRoots: [worktreesRoot] }, execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"], promptMaxChars: 60000, sessionResumeProven: false, timeoutSeconds: 1800 }, promotion: { status: "PILOT_AUTHORIZED" } }))
    const invocations: string[][] = []
    const commandRunner = vi.fn(async ({ args }: { args: string[] }) => {
      invocations.push(args)
      const runId = args[args.indexOf("-RunId") + 1]
      return { code: 0, stderr: "", stdout: `working\n\`\`\`json\n${kernelJson}\n\`\`\`\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=${workspacePath}\n` }
    })
    let merged = false
    // lifecycle: same as the continuity test but ensureOwnedWorktree returns the kernel workspace
    const lifecycle = { /* copy from continuity test, then: */ ensureOwnedWorktree: vi.fn(async ({ branch }: { branch: string }) => ({ branch, worktreePath: workspacePath })) } as any
    const markComplete = vi.fn(async () => true)
    const orchestrator = createHermesOrchestrator({
      workspace: process.cwd(), runtimeRoot: root, state: createHermesStateStore(path.join(root, "state", "state.json"), { now: () => clock }),
      lifecycle, selectOutcome: vi.fn(async () => outcome()), markComplete, markTerminal: vi.fn(async () => true), deferOutcome: vi.fn(async () => true),
      projectCheckpoint, projectLease,
      clientFactory: (worktreePath: string) => createHermesKernelClient({ workspacePath: worktreePath, runtimeRoot: root, commandRunner, policyPath, invokerPath: path.join(root, "invoke.ps1"), now, powershellCommand: "powershell" }),
      holderId: "resident-kernel", now, sleep: async () => {}, leaseRenewalIntervalMs: 60 * 60 * 1000,
    })
    await expect(orchestrator.cycle()).resolves.toEqual({ result: "COMPLETE", outcomeId: String(outcomeId), prNumber, mergeSha, changedPaths })
    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toContain("-WorkspacePath")
    expect(lifecycle.createPullRequest).toHaveBeenCalledOnce()
    expect(markComplete).toHaveBeenCalledOnce()
    const completed = orchestrator && (createHermesStateStore(path.join(root, "state", "state.json"), { now: () => clock }).read().executions[String(outcomeId)])
    expect(completed).toMatchObject({ checkpoint: { state: "COMPLETE" } })
  })
})
```
Note for the implementer: `lifecycle` must include every function the continuity test's `lifecycle` object has (`refreshOriginMain … cleanupOwnedWorktree`) with the same fakes; only `ensureOwnedWorktree` differs (returns `workspacePath`). `merged` toggling in `mergePullRequest`/`inspectPullRequest` is required for `mergeSha` to appear.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/hermes-kernel-orchestrator-cycle.test.ts`
Expected: FAIL only if wiring is wrong (e.g. `-WorkspacePath` not passed, or finalText not harvested). If it passes immediately, add a negative control step: set `commandRunner` to return stdout without a JSON block and assert `cycle()` rejects with `code: "APP_SERVER_TURN_FAILED"` — that must fail before Task 5 and pass after; keep it as a second `it`.

- [ ] **Step 3: Fix any wiring defect found** (edit `hermes-kernel-client.mjs`), rerun until PASS.

- [ ] **Step 4: Run the related suites**

Run: `pnpm exec vitest run tests/hermes-kernel-orchestrator-cycle.test.ts tests/goal-operator-continuity.test.ts tests/hermes-bridge-orchestrator.test.ts tests/hermes-execution-backend.test.ts tests/hermes-kernel-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/hermes-kernel-orchestrator-cycle.test.ts
git commit -m "test(s2): orchestrator completes a fenced delivery through the Hermes-kernel client"
```

---

### Task 8: Runbook + spec status + WO ledger; full CI profile

**Files:**
- Modify: `docs/runbooks/hermes-free-dev-agent.md` (append section)
- Modify: `docs/superpowers/specs/2026-08-16-s2-resident-model-executor-adapter-design.md` (status line → "P1 implemented on branch …")
- Modify: `docs/governance/goal-registry.md` or the program ledger the owner uses (append one line: "S2 P1 — resident-model executor adapter over Hermes-Agent kernel — branch wo/s2-resident-executor-adapter — P2 live smoke pending owner") — if unsure which ledger, add the line to the spec's status instead.

- [ ] **Step 1: Append to the runbook**

```markdown
## v2 — owned-worktree mode (WilliamOS resident executor, S2)

Policy: `config/execution-fabric/hermes-free-dev-agent-v2.policy.json` (`placement.workspaceMode: OWNED_WORKTREE`).
Invoked only by the WilliamOS orchestrator when `WILLIAMOS_EXECUTOR=resident-model`, through
`ResidentModelExecutionBackend.runCodexClient` → `createHermesKernelClient`. The adapter writes a
v2 packet under `<runtime root>\hermes-kernel\threads\<threadId>\turns\<n>\packet.json` and runs:

    powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File invoke-hermes-free-dev-agent.ps1 `
      -PacketPath <packet> -PolicyPath <v2 policy> -WorkspacePath <owned worktree> -RunId <turnId>

The workspace must be under `placement.allowedWorkspaceRoots` (the orchestrator's `worktrees` dir),
must not be the canonical checkout, and must contain no symlink components; otherwise the invoker
walls (`HERMES_FREE_AGENT_WORKSPACE_*_WALL`). No baseline clone is made in this mode. The kernel's
final fenced ```json block is the turn result the orchestrator validates; validation, commit, push,
PR and merge stay in WilliamOS.

`resumeThread` is fail-closed (`execution.sessionResumeProven: false`) until P2 proves kernel session
continuity; the orchestrator then starts a fresh thread, and owner-decision resumes wall — by design.

P2 (owner-triggered on HERMES): `WILLIAMOS_EXECUTOR=resident-model pnpm hermes:smoke` against a
throwaway outcome on the registered contract; record run id, exit code, harvested JSON, and a diff
confined to reservations under `docs/reports/`. Then the two-turn resume probe.
```

- [ ] **Step 2: Update spec status line** to: `**Status:** P1 implemented on branch wo/s2-resident-executor-adapter (owner review = PR); P2 pending owner-triggered live smoke on HERMES.`

- [ ] **Step 3: Full CI profile locally**

Run: `CI=true pnpm exec vitest run --config vitest.ci.config.ts`
Expected: green apart from the known Windows-load residuals (`offload-worker` is CI-excluded; `standing-resident-runner` NTFS-ino flake may appear locally only). If any *new* file fails, fix before commit.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/hermes-free-dev-agent.md docs/superpowers/specs/2026-08-16-s2-resident-model-executor-adapter-design.md
git commit -m "docs(s2): runbook v2 owned-worktree mode; spec status P1 implemented"
```

- [ ] **Step 5: Hand off** — report branch head, test counts, and the P2 command to the owner. Do not push/PR without owner approval.

---

## Self-review (done while writing)

- **Spec coverage:** §3.1 → Task 6; §3.2 connect/threads → Task 4, runTurn → Task 5; §3.3 → Task 5 (`buildKernelPacket`/epilogue); §3.4/§4 invoker → Task 3; §4 policy → Task 2; §3.5 → Task 1; §5 error rows → Task 5 test table (quarantine/unauthorised/foreign workspace → Task 4); §6 P1 → all, P2/P3 → runbook (Task 8); §7 tests → Tasks 1–7; §8 out of scope respected (no compose/runner/image change: workspace mount reuses `WILLIAMOS_AGENT_WORKSPACE`).
- **Placeholders:** none; the one intentionally-called-out no-op line in Task 3 is explicitly deleted with the final rule stated (keep only the `--show-toplevel` canonical check).
- **Type consistency:** `createHermesKernelClient` option names (`workspacePath, runtimeRoot, commandRunner, policyPath, invokerPath, timeoutMs, now, powershellCommand, randomUUID`) match Tasks 4/5/6/7; error codes (`RESIDENT_MODEL_LANE_QUARANTINED / _WORKSPACE_MODE / _NOT_AUTHORIZED / _WORKSPACE / _POLICY_UNREADABLE / _NOT_CONNECTED`, `RESIDENT_MODEL_THREAD_UNKNOWN / _WORKSPACE_MISMATCH / _RESUME_UNAVAILABLE`, `RESIDENT_MODEL_PROMPT_TOO_LONG`, `RESIDENT_MODEL_TURN_OUTPUT_INVALID:<reason>`) are identical across Tasks 4–7; packet field set identical in Tasks 2/3/5; invoker flag order `-PacketPath -PolicyPath -WorkspacePath -RunId` identical in Tasks 3/5/8.
