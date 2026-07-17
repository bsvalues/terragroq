import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  BranchCommitPushAutomationError,
  evaluateBranchCommitPushAutomation,
} from "../scripts/multi-agent-operator/branch-commit-push-automation.mjs"

const BASE = "01f82fbbaa99c86a51e5c4809d91e0e90e11d942"
const HEAD = "1111111111111111111111111111111111111111"

function input(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "BRANCH_COMMIT_PUSH_AUTOMATION_INPUT",
    workOrderId: "WO-MAO-037",
    programGrant: {
      grantId: "AUTHORITY-MAO-PROGRAM-ACTIVE",
      status: "ACTIVE",
      programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
      riskClass: "R3",
      authorityGrantRefs: ["docs/governance/active-program-queue.md"],
    },
    preventiveTrustGate: {
      gateRef: "control-center/backend/workers.py#validate_preventive_trust_gate_v2",
      passed: true,
      identityAttributed: true,
      pathConfined: true,
      outputRedacted: true,
    },
    lane: {
      repository: "bsvalues/terragroq",
      branch: "codex/mao-branch-commit-push-037",
      baseRef: "refs/heads/main",
      baseCommitSha: BASE,
      headCommitSha: HEAD,
      reservedPaths: [
        "scripts/multi-agent-operator",
        "tests",
        "docs/reports",
        "docs/governance",
        "components/operator",
      ],
      changedFiles: [
        "scripts/multi-agent-operator/branch-commit-push-automation.mjs",
        "tests/multi-agent-branch-commit-push-automation.test.ts",
        "docs/reports/WO-MAO-037-branch-commit-push-automation.md",
      ],
      foreignChanges: [],
    },
    commit: {
      message: "feat(operator): add branch commit push automation",
      authorName: "WilliamOS Codex",
      authorEmail: "bsvalues@gmail.com",
    },
    push: {
      remote: "origin",
      remoteBranch: "codex/mao-branch-commit-push-037",
      rollbackRef: BASE,
    },
    secretScan: {
      passed: true,
      scannedFiles: [
        "scripts/multi-agent-operator/branch-commit-push-automation.mjs",
        "tests/multi-agent-branch-commit-push-automation.test.ts",
        "docs/reports/WO-MAO-037-branch-commit-push-automation.md",
      ],
    },
    ...overrides,
  }
}

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected branch commit push wall")
  } catch (error) {
    expect(error).toBeInstanceOf(BranchCommitPushAutomationError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-037 branch, commit, and push automation", () => {
  it("proves a governed branch, commit, and push plan without executing Git", () => {
    const result = evaluateBranchCommitPushAutomation(input())

    expect(result).toMatchObject({
      artifactType: "BRANCH_COMMIT_PUSH_AUTOMATION_RESULT",
      workOrderId: "WO-MAO-037",
      status: "BRANCH_COMMIT_PUSH_AUTOMATION_PROVEN",
      repository: "bsvalues/terragroq",
      branch: "codex/mao-branch-commit-push-037",
      stagedFiles: [
        "docs/reports/wo-mao-037-branch-commit-push-automation.md",
        "scripts/multi-agent-operator/branch-commit-push-automation.mjs",
        "tests/multi-agent-branch-commit-push-automation.test.ts",
      ],
      branchCreationAllowed: true,
      commitAllowed: true,
      pushAllowed: true,
      foreignChangesExcluded: true,
      secretScanPassed: true,
      rollbackPreserved: true,
      gitCommandPerformed: false,
      pushPerformed: false,
      prCreated: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      secretsExposed: false,
      ownerRelayRequired: false,
    })
    expect(result.planHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rejects missing grant, failed trust gate, unsafe branch, and rollback mismatch", () => {
    expectWall(() => evaluateBranchCommitPushAutomation(input({
      programGrant: { ...(input().programGrant as Record<string, unknown>), status: "REVOKED" },
    })), "BRANCH_PUSH_GRANT_WALL")
    expectWall(() => evaluateBranchCommitPushAutomation(input({
      preventiveTrustGate: { ...(input().preventiveTrustGate as Record<string, unknown>), passed: false },
    })), "BRANCH_PUSH_TRUST_WALL")
    expectWall(() => evaluateBranchCommitPushAutomation(input({
      lane: { ...(input().lane as Record<string, unknown>), branch: "main" },
    })), "BRANCH_PUSH_FORMAT_WALL")
    expectWall(() => evaluateBranchCommitPushAutomation(input({
      push: { ...(input().push as Record<string, unknown>), rollbackRef: HEAD },
    })), "BRANCH_PUSH_ROLLBACK_WALL")
  })

  it("rejects foreign changes, unreserved files, and incomplete secret scanning", () => {
    expectWall(() => evaluateBranchCommitPushAutomation(input({
      lane: { ...(input().lane as Record<string, unknown>), foreignChanges: [".obsidian/workspace.json"] },
    })), "BRANCH_PUSH_FOREIGN_CHANGE_WALL")
    expectWall(() => evaluateBranchCommitPushAutomation(input({
      lane: { ...(input().lane as Record<string, unknown>), changedFiles: ["package.json"] },
      secretScan: { passed: true, scannedFiles: ["package.json"] },
    })), "BRANCH_PUSH_RESERVATION_WALL")
    expectWall(() => evaluateBranchCommitPushAutomation(input({
      secretScan: { passed: true, scannedFiles: ["tests/multi-agent-branch-commit-push-automation.test.ts"] },
    })), "BRANCH_PUSH_SECRET_WALL")
  })

  it("exposes deterministic CLI success and typed failure", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "branch-commit-push-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(input()))
    fs.writeFileSync(badPath, JSON.stringify({ ...input(), workOrderId: "WO-MAO-999" }))

    const output = JSON.parse(execFileSync(process.execPath,
      ["scripts/multi-agent-operator/branch-commit-push-automation-cli.mjs", inputPath], { encoding: "utf8" }))
    expect(output).toMatchObject({ status: "BRANCH_COMMIT_PUSH_AUTOMATION_PROVEN", gitCommandPerformed: false })

    const failed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/branch-commit-push-automation-cli.mjs", badPath], { encoding: "utf8" })
    expect(failed.status).toBe(2)
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      code: "BRANCH_PUSH_INPUT_WALL",
      gitCommandPerformed: false,
      authorityGranted: false,
    })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
