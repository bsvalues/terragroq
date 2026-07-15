import crypto from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  CodexProviderConformanceError,
  canonicalCodexProviderConformanceJson,
  codexProviderConformanceFixture,
  evaluateCodexSessionCoordination,
  normalizeCodexProviderConformance,
  validateCodexProviderConformance,
} from "../scripts/multi-agent-operator/codex-provider-conformance.mjs"

function ownerBudget() {
  return {
    credentialTouches: 0,
    diagnosticTouches: 0,
    operationTouches: 0,
    routineContacts: 0,
    routineDecisions: 0,
  }
}

function envelope() {
  return {
    artifactType: "WORK_ORDER_ENVELOPE_V2",
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId: "WO-MAO-030",
    objective: "Coordinate one bounded current-session native team candidate.",
    riskClass: "R1",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{ repository: "bsvalues/terragroq", ref: "refs/heads/main", commitSha: "27bfd37897d51dde27897a880c4357e0773e8a67" }],
    dependencies: ["WO-MAO-029"],
    fanInGate: "ALL",
    laneId: "LANE-MAO-030",
    teamRoles: { coordinator: "codex-coordinator", builder: "codex-builder", reviewer: "codex-reviewer" },
    providerRequirements: ["current-hosted-session", "native-team-coordination", "sanitized-evidence"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: [{ repository: "bsvalues/terragroq", path: "scripts/multi-agent-operator/candidate.mjs" }],
      contracts: [],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
    forbiddenActions: ["CREDENTIAL_ACCESS", "OWNER_CONTACT", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["AUTHORITY-MAO-PROGRAM-ACTIVE"],
    programActivationGrantRef: "AUTHORITY-MAO-PROGRAM-ACTIVE",
    grantStatusEventRefs: ["AUTHORITY-EVENT-MAO-ACTIVE"],
    requiredOutputs: ["implementation", "tests", "sanitized-evidence"],
    requiredValidation: ["focused-vitest", "independent-review"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 3, backoffSeconds: 10 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "COMPATIBLE_PROVIDER_ONLY",
    stopConditions: ["authority-wall", "reservation-collision"],
    evidenceTargets: ["owner-operation-counters", "sanitized-provider-events"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
    ownerTouchBudget: ownerBudget(),
    communicationPolicy: "FINAL_ONLY",
  }
}

function coordination() {
  return {
    conformance: codexProviderConformanceFixture(),
    envelope: envelope(),
    requestedRole: "builder",
    runtimeActivationRequested: false,
  }
}

function expectWall(callback: () => unknown, code: string, field?: string) {
  try {
    callback()
    throw new Error("expected Codex conformance wall")
  } catch (error) {
    expect(error).toBeInstanceOf(CodexProviderConformanceError)
    expect(error).toMatchObject({ code, ...(field ? { field } : {}) })
  }
}

type MutableConformance = Record<string, unknown> & {
  capability: Record<string, unknown>
  ownerTouchBudget: Record<string, number>
  phaseOneEvidence: Array<Record<string, unknown>>
}

function mutableFixture(): MutableConformance {
  return codexProviderConformanceFixture() as unknown as MutableConformance
}

describe("WO-MAO-029 supported Codex capability conformance", () => {
  it("records only the bounded SESSION_ONLY common-provider truth", () => {
    const result = validateCodexProviderConformance(codexProviderConformanceFixture())
    expect(result).toMatchObject({
      ok: true,
      code: "CODEX_PROVIDER_SESSION_ONLY",
      currentSessionCoordinationAllowed: true,
      providerContractDispatchAllowed: false,
      authorityGranted: false,
      conformance: {
        workOrderId: "WO-MAO-029",
        controlPlaneRiskClass: "R3",
        outcome: "SESSION_ONLY",
        sessionScope: "CURRENT_HOSTED_SESSION_NATIVE_TEAM_ONLY",
        enabledForCurrentHostedSession: true,
        durableTransport: false,
        durablePersistence: false,
        executableServiceWorker: false,
        runtimeActivationAllowed: false,
        localIssue357ExecutionAllowed: false,
        localIssue357RetryAllowed: false,
        capability: {
          providerId: "hosted-codex",
          adapterId: "hosted-codex-session-native-team-v1",
          availability: "UNAVAILABLE",
          riskClasses: ["R0", "R1"],
          maxConcurrency: 3,
          serviceCompatible: false,
          authorityMintingAllowed: false,
        },
      },
    })
  })

  it("pins the complete capability surface and authoritative Phase 1 merge evidence", () => {
    const value = normalizeCodexProviderConformance(codexProviderConformanceFixture())
    expect(value.capability).toEqual({
      schemaVersion: 1,
      artifactType: "PROVIDER_CAPABILITY_SNAPSHOT",
      providerId: "hosted-codex",
      adapterId: "hosted-codex-session-native-team-v1",
      availability: "UNAVAILABLE",
      riskClasses: ["R0", "R1"],
      requirements: ["current-hosted-session", "native-team-coordination", "sanitized-evidence"],
      actions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
      roles: ["builder", "coordinator", "remediator", "reviewer", "verifier"],
      repositories: ["bsvalues/terragroq"],
      maxConcurrency: 3,
      supportsCancellation: true,
      supportsArtifacts: true,
      supportsSanitizedEvidence: true,
      serviceCompatible: false,
      authorityMintingAllowed: false,
    })
    expect(value.phaseOneEvidence).toEqual([
      { pullRequest: 364, mergeCommitSha: "8ec632aaacef731da2bc3e02958679b6c6273be6" },
      { pullRequest: 365, mergeCommitSha: "94795d37d4a844045f1461936c5744b89d2e28c0" },
      { pullRequest: 366, mergeCommitSha: "99cd0f20e4a214e8503784ff1226a9919d4b3889" },
    ])
  })

  it("recomputes a deterministic canonical SHA-256", () => {
    const one = validateCodexProviderConformance(codexProviderConformanceFixture())
    const reordered = codexProviderConformanceFixture() as Record<string, unknown>
    const reversed = Object.fromEntries(Object.entries(reordered).reverse())
    const two = validateCodexProviderConformance(reversed)
    const direct = crypto.createHash("sha256")
      .update(canonicalCodexProviderConformanceJson(one.conformance))
      .digest("hex")
    expect(one.contentHash).toBe(direct)
    expect(two.contentHash).toBe(direct)
    expect(direct).toMatch(/^[a-f0-9]{64}$/)
  })

  it("recursively freezes normalized nested objects and arrays without sharing input", () => {
    const input = codexProviderConformanceFixture()
    const normalized = normalizeCodexProviderConformance(input)
    const visit = (value: unknown) => {
      if (value !== null && typeof value === "object") {
        expect(Object.isFrozen(value)).toBe(true)
        for (const child of Object.values(value)) visit(child)
      }
    }
    visit(normalized)
    expect(normalized.capability).not.toBe(input.capability)
    expect(normalized.capability.roles).not.toBe(input.capability.roles)
    expect(normalized.phaseOneEvidence).not.toBe(input.phaseOneEvidence)
    expect(() => { (normalized.capability.roles as string[]).push("merge-controller") }).toThrow()
  })

  it.each([
    ["provider identity", (v: MutableConformance) => { v.capability.providerId = "nested-local-codex" }],
    ["adapter identity", (v: MutableConformance) => { v.capability.adapterId = "interactive-auth-service" }],
    ["availability inflation", (v: MutableConformance) => { v.capability.availability = "AVAILABLE" }],
    ["empty requirements", (v: MutableConformance) => { v.capability.requirements = [] }],
    ["requirement substitution", (v: MutableConformance) => { v.capability.requirements = ["durable-transport"] }],
    ["action substitution", (v: MutableConformance) => { v.capability.actions = ["READ_REPOSITORY"] }],
    ["role substitution", (v: MutableConformance) => { v.capability.roles = ["owner"] }],
    ["wrong repository", (v: MutableConformance) => { v.capability.repositories = ["bsvalues/other"] }],
    ["inflated concurrency", (v: MutableConformance) => { v.capability.maxConcurrency = 4 }],
    ["service compatibility", (v: MutableConformance) => { v.capability.serviceCompatible = true }],
    ["cancellation substitution", (v: MutableConformance) => { v.capability.supportsCancellation = false }],
    ["artifact substitution", (v: MutableConformance) => { v.capability.supportsArtifacts = false }],
    ["evidence substitution", (v: MutableConformance) => { v.capability.supportsSanitizedEvidence = false }],
    ["authority minting", (v: MutableConformance) => { v.capability.authorityMintingAllowed = true }],
  ])("rejects %s instead of inflating conformance", (_name, mutate) => {
    const value = mutableFixture()
    mutate(value)
    expectWall(() => normalizeCodexProviderConformance(value), "CODEX_CONFORMANCE_CAPABILITY_WALL")
  })

  it.each([
    ["durable transport", "durableTransport"],
    ["durable persistence", "durablePersistence"],
    ["service worker", "executableServiceWorker"],
    ["provider dispatch", "providerContractDispatchAllowed"],
    ["authority", "authorityMintingAllowed"],
    ["runtime", "runtimeActivationAllowed"],
    ["issue 357 execution", "localIssue357ExecutionAllowed"],
    ["issue 357 retry", "localIssue357RetryAllowed"],
  ])("rejects an asserted %s claim", (_name, field) => {
    const value = mutableFixture()
    value[field] = true
    expectWall(() => normalizeCodexProviderConformance(value), "CODEX_CONFORMANCE_VALUE_WALL", field)
  })

  it("rejects evidence substitutions, unknown fields, and every nonzero owner counter", () => {
    const evidence = mutableFixture()
    evidence.phaseOneEvidence[0].mergeCommitSha = "0".repeat(40)
    expectWall(() => normalizeCodexProviderConformance(evidence), "CODEX_CONFORMANCE_VALUE_WALL", "phaseOneEvidence")
    const unknown = mutableFixture()
    unknown.serviceToken = "not-allowed"
    expectWall(() => normalizeCodexProviderConformance(unknown), "CODEX_CONFORMANCE_UNKNOWN_FIELD_WALL", "conformance.serviceToken")
    for (const field of Object.keys(ownerBudget())) {
      const value = mutableFixture()
      value.ownerTouchBudget[field] = 1
      expectWall(() => normalizeCodexProviderConformance(value), "CODEX_CONFORMANCE_OWNER_WALL", `ownerTouchBudget.${field}`)
    }
  })

  it("allows exact R0/R1 current-session coordination without service dispatch or authority", () => {
    for (const riskClass of ["R0", "R1"]) {
      const value = coordination()
      value.envelope.riskClass = riskClass
      expect(evaluateCodexSessionCoordination(value)).toMatchObject({
        code: "CODEX_CURRENT_SESSION_COORDINATION_ELIGIBLE",
        requestedRole: "builder",
        coordinationAllowed: true,
        providerContractDispatchAllowed: false,
        dispatchPerformed: false,
        durablePersistenceClaimed: false,
        serviceWorkerClaimed: false,
        runtimeActivationAllowed: false,
        authorityGranted: false,
      })
    }
  })

  it.each(["R2", "R3"])("rejects %s task execution on the SESSION_ONLY surface", (riskClass) => {
    const value = coordination()
    value.envelope.riskClass = riskClass
    expectWall(() => evaluateCodexSessionCoordination(value), "CODEX_CONFORMANCE_RISK_WALL", "envelope.riskClass")
  })

  it.each([
    ["wrong repo", (v: ReturnType<typeof coordination>) => { v.envelope.repositories = ["bsvalues/other"]; v.envelope.baseRefs = [{ ...v.envelope.baseRefs[0], repository: "bsvalues/other" }] }, "CODEX_CONFORMANCE_ENVELOPE_WALL"],
    ["wrong role", (v: ReturnType<typeof coordination>) => { v.requestedRole = "merge-controller" }, "CODEX_CONFORMANCE_ROLE_WALL"],
    ["empty requirements", (v: ReturnType<typeof coordination>) => { v.envelope.providerRequirements = [] }, "CODEX_CONFORMANCE_ENVELOPE_WALL"],
    ["substituted actions", (v: ReturnType<typeof coordination>) => { v.envelope.allowedActions = ["READ_REPOSITORY"] }, "CODEX_CONFORMANCE_VALUE_WALL"],
    ["fallback service", (v: ReturnType<typeof coordination>) => { v.envelope.fallbackProviders = ["local-codex"] }, "CODEX_CONFORMANCE_VALUE_WALL"],
    ["runtime request", (v: ReturnType<typeof coordination>) => { v.runtimeActivationRequested = true }, "CODEX_CONFORMANCE_RUNTIME_WALL"],
    ["missing runtime prohibition", (v: ReturnType<typeof coordination>) => { v.envelope.forbiddenActions = ["CREDENTIAL_ACCESS", "OWNER_CONTACT"] }, "CODEX_CONFORMANCE_RUNTIME_WALL"],
  ])("rejects envelope %s", (_name, mutate, code) => {
    const value = coordination()
    mutate(value)
    expectWall(() => evaluateCodexSessionCoordination(value), code)
  })

  it("provides deterministic validate/coordinate CLI success and typed failure", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-conformance-"))
    const fixturePath = path.join(directory, "conformance.json")
    const coordinationPath = path.join(directory, "coordination.json")
    fs.writeFileSync(fixturePath, JSON.stringify(codexProviderConformanceFixture()))
    fs.writeFileSync(coordinationPath, JSON.stringify(coordination()))
    const cli = path.resolve("scripts/multi-agent-operator/codex-provider-conformance-cli.mjs")
    const validateOutput = JSON.parse(execFileSync(process.execPath, [cli, "validate", fixturePath], { encoding: "utf8" }))
    const coordinateOutput = JSON.parse(execFileSync(process.execPath, [cli, "coordinate", coordinationPath], { encoding: "utf8" }))
    expect(validateOutput).toMatchObject({ code: "CODEX_PROVIDER_SESSION_ONLY", providerContractDispatchAllowed: false })
    expect(coordinateOutput).toMatchObject({ code: "CODEX_CURRENT_SESSION_COORDINATION_ELIGIBLE", dispatchPerformed: false })
    const failed = spawnSync(process.execPath, [cli, "unsupported", fixturePath], { encoding: "utf8" })
    expect(failed.status).toBe(2)
    expect(JSON.parse(failed.stdout)).toMatchObject({ ok: false, code: "CODEX_CONFORMANCE_CLI_WALL", field: "operation" })
    fs.rmSync(directory, { recursive: true })
  })
})
