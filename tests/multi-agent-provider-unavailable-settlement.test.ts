import crypto from "node:crypto"
import { spawnSync } from "node:child_process"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../scripts/multi-agent-operator/provider-assessment-trust-registry.mjs", async () => (
  import("./fixtures/provider-assessment-trust-registry-fixture.mjs")
))

import {
  createStaticClaudeProviderAssessment,
  verifyStaticClaudeProviderAssessment,
} from "../scripts/multi-agent-operator/claude-provider-assessment.mjs"
import {
  DagEligibleResolverError,
  resolveDagEligibleSet,
} from "../scripts/multi-agent-operator/dag-eligible-resolver.mjs"
import {
  ProviderUnavailableSettlementError,
  loadCanonicalWoMao034ProviderUnavailableAssessment,
  providerUnavailableAssessmentContentHash,
  providerTrustBundleContentHash,
  providerTrustRegistryRecordContentHash,
  providerTrustStatusEventHash,
  signProviderUnavailableAssessmentClaims,
  verifyPinnedProviderAssessmentTrustBundle,
  verifyProviderUnavailableAssessment,
} from "../scripts/multi-agent-operator/provider-unavailable-settlement.mjs"
import {
  createWoMao034ProviderSettlementEnvelopes,
  validateWorkOrderEnvelopeV2,
} from "../scripts/multi-agent-operator/work-order-envelope-v2.mjs"
import { canonicalJson } from "../scripts/multi-agent-operator/authority-events.mjs"
import {
  clearTestProviderTrustRecords,
  installTestProviderTrustRecord,
} from "./fixtures/provider-assessment-trust-registry-fixture.mjs"

afterEach(() => clearTestProviderTrustRecords())

