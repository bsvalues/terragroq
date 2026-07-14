import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { assertLegacyAdapterDispatchAllowed, runOperationalKernelCycle, selectEligibleWorkOrder } from "@/scripts/runtime-operator/operational-kernel.mjs"

describe("WilliamOS operational kernel", () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  it("preserves the typed terminal-quarantine signal in the direct CLI", () => {
    const cli = fs.readFileSync("scripts/runtime-operator/operational-kernel-cli.mjs", "utf8")
    expect(cli).toContain("QUARANTINED_TERMINAL|[A-Z][A-Z0-9_]+_WALL")
  })

  it("rejects the quarantined legacy adapter before any dispatch side effect", async () => {
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      adapter: {
        adapterId: "local-nested-codex-exec",
        state: "QUARANTINED_TERMINAL",
        dispatchAllowed: false,
        retryAllowed: false,
        terminalIssueNumber: 357,
        terminalReason: "CODEX_NETWORK_WALL",
      },
      workOrders: [
        {
          workOrderId: "WO-RUNTIME-KERNEL-PILOT-001",
          adapterId: "local-nested-codex-exec",
          authority: "REVOKED_TERMINAL",
          executionAllowed: false,
          retryAllowed: false,
        },
        {
          workOrderId: "WO-RUNTIME-KERNEL-CONTINUATION-001",
          adapterId: "local-nested-codex-exec",
          authority: "REVOKED_TERMINAL",
          executionAllowed: false,
          retryAllowed: false,
        },
      ],
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-quarantine-"))
    roots.push(root)
    const sideEffects: string[] = []
    const adapters = {
      adapterId: "local-nested-codex-exec",
      assertRuntime: async () => sideEffects.push("readiness"),
      listQueue: async () => { sideEffects.push("queue"); return [] },
      lease: async () => sideEffects.push("lease"),
      prepareWorkspace: async () => { sideEffects.push("workspace"); return "unused" },
      invokeCodex: async () => { sideEffects.push("provider"); return { result: "NO_CHANGE" } },
    }

    await expect(runOperationalKernelCycle({ root, registry, adapters })).rejects.toThrow("QUARANTINED_TERMINAL")
    expect(sideEffects).toEqual([])

    const changedRegistry = structuredClone(registry)
    changedRegistry.adapter.state = "ACTIVE"
    await expect(runOperationalKernelCycle({ root, registry: changedRegistry, adapters })).rejects.toThrow("LEGACY_ADAPTER_QUARANTINE_INTEGRITY_WALL")

    const markerRemoved = structuredClone(registry)
    delete (markerRemoved as { adapter?: unknown }).adapter
    await expect(runOperationalKernelCycle({ root, registry: markerRemoved, adapters })).rejects.toThrow("LEGACY_ADAPTER_QUARANTINE_INTEGRITY_WALL")
    await expect(runOperationalKernelCycle({
      root,
      registry: { schemaVersion: 1, repository: "bsvalues/terragroq", workOrders: [] },
      adapters,
    })).rejects.toThrow("LEGACY_ADAPTER_QUARANTINE_INTEGRITY_WALL")
    expect(sideEffects).toEqual([])
  })

  it("treats signed revocation evidence as optional defense-in-depth without allowing dispatch", async () => {
    const registry = JSON.parse(fs.readFileSync("runtime-operator/native/authority-registry.json", "utf8"))
    const observations: unknown[] = []
    await expect(assertLegacyAdapterDispatchAllowed(
      registry,
      undefined,
      "local-nested-codex-exec",
    ))
      .rejects.toThrow("QUARANTINED_TERMINAL")
    await expect(assertLegacyAdapterDispatchAllowed(registry, async (request) => {
      observations.push(request)
      return { status: "VERIFIED_REVOKED" }
    }, "local-nested-codex-exec")).rejects.toThrow("QUARANTINED_TERMINAL")
    expect(observations).toEqual([{
      adapterId: "local-nested-codex-exec",
      terminalIssueNumber: 357,
      terminalReason: "CODEX_NETWORK_WALL",
      workOrderIds: ["WO-RUNTIME-KERNEL-PILOT-001", "WO-RUNTIME-KERNEL-CONTINUATION-001"],
    }])
  })

  it("resumes one approved Work Order through remediation, verified merge, evidence, and next selection", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-"))
    roots.push(root)
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      workOrders: [
        {
          workOrderId: "WO-KERNEL-ACCEPTANCE-001",
          authority: "APPROVED",
          riskClass: "R0",
          dependencies: [],
          ownerGateRequired: false,
          protectedScope: false,
          baseBranch: "main",
          mergeMode: "AUTO_ELIGIBLE",
          allowedPaths: ["docs/reports/kernel-acceptance.md"],
          requiredValidation: ["diff-check", "lint", "test", "build"],
          task: "Add the bounded kernel acceptance evidence file.",
        },
        {
          workOrderId: "WO-KERNEL-ACCEPTANCE-002",
          authority: "APPROVED",
          riskClass: "R0",
          dependencies: ["WO-KERNEL-ACCEPTANCE-001"],
          ownerGateRequired: false,
          protectedScope: false,
          baseBranch: "main",
          mergeMode: "AUTO_ELIGIBLE",
          allowedPaths: ["docs/reports/kernel-next.md"],
          requiredValidation: ["diff-check"],
          task: "Record the next bounded evidence item.",
        },
      ],
    }
    const queue = [
      { issueNumber: 901, workOrderId: "WO-KERNEL-ACCEPTANCE-001", state: "READY", createdAt: "2026-07-13T01:00:00Z" },
      { issueNumber: 902, workOrderId: "WO-KERNEL-ACCEPTANCE-002", state: "READY", createdAt: "2026-07-13T02:00:00Z" },
    ]
    const calls: string[] = []
    let prInspection = 0
    const adapters = {
      assertRuntime: async () => calls.push("runtime:verified"),
      listQueue: async () => queue,
      resolveBaseSha: async () => "a".repeat(40),
      lease: async (issueNumber: number) => calls.push(`lease:${issueNumber}`),
      prepareWorkspace: async ({ workOrderId }: { workOrderId: string }) => {
        calls.push(`workspace:${workOrderId}`)
        return path.join(root, "workspace", workOrderId.toLowerCase())
      },
      invokeCodex: async ({ remediation }: { remediation: boolean }) => {
        calls.push(remediation ? "codex:remediation" : "codex:implementation")
        return { result: "PATCH_READY", summary: "bounded change", unifiedPatch: "diff --git a/x b/x" }
      },
      applyAndInspect: async ({ allowedPaths }: { allowedPaths: string[] }) => {
        calls.push(`diff:${allowedPaths.join(",")}`)
        return { changedPaths: ["docs/reports/kernel-acceptance.md"], patchBytes: 128 }
      },
      validate: async ({ requiredValidation }: { requiredValidation: string[] }) => calls.push(`validate:${requiredValidation.join(",")}`),
      publish: async ({ existingPr, resolvedThreadIds }: { existingPr: number | null; resolvedThreadIds: string[] }) => {
        calls.push(existingPr ? `push:${existingPr}` : "publish:new")
        if (existingPr) expect(resolvedThreadIds).toEqual(["thread-1"])
        return { branch: "runtime/wo-kernel-acceptance-001-issue-901", pr: existingPr ?? 77 }
      },
      inspectPullRequest: async () => {
        prInspection += 1
        calls.push(`inspect:${prInspection}`)
        return prInspection === 1
          ? { decision: "REMEDIATE", reason: "UNRESOLVED_REVIEW_THREADS", feedback: "Narrow evidence wording fix.", threadIds: ["thread-1"], threadPaths: ["docs/reports/kernel-acceptance.md"] }
          : { decision: "MERGE", reason: "ALL_GATES_GREEN", feedback: "" }
      },
      merge: async (pr: number) => {
        calls.push(`merge:${pr}`)
        return { mergeSha: "b".repeat(40) }
      },
      verifyMergedMain: async (mergeSha: string) => calls.push(`verify-main:${mergeSha}`),
      complete: async (issueNumber: number) => {
        calls.push(`complete:${issueNumber}`)
        queue[0].state = "COMPLETED"
      },
    }

    const first = await runOperationalKernelCycle({ root, registry, adapters })
    expect(first).toMatchObject({ state: "PR_OPEN", workOrderId: "WO-KERNEL-ACCEPTANCE-001", pr: 77 })

    const second = await runOperationalKernelCycle({ root, registry, adapters })
    expect(second).toMatchObject({ state: "PR_OPEN", workOrderId: "WO-KERNEL-ACCEPTANCE-001", remediationAttempts: 1 })

    const third = await runOperationalKernelCycle({ root, registry, adapters })
    expect(third).toMatchObject({
      state: "COMPLETED",
      workOrderId: "WO-KERNEL-ACCEPTANCE-001",
      mergeSha: "b".repeat(40),
      nextWorkOrderId: "WO-KERNEL-ACCEPTANCE-002",
    })
    expect(calls).toEqual([
      "runtime:verified",
      "lease:901",
      "workspace:WO-KERNEL-ACCEPTANCE-001",
      "codex:implementation",
      "diff:docs/reports/kernel-acceptance.md",
      "validate:diff-check,lint,test,build",
      "publish:new",
      "runtime:verified",
      "inspect:1",
      "codex:remediation",
      "diff:docs/reports/kernel-acceptance.md",
      "validate:diff-check,lint,test,build",
      "push:77",
      "runtime:verified",
      "inspect:2",
      "inspect:3",
      "merge:77",
      `verify-main:${"b".repeat(40)}`,
      "complete:901",
    ])

    const checkpoint = JSON.parse(fs.readFileSync(path.join(root, "state", "kernel-checkpoint.json"), "utf8"))
    expect(checkpoint).toMatchObject({ state: "COMPLETED", workOrderId: "WO-KERNEL-ACCEPTANCE-001", pr: 77 })
    const events = fs.readFileSync(path.join(root, "audit", "kernel-events.jsonl"), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line))
    expect(events.map((event) => event.state)).toEqual([
      "LEASED",
      "PATCH_PREPARED",
      "VALIDATING",
      "PR_OPEN",
      "REVIEW_REMEDIATION",
      "PATCH_PREPARED",
      "VALIDATING",
      "PR_OPEN",
      "MERGE_READY",
      "MERGED",
      "MERGED_VERIFIED",
      "ISSUE_COMPLETED",
      "COMPLETED",
    ])
  })

  it("reconciles a persisted patch checkpoint without invoking Codex again", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-resume-"))
    roots.push(root)
    fs.mkdirSync(path.join(root, "state"), { recursive: true })
    fs.writeFileSync(path.join(root, "state", "kernel-checkpoint.json"), JSON.stringify({
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      goal: "GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      loop: "LOOP-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      workOrderId: "WO-KERNEL-RESUME-001",
      issueNumber: 903,
      state: "PATCH_PREPARED",
      baseSha: "a".repeat(40),
      workspace: path.join(root, "workspace"),
      branch: null,
      pr: null,
      attempt: 1,
      remediationAttempts: 0,
      changedPaths: ["docs/reports/resume.md"],
      patchBytes: 64,
    }))
    const calls: string[] = []
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      workOrders: [{
        workOrderId: "WO-KERNEL-RESUME-001",
        authority: "APPROVED",
        riskClass: "R0",
        dependencies: [],
        ownerGateRequired: false,
        protectedScope: false,
        baseBranch: "main",
        mergeMode: "AUTO_ELIGIBLE",
        allowedPaths: ["docs/reports/resume.md"],
        requiredValidation: ["diff-check"],
        task: "Resume the bounded patch.",
      }],
    }
    const result = await runOperationalKernelCycle({ root, registry, adapters: {
      assertRuntime: async () => calls.push("runtime"),
      listQueue: async () => [{ issueNumber: 903, workOrderId: "WO-KERNEL-RESUME-001", state: "LEASED", createdAt: "2026-07-13T01:00:00Z" }],
      invokeCodex: async () => { throw new Error("Codex must not run") },
      validate: async () => calls.push("validate"),
      publish: async () => ({ branch: "runtime/resume", pr: 78 }),
    } })
    expect(result).toMatchObject({ state: "PR_OPEN", pr: 78 })
    expect(calls).toEqual(["runtime", "validate"])
  })

  it("persists Codex transport failures for unattended backoff instead of owner escalation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-retry-"))
    roots.push(root)
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      workOrders: [{
        workOrderId: "WO-KERNEL-RETRY-001",
        authority: "APPROVED",
        riskClass: "R0",
        dependencies: [],
        ownerGateRequired: false,
        protectedScope: false,
        baseBranch: "main",
        mergeMode: "AUTO_ELIGIBLE",
        allowedPaths: ["docs/reports/retry.md"],
        requiredValidation: ["diff-check"],
        task: "Exercise recoverable transport state.",
      }],
    }
    const startedAt = Date.now()
    const result = await runOperationalKernelCycle({ root, registry, adapters: {
      assertRuntime: async () => undefined,
      listQueue: async () => [{ issueNumber: 904, workOrderId: "WO-KERNEL-RETRY-001", state: "READY", createdAt: "2026-07-13T01:00:00Z" }],
      resolveBaseSha: async () => "a".repeat(40),
      lease: async () => undefined,
      prepareWorkspace: async () => path.join(root, "workspace"),
      invokeCodex: async () => { throw new Error("CODEX_NETWORK_WALL") },
    } })
    expect(result).toMatchObject({ state: "FAILED_RECOVERABLE", resumeState: "LEASED", attempt: 2, ownerDecisionRequired: false })
    const checkpoint = JSON.parse(fs.readFileSync(path.join(root, "state", "kernel-checkpoint.json"), "utf8"))
    const retryDelay = Date.parse(checkpoint.nextAttemptAt) - startedAt
    expect(retryDelay).toBeGreaterThanOrEqual(14_000)
    expect(retryDelay).toBeLessThanOrEqual(17_000)
  })

  it("rejects globally forbidden authority paths before leasing", () => {
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      workOrders: [{
        workOrderId: "WO-KERNEL-FORBIDDEN-001",
        authority: "APPROVED",
        riskClass: "R0",
        dependencies: [],
        ownerGateRequired: false,
        protectedScope: false,
        baseBranch: "main",
        mergeMode: "AUTO_ELIGIBLE",
        allowedPaths: ["package.json"],
        requiredValidation: ["diff-check"],
        task: "Change a forbidden path.",
      }],
    }
    expect(() => selectEligibleWorkOrder(registry, [{
      issueNumber: 905,
      workOrderId: "WO-KERNEL-FORBIDDEN-001",
      state: "READY",
      createdAt: "2026-07-13T01:00:00Z",
    }])).toThrow("AUTHORITY_PATH_WALL")
  })

  it("rejects missing validation and secret-wall codes persist as terminal evidence", async () => {
    const invalid = {
      workOrderId: "WO-KERNEL-VALIDATION-MISSING-001",
      authority: "APPROVED",
      riskClass: "R0",
      dependencies: [],
      ownerGateRequired: false,
      protectedScope: false,
      baseBranch: "main",
      mergeMode: "AUTO_ELIGIBLE",
      allowedPaths: ["docs/reports/missing.md"],
      requiredValidation: [],
      task: "Missing validation.",
    }
    expect(() => selectEligibleWorkOrder({ schemaVersion: 1, repository: "bsvalues/terragroq", workOrders: [invalid] }, [
      { issueNumber: 910, workOrderId: invalid.workOrderId, state: "READY", createdAt: "2026-07-13T01:00:00Z" },
    ])).toThrow("AUTHORITY_VALIDATION_WALL")

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-secret-wall-"))
    roots.push(root)
    const valid = { ...invalid, workOrderId: "WO-KERNEL-SECRET-WALL-001", requiredValidation: ["diff-check"] }
    const result = await runOperationalKernelCycle({ root, registry: { schemaVersion: 1, repository: "bsvalues/terragroq", workOrders: [valid] }, adapters: {
      assertRuntime: async () => undefined,
      listQueue: async () => [{ issueNumber: 911, workOrderId: valid.workOrderId, state: "READY", createdAt: "2026-07-13T01:00:00Z" }],
      resolveBaseSha: async () => "a".repeat(40),
      lease: async () => undefined,
      prepareWorkspace: async () => path.join(root, "workspace"),
      invokeCodex: async () => ({ result: "PATCH_READY", summary: "bounded", unifiedPatch: "diff --git a/x b/x" }),
      applyAndInspect: async () => { throw new Error("PATCH_SECRET_OR_BINARY_WALL") },
    } })
    expect(result).toMatchObject({ state: "FAILED_TERMINAL", failureCode: "PATCH_SECRET_OR_BINARY_WALL" })
    const checkpointFile = path.join(root, "state", "kernel-checkpoint.json")
    const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, "utf8"))
    checkpoint.failureCode = `password = "${"x".repeat(16)}"`
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint))
    await expect(runOperationalKernelCycle({ root, registry: { schemaVersion: 1, repository: "bsvalues/terragroq", workOrders: [valid] }, adapters: {} })).rejects.toThrow("CHECKPOINT_SECRET_FIELD_WALL")
  })

  it("does not lease a duplicate queue record after the Work Order is completed", () => {
    const authority = {
      workOrderId: "WO-KERNEL-IDEMPOTENT-001",
      authority: "APPROVED",
      riskClass: "R0",
      dependencies: [],
      ownerGateRequired: false,
      protectedScope: false,
      baseBranch: "main",
      mergeMode: "AUTO_ELIGIBLE",
      allowedPaths: ["docs/reports/idempotent.md"],
      requiredValidation: ["diff-check"],
      task: "Do not duplicate completed work.",
    }
    expect(selectEligibleWorkOrder({ schemaVersion: 1, repository: "bsvalues/terragroq", workOrders: [authority] }, [
      { issueNumber: 908, workOrderId: authority.workOrderId, state: "COMPLETED", createdAt: "2026-07-13T01:00:00Z" },
      { issueNumber: 909, workOrderId: authority.workOrderId, state: "READY", createdAt: "2026-07-13T02:00:00Z" },
    ])).toBeNull()
  })

  it("remediates a local validation failure inside the same path and attempt budgets", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-validation-"))
    roots.push(root)
    fs.mkdirSync(path.join(root, "state"), { recursive: true })
    fs.writeFileSync(path.join(root, "state", "kernel-checkpoint.json"), JSON.stringify({
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      goal: "GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      loop: "LOOP-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      workOrderId: "WO-KERNEL-VALIDATION-001",
      issueNumber: 906,
      state: "PATCH_PREPARED",
      baseSha: "a".repeat(40),
      workspace: path.join(root, "workspace"),
      branch: null,
      pr: null,
      attempt: 1,
      remediationAttempts: 0,
      changedPaths: ["docs/reports/validation.md"],
      patchBytes: 64,
    }))
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      workOrders: [{
        workOrderId: "WO-KERNEL-VALIDATION-001",
        authority: "APPROVED",
        riskClass: "R0",
        dependencies: [],
        ownerGateRequired: false,
        protectedScope: false,
        baseBranch: "main",
        mergeMode: "AUTO_ELIGIBLE",
        allowedPaths: ["docs/reports/validation.md"],
        requiredValidation: ["test"],
        task: "Repair the bounded validation failure.",
      }],
    }
    let validationAttempt = 0
    const calls: string[] = []
    const adapters = {
      assertRuntime: async () => undefined,
      listQueue: async () => [{ issueNumber: 906, workOrderId: "WO-KERNEL-VALIDATION-001", state: "LEASED", createdAt: "2026-07-13T01:00:00Z" }],
      validate: async () => {
        validationAttempt += 1
        if (validationAttempt === 1) throw new Error("VALIDATION_TEST_WALL")
        calls.push("validation:pass")
      },
      invokeCodex: async ({ remediation }: { remediation: boolean }) => {
        calls.push(`codex:${remediation}`)
        return { result: "PATCH_READY", summary: "repair", unifiedPatch: "diff --git a/x b/x" }
      },
      applyAndInspect: async ({ allowExistingStaged, allowedPaths }: { allowExistingStaged: boolean; allowedPaths: string[] }) => {
        expect(allowedPaths).toEqual(["docs/reports/validation.md"])
        calls.push(`existing:${allowExistingStaged}`)
        return { changedPaths: ["docs/reports/validation.md"], patchBytes: 96 }
      },
      publish: async () => ({ branch: "runtime/validation", pr: 79 }),
    }
    const failed = await runOperationalKernelCycle({ root, registry, adapters })
    expect(failed).toMatchObject({ state: "REVIEW_REMEDIATION", remediationSource: "VALIDATION", remediationAttempts: 1 })
    const recovered = await runOperationalKernelCycle({ root, registry, adapters })
    expect(recovered).toMatchObject({ state: "PR_OPEN", pr: 79 })
    expect(calls).toEqual(["codex:true", "existing:true", "validation:pass"])
  })

  it("holds owner and terminal walls and honors retry time before network readiness", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-hold-"))
    roots.push(root)
    fs.mkdirSync(path.join(root, "state"), { recursive: true })
    const checkpointPath = path.join(root, "state", "kernel-checkpoint.json")
    const base = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      goal: "GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      loop: "LOOP-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      workOrderId: "WO-KERNEL-HOLD-001",
      issueNumber: 907,
      baseSha: "a".repeat(40),
      workspace: path.join(root, "workspace"),
      branch: null,
      pr: null,
      attempt: 1,
      remediationAttempts: 0,
    }
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      workOrders: [{
        workOrderId: "WO-KERNEL-HOLD-001",
        authority: "APPROVED",
        riskClass: "R0",
        dependencies: [],
        ownerGateRequired: false,
        protectedScope: false,
        baseBranch: "main",
        mergeMode: "AUTO_ELIGIBLE",
        allowedPaths: ["docs/reports/hold.md"],
        requiredValidation: ["diff-check"],
        task: "Hold state.",
      }],
    }
    let readinessCalls = 0
    const adapters = { assertRuntime: async () => { readinessCalls += 1 }, listQueue: async () => [] }

    fs.writeFileSync(checkpointPath, JSON.stringify({ ...base, state: "BLOCKED", ownerDecisionRequired: true }))
    await expect(runOperationalKernelCycle({ root, registry, adapters })).resolves.toMatchObject({ state: "BLOCKED", ownerDecisionRequired: true })

    fs.writeFileSync(checkpointPath, JSON.stringify({ ...base, state: "FAILED_RECOVERABLE", resumeState: "LEASED", nextAttemptAt: "2999-01-01T00:00:00.000Z", ownerDecisionRequired: false }))
    await expect(runOperationalKernelCycle({ root, registry, adapters })).resolves.toMatchObject({ state: "FAILED_RECOVERABLE" })

    fs.writeFileSync(checkpointPath, JSON.stringify({ ...base, state: "FAILED_TERMINAL", failureCode: "PATCH_POLICY_WALL", ownerDecisionRequired: false }))
    await expect(runOperationalKernelCycle({ root, registry, adapters })).resolves.toMatchObject({ state: "FAILED_TERMINAL" })
    expect(readinessCalls).toBe(0)
  })

  it("resumes after merge without repeating the merge operation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-merged-"))
    roots.push(root)
    fs.mkdirSync(path.join(root, "state"), { recursive: true })
    fs.writeFileSync(path.join(root, "state", "kernel-checkpoint.json"), JSON.stringify({
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      goal: "GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      loop: "LOOP-RUNTIME-OPERATOR-LOCAL-IDENTITY-001",
      workOrderId: "WO-KERNEL-MERGED-001",
      issueNumber: 912,
      state: "MERGED",
      baseSha: "a".repeat(40),
      branch: "runtime/merged",
      pr: 80,
      mergeSha: "b".repeat(40),
      attempt: 1,
      remediationAttempts: 0,
    }))
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      workOrders: [{
        workOrderId: "WO-KERNEL-MERGED-001",
        authority: "APPROVED",
        riskClass: "R0",
        dependencies: [],
        ownerGateRequired: false,
        protectedScope: false,
        baseBranch: "main",
        mergeMode: "AUTO_ELIGIBLE",
        allowedPaths: ["docs/reports/merged.md"],
        requiredValidation: ["diff-check"],
        task: "Resume merged state.",
      }],
    }
    const calls: string[] = []
    const result = await runOperationalKernelCycle({ root, registry, adapters: {
      assertRuntime: async () => undefined,
      merge: async () => { throw new Error("merge must not repeat") },
      verifyMergedMain: async () => calls.push("verify"),
      complete: async () => calls.push("complete"),
      listQueue: async () => [{ issueNumber: 912, workOrderId: "WO-KERNEL-MERGED-001", state: "COMPLETED", createdAt: "2026-07-13T01:00:00Z" }],
    } })
    expect(result).toMatchObject({ state: "COMPLETED", mergeSha: "b".repeat(40) })
    expect(calls).toEqual(["verify", "complete"])
  })
})
