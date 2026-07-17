import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import { describe, expect, it } from "vitest"

import {
  WorkOrderEnvelopeV2Error,
  canonicalWorkOrderEnvelopeV2Json,
  createWoMao034ProviderSettlementEnvelopes,
  toDispatchEnvelope,
  validateWorkOrderEnvelopeV2,
} from "../scripts/multi-agent-operator/work-order-envelope-v2.mjs"

function validEnvelope() {
  return {
    artifactType: "WORK_ORDER_ENVELOPE_V2",
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId: "WO-MAO-016",
    objective: "Implement and validate the provider-neutral work-order envelope v2.",
    riskClass: "R3",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{
      repository: "bsvalues/terragroq",
      ref: "refs/heads/main",
      commitSha: "94795d37d4a844045f1461936c5744b89d2e28c0",
    }],
    dependencies: ["WO-MAO-015"],
    fanInGate: "ALL",
    laneId: "LANE-MAO-P2-ENVELOPE",
    teamRoles: {
      coordinator: "codex-coordinator",
      builder: "codex-builder-envelope",
      reviewer: "codex-assurance-envelope",
    },
    providerRequirements: ["isolated-worktree", "native-subagent"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: ["claude-code"],
    reservations: {
      paths: [
        { repository: "bsvalues/terragroq", path: "scripts/multi-agent-operator/work-order-envelope-v2.mjs" },
        { repository: "bsvalues/terragroq", path: "tests/multi-agent-work-order-envelope-v2.test.ts" },
      ],
      contracts: ["work-order-envelope-v2"],
      environments: ["node-test"],
    },
    allowedActions: ["READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION"],
    forbiddenActions: ["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["docs/reports/WO-MAO-003-owner-only-authority-contract.md"],
    programActivationGrantRef: null,
    grantStatusEventRefs: [],
    requiredOutputs: ["validator", "typed-cli", "tests", "evidence-report"],
    requiredValidation: ["focused-vitest", "eslint", "git-diff-check"],
    reviewRequirements: {
      independentReviewer: true,
      minimumApprovals: 1,
      maximumUnresolvedThreads: 0,
    },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 3, backoffSeconds: 10 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "COMPATIBLE_PROVIDER_ONLY",
    stopConditions: ["authority-wall", "reservation-collision", "provider-exhausted"],
    evidenceTargets: ["validation", "content-hash", "owner-operation-counters"],
    ownerDecisionConditions: ["material-scope-expansion"],
    ownerOperationsAllowed: false,
    ownerTouchBudget: {
      operationTouches: 0,
      credentialTouches: 0,
      diagnosticTouches: 0,
      routineDecisions: 0,
      routineContacts: 0,
    },
    communicationPolicy: "FINAL_ONLY",
  }
}

function expectWall(mutator: (value: ReturnType<typeof validEnvelope>) => void, code: string, field?: string) {
  const envelope = validEnvelope()
  mutator(envelope)
  try {
    validateWorkOrderEnvelopeV2(envelope)
    throw new Error("expected validation to fail")
  } catch (error) {
    expect(error).toBeInstanceOf(WorkOrderEnvelopeV2Error)
    expect(error).toMatchObject({ code, ...(field ? { field } : {}) })
  }
}

describe("provider-neutral work-order envelope v2", () => {
  it("validates every mandatory execution concern without dispatching or granting authority", () => {
    const result = validateWorkOrderEnvelopeV2(validEnvelope())
    expect(result).toMatchObject({
      ok: true,
      code: "WORK_ORDER_ENVELOPE_V2_VALID",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      validationOnly: true,
      dispatchPerformed: false,
      authorityGranted: false,
      envelope: {
        artifactType: "WORK_ORDER_ENVELOPE_V2",
        schemaVersion: 2,
        dependencies: ["WO-MAO-015"],
        fanInGate: "ALL",
        preferredProviders: ["hosted-codex"],
        fallbackProviders: ["claude-code"],
        reroutePolicy: "COMPATIBLE_PROVIDER_ONLY",
        ownerOperationsAllowed: false,
        communicationPolicy: "FINAL_ONLY",
        ownerTouchBudget: {
          credentialTouches: 0,
          diagnosticTouches: 0,
          operationTouches: 0,
          routineContacts: 0,
          routineDecisions: 0,
        },
      },
    })
    expect(toDispatchEnvelope(validEnvelope())).not.toHaveProperty("ownerTouchBudget")
  })

  it("canonicalizes set-like dispatch fields and produces a stable hash", () => {
    const first = validateWorkOrderEnvelopeV2(validEnvelope())
    const reordered = validEnvelope()
    reordered.reservations.paths.reverse()
    reordered.requiredOutputs.reverse()
    reordered.stopConditions.reverse()
    const second = validateWorkOrderEnvelopeV2(reordered)
    expect(second.contentHash).toBe(first.contentHash)
    expect(canonicalWorkOrderEnvelopeV2Json(second.envelope)).toBe(canonicalWorkOrderEnvelopeV2Json(first.envelope))
  })

  it("defaults provider-optional fields without breaking existing v2 envelopes", () => {
    const result = validateWorkOrderEnvelopeV2(validEnvelope())
    expect(result.envelope).toMatchObject({ dependencyPolicies: [], providerBinding: null })
    expect(result.contentHash).toBe("b033577db1b9cd54d08513637a4582dd731e5de5d5b0beaf6a084c30ff37cd45")
    expect(toDispatchEnvelope(validEnvelope())).not.toHaveProperty("dependencyPolicies")
    expect(toDispatchEnvelope(validEnvelope())).not.toHaveProperty("providerBinding")
  })

  it("hashes populated provider fields while preserving omission semantics", () => {
    const omitted = validEnvelope()
    const explicitDefaults = { ...validEnvelope(), dependencyPolicies: [], providerBinding: null }
    expect(validateWorkOrderEnvelopeV2(explicitDefaults).contentHash)
      .not.toBe(validateWorkOrderEnvelopeV2(omitted).contentHash)
  })

  it("accepts only explicit ALL-edge provider-unavailable settlement metadata", () => {
    const value = validEnvelope()
    value.dependencies = ["WO-MAO-033"]
    Object.assign(value, {
      dependencyPolicies: [{
        dependencyWorkOrderId: "WO-MAO-033",
        satisfaction: "COMPLETE_OR_PROVIDER_UNAVAILABLE_DEFERRED",
        providerId: "claude-code",
        assessmentWorkOrderId: "WO-MAO-032",
      }],
    })
    expect(validateWorkOrderEnvelopeV2(value).envelope.dependencyPolicies).toEqual([{
      dependencyWorkOrderId: "WO-MAO-033",
      satisfaction: "COMPLETE_OR_PROVIDER_UNAVAILABLE_DEFERRED",
      providerId: "claude-code",
      assessmentWorkOrderId: "WO-MAO-032",
    }])

    value.fanInGate = "ANY"
    expect(() => validateWorkOrderEnvelopeV2(value)).toThrow(/ALL_GATE_REQUIRED/)
    value.fanInGate = "ALL"
    value.dependencyPolicies[0].satisfaction = "ANY_DEFER_IS_FINE"
    expect(() => validateWorkOrderEnvelopeV2(value)).toThrow(/KNOWN_POLICY_REQUIRED/)
  })

  it("cross-binds optional assessment and subject provider identities", () => {
    const assessment = validEnvelope()
    assessment.workOrderId = "WO-MAO-032"
    Object.assign(assessment, { providerBinding: {
      providerId: "claude-code",
      assessmentWorkOrderId: "WO-MAO-032",
      subjectWorkOrderId: "WO-MAO-033",
      role: "ASSESSMENT",
    } })
    expect(validateWorkOrderEnvelopeV2(assessment).envelope.providerBinding).toMatchObject({ role: "ASSESSMENT" })
    assessment.providerBinding.role = "SUBJECT"
    expect(() => validateWorkOrderEnvelopeV2(assessment)).toThrow(/ROLE_WORK_ORDER_MISMATCH/)
  })

  it.each([
    ["missing mandatory field", (value: ReturnType<typeof validEnvelope>) => { delete (value as Partial<typeof value>).ownerTouchBudget }, "WORK_ORDER_ENVELOPE_MISSING_FIELD_WALL", "envelope.ownerTouchBudget"],
    ["unknown field", (value: ReturnType<typeof validEnvelope>) => { Object.assign(value, { surprise: true }) }, "WORK_ORDER_ENVELOPE_UNKNOWN_FIELD_WALL", "envelope.surprise"],
    ["wrong artifact", (value: ReturnType<typeof validEnvelope>) => { value.artifactType = "DISPATCH_ENVELOPE" }, "WORK_ORDER_ENVELOPE_ARTIFACT_WALL", "artifactType"],
    ["non-final communication", (value: ReturnType<typeof validEnvelope>) => { value.communicationPolicy = "PROGRESS_UPDATES" }, "WORK_ORDER_ENVELOPE_OWNER_WALL", "communicationPolicy"],
    ["owner operation budget", (value: ReturnType<typeof validEnvelope>) => { value.ownerTouchBudget.operationTouches = 1 }, "WORK_ORDER_ENVELOPE_OWNER_WALL", "ownerTouchBudget.operationTouches"],
    ["owner routine contact budget", (value: ReturnType<typeof validEnvelope>) => { value.ownerTouchBudget.routineContacts = 1 }, "WORK_ORDER_ENVELOPE_OWNER_WALL", "ownerTouchBudget.routineContacts"],
    ["unknown owner counter", (value: ReturnType<typeof validEnvelope>) => { Object.assign(value.ownerTouchBudget, { extra: 0 }) }, "WORK_ORDER_ENVELOPE_UNKNOWN_FIELD_WALL", "ownerTouchBudget.extra"],
    ["missing authority evidence", (value: ReturnType<typeof validEnvelope>) => { value.authorityGrantRefs = [] }, "WORK_ORDER_ENVELOPE_AUTHORITY_WALL", "authorityGrantRefs"],
    ["missing owner counter evidence", (value: ReturnType<typeof validEnvelope>) => { value.evidenceTargets = ["validation"] }, "WORK_ORDER_ENVELOPE_EVIDENCE_WALL", "evidenceTargets"],
    ["empty ANY gate", (value: ReturnType<typeof validEnvelope>) => { value.dependencies = []; value.fanInGate = "ANY" }, "WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", "fanInGate"],
    ["owner operations enabled", (value: ReturnType<typeof validEnvelope>) => { value.ownerOperationsAllowed = true as false }, "WORK_ORDER_ENVELOPE_DISPATCH_WALL", "ownerOperationsAllowed"],
    ["unsafe reservation", (value: ReturnType<typeof validEnvelope>) => { value.reservations.paths[0].path = "scripts/../secret" }, "WORK_ORDER_ENVELOPE_DISPATCH_WALL", "reservations.paths[0].path"],
    ["provider overlap", (value: ReturnType<typeof validEnvelope>) => { value.fallbackProviders = ["hosted-codex"] }, "WORK_ORDER_ENVELOPE_DISPATCH_WALL", "preferredProviders"],
    ["role collision", (value: ReturnType<typeof validEnvelope>) => { value.teamRoles.reviewer = value.teamRoles.builder }, "WORK_ORDER_ENVELOPE_DISPATCH_WALL", "teamRoles"],
  ])("rejects %s", (_name, mutate, code, field) => {
    expectWall(mutate, code, field)
  })

  it.each(["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION", "PRODUCTION_WRITE"])(
    "rejects protected action %s even when another field claims zero-owner operation",
    (action) => {
      expectWall((value) => { value.allowedActions.push(action) }, "WORK_ORDER_ENVELOPE_DISPATCH_WALL", "allowedActions")
    },
  )

  it("returns typed CLI success and failure outcomes", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-envelope-v2-"))
    const validPath = path.join(directory, "valid.json")
    const invalidPath = path.join(directory, "invalid.json")
    fs.writeFileSync(validPath, JSON.stringify(validEnvelope()))
    const invalid = validEnvelope()
    invalid.ownerTouchBudget.routineDecisions = 1
    fs.writeFileSync(invalidPath, JSON.stringify(invalid))
    const cli = path.resolve("scripts/multi-agent-operator/work-order-envelope-v2-cli.mjs")

    const success = JSON.parse(execFileSync(process.execPath, [cli, validPath], { encoding: "utf8" }))
    expect(success).toMatchObject({
      ok: true,
      code: "WORK_ORDER_ENVELOPE_V2_VALID",
      validationOnly: true,
      dispatchPerformed: false,
      authorityGranted: false,
    })
    const failure = spawnSync(process.execPath, [cli, invalidPath], { encoding: "utf8" })
    expect(failure.status).toBe(2)
    expect(failure.stderr).toBe("")
    expect(JSON.parse(failure.stdout)).toEqual({
      ok: false,
      code: "WORK_ORDER_ENVELOPE_OWNER_WALL",
      field: "ownerTouchBudget.routineDecisions",
      detail: "ZERO_REQUIRED",
    })
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it("constructs the exact WO-MAO-034 settlement DAG packets without synthetic reservations", () => {
    const packets = createWoMao034ProviderSettlementEnvelopes()
    expect(packets.assessmentEnvelope.dependencies).toEqual(["WO-MAO-007", "WO-MAO-019", "WO-MAO-022"])
    expect(packets.subjectEnvelope.dependencies).toEqual(["WO-MAO-025", "WO-MAO-028", "WO-MAO-032"])
    expect(packets.consumerEnvelope.dependencies).toEqual(["WO-MAO-024", "WO-MAO-031", "WO-MAO-033"])
    expect(packets.prerequisiteEnvelopes).toHaveLength(7)
    expect(packets).toMatchObject({
      assessmentEnvelopeHash: "4f4495e4ca5e0691ba99ac277a74f5c29c594e9f300fd02979fa2eea07628da8",
      subjectEnvelopeHash: "5311ed8044b3b40a9ea7604cdb77a90d29f2d5562562a7c2988313f76a7226ee",
      consumerEnvelopeHash: "c03f2339666105cbe08b51ef32a50000d3b2441103f4420721f216c75667cb03",
      sourceAssessmentContentHash: "60917d122e314844e175c9d4e6e60e197a5e4f06bc2b6f2ea73b0fc1e09ed523",
    })
    expect(JSON.stringify(packets)).not.toContain("tmp/wo-mao")
  })
})
