import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  IsolatedWorkspaceManagerError,
  executeIsolatedWorkspaceLifecycle,
  planIsolatedWorkspaces,
} from "../scripts/multi-agent-operator/isolated-workspace-manager.mjs"

const BASE_SHA = "6239cd907bd5d260d2f11a2ee864a5d8c9a7e1f2"
const HEAD_SHA = "8a45e6e8a2867c860213fa762b2c0ae93c718331"
const ROOT = "/operator/worktrees"
const REPOSITORY_ROOT = "/operator/source/terragroq"
const temporaryDirectories: string[] = []

function observed(laneId = "LANE-A", workOrderId = "WO-MAO-025", overrides = {}) {
  const workspacePath = `${ROOT}/${laneId.toLowerCase()}`
  return {
    repository: "bsvalues/terragroq",
    repositoryRoot: REPOSITORY_ROOT,
    workspacePath,
    branch: `codex/${workOrderId.toLowerCase()}`,
    baseRef: "refs/heads/main",
    baseCommitSha: BASE_SHA,
    headCommitSha: BASE_SHA,
    ownerLaneId: laneId,
    ownerWorkOrderId: workOrderId,
    trackedChanges: [],
    untrackedChanges: [],
    ignoredChanges: [],
    worktreeLaneIds: [laneId],
    branchLaneIds: [laneId],
    ...overrides,
  }
}

function lane(laneId = "LANE-A", workOrderId = "WO-MAO-025", overrides: Record<string, unknown> = {}) {
  const workspacePath = `${ROOT}/${laneId.toLowerCase()}`
  return {
    laneId,
    workOrderId,
    repository: "bsvalues/terragroq",
    repositoryRoot: REPOSITORY_ROOT,
    workspacePath,
    branch: `codex/${workOrderId.toLowerCase()}`,
    baseRef: "refs/heads/main",
    baseCommitSha: BASE_SHA,
    lifecycleState: "EXECUTING",
    reservedPaths: [`lanes/${laneId.toLowerCase()}`],
    reservationSetId: `reservation-${laneId.toLowerCase()}`,
    leaseId: `lease-${laneId.toLowerCase()}`,
    leaseFence: 1,
    evidenceEventId: `evidence-${laneId.toLowerCase()}`,
    observedWorkspace: null,
    ...overrides,
  }
}

function input(lanes = [lane()]) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_ISOLATED_WORKSPACE_INPUT",
    planId: "workspace-plan-wo-mao-025",
    workspaceRoot: ROOT,
    lanes,
  }
}

function trustedContext(value = lane(), headCommitSha = value.baseCommitSha) {
  return {
    verifyLaneBinding: (requested: Record<string, unknown>) => ({
      verified: true,
      ...requested,
      headCommitSha,
    }),
  }
}

function mismatchedTrustedContext(value = lane(), headCommitSha = value.baseCommitSha) {
  return {
    verifyLaneBinding: () => ({
      verified: true,
      laneId: value.laneId,
      workOrderId: value.workOrderId,
      repository: value.repository,
      repositoryRoot: value.repositoryRoot,
      workspacePath: value.workspacePath,
      branch: value.branch,
      baseRef: value.baseRef,
      baseCommitSha: value.baseCommitSha,
      lifecycleState: value.lifecycleState,
      reservedPaths: value.reservedPaths.map((entry) => entry.toLowerCase()),
      reservationSetId: value.reservationSetId,
      leaseId: value.leaseId,
      leaseFence: value.leaseFence,
      evidenceEventId: value.evidenceEventId,
      headCommitSha,
    }),
  }
}

