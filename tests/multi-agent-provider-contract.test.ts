import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  ProviderContractError,
  evaluateProviderDispatch,
  hashProviderResponse,
  normalizeProviderCapability,
  validateProviderResponse,
} from "../scripts/multi-agent-operator/provider-contract.mjs"

function envelope() {
  return {
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId: "WO-MAO-019",
    objective: "Prove a provider-neutral local dispatch contract.",
    riskClass: "R3",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{ repository: "bsvalues/terragroq", ref: "refs/heads/main", commitSha: "94795d37d4a844045f1461936c5744b89d2e28c0" }],
    dependencies: ["WO-MAO-016"],
    fanInGate: "ALL",
    laneId: "LANE-MAO-019",
    teamRoles: { coordinator: "coordinator-1", builder: "builder-1", reviewer: "reviewer-1" },
    providerRequirements: ["isolated-worktree", "sanitized-evidence"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: ["claude-code"],
    reservations: {
      paths: [{ repository: "bsvalues/terragroq", path: "scripts/multi-agent-operator/provider-contract.mjs" }],
      contracts: ["provider-contract-v1"],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
    forbiddenActions: ["CREDENTIAL_ACCESS", "OWNER_CONTACT", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: [],
    programActivationGrantRef: null,
    grantStatusEventRefs: [],
    requiredOutputs: ["contract", "tests"],
    requiredValidation: ["focused-vitest"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 3, backoffSeconds: 10 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "COMPATIBLE_PROVIDER_ONLY",
    stopConditions: ["authority-wall", "reservation-collision"],
    evidenceTargets: ["sanitized-provider-events"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
  }
}

function capability() {
  return {
    schemaVersion: 1,
    artifactType: "PROVIDER_CAPABILITY_SNAPSHOT",
    providerId: "hosted-codex",
    adapterId: "hosted-codex-adapter-v1",
    availability: "AVAILABLE",
    riskClasses: ["R1", "R3"],
    requirements: ["sanitized-evidence", "isolated-worktree"],
    actions: ["WRITE_RESERVED_PATHS", "READ_REPOSITORY", "RUN_VALIDATION"],
    roles: ["builder", "reviewer"],
    repositories: ["bsvalues/terragroq"],
    maxConcurrency: 3,
    supportsCancellation: true,
    supportsArtifacts: true,
    supportsSanitizedEvidence: true,
    serviceCompatible: true,
    authorityMintingAllowed: false,
  }
}

function status() {
  return {
    schemaVersion: 1,
    artifactType: "PROVIDER_STATUS",
    providerId: "hosted-codex",
    adapterId: "hosted-codex-adapter-v1",
    dispatchId: "dispatch-019",
    workOrderId: "WO-MAO-019",
    laneId: "LANE-MAO-019",
    providerState: "RUNNING",
    reasonCode: null,
    sanitized: true,
    authorityGranted: false,
    progressMarker: "focused-tests-running",
  }
}

function expectWall(callback: () => unknown, code: string, field?: string) {
  try {
    callback()
    throw new Error("expected provider contract wall")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderContractError)
    expect(error).toMatchObject({ code, ...(field ? { field } : {}) })
  }
}

describe("provider-neutral capability and dispatch contract", () => {
  it("normalizes discovery and proves eligibility without dispatching or granting authority", () => {
    const normalized = normalizeProviderCapability(capability())
    expect(normalized.requirements).toEqual(["isolated-worktree", "sanitized-evidence"])
    expect(evaluateProviderDispatch({ envelope: envelope(), capability: capability(), requestedRole: "builder" })).toMatchObject({
      code: "PROVIDER_DISPATCH_ELIGIBLE",
      eligible: true,
      capabilityMatched: true,
      dispatchAllowed: false,
      dispatchPerformed: false,
      requiresIndependentAuthorityMatch: true,
      authorityGranted: false,
      providerId: "hosted-codex",
      workOrderId: "WO-MAO-019",
      reasons: [],
    })
  })

  it.each([
    ["requirement", (value: ReturnType<typeof capability>) => { value.requirements = ["isolated-worktree"] }, "PROVIDER_CAPABILITY_GAP:requirements"],
    ["action", (value: ReturnType<typeof capability>) => { value.actions = ["READ_REPOSITORY", "RUN_VALIDATION"] }, "PROVIDER_CAPABILITY_GAP:actions"],
    ["role", (value: ReturnType<typeof capability>) => { value.roles = ["reviewer"] }, "PROVIDER_CAPABILITY_GAP:roles"],
    ["repository", (value: ReturnType<typeof capability>) => { value.repositories = ["bsvalues/other"] }, "PROVIDER_CAPABILITY_GAP:repositories"],
    ["risk", (value: ReturnType<typeof capability>) => { value.riskClasses = ["R1"] }, "PROVIDER_CAPABILITY_GAP:riskClasses"],
  ])("never dispatches unsupported %s work", (_name, mutate, reason) => {
    const value = capability()
    mutate(value)
    expect(evaluateProviderDispatch({ envelope: envelope(), capability: value, requestedRole: "builder" })).toMatchObject({
      code: "PROVIDER_DISPATCH_UNSUPPORTED",
      eligible: false,
      dispatchAllowed: false,
      dispatchPerformed: false,
      authorityGranted: false,
      reasons: expect.arrayContaining([reason]),
    })
  })

  it("keeps unavailable and non-service provider surfaces out of dispatch", () => {
    const value = capability()
    value.availability = "UNAVAILABLE"
    value.maxConcurrency = 0
    value.serviceCompatible = false
    expect(evaluateProviderDispatch({ envelope: envelope(), capability: value, requestedRole: "builder" })).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["PROVIDER_UNAVAILABLE", "PROVIDER_NO_CAPACITY", "PROVIDER_NOT_SERVICE_COMPATIBLE"]),
    })
  })

  it("rejects adapter capability and response attempts to mint authority", () => {
    expectWall(() => normalizeProviderCapability({ ...capability(), authorityMintingAllowed: true }), "PROVIDER_AUTHORITY_MINT_WALL", "authorityMintingAllowed")
    expectWall(() => validateProviderResponse({ ...status(), authorityGranted: true }), "PROVIDER_AUTHORITY_MINT_WALL", "authorityGranted")
  })

  it("validates status, cancellation, artifact, and sanitized evidence interfaces", () => {
    const common = { ...status(), progressMarker: undefined }
    delete common.progressMarker
    const cancellation = validateProviderResponse({ ...common, artifactType: "PROVIDER_CANCELLATION", providerState: "CANCELLED", reasonCode: "CANCELLED_BY_COORDINATOR", cancelAcknowledged: true })
    const artifact = validateProviderResponse({
      ...common,
      artifactType: "PROVIDER_ARTIFACT",
      providerState: "SUCCEEDED",
      artifactId: "artifact-1",
      artifactKind: "test-report",
      contentHash: "a".repeat(64),
      relativePath: "reports/focused-tests.json",
    })
    const evidence = validateProviderResponse({
      ...common,
      artifactType: "PROVIDER_EVIDENCE",
      eventId: "event-1",
      evidenceType: "validation",
      contentHash: "b".repeat(64),
      summary: "Focused tests passed.",
      attributes: { testCount: 12, suite: "provider-contract" },
      rawProviderOutputIncluded: false,
    })
    expect(validateProviderResponse(status())).toMatchObject({ artifactType: "PROVIDER_STATUS", authorityGranted: false })
    expect(cancellation).toMatchObject({ cancelAcknowledged: true, authorityGranted: false })
    expect(artifact).toMatchObject({ relativePath: "reports/focused-tests.json", contentHash: "a".repeat(64) })
    expect(evidence).toMatchObject({ sanitized: true, rawProviderOutputIncluded: false, attributes: { suite: "provider-contract", testCount: 12 } })
    expect(hashProviderResponse(status())).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    ["raw provider output", { rawProviderOutput: "not allowed" }],
    ["secret-like key", { apiToken: "not allowed" }],
    ["API key alias", { apiKey: "plaintext-value" }],
    ["nested credential", { nested: { credentialValue: "not allowed" } }],
    ["credential-shaped value", { note: "Bearer abcdefghijklmnopqrstuvwxyz" }],
  ])("rejects %s in evidence attributes", (_name, attributes) => {
    const common = { ...status() } as Record<string, unknown>
    delete common.progressMarker
    expectWall(() => validateProviderResponse({
      ...common,
      artifactType: "PROVIDER_EVIDENCE",
      eventId: "event-1",
      evidenceType: "validation",
      contentHash: "b".repeat(64),
      summary: "Sanitized.",
      attributes,
      rawProviderOutputIncluded: false,
    }), "PROVIDER_EVIDENCE_SANITIZATION_WALL")
  })

  it.each(["../secret", "C:/owner/secret", "reports/*.json", "reports\\secret.json"])("rejects unsafe artifact path %s", (relativePath) => {
    const common = { ...status() } as Record<string, unknown>
    delete common.progressMarker
    expectWall(() => validateProviderResponse({ ...common, artifactType: "PROVIDER_ARTIFACT", providerState: "SUCCEEDED", artifactId: "artifact-1", artifactKind: "report", contentHash: "c".repeat(64), relativePath }), "PROVIDER_ARTIFACT_PATH_WALL")
  })

  it("rejects raw output flags, sensitive summaries, and unknown response fields", () => {
    const common = { ...status() } as Record<string, unknown>
    delete common.progressMarker
    expectWall(() => validateProviderResponse({ ...common, artifactType: "PROVIDER_EVIDENCE", eventId: "event-1", evidenceType: "test", contentHash: "c".repeat(64), summary: "safe", attributes: {}, rawProviderOutputIncluded: true }), "PROVIDER_EVIDENCE_SANITIZATION_WALL")
    expectWall(() => validateProviderResponse({ ...common, artifactType: "PROVIDER_EVIDENCE", eventId: "event-1", evidenceType: "test", contentHash: "c".repeat(64), summary: "Bearer abcdefghijklmnopqrstuvwxyz", attributes: {}, rawProviderOutputIncluded: false }), "PROVIDER_EVIDENCE_SANITIZATION_WALL")
    expectWall(() => validateProviderResponse({ ...common, artifactType: "PROVIDER_EVIDENCE", eventId: "event-1", evidenceType: "test", contentHash: "c".repeat(64), summary: "password=hunter2", attributes: {}, rawProviderOutputIncluded: false }), "PROVIDER_EVIDENCE_SANITIZATION_WALL")
    expectWall(() => validateProviderResponse({ ...status(), surprise: true }), "PROVIDER_CONTRACT_UNKNOWN_FIELD_WALL", "response.surprise")
  })

  it.each([
    "password=abc",
    "token=x",
    "token : x",
    "api-key: z",
    "pwd = \"q\"",
    "secret:'v'",
  ])("rejects short or delimiter-varied residual secret assignment %s", (summary) => {
    const common = { ...status() } as Record<string, unknown>
    delete common.progressMarker
    expectWall(() => validateProviderResponse({ ...common, artifactType: "PROVIDER_EVIDENCE", eventId: "event-1", evidenceType: "test", contentHash: "c".repeat(64), summary, attributes: {}, rawProviderOutputIncluded: false }), "PROVIDER_EVIDENCE_SANITIZATION_WALL", "summary")
  })

  it.each([
    "Token validation completed without credential material.",
    "The password policy passed.",
    "API key fields were absent from the sanitized artifact.",
  ])("does not false-positive ordinary security prose: %s", (summary) => {
    const common = { ...status() } as Record<string, unknown>
    delete common.progressMarker
    expect(validateProviderResponse({ ...common, artifactType: "PROVIDER_EVIDENCE", eventId: "event-1", evidenceType: "test", contentHash: "c".repeat(64), summary, attributes: {}, rawProviderOutputIncluded: false })).toMatchObject({ summary, sanitized: true })
  })

  it("enforces provider state/reason semantics and cancellation/artifact matrices", () => {
    expectWall(() => validateProviderResponse({ ...status(), providerState: "FAILED", reasonCode: null }), "PROVIDER_RESPONSE_SEMANTIC_WALL", "reasonCode")
    expect(validateProviderResponse({ ...status(), providerState: "FAILED", reasonCode: "PROVIDER_EXECUTION_FAILED" })).toMatchObject({ providerState: "FAILED", reasonCode: "PROVIDER_EXECUTION_FAILED" })
    expectWall(() => validateProviderResponse({ ...status(), providerState: "RUNNING", reasonCode: "SHOULD_BE_NULL" }), "PROVIDER_RESPONSE_SEMANTIC_WALL", "reasonCode")

    const common = { ...status() } as Record<string, unknown>
    delete common.progressMarker
    expectWall(() => validateProviderResponse({ ...common, artifactType: "PROVIDER_CANCELLATION", providerState: "SUCCEEDED", cancelAcknowledged: true }), "PROVIDER_RESPONSE_SEMANTIC_WALL", "cancelAcknowledged")
    expectWall(() => validateProviderResponse({ ...common, artifactType: "PROVIDER_CANCELLATION", providerState: "CANCELLED", reasonCode: "CANCELLED_BY_COORDINATOR", cancelAcknowledged: false }), "PROVIDER_RESPONSE_SEMANTIC_WALL", "cancelAcknowledged")
    expectWall(() => validateProviderResponse({ ...common, artifactType: "PROVIDER_ARTIFACT", providerState: "RUNNING", artifactId: "artifact-1", artifactKind: "report", contentHash: "d".repeat(64), relativePath: "reports/result.json" }), "PROVIDER_RESPONSE_SEMANTIC_WALL", "providerState")
  })

  it("exposes machine-readable capability, dispatch, response, and typed failure CLI operations", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-provider-contract-"))
    const capPath = path.join(directory, "capability.json")
    const dispatchPath = path.join(directory, "dispatch.json")
    const responsePath = path.join(directory, "response.json")
    fs.writeFileSync(capPath, JSON.stringify(capability()))
    fs.writeFileSync(dispatchPath, JSON.stringify({ envelope: envelope(), capability: capability(), requestedRole: "builder" }))
    fs.writeFileSync(responsePath, JSON.stringify(status()))
    const cli = path.resolve("scripts/multi-agent-operator/provider-contract-cli.mjs")
    expect(JSON.parse(execFileSync(process.execPath, [cli, "capability", capPath], { encoding: "utf8" }))).toMatchObject({ artifactType: "PROVIDER_CAPABILITY_SNAPSHOT" })
    expect(JSON.parse(execFileSync(process.execPath, [cli, "dispatch", dispatchPath], { encoding: "utf8" }))).toMatchObject({ code: "PROVIDER_DISPATCH_ELIGIBLE", dispatchPerformed: false })
    expect(JSON.parse(execFileSync(process.execPath, [cli, "response", responsePath], { encoding: "utf8" }))).toMatchObject({ artifactType: "PROVIDER_STATUS" })
    const failure = spawnSync(process.execPath, [cli, "unknown", capPath], { encoding: "utf8" })
    expect(failure.status).toBe(2)
    expect(JSON.parse(failure.stdout)).toMatchObject({ code: "PROVIDER_CONTRACT_CLI_WALL", field: "operation", ok: false })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