function envelope(workOrderId: string) {
  return {
    artifactType: "WORK_ORDER_ENVELOPE_V2",
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId,
    objective: `Execute ${workOrderId} inside recorded authority.`,
    riskClass: "R3",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{
      repository: "bsvalues/terragroq",
      ref: "refs/heads/main",
      commitSha: "27bfd372ee3e3bd778351a848c5db35a1e5d19ef",
    }],
    dependencies: [] as string[],
    fanInGate: "ALL",
    laneId: `LANE-${workOrderId}`,
    teamRoles: { coordinator: "codex-coordinator", builder: `builder-${workOrderId.toLowerCase()}`, reviewer: `reviewer-${workOrderId.toLowerCase()}` },
    providerRequirements: ["isolated-worktree"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: [{ repository: "bsvalues/terragroq", path: `tmp/${workOrderId.toLowerCase()}.txt` }],
      contracts: [`contract-${workOrderId.toLowerCase()}`],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION"],
    forbiddenActions: ["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["docs/reports/WO-MAO-003-owner-only-authority-contract.md"],
    programActivationGrantRef: null,
    grantStatusEventRefs: [],
    requiredOutputs: ["artifact"],
    requiredValidation: ["tests"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 1, backoffSeconds: 0 },
    remediationBudget: { maxCycles: 1 },
    reroutePolicy: "NONE",
    stopConditions: ["authority-wall"],
    evidenceTargets: ["owner-operation-counters"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
    ownerTouchBudget: { operationTouches: 0, credentialTouches: 0, diagnosticTouches: 0, routineDecisions: 0, routineContacts: 0 },
    communicationPolicy: "FINAL_ONLY",
  }
}

function fixture() {
  const canonicalEnvelopes = createWoMao034ProviderSettlementEnvelopes()
  const assessmentEnvelope = structuredClone(canonicalEnvelopes.assessmentEnvelope)
  const subjectEnvelope = structuredClone(canonicalEnvelopes.subjectEnvelope)
  const consumerEnvelope = structuredClone(canonicalEnvelopes.consumerEnvelope)
  const claims = {
    schemaVersion: 2,
    artifactType: "PROVIDER_AVAILABILITY_ASSESSMENT",
    artifactId: "assessment-wo-mao-032-claude-code",
    providerId: "claude-code",
    assessmentWorkOrderId: "WO-MAO-032",
    subjectWorkOrderId: "WO-MAO-033",
    consumerWorkOrderId: "WO-MAO-034",
    assessmentEnvelopeHash: validateWorkOrderEnvelopeV2(assessmentEnvelope).contentHash,
    subjectEnvelopeHash: validateWorkOrderEnvelopeV2(subjectEnvelope).contentHash,
    consumerEnvelopeHash: validateWorkOrderEnvelopeV2(consumerEnvelope).contentHash,
    sourceAssessmentContentHash: canonicalEnvelopes.sourceAssessmentContentHash,
    result: "UNAVAILABLE",
    completionStatus: "COMPLETE_PROVIDER_ASSESSMENT",
    lifecycleState: "DEFERRED",
    reasonCode: "PROVIDER_UNAVAILABLE",
    continuationPolicy: "DEFER_AFFECTED_LANE_CONTINUE_HEALTHY_PROVIDERS",
    assessmentSource: "STATIC_REPOSITORY_EVIDENCE",
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const { publicKey: rootPublicKey, privateKey: rootPrivateKey } = crypto.generateKeyPairSync("ed25519")
  const artifact = {
    ...claims,
    contentHash: providerUnavailableAssessmentContentHash(claims),
    proof: {
      proofType: "TRUSTED_WRITER_SIGNATURE",
      writerId: "assurance-wo-mao-032",
      keyId: "assurance-key-1",
      algorithm: "ED25519",
      signature: signProviderUnavailableAssessmentClaims(claims, privateKey),
    },
  }
  const fingerprint = (key: typeof publicKey) => crypto.createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex")
  let previousEventHash: string | null = null
  const statusEvent = (sequence: number, subjectType: string, subjectId: string, status = "ACTIVE") => {
    const event = {
      sequence,
      version: sequence,
      fence: 100 + sequence,
      eventId: `trust-status-${sequence}`,
      subjectType,
      subjectId,
      status,
      issuedAt: `2026-07-0${sequence}T00:00:00.000Z`,
      previousEventHash,
    }
    const withHash = { ...event, eventHash: providerTrustStatusEventHash(event) }
    previousEventHash = withHash.eventHash
    return withHash
  }
  const ledgerAnchor = {
    anchorId: "anchor-assessment-032",
    ledgerId: "ledger-mao",
    eventId: "event-assessment-032",
    eventHash: "b".repeat(64),
    eventCount: 17,
    headEventHash: "c".repeat(64),
    externalAnchorId: "checkpoint-mao-032",
    assessmentContentHash: artifact.contentHash,
    artifactId: artifact.artifactId,
    providerId: claims.providerId,
    assessmentWorkOrderId: claims.assessmentWorkOrderId,
    subjectWorkOrderId: claims.subjectWorkOrderId,
    consumerWorkOrderId: claims.consumerWorkOrderId,
    assessmentEnvelopeHash: claims.assessmentEnvelopeHash,
    subjectEnvelopeHash: claims.subjectEnvelopeHash,
    consumerEnvelopeHash: claims.consumerEnvelopeHash,
    sourceAssessmentContentHash: claims.sourceAssessmentContentHash,
    status: "ACTIVE",
    issuedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:00:00.000Z",
  }
  const statusEvents = [
    statusEvent(1, "ROOT", "assessment-root-1"),
    statusEvent(2, "WRITER", "assurance-wo-mao-032"),
    statusEvent(3, "LEDGER_ANCHOR", ledgerAnchor.anchorId),
  ]
  const bundlePayload = {
    schemaVersion: 1,
    artifactType: "PROVIDER_ASSESSMENT_TRUST_BUNDLE",
    bundleId: "provider-assessment-trust-1",
    issuer: { role: "TRUST_ROOT", rootId: "assessment-root-1" },
    issuedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:00:00.000Z",
    root: {
      rootId: "assessment-root-1",
      keyId: "assessment-root-key-1",
      algorithm: "ED25519",
      publicKeyPem: rootPublicKey.export({ type: "spki", format: "pem" }).toString(),
      fingerprint: fingerprint(rootPublicKey),
      status: "ACTIVE",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
    },
    writers: [{
      writerId: "assurance-wo-mao-032",
      keyId: "assurance-key-1",
      algorithm: "ED25519",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      fingerprint: fingerprint(publicKey),
      status: "ACTIVE",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      providerIds: ["claude-code"],
      assessmentWorkOrderIds: ["WO-MAO-032"],
      subjectWorkOrderIds: ["WO-MAO-033"],
      consumerWorkOrderIds: ["WO-MAO-034"],
      consumerEnvelopeHashes: [claims.consumerEnvelopeHash],
      sourceAssessmentContentHashes: [claims.sourceAssessmentContentHash],
    }],
    ledgerAnchors: [ledgerAnchor],
    statusEvents,
    statusHead: { eventCount: statusEvents.length, latestEventHash: statusEvents.at(-1)!.eventHash },
  }
  const sealBundle = (payload = bundlePayload) => {
    const contentHash = providerTrustBundleContentHash(payload)
    return {
      ...payload,
      contentHash,
      signature: {
        algorithm: "ED25519",
        keyId: payload.root.keyId,
        value: crypto.sign(null, Buffer.from(canonicalJson(payload)), rootPrivateKey).toString("base64"),
      },
    }
  }
  const trustBundle = sealBundle()
  const registryRecord = {
    schemaVersion: 1,
    artifactType: "PROVIDER_ASSESSMENT_PIN_RECORD",
    registryId: "test-provider-assessment-pins",
    registryVersion: 1,
    status: "ACTIVE",
    immutable: true,
    trustBundle,
    pinnedRootFingerprint: bundlePayload.root.fingerprint,
    pinnedBundleContentHash: trustBundle.contentHash,
    pinnedStatusHeadHash: bundlePayload.statusHead.latestEventHash,
  }
  const installRecord = (record = registryRecord, evaluationTime = "2026-07-14T00:00:00.000Z") => {
    installTestProviderTrustRecord(record.registryId, record.registryVersion, {
      registryRecord: record,
      pinnedRegistryRecordContentHash: providerTrustRegistryRecordContentHash(record),
    }, evaluationTime)
    return { registryId: record.registryId, registryVersion: record.registryVersion }
  }
  const trustConfiguration = installRecord()
  const trust = verifyPinnedProviderAssessmentTrustBundle(trustConfiguration)
  const states = [
    { workOrderId: "WO-MAO-032", state: "COMPLETE", reasonCode: null },
    {
      workOrderId: "WO-MAO-033",
      state: "DEFERRED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      providerUnavailableAssessmentRef: { artifactId: artifact.artifactId, contentHash: artifact.contentHash },
    },
    { workOrderId: "WO-MAO-034", state: "PLANNED", reasonCode: null },
    ...canonicalEnvelopes.prerequisiteEnvelopes.map(({ workOrderId }) => ({
      workOrderId,
      state: "COMPLETE",
      reasonCode: null,
    })),
  ]
  const input = {
    schemaVersion: 1,
    artifactType: "DAG_ELIGIBILITY_INPUT",
    workOrders: [
      consumerEnvelope,
      subjectEnvelope,
      assessmentEnvelope,
      ...canonicalEnvelopes.prerequisiteEnvelopes.map((entry) => structuredClone(entry)),
    ],
    workOrderStates: states,
    providerAssessments: [artifact],
  }
  return {
    input, artifact, trust, assessmentEnvelope, subjectEnvelope, consumerEnvelope,
    claims, privateKey, publicKey, rootPrivateKey, rootPublicKey, ledgerAnchor, bundlePayload, sealBundle,
    trustConfiguration,
    registryRecord, installRecord,
  }
}

function expectDagWall(input: unknown, trust: unknown, detail?: string) {
  try {
    resolveDagEligibleSet(input, trust)
    throw new Error("expected DAG wall")
  } catch (error) {
    expect(error).toBeInstanceOf(DagEligibleResolverError)
    expect(error).toMatchObject({ code: "DAG_ELIGIBILITY_SETTLEMENT_WALL" })
    if (detail) expect(String((error as Error).message)).toContain(detail)
  }
}

describe("WO-MAO-032 static Claude provider assessment", () => {
  it("records the exact unavailable, zero-owner, healthy-provider-continuation outcome", () => {
    const assessment = createStaticClaudeProviderAssessment()
    expect(assessment).toMatchObject({
      assessmentStatus: "COMPLETE_PROVIDER_ASSESSMENT",
      availability: "UNAVAILABLE",
      reasonCode: "PROVIDER_UNAVAILABLE",
      enabled: false,
      maxConcurrency: 0,
      serviceCompatible: false,
      trustGateStatus: "NOT_EVALUATED_NO_TRANSPORT",
      lifecycleState: "DEFERRED",
      continuationPolicy: "DEFER_AFFECTED_LANE_CONTINUE_HEALTHY_PROVIDERS",
      codexLaneStatus: "ELIGIBLE_UNAFFECTED",
      ownerDecisionRequired: false,
      prohibitedOperationsPerformed: {
        claudeCommand: false,
        claudeVersionProbe: false,
        authenticationProbe: false,
        credentialInspection: false,
        networkProbe: false,
        smokeExecution: false,
        runtimeActivation: false,
        githubOperation: false,
        ownerContact: false,
      },
      ownerOperationCounters: {
        OWNER_OPERATION_TOUCH_COUNT: 0,
        OWNER_CREDENTIAL_TOUCH_COUNT: 0,
        OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
        OWNER_ROUTINE_DECISION_COUNT: 0,
        OWNER_ROUTINE_CONTACT_COUNT: 0,
      },
    })
    expect(verifyStaticClaudeProviderAssessment(assessment)).toMatchObject({ ok: true, providerInvoked: false })
    expect(() => verifyStaticClaudeProviderAssessment({ ...assessment, enabled: true })).toThrow("CLAUDE_PROVIDER_ASSESSMENT_MISMATCH")
  })
})

describe("provider-unavailable dependency settlement", () => {
  it("settles only the explicitly declared ALL edge with an independently verified assessment", () => {
    const { input, trust, artifact } = fixture()
    expect(trust).toMatchObject({
      ok: true,
      code: "PROVIDER_ASSESSMENT_TRUST_BUNDLE_VERIFIED",
      writerCount: 1,
      ledgerAnchorCount: 1,
    })
    expect(verifyProviderUnavailableAssessment(artifact, trust)).toMatchObject({
      ok: true,
      code: "PROVIDER_UNAVAILABLE_ASSESSMENT_VERIFIED",
      independentlyAuthoritative: true,
    })
    const result = resolveDagEligibleSet(input, trust)
    expect(result.eligible).toEqual([{
      workOrderId: "WO-MAO-034",
      fanInGate: "ALL",
      completedDependencies: ["WO-MAO-024", "WO-MAO-031"],
      settledDependencies: [{
        workOrderId: "WO-MAO-033",
        satisfaction: "COMPLETE_OR_PROVIDER_UNAVAILABLE_DEFERRED",
        providerId: "claude-code",
        assessmentWorkOrderId: "WO-MAO-032",
        assessmentArtifactId: artifact.artifactId,
        assessmentContentHash: artifact.contentHash,
        consumerWorkOrderId: "WO-MAO-034",
        consumerEnvelopeHash: artifact.consumerEnvelopeHash,
        sourceAssessmentContentHash: artifact.sourceAssessmentContentHash,
      }],
    }])
    expect(result.ineligible).toEqual([{
      workOrderId: "WO-MAO-033",
      reasonCode: "EXPLICITLY_DEFERRED",
      stateReasonCode: "PROVIDER_UNAVAILABLE",
    }])
  })

  it("rejects consumer-envelope replay and any tampered V2 consumer/source binding", () => {
    const replay = fixture()
    const changedConsumer = structuredClone(replay.consumerEnvelope)
    changedConsumer.objective = `${changedConsumer.objective} replayed`
    replay.input.workOrders[0] = changedConsumer
    expectDagWall(replay.input, replay.trust, "ASSESSMENT_IDENTITY_OR_ENVELOPE_HASH_MISMATCH")

    const tampered = fixture()
    tampered.input.providerAssessments[0] = {
      ...tampered.artifact,
      consumerWorkOrderId: "WO-MAO-099",
    }
    expectDagWall(tampered.input, tampered.trust, "PROVIDER_SETTLEMENT_HASH_WALL")
  })

  it("rejects correctly re-signed claims outside pinned consumer and source-assessment scope", () => {
    for (const mutation of [
      { consumerWorkOrderId: "WO-MAO-099" },
      { consumerEnvelopeHash: "d".repeat(64) },
      { sourceAssessmentContentHash: "e".repeat(64) },
    ]) {
      const data = fixture()
      const claims = { ...data.claims, ...mutation }
      const artifact = {
        ...claims,
        contentHash: providerUnavailableAssessmentContentHash(claims),
        proof: {
          ...data.artifact.proof,
          signature: signProviderUnavailableAssessmentClaims(claims, data.privateKey),
        },
      }
      expect(() => verifyProviderUnavailableAssessment(artifact, data.trust)).toThrow(/WRITER_SCOPE_MISMATCH/)
    }
  })

  it("rejects random signatures, self-asserted writers, computed-hash mismatch, and unknown fields", () => {
    const { artifact, trust } = fixture()
    expect(() => verifyProviderUnavailableAssessment({ ...artifact, proof: { ...artifact.proof, signature: Buffer.alloc(64, 1).toString("base64") } }, trust))
      .toThrow(/SIGNATURE_VERIFICATION_FAILED/)
    expect(() => verifyProviderUnavailableAssessment(artifact, { trustedAssessmentWriters: [] }))
      .toThrow(/RAW_CALLER_TRUST_REJECTED/)
    expect(() => verifyProviderUnavailableAssessment(artifact, { trustedLedgerAnchors: [] }))
      .toThrow(/RAW_CALLER_TRUST_REJECTED/)
    expect(() => verifyProviderUnavailableAssessment({ ...artifact, contentHash: "a".repeat(64) }, trust))
      .toThrow(/COMPUTED_HASH_MISMATCH/)
    expect(() => verifyProviderUnavailableAssessment({ ...artifact, surprise: true }, trust)).toThrow(ProviderUnavailableSettlementError)
  })

  it("accepts an exact independently trusted immutable-ledger anchor and rejects a self-asserted anchor", () => {
    const { artifact, trust } = fixture()
    const proof = {
      proofType: "IMMUTABLE_EVIDENCE_LEDGER_ANCHOR",
      ledgerId: "ledger-mao",
      eventId: "event-assessment-032",
      eventHash: "b".repeat(64),
      eventCount: 17,
      headEventHash: "c".repeat(64),
      externalAnchorId: "checkpoint-mao-032",
    }
    const anchored = { ...artifact, proof }
    expect(verifyProviderUnavailableAssessment(anchored, trust)).toMatchObject({ independentlyAuthoritative: true })
    expect(() => verifyProviderUnavailableAssessment({
      ...anchored,
      proof: { ...proof, eventHash: "d".repeat(64) },
    }, trust)).toThrow(/ACTIVE_PINNED_LEDGER_ANCHOR_REQUIRED/)
  })

  it("rejects root substitution, bad pinned bundle hash/signature, stale bundles, and raw self-roots", () => {
    const data = fixture()
    expect(() => verifyProviderUnavailableAssessment(data.artifact, data.trustConfiguration))
      .toThrow(/SEPARATELY_CONFIGURED_PINNED_TRUST_REQUIRED/)
    const substituted = structuredClone(data.bundlePayload)
    const replacement = crypto.generateKeyPairSync("ed25519")
    substituted.root.publicKeyPem = replacement.publicKey.export({ type: "spki", format: "pem" }).toString()
    substituted.root.fingerprint = crypto.createHash("sha256")
      .update(replacement.publicKey.export({ type: "spki", format: "der" })).digest("hex")
    const substitutedHash = providerTrustBundleContentHash(substituted)
    const substitutedBundle = {
      ...substituted,
      contentHash: substitutedHash,
      signature: {
        algorithm: "ED25519",
        keyId: substituted.root.keyId,
        value: crypto.sign(null, Buffer.from(canonicalJson(substituted)), replacement.privateKey).toString("base64"),
      },
    }
    const substitutedRecord = {
      ...structuredClone(data.registryRecord),
      trustBundle: substitutedBundle,
      pinnedBundleContentHash: substitutedHash,
    }
    expect(() => verifyPinnedProviderAssessmentTrustBundle(data.installRecord(substitutedRecord)))
      .toThrow(/PINNED_ROOT_MISMATCH/)

    const badHashRecord = { ...structuredClone(data.registryRecord), pinnedBundleContentHash: "e".repeat(64) }
    expect(() => verifyPinnedProviderAssessmentTrustBundle(data.installRecord(badHashRecord)))
      .toThrow(/PINNED_HASH_MISMATCH/)
    const badSignatureRecord = structuredClone(data.registryRecord)
    badSignatureRecord.trustBundle.signature.value = Buffer.alloc(64, 4).toString("base64")
    expect(() => verifyPinnedProviderAssessmentTrustBundle(data.installRecord(badSignatureRecord)))
      .toThrow(/SIGNATURE_VERIFICATION_FAILED/)
    expect(() => verifyPinnedProviderAssessmentTrustBundle(
      data.installRecord(data.registryRecord, "2026-08-01T00:00:00.000Z"),
    )).toThrow(/ACTIVE_WINDOW_REQUIRED/)
    const badHeadRecord = { ...structuredClone(data.registryRecord), pinnedStatusHeadHash: "9".repeat(64) }
    expect(() => verifyPinnedProviderAssessmentTrustBundle(data.installRecord(badHeadRecord)))
      .toThrow(/PINNED_HEAD_MISMATCH/)
    expect(() => verifyPinnedProviderAssessmentTrustBundle({
      ...data.trustConfiguration,
      trustBundle: data.registryRecord.trustBundle,
    })).toThrow(/CALLER_TRUST_MATERIAL_REJECTED/)

    const selfKey = crypto.generateKeyPairSync("ed25519")
    const selfSigned = {
      ...data.artifact,
      proof: {
        ...data.artifact.proof,
        writerId: "caller-self-root",
        keyId: "caller-self-key",
        signature: signProviderUnavailableAssessmentClaims(data.claims, selfKey.privateKey),
      },
    }
    expect(() => verifyProviderUnavailableAssessment(selfSigned, {
      trustedAssessmentWriters: [{
        writerId: "caller-self-root",
        keyId: "caller-self-key",
        algorithm: "ED25519",
        publicKey: selfKey.publicKey.export({ type: "spki", format: "pem" }).toString(),
      }],
    })).toThrow(/RAW_CALLER_TRUST_REJECTED/)
  })

  it("exposes no production root-registration surface and rejects unknown registry references", () => {
    const probe = spawnSync(process.execPath, ["--input-type=module", "-e", [
      'import * as registry from "./scripts/multi-agent-operator/provider-assessment-trust-registry.mjs"',
      'console.log(JSON.stringify({keys:Object.keys(registry).sort(),metadata:registry.PROVIDER_ASSESSMENT_PIN_REGISTRY_METADATA,record:registry.loadCanonicalProviderTrustRecord("williamos-provider-assessment-pins",2)}))',
    ].join(";")], { cwd: process.cwd(), encoding: "utf8" })
    expect(probe.status).toBe(0)
    const result = JSON.parse(probe.stdout)
    expect(result.keys).toEqual(["PROVIDER_ASSESSMENT_PIN_REGISTRY_METADATA", "loadCanonicalProviderTrustRecord"])
    expect(result.metadata).toMatchObject({
      version: 2,
      activeRecordCount: 1,
      mutableRegistrationAllowed: false,
      contentHash: "36e5454ad60f86580ca621beef685d195877a693eef4fb2c22f8e7fb454e5034",
    })
    expect(result.record).toMatchObject({
      registryRecord: {
        registryId: "williamos-provider-assessment-pins",
        registryVersion: 2,
        status: "ACTIVE",
        immutable: true,
      },
      pinnedRegistryRecordContentHash: "8dfb934e0499518dfefe3215ffab3eb4e6fd42d18f0c9417db300eee280e9c11",
    })
    expect(() => verifyPinnedProviderAssessmentTrustBundle({
      registryId: "caller-minted-root",
      registryVersion: 1,
    })).toThrow(/AUTHENTICATED_PINNED_RECORD_REQUIRED/)
  })

  it("verifies the immutable production V2 settlement without exposing private key material", () => {
    const assessment = loadCanonicalWoMao034ProviderUnavailableAssessment()
    const probe = spawnSync(process.execPath, ["--input-type=module", "-e", [
      'import * as settlement from "./scripts/multi-agent-operator/provider-unavailable-settlement.mjs"',
      'const trust=settlement.verifyPinnedProviderAssessmentTrustBundle({registryId:"williamos-provider-assessment-pins",registryVersion:2})',
      'const assessment=settlement.loadCanonicalWoMao034ProviderUnavailableAssessment()',
      'console.log(JSON.stringify({keys:Object.keys(settlement).sort(),trust,verified:settlement.verifyProviderUnavailableAssessment(assessment,trust)}))',
    ].join(";")], { cwd: process.cwd(), encoding: "utf8" })
    expect(probe.status).toBe(0)
    const result = JSON.parse(probe.stdout)
    expect(result.trust).toMatchObject({
      registryVersion: 2,
      rootFingerprint: "55d270e3515c50354718835ff57bfb793b6575a03d43bb415eda9f58739a495a",
      bundleContentHash: "7198e6c96a30f058f2384c98bed692df2c8a25997bede2138f374314eaf22ee1",
      statusHeadHash: "3f697265d1efc91373251d1f5bea3f847052ac425eb5a22d41fe74b8d86f8ff0",
    })
    expect(result.verified).toMatchObject({
      ok: true,
      assessment: {
        artifactId: assessment.artifactId,
        consumerWorkOrderId: "WO-MAO-034",
        consumerEnvelopeHash: "c03f2339666105cbe08b51ef32a50000d3b2441103f4420721f216c75667cb03",
        sourceAssessmentContentHash: "60917d122e314844e175c9d4e6e60e197a5e4f06bc2b6f2ea73b0fc1e09ed523",
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE KEY|privateKey|BEGIN PRIVATE/)
  })

  it("reloads registry trust for every assessment so stale handles cannot survive expiry or revocation", () => {
    const expired = fixture()
    expect(verifyProviderUnavailableAssessment(expired.artifact, expired.trust)).toMatchObject({ ok: true })
    expired.installRecord(expired.registryRecord, "2026-08-01T00:00:00.000Z")
    expect(() => verifyProviderUnavailableAssessment(expired.artifact, expired.trust))
      .toThrow(/ACTIVE_WINDOW_REQUIRED/)

    const revoked = fixture()
    expect(verifyProviderUnavailableAssessment(revoked.artifact, revoked.trust)).toMatchObject({ ok: true })
    const revokedRecord = { ...structuredClone(revoked.registryRecord), status: "REVOKED" }
    revoked.installRecord(revokedRecord)
    expect(() => verifyProviderUnavailableAssessment(revoked.artifact, revoked.trust))
      .toThrow(/ACTIVE_IMMUTABLE_RECORD_REQUIRED/)
  })

  it("rejects duplicate, out-of-order, rollback, backdated, and post-revocation status chains", () => {
    const assertChainWall = (mutate: (payload: ReturnType<typeof structuredClone>) => void, expected: RegExp) => {
      const data = fixture()
      const payload = structuredClone(data.bundlePayload)
      mutate(payload)
      let previousEventHash: string | null = null
      for (const event of payload.statusEvents) {
        event.previousEventHash = previousEventHash
        event.eventHash = providerTrustStatusEventHash(event)
        previousEventHash = event.eventHash
      }
      payload.statusHead = { eventCount: payload.statusEvents.length, latestEventHash: previousEventHash! }
      const bundle = data.sealBundle(payload)
      const record = {
        ...structuredClone(data.registryRecord),
        trustBundle: bundle,
        pinnedBundleContentHash: bundle.contentHash,
        pinnedStatusHeadHash: payload.statusHead.latestEventHash,
      }
      expect(() => verifyPinnedProviderAssessmentTrustBundle(data.installRecord(record))).toThrow(expected)
    }

    assertChainWall((payload) => { payload.statusEvents[1].eventId = payload.statusEvents[0].eventId }, /DUPLICATE/)
    assertChainWall((payload) => { payload.statusEvents[1].sequence = 3 }, /CHAIN_LINK_MISMATCH/)
    assertChainWall((payload) => { payload.statusEvents[1].version = 1 }, /CHAIN_LINK_MISMATCH/)
    assertChainWall((payload) => { payload.statusEvents[2].fence = payload.statusEvents[1].fence }, /CHAIN_LINK_MISMATCH/)
    assertChainWall((payload) => { payload.statusEvents[2].issuedAt = payload.statusEvents[1].issuedAt }, /STRICTLY_MONOTONIC_TIME_REQUIRED/)
    assertChainWall((payload) => {
      payload.statusEvents.push({
        sequence: 4,
        version: 4,
        fence: 104,
        eventId: "trust-status-4",
        subjectType: "WRITER",
        subjectId: "assurance-wo-mao-032",
        status: "REVOKED",
        issuedAt: "2026-07-10T00:00:00.000Z",
        previousEventHash: null,
        eventHash: "0".repeat(64),
      }, {
        sequence: 5,
        version: 5,
        fence: 105,
        eventId: "trust-status-5",
        subjectType: "WRITER",
        subjectId: "assurance-wo-mao-032",
        status: "ACTIVE",
        issuedAt: "2026-07-11T00:00:00.000Z",
        previousEventHash: null,
        eventHash: "0".repeat(64),
      })
    }, /TERMINAL_REVOCATION_VIOLATION/)
    assertChainWall((payload) => {
      payload.statusEvents.push({
        sequence: 4,
        version: 4,
        fence: 104,
        eventId: "trust-status-4",
        subjectType: "WRITER",
        subjectId: "assurance-wo-mao-032",
        status: "REVOKED",
        issuedAt: "2026-07-10T00:00:00.000Z",
        previousEventHash: null,
        eventHash: "0".repeat(64),
      }, {
        sequence: 5,
        version: 5,
        fence: 105,
        eventId: "trust-status-5",
        subjectType: "WRITER",
        subjectId: "assurance-wo-mao-032",
        status: "ACTIVE",
        issuedAt: "2026-07-09T00:00:00.000Z",
        previousEventHash: null,
        eventHash: "0".repeat(64),
      })
    }, /STRICTLY_MONOTONIC_TIME_REQUIRED/)
  })

  it("rejects revoked roots/writers, expired writers, fabricated anchors, and identity/hash mismatch", () => {
    const rootRevoked = fixture()
    const rootPayload = structuredClone(rootRevoked.bundlePayload)
    rootPayload.root.status = "REVOKED"
    const rootEvent = {
      sequence: 4,
      version: 4,
      fence: 104,
      eventId: "trust-status-4",
      subjectType: "ROOT",
      subjectId: rootPayload.root.rootId,
      status: "REVOKED",
      issuedAt: "2026-07-10T00:00:00.000Z",
      previousEventHash: rootPayload.statusHead.latestEventHash,
    }
    rootPayload.statusEvents.push({ ...rootEvent, eventHash: providerTrustStatusEventHash(rootEvent) })
    rootPayload.statusHead = { eventCount: 4, latestEventHash: rootPayload.statusEvents.at(-1)!.eventHash }
    const rootBundle = rootRevoked.sealBundle(rootPayload)
    const rootRevokedRecord = {
      ...structuredClone(rootRevoked.registryRecord),
      trustBundle: rootBundle,
      pinnedBundleContentHash: rootBundle.contentHash,
      pinnedStatusHeadHash: rootPayload.statusHead.latestEventHash,
    }
    expect(() => verifyPinnedProviderAssessmentTrustBundle(rootRevoked.installRecord(rootRevokedRecord)))
      .toThrow(/ACTIVE_ED25519_ROOT_REQUIRED/)

    const rootExpired = fixture()
    const expiredRootPayload = structuredClone(rootExpired.bundlePayload)
    expiredRootPayload.root.expiresAt = "2026-07-13T00:00:00.000Z"
    const expiredRootBundle = rootExpired.sealBundle(expiredRootPayload)
    const rootExpiredRecord = {
      ...structuredClone(rootExpired.registryRecord),
      trustBundle: expiredRootBundle,
      pinnedBundleContentHash: expiredRootBundle.contentHash,
    }
    expect(() => verifyPinnedProviderAssessmentTrustBundle(rootExpired.installRecord(rootExpiredRecord)))
      .toThrow(/ACTIVE_ROOT_WINDOW_REQUIRED/)

    const writerRevoked = fixture()
    const writerPayload = structuredClone(writerRevoked.bundlePayload)
    writerPayload.writers[0].status = "REVOKED"
    const writerEvent = {
      sequence: 4,
      version: 4,
      fence: 104,
      eventId: "trust-status-4",
      subjectType: "WRITER",
      subjectId: writerPayload.writers[0].writerId,
      status: "REVOKED",
      issuedAt: "2026-07-10T00:00:00.000Z",
      previousEventHash: writerPayload.statusHead.latestEventHash,
    }
    writerPayload.statusEvents.push({ ...writerEvent, eventHash: providerTrustStatusEventHash(writerEvent) })
    writerPayload.statusHead = { eventCount: 4, latestEventHash: writerPayload.statusEvents.at(-1)!.eventHash }
    const writerBundle = writerRevoked.sealBundle(writerPayload)
    const writerRevokedRecord = {
      ...structuredClone(writerRevoked.registryRecord),
      trustBundle: writerBundle,
      pinnedBundleContentHash: writerBundle.contentHash,
      pinnedStatusHeadHash: writerPayload.statusHead.latestEventHash,
    }
    const revokedWriterTrust = verifyPinnedProviderAssessmentTrustBundle(writerRevoked.installRecord(writerRevokedRecord))
    expect(() => verifyProviderUnavailableAssessment(writerRevoked.artifact, revokedWriterTrust))
      .toThrow(/ACTIVE_FRESH_WRITER_REQUIRED/)

    const writerExpired = fixture()
    const expiredPayload = structuredClone(writerExpired.bundlePayload)
    expiredPayload.writers[0].expiresAt = "2026-07-13T00:00:00.000Z"
    const expiredBundle = writerExpired.sealBundle(expiredPayload)
    const writerExpiredRecord = {
      ...structuredClone(writerExpired.registryRecord),
      trustBundle: expiredBundle,
      pinnedBundleContentHash: expiredBundle.contentHash,
    }
    const expiredWriterTrust = verifyPinnedProviderAssessmentTrustBundle(writerExpired.installRecord(writerExpiredRecord))
    expect(() => verifyProviderUnavailableAssessment(writerExpired.artifact, expiredWriterTrust))
      .toThrow(/ACTIVE_FRESH_WRITER_REQUIRED/)

    const writerStale = fixture()
    const staleWriterPayload = structuredClone(writerStale.bundlePayload)
    staleWriterPayload.writers[0].notBefore = "2026-07-15T00:00:00.000Z"
    const staleWriterBundle = writerStale.sealBundle(staleWriterPayload)
    const writerStaleRecord = {
      ...structuredClone(writerStale.registryRecord),
      trustBundle: staleWriterBundle,
      pinnedBundleContentHash: staleWriterBundle.contentHash,
    }
    const staleWriterTrust = verifyPinnedProviderAssessmentTrustBundle(writerStale.installRecord(writerStaleRecord))
    expect(() => verifyProviderUnavailableAssessment(writerStale.artifact, staleWriterTrust))
      .toThrow(/ACTIVE_FRESH_WRITER_REQUIRED/)

    const identity = fixture()
    const otherClaims = { ...identity.claims, providerId: "other-provider" }
    const otherArtifact = {
      ...otherClaims,
      contentHash: providerUnavailableAssessmentContentHash(otherClaims),
      proof: {
        ...identity.artifact.proof,
        signature: signProviderUnavailableAssessmentClaims(otherClaims, identity.privateKey),
      },
    }
    expect(() => verifyProviderUnavailableAssessment(otherArtifact, identity.trust)).toThrow(/WRITER_SCOPE_MISMATCH/)

    const envelopeMismatch = fixture()
    const mismatchedClaims = { ...envelopeMismatch.claims, subjectEnvelopeHash: "f".repeat(64) }
    const mismatchedArtifact = {
      ...mismatchedClaims,
      contentHash: providerUnavailableAssessmentContentHash(mismatchedClaims),
      proof: {
        ...envelopeMismatch.artifact.proof,
        signature: signProviderUnavailableAssessmentClaims(mismatchedClaims, envelopeMismatch.privateKey),
      },
    }
    envelopeMismatch.input.providerAssessments[0] = mismatchedArtifact
    envelopeMismatch.input.workOrderStates[1].providerUnavailableAssessmentRef.contentHash = mismatchedArtifact.contentHash
    expectDagWall(envelopeMismatch.input, envelopeMismatch.trust, "ASSESSMENT_IDENTITY_OR_ENVELOPE_HASH_MISMATCH")
  })

  it("rejects blocked, arbitrary deferred, missing evidence, mismatched identities, and arbitrary COMPLETE WOs", () => {
    const blocked = fixture()
    blocked.input.workOrderStates[1].state = "BLOCKED"
    blocked.input.workOrderStates[1].reasonCode = "PROVIDER_UNAVAILABLE"
    expectDagWall(blocked.input, blocked.trust, "PROVIDER_UNAVAILABLE_DEFER_REQUIRED")

    const arbitrary = fixture()
    arbitrary.input.workOrderStates[1].reasonCode = "POLICY_DEFER"
    expectDagWall(arbitrary.input, arbitrary.trust, "PROVIDER_UNAVAILABLE_DEFER_REQUIRED")

    const missing = fixture()
    delete missing.input.workOrderStates[1].providerUnavailableAssessmentRef
    expectDagWall(missing.input, missing.trust, "ASSESSMENT_REFERENCE_REQUIRED")

    const mismatch = fixture()
    mismatch.input.providerAssessments[0] = { ...mismatch.artifact, providerId: "other-provider" }
    expectDagWall(mismatch.input, mismatch.trust)

    const arbitraryComplete = fixture()
    arbitraryComplete.input.workOrders[2] = { ...arbitraryComplete.assessmentEnvelope, providerBinding: null }
    expectDagWall(arbitraryComplete.input, arbitraryComplete.trust, "ENVELOPE_PROVIDER_BINDING_MISMATCH")
  })

  it("rejects duplicate, unreferenced, and unknown assessment inputs while old COMPLETE-only inputs remain unchanged", () => {
    const malformed = fixture()
    malformed.input.providerAssessments = [null]
    try {
      resolveDagEligibleSet(malformed.input, malformed.trust)
      throw new Error("expected malformed assessment wall")
    } catch (error) {
      expect(error).toMatchObject({
        code: "DAG_ELIGIBILITY_TYPE_WALL",
        field: "providerAssessments[0]",
        detail: "OBJECT_REQUIRED",
      })
    }

    const duplicate = fixture()
    duplicate.input.providerAssessments.push({ ...duplicate.artifact })
    try {
      resolveDagEligibleSet(duplicate.input, duplicate.trust)
      throw new Error("expected duplicate wall")
    } catch (error) {
      expect(error).toMatchObject({ code: "DAG_ELIGIBILITY_DUPLICATE_WALL" })
    }

    const unreferenced = fixture()
    unreferenced.input.providerAssessments.push({
      ...unreferenced.artifact,
      artifactId: "assessment-unreferenced",
    })
    expectDagWall(unreferenced.input, unreferenced.trust, "UNREFERENCED_ASSESSMENT")

    const unknownAssessmentWo = fixture()
    unknownAssessmentWo.input.workOrders[0].dependencyPolicies[0].assessmentWorkOrderId = "WO-MAO-999"
    expectDagWall(unknownAssessmentWo.input, unknownAssessmentWo.trust, "UNKNOWN_ASSESSMENT_WORK_ORDER")

    const oldA = envelope("WO-MAO-016")
    const oldB = envelope("WO-MAO-017")
    oldB.dependencies = ["WO-MAO-016"]
    const oldResult = resolveDagEligibleSet({
      schemaVersion: 1,
      artifactType: "DAG_ELIGIBILITY_INPUT",
      workOrders: [oldB, oldA],
      workOrderStates: [
        { workOrderId: "WO-MAO-016", state: "COMPLETE", reasonCode: null },
        { workOrderId: "WO-MAO-017", state: "PLANNED", reasonCode: null },
      ],
    })
    expect(oldResult.eligible).toEqual([{ workOrderId: "WO-MAO-017", fanInGate: "ALL", completedDependencies: ["WO-MAO-016"] }])
  })

  it("does not demand settlement evidence for PLANNED dependencies or suppress unrelated eligible lanes", () => {
    const data = fixture()
    data.input.workOrderStates[1] = { workOrderId: "WO-MAO-033", state: "PLANNED", reasonCode: null }
    data.input.providerAssessments = []
    data.input.workOrders.push(envelope("WO-MAO-035"))
    data.input.workOrderStates.push({ workOrderId: "WO-MAO-035", state: "PLANNED", reasonCode: null })
    const result = resolveDagEligibleSet(data.input, data.trust)
    expect(result.eligible).toEqual([
      {
        workOrderId: "WO-MAO-033",
        fanInGate: "ALL",
        completedDependencies: ["WO-MAO-025", "WO-MAO-028", "WO-MAO-032"],
      },
      { workOrderId: "WO-MAO-035", fanInGate: "ALL", completedDependencies: [] },
    ])
    expect(result.ineligible).toContainEqual({
      workOrderId: "WO-MAO-034",
      reasonCode: "DEPENDENCY_INCOMPLETE",
      fanInGate: "ALL",
      completedDependencies: ["WO-MAO-024", "WO-MAO-031"],
      pendingDependencies: ["WO-MAO-033"],
      deferredDependencies: [],
      blockedDependencies: [],
    })
  })
})