function expectWall(value: unknown, code: string, field?: string, detail?: string) {
  try {
    planIsolatedWorkspaces(value)
    throw new Error("expected planning wall")
  } catch (error) {
    expect(error).toBeInstanceOf(IsolatedWorkspaceManagerError)
    expect(error).toMatchObject({ code, ...(field ? { field } : {}), ...(detail ? { detail } : {}) })
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe("multi-agent isolated workspace manager", () => {
  it("plans CREATE for an absent lane workspace without executing", () => {
    expect(planIsolatedWorkspaces(input())).toMatchObject({
      artifactType: "MULTI_AGENT_ISOLATED_WORKSPACE_PLAN",
      status: "PLANNED",
      actions: [{ action: "CREATE", reasonCodes: ["WORKSPACE_ABSENT"] }],
      planningOnly: true,
      localContractOnly: true,
      gitCommandPerformed: false,
      filesystemMutationPerformed: false,
      executionPerformed: false,
      cleanupPerformed: false,
      executionAuthorized: false,
      mutationPerformed: false,
      authorityGranted: false,
      ownerOperationsRequired: false,
    })
  })

  it("plans REUSE only for exact clean owned identity", () => {
    const value = lane("LANE-A", "WO-MAO-025", { observedWorkspace: observed() })
    expect(planIsolatedWorkspaces(input([value]))).toMatchObject({
      actions: [{ action: "REUSE", reasonCodes: ["EXACT_CLEAN_IDENTITY"] }],
    })
  })

  it.each([
    ["advanced head", { headCommitSha: HEAD_SHA }],
  ])("rejects unproven dirty drift but plans clean head reconciliation: %s", (_name, drift) => {
    const value = lane("LANE-A", "WO-MAO-025", { observedWorkspace: observed("LANE-A", "WO-MAO-025", drift) })
    if (Object.hasOwn(drift, "headCommitSha")) {
      expect(planIsolatedWorkspaces(input([value]))).toMatchObject({
        actions: [{ action: "RECONCILE", reasonCodes: ["OWNED_SAFE_DRIFT"] }],
      })
    } else {
      expectWall(input([value]), "ISOLATED_WORKSPACE_FOREIGN_CHANGE_WALL")
    }
  })

  it("plans CLEANUP only for terminal exact clean owned state", () => {
    const value = lane("LANE-A", "WO-MAO-025", {
      lifecycleState: "COMPLETE",
      observedWorkspace: observed(),
    })
    expect(planIsolatedWorkspaces(input([value]))).toMatchObject({
      actions: [{ action: "CLEANUP", reasonCodes: ["TERMINAL_CLEAN_EXACT_OWNERSHIP"] }],
      cleanupPerformed: false,
    })
  })

  it("produces deterministic plans regardless of lane and change order", () => {
    const a = lane("LANE-A", "WO-MAO-025", {
      observedWorkspace: observed("LANE-A", "WO-MAO-025", {
        headCommitSha: HEAD_SHA,
      }),
    })
    const b = lane("LANE-B", "WO-MAO-026")
    const first = planIsolatedWorkspaces(input([b, a]))
    const secondInput = input([structuredClone(a), structuredClone(b)])
    expect(planIsolatedWorkspaces(secondInput)).toEqual(first)
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rejects duplicate lane, work order, path, and branch ownership", () => {
    expectWall(input([lane(), lane()]), "ISOLATED_WORKSPACE_DUPLICATE_LANE_WALL", "lanes")
    expectWall(input([lane(), lane("LANE-B", "WO-MAO-025")]), "ISOLATED_WORKSPACE_DUPLICATE_WORK_ORDER_WALL", "lanes")
    expectWall(input([lane(), lane("LANE-B", "WO-MAO-026", { workspacePath: `${ROOT}/lane-a` })]),
      "ISOLATED_WORKSPACE_SHARED_PATH_WALL", "lanes")
    expectWall(input([lane(), lane("LANE-B", "WO-MAO-026", { workspacePath: `${ROOT}/lane-a/nested` })]),
      "ISOLATED_WORKSPACE_SHARED_PATH_WALL", "lanes")
    expectWall(input([lane(), lane("LANE-B", "WO-MAO-026", { branch: "codex/wo-mao-025" })]),
      "ISOLATED_WORKSPACE_SHARED_BRANCH_WALL", "lanes")
    expectWall(input([lane(), lane("LANE-B", "WO-MAO-026", { branch: "codex/wo-mao-025/nested" })]),
      "ISOLATED_WORKSPACE_SHARED_BRANCH_WALL", "lanes")
    expectWall(input([lane(), lane("LANE-B", "WO-MAO-026", { branch: "CODEX/WO-MAO-025" })]),
      "ISOLATED_WORKSPACE_SHARED_BRANCH_WALL", "lanes")
    expectWall(input([lane(), lane("LANE-B", "WO-MAO-026", { reservedPaths: ["lanes/lane-a/unit"] })]),
      "ISOLATED_WORKSPACE_RESERVATION_WALL", "lanes")
  })

  it.each([
    ["repository", "bsvalues/foreign", "ISOLATED_WORKSPACE_FOREIGN_REPOSITORY_WALL"],
    ["repositoryRoot", "/operator/source/foreign", "ISOLATED_WORKSPACE_FOREIGN_REPOSITORY_WALL"],
    ["workspacePath", `${ROOT}/lane-b`, "ISOLATED_WORKSPACE_FOREIGN_WORKSPACE_WALL"],
    ["branch", "codex/foreign", "ISOLATED_WORKSPACE_FOREIGN_BRANCH_WALL"],
    ["baseRef", "refs/heads/release", "ISOLATED_WORKSPACE_FOREIGN_BASE_WALL"],
    ["baseCommitSha", HEAD_SHA, "ISOLATED_WORKSPACE_FOREIGN_BASE_WALL"],
  ] as const)("rejects foreign observed %s identity", (field, replacement, code) => {
    const value = lane("LANE-A", "WO-MAO-025", {
      observedWorkspace: observed("LANE-A", "WO-MAO-025", { [field]: replacement }),
    })
    expectWall(input([value]), code, `lanes[0].observedWorkspace.${field}`)
  })

  it("rejects foreign owner identity and shared worktree or branch attachment", () => {
    for (const [field, replacement, code] of [
      ["ownerLaneId", "LANE-B", "ISOLATED_WORKSPACE_FOREIGN_OWNER_WALL"],
      ["ownerWorkOrderId", "WO-MAO-026", "ISOLATED_WORKSPACE_FOREIGN_OWNER_WALL"],
      ["worktreeLaneIds", ["LANE-A", "LANE-B"], "ISOLATED_WORKSPACE_SHARED_WORKTREE_WALL"],
      ["branchLaneIds", ["LANE-A", "LANE-B"], "ISOLATED_WORKSPACE_SHARED_BRANCH_WALL"],
    ] as const) {
      const value = lane("LANE-A", "WO-MAO-025", {
        observedWorkspace: observed("LANE-A", "WO-MAO-025", { [field]: replacement }),
      })
      expectWall(input([value]), code, `lanes[0].observedWorkspace.${field}`)
    }
  })

  it("rejects foreign tracked, untracked, and ignored changes", () => {
    for (const collection of ["trackedChanges", "untrackedChanges", "ignoredChanges"] as const) {
      const value = lane("LANE-A", "WO-MAO-025", {
        observedWorkspace: observed("LANE-A", "WO-MAO-025", { [collection]: ["components/foreign.ts"] }),
      })
      expectWall(input([value]), "ISOLATED_WORKSPACE_FOREIGN_CHANGE_WALL",
        `lanes[0].observedWorkspace.${collection}`)
    }
  })

  it.each([
    ["sibling escape", `${ROOT}/../foreign`],
    ["prefix confusion", `${ROOT}-foreign/lane-a`],
    ["root itself", ROOT],
  ])("rejects %s outside the workspace root", (_name, workspacePath) => {
    expectWall(input([lane("LANE-A", "WO-MAO-025", { workspacePath })]),
      "ISOLATED_WORKSPACE_PATH_WALL", "lanes[0].workspacePath", "OUTSIDE_WORKSPACE_ROOT")
  })

  it("rejects relative paths and unsafe cleanup", () => {
    expectWall(input([lane("LANE-A", "WO-MAO-025", { workspacePath: "../lane-a" })]),
      "ISOLATED_WORKSPACE_PATH_WALL", "lanes[0].workspacePath", "ABSOLUTE_PATH_REQUIRED")
    for (const drift of [{ headCommitSha: HEAD_SHA }]) {
      const value = lane("LANE-A", "WO-MAO-025", {
        lifecycleState: "COMPLETE",
        observedWorkspace: observed("LANE-A", "WO-MAO-025", drift),
      })
      expectWall(input([value]), "ISOLATED_WORKSPACE_UNSAFE_CLEANUP_WALL",
        "lanes[0].observedWorkspace")
    }
  })

  it("rejects malformed, missing, unknown, and authority-minting fields", () => {
    const missing = input() as Partial<ReturnType<typeof input>>
    delete missing.planId
    expectWall(missing, "ISOLATED_WORKSPACE_MISSING_FIELD_WALL", "input.planId")
    expectWall({ ...input(), schemaVersion: 2 }, "ISOLATED_WORKSPACE_INPUT_WALL", "schemaVersion")
    expectWall({ ...input(), unexpected: true }, "ISOLATED_WORKSPACE_UNKNOWN_FIELD_WALL", "input.unexpected")
    expectWall(input([lane("LANE-A", "WO-MAO-025", { branch: "HEAD" })]),
      "ISOLATED_WORKSPACE_FORMAT_WALL", "lanes[0].branch", "SAFE_GIT_BRANCH_REQUIRED")
    const unknownLane = input()
    Object.assign(unknownLane.lanes[0], { command: "git worktree add" })
    expectWall(unknownLane, "ISOLATED_WORKSPACE_UNKNOWN_FIELD_WALL", "lanes[0].command")
    for (const field of ["authorityGranted", "executionAuthorized", "dispatchAuthorized", "mutationAuthorized", "cleanupAuthorized"]) {
      expectWall({ ...input(), [field]: true }, "ISOLATED_WORKSPACE_AUTHORITY_MINT_WALL", field,
        "FALSE_OR_OMITTED_REQUIRED")
    }
  })

  it("canonicalizes equivalent Windows paths before hashing", () => {
    const upper = input([lane("LANE-A", "WO-MAO-025", {
      repositoryRoot: "C:\\Ops\\Source",
      workspacePath: "C:\\Ops\\Worktrees\\Lane-A",
    })])
    upper.workspaceRoot = "C:\\Ops\\Worktrees"
    const lower = structuredClone(upper)
    lower.workspaceRoot = "c:/ops/worktrees"
    lower.lanes[0].repositoryRoot = "c:/ops/source"
    lower.lanes[0].workspacePath = "c:/ops/worktrees/lane-a"
    expect(planIsolatedWorkspaces(lower).planHash).toBe(planIsolatedWorkspaces(upper).planHash)
  })

  it("rejects Windows reservation collisions regardless of path case", () => {
    const first = lane("LANE-A", "WO-MAO-025", { reservedPaths: ["Components/Operator"] })
    const second = lane("LANE-B", "WO-MAO-026", { reservedPaths: ["components/operator/registry.ts"] })
    expectWall(input([first, second]), "ISOLATED_WORKSPACE_RESERVATION_WALL", "lanes")
  })

  it("does not invoke Git or mutate the filesystem", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-workspace-noop-"))
    temporaryDirectories.push(directory)
    const root = path.join(directory, "worktrees")
    const repositoryRoot = path.join(directory, "repository")
    const workspacePath = path.join(root, "lane-a")
    const marker = path.join(directory, "marker.txt")
    fs.mkdirSync(root)
    fs.mkdirSync(repositoryRoot)
    fs.writeFileSync(marker, "unchanged")
    const before = fs.readdirSync(directory, { recursive: true }).sort()
    const value = input([lane("LANE-A", "WO-MAO-025", { repositoryRoot, workspacePath })])
    const result = planIsolatedWorkspaces({ ...value, workspaceRoot: root })
    expect(result).toMatchObject({ actions: [{ action: "CREATE" }], gitCommandPerformed: false,
      filesystemMutationPerformed: false })
    expect(fs.existsSync(workspacePath)).toBe(false)
    expect(fs.readFileSync(marker, "utf8")).toBe("unchanged")
    expect(fs.readdirSync(directory, { recursive: true }).sort()).toEqual(before)
  })

  it("creates, validates, reconciles, and safely cleans a real owned worktree", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-workspace-live-"))
    temporaryDirectories.push(directory)
    const repositoryRoot = path.join(directory, "repository")
    const workspaceRoot = path.join(directory, "worktrees")
    const workspacePath = path.join(workspaceRoot, "lane-a")
    fs.mkdirSync(repositoryRoot)
    fs.mkdirSync(workspaceRoot)
    execFileSync("git", ["init", "-b", "main"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.name", "WilliamOS Test"], { cwd: repositoryRoot })
    fs.writeFileSync(path.join(repositoryRoot, "README.md"), "proof\n")
    execFileSync("git", ["add", "README.md"], { cwd: repositoryRoot })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repositoryRoot })
    const baseCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim()
    const desired = lane("LANE-A", "WO-MAO-025", {
      repositoryRoot,
      workspacePath,
      baseCommitSha,
      observedWorkspace: null,
    })
    const value = { ...input([desired]), workspaceRoot }

    expect(() => executeIsolatedWorkspaceLifecycle(value)).toThrow("HOST_VERIFIER_REQUIRED")
    const trust = trustedContext(desired)
    const created = executeIsolatedWorkspaceLifecycle(value, trust)
    expect(created).toMatchObject({
      results: [{ action: "CREATE", changed: true }],
      executionPerformed: true,
      mutationPerformed: true,
      authorityGranted: false,
    })
    expect(created.requestedPlanHash).toMatch(/^[a-f0-9]{64}$/)
    expect(created.executionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(created.results[0]).toMatchObject({
      checkpointHeadCommitSha: baseCommitSha,
      trustedBindingHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(fs.existsSync(workspacePath)).toBe(true)
    expect(executeIsolatedWorkspaceLifecycle(value, trust)).toMatchObject({
      results: [{ action: "REUSE", changed: false }],
      mutationPerformed: false,
    })

    execFileSync("git", ["worktree", "remove", "--", workspacePath], { cwd: repositoryRoot })
    expect(executeIsolatedWorkspaceLifecycle(value, trust)).toMatchObject({
      results: [{ action: "RECONCILE", changed: true }],
    })
    const terminal = structuredClone(value)
    terminal.lanes[0].lifecycleState = "COMPLETE"
    expect(executeIsolatedWorkspaceLifecycle(terminal, trustedContext(terminal.lanes[0]))).toMatchObject({
      results: [{ action: "CLEANUP", changed: true }],
    })
    expect(fs.existsSync(workspacePath)).toBe(false)
    expect(spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/codex/wo-mao-025"], {
      cwd: repositoryRoot,
    }).status).not.toBe(0)
  })

  it("requires single-lane atomic apply before any workspace mutation", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-workspace-atomic-"))
    temporaryDirectories.push(directory)
    const workspaceRoot = path.join(directory, "worktrees")
    const repositoryRoot = path.join(directory, "repository")
    fs.mkdirSync(workspaceRoot)
    fs.mkdirSync(repositoryRoot)
    const lanes = [
      lane("LANE-A", "WO-MAO-025", {
        repositoryRoot,
        workspacePath: path.join(workspaceRoot, "lane-a"),
      }),
      lane("LANE-B", "WO-MAO-026", {
        repositoryRoot,
        workspacePath: path.join(workspaceRoot, "lane-b"),
      }),
    ]
    expect(() => executeIsolatedWorkspaceLifecycle({ ...input(lanes), workspaceRoot }, trustedContext(lanes[0])))
      .toThrow("SINGLE_LANE_ATOMIC_APPLY_REQUIRED")
    expect(fs.readdirSync(workspaceRoot)).toEqual([])
  })

  it("rejects fresh creation when the verified checkpoint is beyond the absent branch", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-workspace-missing-checkpoint-"))
    temporaryDirectories.push(directory)
    const workspaceRoot = path.join(directory, "worktrees")
    const repositoryRoot = path.join(directory, "repository")
    fs.mkdirSync(workspaceRoot)
    fs.mkdirSync(repositoryRoot)
    execFileSync("git", ["init", "-b", "main"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.name", "WilliamOS Test"], { cwd: repositoryRoot })
    fs.writeFileSync(path.join(repositoryRoot, "README.md"), "proof\n")
    execFileSync("git", ["add", "README.md"], { cwd: repositoryRoot })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repositoryRoot })
    const baseCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim()
    const desired = lane("LANE-A", "WO-MAO-025", {
      repositoryRoot,
      workspacePath: path.join(workspaceRoot, "lane-a"),
      baseCommitSha,
    })
    expect(() => executeIsolatedWorkspaceLifecycle(
      { ...input([desired]), workspaceRoot },
      trustedContext(desired, HEAD_SHA),
    )).toThrow("CHECKPOINT_BRANCH_MISSING")
    expect(fs.readdirSync(workspaceRoot)).toEqual([])
  })

  it("rejects ignored live changes and a branch tip beyond the ownership checkpoint", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-workspace-fences-"))
    temporaryDirectories.push(directory)
    const repositoryRoot = path.join(directory, "repository")
    const workspaceRoot = path.join(directory, "worktrees")
    const workspacePath = path.join(workspaceRoot, "lane-a")
    fs.mkdirSync(repositoryRoot)
    fs.mkdirSync(workspaceRoot)
    execFileSync("git", ["init", "-b", "main"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.name", "WilliamOS Test"], { cwd: repositoryRoot })
    fs.writeFileSync(path.join(repositoryRoot, ".gitignore"), "*.ignored\n")
    fs.writeFileSync(path.join(repositoryRoot, "README.md"), "proof\n")
    execFileSync("git", ["add", ".gitignore", "README.md"], { cwd: repositoryRoot })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repositoryRoot })
    const baseCommitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim()
    const desired = lane("LANE-A", "WO-MAO-025", {
      repositoryRoot,
      workspacePath,
      baseCommitSha,
    })
    const value = { ...input([desired]), workspaceRoot }
    const trust = trustedContext(desired)
    executeIsolatedWorkspaceLifecycle(value, trust)

    fs.writeFileSync(path.join(workspacePath, "foreign.ignored"), "foreign\n")
    expect(() => executeIsolatedWorkspaceLifecycle(value, trust)).toThrow("ISOLATED_WORKSPACE_FOREIGN_CHANGE_WALL")
    fs.rmSync(path.join(workspacePath, "foreign.ignored"))

    fs.writeFileSync(path.join(workspacePath, "README.md"), "advanced\n")
    execFileSync("git", ["add", "README.md"], { cwd: workspacePath })
    execFileSync("git", ["commit", "-m", "advance"], { cwd: workspacePath })
    expect(() => executeIsolatedWorkspaceLifecycle(value, trust)).toThrow("CHECKPOINT_HEAD_MISMATCH")
    const advancedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspacePath, encoding: "utf8" }).trim()
    expect(executeIsolatedWorkspaceLifecycle(value, trustedContext(desired, advancedHead))).toMatchObject({
      results: [{ action: "REUSE", changed: false }],
    })
    execFileSync("git", ["merge", "--ff-only", "codex/wo-mao-025"], { cwd: repositoryRoot })
    const terminal = structuredClone(value)
    terminal.lanes[0].lifecycleState = "COMPLETE"
    expect(executeIsolatedWorkspaceLifecycle(
      terminal,
      trustedContext(terminal.lanes[0], advancedHead),
    )).toMatchObject({
      results: [{ action: "CLEANUP", changed: true }],
    })
    expect(fs.existsSync(workspacePath)).toBe(false)
  })

  it("binds trusted verification to lifecycle intent and reservation scope", () => {
    const value = lane()
    const wrongIntent = mismatchedTrustedContext({ ...value, lifecycleState: "COMPLETE" })
    const wrongReservation = mismatchedTrustedContext({ ...value, reservedPaths: ["foreign/path"] })
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-workspace-trust-"))
    temporaryDirectories.push(directory)
    const workspaceRoot = path.join(directory, "worktrees")
    const repositoryRoot = path.join(directory, "repository")
    fs.mkdirSync(workspaceRoot)
    fs.mkdirSync(repositoryRoot)
    const desired = lane("LANE-A", "WO-MAO-025", {
      repositoryRoot,
      workspacePath: path.join(workspaceRoot, "lane-a"),
    })
    const request = { ...input([desired]), workspaceRoot }
    expect(() => executeIsolatedWorkspaceLifecycle(request, wrongIntent)).toThrow("EXACT_STORE_BINDING_REQUIRED")
    expect(() => executeIsolatedWorkspaceLifecycle(request, wrongReservation)).toThrow("EXACT_STORE_BINDING_REQUIRED")
  })

  it("rolls back Git creation when ownership persistence fails", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-workspace-rollback-"))
    temporaryDirectories.push(directory)
    const repositoryRoot = path.join(directory, "repository")
    const workspaceRoot = path.join(directory, "worktrees")
    const workspacePath = path.join(workspaceRoot, "lane-a")
    fs.mkdirSync(repositoryRoot)
    fs.mkdirSync(workspaceRoot)
    execFileSync("git", ["init", "-b", "main"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.name", "WilliamOS Test"], { cwd: repositoryRoot })
    fs.writeFileSync(path.join(repositoryRoot, "README.md"), "proof\n")
    execFileSync("git", ["add", "README.md"], { cwd: repositoryRoot })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repositoryRoot })
    const baseCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim()
    const desired = lane("LANE-A", "WO-MAO-025", { repositoryRoot, workspacePath, baseCommitSha })
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("persistence failed") })
    expect(() => executeIsolatedWorkspaceLifecycle(
      { ...input([desired]), workspaceRoot },
      trustedContext(desired),
    )).toThrow("persistence failed")
    rename.mockRestore()
    expect(fs.existsSync(workspacePath)).toBe(false)
    expect(spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/codex/wo-mao-025"], {
      cwd: repositoryRoot,
    }).status).not.toBe(0)
    expect(fs.existsSync(path.join(workspaceRoot, ".williamos-workspace-ownership.json"))).toBe(false)
  })

  it("restores the exact branch and worktree when cleanup persistence fails", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-workspace-cleanup-rollback-"))
    temporaryDirectories.push(directory)
    const repositoryRoot = path.join(directory, "repository")
    const workspaceRoot = path.join(directory, "worktrees")
    const workspacePath = path.join(workspaceRoot, "lane-a")
    fs.mkdirSync(repositoryRoot)
    fs.mkdirSync(workspaceRoot)
    execFileSync("git", ["init", "-b", "main"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repositoryRoot })
    execFileSync("git", ["config", "user.name", "WilliamOS Test"], { cwd: repositoryRoot })
    fs.writeFileSync(path.join(repositoryRoot, "README.md"), "proof\n")
    execFileSync("git", ["add", "README.md"], { cwd: repositoryRoot })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repositoryRoot })
    const baseCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim()
    const desired = lane("LANE-A", "WO-MAO-025", { repositoryRoot, workspacePath, baseCommitSha })
    const value = { ...input([desired]), workspaceRoot }
    executeIsolatedWorkspaceLifecycle(value, trustedContext(desired))
    const terminal = structuredClone(value)
    terminal.lanes[0].lifecycleState = "COMPLETE"
    const ownershipBefore = fs.readFileSync(path.join(workspaceRoot, ".williamos-workspace-ownership.json"), "utf8")
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("cleanup persistence failed") })
    expect(() => executeIsolatedWorkspaceLifecycle(terminal, trustedContext(terminal.lanes[0])))
      .toThrow("cleanup persistence failed")
    rename.mockRestore()
    expect(fs.existsSync(workspacePath)).toBe(true)
    expect(execFileSync("git", ["rev-parse", "codex/wo-mao-025"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim()).toBe(baseCommitSha)
    expect(fs.readFileSync(path.join(workspaceRoot, ".williamos-workspace-ownership.json"), "utf8"))
      .toBe(ownershipBefore)
    expect(executeIsolatedWorkspaceLifecycle(terminal, trustedContext(terminal.lanes[0]))).toMatchObject({
      results: [{ action: "CLEANUP", changed: true }],
    })
  })

  it("CLI emits typed success and failure without executing", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-workspace-cli-"))
    temporaryDirectories.push(directory)
    const validPath = path.join(directory, "valid.json")
    const invalidPath = path.join(directory, "invalid.json")
    fs.writeFileSync(validPath, JSON.stringify(input()))
    fs.writeFileSync(invalidPath, JSON.stringify({ ...input(), authorityGranted: true }))
    const cli = path.resolve("scripts/multi-agent-operator/isolated-workspace-manager-cli.mjs")
    const success = spawnSync(process.execPath, [cli, "plan", validPath], { encoding: "utf8", env: {} })
    expect(success.status).toBe(0)
    expect(success.stderr).toBe("")
    expect(JSON.parse(success.stdout)).toMatchObject({
      ok: true,
      actions: [{ action: "CREATE" }],
      planningOnly: true,
      gitCommandPerformed: false,
      filesystemMutationPerformed: false,
      executionAuthorized: false,
      authorityGranted: false,
    })
    const failure = spawnSync(process.execPath, [cli, "plan", invalidPath], { encoding: "utf8", env: {} })
    expect(failure.status).toBe(2)
    expect(failure.stderr).toBe("")
    expect(JSON.parse(failure.stdout)).toMatchObject({
      ok: false,
      code: "ISOLATED_WORKSPACE_AUTHORITY_MINT_WALL",
      field: "authorityGranted",
      planningOnly: true,
      gitCommandPerformed: false,
      filesystemMutationPerformed: false,
      executionAuthorized: false,
      authorityGranted: false,
    })

    const workspaceRoot = path.join(directory, "worktrees")
    const repositoryRoot = path.join(directory, "repository")
    const workspacePath = path.join(workspaceRoot, "lane-a")
    fs.mkdirSync(workspaceRoot)
    fs.mkdirSync(repositoryRoot)
    const applyPath = path.join(directory, "apply.json")
    fs.writeFileSync(applyPath, JSON.stringify({
      ...input([lane("LANE-A", "WO-MAO-025", { repositoryRoot, workspacePath })]),
      workspaceRoot,
    }))
    const apply = spawnSync(process.execPath, [cli, "apply", applyPath], { encoding: "utf8", env: {} })
    expect(apply.status).toBe(2)
    expect(JSON.parse(apply.stdout)).toMatchObject({
      ok: false,
      code: "ISOLATED_WORKSPACE_TRUST_WALL",
      detail: "HOST_VERIFIER_REQUIRED",
      executionPerformed: false,
      mutationPerformed: false,
      authorityGranted: false,
    })
    expect(fs.existsSync(workspacePath)).toBe(false)
  })
})
