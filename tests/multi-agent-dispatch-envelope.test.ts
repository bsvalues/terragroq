import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  DispatchEnvelopeError,
  canonicalDispatchEnvelopeJson,
  validateDispatchEnvelope,
} from "../scripts/multi-agent-operator/dispatch-envelope.mjs"

function validEnvelope() {
  return {
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId: "WO-MAO-010",
    objective: "Build and verify the bounded hosted Codex lane A artifact.",
    riskClass: "R1",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{
      repository: "bsvalues/terragroq",
      ref: "refs/heads/main",
      commitSha: "7713d3b80b421fd4ae76c2b9a2c31b9e59c7e828",
    }],
    dependencies: ["WO-MAO-009", "WO-MAO-008"],
    fanInGate: "ALL",
    laneId: "LANE-MAO-A",
    teamRoles: {
      coordinator: "codex-coordinator",
      builder: "codex-builder-a",
      reviewer: "codex-assurance-a",
    },
    providerRequirements: ["isolated-worktree", "native-subagent"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: [
        { repository: "bsvalues/terragroq", path: "tests/multi-agent-dispatch-envelope.test.ts" },
        { repository: "bsvalues/terragroq", path: "scripts/multi-agent-operator/dispatch-envelope.mjs" },
      ],
      contracts: ["dispatch-envelope-v2"],
      environments: [],
    },
    allowedActions: ["RUN_VALIDATION", "OPEN_DRAFT_PR", "WRITE_RESERVED_PATHS", "READ_REPOSITORY"],
    forbiddenActions: ["OWNER_CONTACT", "RUNTIME_ACTIVATION", "CREDENTIAL_ACCESS"],
    authorityGrantRefs: [],
    programActivationGrantRef: null,
    grantStatusEventRefs: [],
    requiredOutputs: ["validator", "evidence-report", "tests"],
    requiredValidation: ["focused-vitest", "git-diff-check"],
    reviewRequirements: {
      independentReviewer: true,
      minimumApprovals: 1,
      maximumUnresolvedThreads: 0,
    },
    mergeMode: "DRAFT_PR_ONLY",
    retryBudget: { maxAttempts: 3, backoffSeconds: 10 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "NONE",
    stopConditions: ["reservation-collision", "authority-wall"],
    evidenceTargets: ["branch", "commit", "validation", "owner-operation-counters"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
  }
}

function expectWall(mutator: (envelope: ReturnType<typeof validEnvelope>) => void, code: string, field?: string) {
  const envelope = validEnvelope()
  mutator(envelope)
  try {
    validateDispatchEnvelope(envelope)
    throw new Error("expected dispatch envelope validation to fail")
  } catch (error) {
    expect(error).toBeInstanceOf(DispatchEnvelopeError)
    expect(error).toMatchObject({ code, ...(field ? { field } : {}) })
  }
}

describe("hosted-team dispatch envelope", () => {
  it("normalizes set-like fields and emits a stable content hash", () => {
    const input = validEnvelope()
    const first = validateDispatchEnvelope(input)
    const secondInput = validEnvelope()
    secondInput.dependencies.reverse()
    secondInput.allowedActions.reverse()
    secondInput.reservations.paths.reverse()
    secondInput.requiredOutputs.reverse()
    const second = validateDispatchEnvelope(secondInput)

    expect(first).toMatchObject({
      ok: true,
      code: "DISPATCH_ENVELOPE_VALID",
      validationOnly: true,
      authorityGranted: false,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      envelope: {
        ownerOperationsAllowed: false,
        dependencies: ["WO-MAO-008", "WO-MAO-009"],
        allowedActions: ["OPEN_DRAFT_PR", "READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
      },
    })
    expect(second.contentHash).toBe(first.contentHash)
    expect(canonicalDispatchEnvelopeJson(second.envelope)).toBe(canonicalDispatchEnvelopeJson(first.envelope))
  })

  it.each([
    ["missing field", (value: ReturnType<typeof validEnvelope>) => { delete (value as Partial<typeof value>).goalId }, "DISPATCH_ENVELOPE_MISSING_FIELD_WALL", "envelope.goalId"],
    ["unknown field", (value: ReturnType<typeof validEnvelope>) => { Object.assign(value, { surprise: true }) }, "DISPATCH_ENVELOPE_UNKNOWN_FIELD_WALL", "envelope.surprise"],
    ["owner operation", (value: ReturnType<typeof validEnvelope>) => { value.ownerOperationsAllowed = true as false }, "DISPATCH_ENVELOPE_OWNER_OPERATION_WALL", "ownerOperationsAllowed"],
    ["unsupported risk", (value: ReturnType<typeof validEnvelope>) => { value.riskClass = "R9" }, "DISPATCH_ENVELOPE_RISK_WALL", "riskClass"],
    ["self dependency", (value: ReturnType<typeof validEnvelope>) => { value.dependencies = [value.workOrderId] }, "DISPATCH_ENVELOPE_CONTRADICTION_WALL", "dependencies"],
    ["same actor in two roles", (value: ReturnType<typeof validEnvelope>) => { value.teamRoles.reviewer = value.teamRoles.builder }, "DISPATCH_ENVELOPE_CONTRADICTION_WALL", "teamRoles"],
    ["provider in preferred and fallback", (value: ReturnType<typeof validEnvelope>) => { value.fallbackProviders = ["hosted-codex"] }, "DISPATCH_ENVELOPE_CONTRADICTION_WALL", "preferredProviders"],
    ["base repository mismatch", (value: ReturnType<typeof validEnvelope>) => { value.baseRefs[0].repository = "bsvalues/wrong" }, "DISPATCH_ENVELOPE_BASE_REF_WALL", "baseRefs"],
    ["partial base ref", (value: ReturnType<typeof validEnvelope>) => { value.baseRefs[0].ref = "main" }, "DISPATCH_ENVELOPE_BASE_REF_WALL", "baseRefs[0].ref"],
    ["overlapping actions", (value: ReturnType<typeof validEnvelope>) => { value.forbiddenActions.push("RUN_VALIDATION") }, "DISPATCH_ENVELOPE_CONTRADICTION_WALL", "allowedActions"],
    ["owner contact action", (value: ReturnType<typeof validEnvelope>) => { value.allowedActions.push("OWNER_CONTACT") }, "DISPATCH_ENVELOPE_OWNER_OPERATION_WALL", "allowedActions"],
    ["unsupported action", (value: ReturnType<typeof validEnvelope>) => { value.allowedActions.push("DO_ANYTHING") }, "DISPATCH_ENVELOPE_ACTION_WALL", "allowedActions"],
    ["retry attempts below bound", (value: ReturnType<typeof validEnvelope>) => { value.retryBudget.maxAttempts = 0 }, "DISPATCH_ENVELOPE_RETRY_BUDGET_WALL", "retryBudget.maxAttempts"],
    ["retry attempts above bound", (value: ReturnType<typeof validEnvelope>) => { value.retryBudget.maxAttempts = 6 }, "DISPATCH_ENVELOPE_RETRY_BUDGET_WALL", "retryBudget.maxAttempts"],
    ["negative backoff", (value: ReturnType<typeof validEnvelope>) => { value.retryBudget.backoffSeconds = -1 }, "DISPATCH_ENVELOPE_RETRY_BUDGET_WALL", "retryBudget.backoffSeconds"],
    ["unbounded remediation", (value: ReturnType<typeof validEnvelope>) => { value.remediationBudget.maxCycles = 4 }, "DISPATCH_ENVELOPE_RETRY_BUDGET_WALL", "remediationBudget.maxCycles"],
    ["fallback with no reroute", (value: ReturnType<typeof validEnvelope>) => { value.fallbackProviders = ["claude-code"] }, "DISPATCH_ENVELOPE_CONTRADICTION_WALL", "fallbackProviders"],
    ["PR action when merge disabled", (value: ReturnType<typeof validEnvelope>) => { value.mergeMode = "NO_MERGE" }, "DISPATCH_ENVELOPE_CONTRADICTION_WALL", "mergeMode"],
    ["merge action in draft-only mode", (value: ReturnType<typeof validEnvelope>) => { value.allowedActions.push("MERGE_ELIGIBLE_PR") }, "DISPATCH_ENVELOPE_CONTRADICTION_WALL", "mergeMode"],
    ["draft-only mode without draft action", (value: ReturnType<typeof validEnvelope>) => { value.allowedActions = value.allowedActions.filter((action) => action !== "OPEN_DRAFT_PR") }, "DISPATCH_ENVELOPE_CONTRADICTION_WALL", "mergeMode"],
    ["assurance-gated mode without merge action", (value: ReturnType<typeof validEnvelope>) => { value.mergeMode = "ASSURANCE_GATED" }, "DISPATCH_ENVELOPE_CONTRADICTION_WALL", "mergeMode"],
    ["reviewer not independent", (value: ReturnType<typeof validEnvelope>) => { value.reviewRequirements.independentReviewer = false }, "DISPATCH_ENVELOPE_REVIEW_WALL", "reviewRequirements.independentReviewer"],
  ])("rejects %s", (_name, mutate, code, field) => {
    expectWall(mutate, code, field)
  })

  it.each([
    ["absolute POSIX path", "/etc/passwd"],
    ["absolute Windows path", "C:\\Users\\owner\\secret"],
    ["parent traversal", "scripts/../secrets.txt"],
    ["current traversal", "scripts/./file.mjs"],
    ["wildcard", "scripts/**/*.mjs"],
    ["backslash", "scripts\\file.mjs"],
    ["NUL control character", "scripts/file\u0000.mjs"],
    ["newline control character", "scripts/file\n.mjs"],
  ])("rejects %s reservations", (_name, unsafePath) => {
    expectWall((value) => { value.reservations.paths[0].path = unsafePath }, "DISPATCH_ENVELOPE_PATH_WALL")
  })

  it("rejects duplicate path reservations after deterministic normalization", () => {
    expectWall((value) => {
      value.reservations.paths.push({ ...value.reservations.paths[0] })
    }, "DISPATCH_ENVELOPE_DUPLICATE_WALL", "reservations.paths")
  })

  it("provides a machine-readable CLI success and typed failure", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-dispatch-envelope-"))
    const validPath = path.join(directory, "valid.json")
    const invalidPath = path.join(directory, "invalid.json")
    fs.writeFileSync(validPath, JSON.stringify(validEnvelope()))
    const invalid = validEnvelope()
    invalid.ownerOperationsAllowed = true as false
    fs.writeFileSync(invalidPath, JSON.stringify(invalid))
    const cli = path.resolve("scripts/multi-agent-operator/dispatch-envelope-cli.mjs")

    const success = JSON.parse(execFileSync(process.execPath, [cli, validPath], { encoding: "utf8" }))
    expect(success).toMatchObject({
      ok: true,
      code: "DISPATCH_ENVELOPE_VALID",
      validationOnly: true,
      authorityGranted: false,
    })

    const failure = spawnSync(process.execPath, [cli, invalidPath], { encoding: "utf8" })
    expect(failure.status).toBe(2)
    expect(failure.stderr).toBe("")
    expect(JSON.parse(failure.stdout)).toEqual({
      code: "DISPATCH_ENVELOPE_OWNER_OPERATION_WALL",
      detail: "FALSE_REQUIRED",
      field: "ownerOperationsAllowed",
      ok: false,
    })

    fs.rmSync(directory, { recursive: true, force: true })
  })
})
