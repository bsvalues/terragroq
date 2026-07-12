import fs from "node:fs"
import { describe, expect, it } from "vitest"

describe("native execution controls", () => {
  it("isolates worktrees and derives stable idempotency keys", () => {
    const execution = fs.readFileSync("runtime-operator/native/WilliamOS.RuntimeExecution.psm1", "utf8")
    expect(execution).toContain("bsvalues/terragroq")
    expect(execution).toContain('"worktree", "add", "--detach"')
    expect(execution).toContain("WORKSPACE_EXISTS_WALL")
    expect(execution).toContain('"$Repository|$WorkOrder|$BaseSha"')
    expect(execution).not.toMatch(/reset\s+--hard|force.push|submodule/i)
  })

  it("invokes Codex with schema, sandbox, no approval, and sanitized environment", () => {
    const module = fs.readFileSync("runtime-operator/native/WilliamOS.RuntimeExecution.psm1", "utf8")
    const codex = fs.readFileSync("scripts/local/williamos-codex-exec.ps1", "utf8")
    expect(module).toContain('@("OPENAI_API_KEY", "GH_TOKEN", "GITHUB_TOKEN")')
    expect(codex).toContain('"--ask-for-approval", "never"')
    expect(codex).toContain('"--sandbox", "workspace-write"')
    expect(codex).toContain("--output-schema")
    expect(codex).toContain('EndsWith(".ps1"')
    expect(codex).toContain("node_modules\\@openai\\codex\\bin\\codex.js")
    expect(module).toContain("PROCESS_OUTPUT_BUDGET_WALL")
  })

  it("blocks unsafe patch paths and exposes only allowlisted GitHub operations", () => {
    const patch = fs.readFileSync("scripts/local/williamos-patch-policy.ps1", "utf8")
    expect(patch).toContain("PATCH_PATH_POLICY_WALL")
    expect(patch).toContain("PATCH_BINARY_WALL")
    const github = fs.readFileSync("scripts/local/williamos-github-operation.ps1", "utf8")
    expect(github).toContain('ValidateSet("issue-view", "pr-view", "pr-checks", "pr-create", "pr-merge")')
    expect(github).toContain("MERGE_GATE_WALL")
    expect(github).toContain("GITHUB_RECONCILIATION_WALL")
    expect(github).toContain("gh pr list")
    expect(github).not.toMatch(/secret|variable|workflow run|release create|repo edit/i)
  })

  it("pins bounded consumption and verifies hash-chained audit", () => {
    const budgets = JSON.parse(fs.readFileSync("runtime-operator/native/budgets.json", "utf8"))
    expect(budgets).toMatchObject({ maxCyclesPerHour: 4, maxCyclesPerDay: 12, maxCodexInvocationsPerWorkOrder: 3, maxRemediationAttempts: 2 })
    expect(budgets.maxChangedFiles).toBeLessThanOrEqual(20)
    const execution = fs.readFileSync("runtime-operator/native/WilliamOS.RuntimeExecution.psm1", "utf8")
    expect(execution).toContain("BUDGET_EXHAUSTED_")
    expect(execution).toContain("NO_RETRY_TERMINAL")
    const audit = fs.readFileSync("scripts/local/williamos-audit-verify.ps1", "utf8")
    expect(audit).toContain("AUDIT_CHAIN_WALL")
    expect(audit).toContain("AUDIT_HASH_WALL")
  })
})
