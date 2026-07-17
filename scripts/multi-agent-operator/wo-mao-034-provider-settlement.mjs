import crypto from "node:crypto"

import {
  createStaticClaudeProviderAssessment,
  verifyStaticClaudeProviderAssessment,
} from "./claude-provider-assessment.mjs"
import { resolveDagEligibleSet } from "./dag-eligible-resolver.mjs"
import {
  loadCanonicalProviderTrustRecord,
  PROVIDER_ASSESSMENT_PIN_REGISTRY_METADATA,
} from "./provider-assessment-trust-registry.mjs"
import {
  loadCanonicalWoMao034ProviderUnavailableAssessment,
  verifyPinnedProviderAssessmentTrustBundle,
  verifyProviderUnavailableAssessment,
} from "./provider-unavailable-settlement.mjs"
import {
  createWoMao034ProviderSettlementEnvelopes,
} from "./work-order-envelope-v2.mjs"

const TRUST_REFERENCE = Object.freeze({
  registryId: "williamos-provider-assessment-pins",
  registryVersion: 2,
})

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

export class WoMao034ProviderSettlementError extends Error {
  constructor(code, detail = null) {
    super(detail === null ? code : `${code}:${detail}`)
    this.name = "WoMao034ProviderSettlementError"
    this.code = code
    this.detail = detail
  }
}

function wall(code, detail = null) {
  throw new WoMao034ProviderSettlementError(code, detail)
}

export function canonicalWoMao034ProviderSettlementJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function woMao034ProviderSettlementContentHash(value) {
  return crypto.createHash("sha256")
    .update(canonicalWoMao034ProviderSettlementJson(value))
    .digest("hex")
}

export function runWoMao034ProviderSettlement() {
  const envelopes = createWoMao034ProviderSettlementEnvelopes()
  const sourceAssessment = createStaticClaudeProviderAssessment()
  verifyStaticClaudeProviderAssessment(sourceAssessment)
  if (sourceAssessment.contentHash !== envelopes.sourceAssessmentContentHash) {
    wall("WO_MAO_034_SOURCE_ASSESSMENT_DRIFT_WALL")
  }
  const canonicalAssessment = loadCanonicalWoMao034ProviderUnavailableAssessment()
  if (canonicalAssessment === null) {
    wall("WO_MAO_034_CANONICAL_ASSESSMENT_WALL")
  }

  const trust = verifyPinnedProviderAssessmentTrustBundle(TRUST_REFERENCE)
  const registryEntry = loadCanonicalProviderTrustRecord(
    TRUST_REFERENCE.registryId,
    TRUST_REFERENCE.registryVersion,
  )
  if (registryEntry === null) wall("WO_MAO_034_CANONICAL_TRUST_RECORD_WALL")
  const verifiedAssessment = verifyProviderUnavailableAssessment(canonicalAssessment, trust)
  const assessment = verifiedAssessment.assessment

  if (assessment.assessmentWorkOrderId !== "WO-MAO-032"
    || assessment.assessmentEnvelopeHash !== envelopes.assessmentEnvelopeHash
    || assessment.subjectWorkOrderId !== "WO-MAO-033"
    || assessment.subjectEnvelopeHash !== envelopes.subjectEnvelopeHash
    || assessment.consumerWorkOrderId !== "WO-MAO-034"
    || assessment.consumerEnvelopeHash !== envelopes.consumerEnvelopeHash
    || assessment.sourceAssessmentContentHash !== envelopes.sourceAssessmentContentHash) {
    wall("WO_MAO_034_CANONICAL_BINDING_WALL")
  }

  const dagInput = {
    schemaVersion: 1,
    artifactType: "DAG_ELIGIBILITY_INPUT",
    workOrders: [
      ...envelopes.prerequisiteEnvelopes,
      envelopes.assessmentEnvelope,
      envelopes.subjectEnvelope,
      envelopes.consumerEnvelope,
    ],
    workOrderStates: [
      ...envelopes.prerequisiteEnvelopes.map(({ workOrderId }) => ({
        workOrderId,
        state: "COMPLETE",
        reasonCode: null,
      })),
      { workOrderId: "WO-MAO-032", state: "COMPLETE", reasonCode: null },
      {
        workOrderId: "WO-MAO-033",
        state: "DEFERRED",
        reasonCode: "PROVIDER_UNAVAILABLE",
        providerUnavailableAssessmentRef: {
          artifactId: assessment.artifactId,
          contentHash: assessment.contentHash,
        },
      },
      { workOrderId: "WO-MAO-034", state: "PLANNED", reasonCode: null },
    ],
    providerAssessments: [canonicalAssessment],
  }
  const eligibility = resolveDagEligibleSet(dagInput, trust)
  const released = eligibility.eligible.find(({ workOrderId }) => workOrderId === "WO-MAO-034")
  if (!released || released.settledDependencies.length !== 1
    || released.settledDependencies[0].workOrderId !== "WO-MAO-033") {
    wall("WO_MAO_034_DAG_SETTLEMENT_WALL")
  }

  const output = {
    schemaVersion: 1,
    artifactType: "WO_MAO_034_PROVIDER_SETTLEMENT_RESULT",
    status: "CANONICAL_PROVIDER_UNAVAILABLE_SETTLEMENT_VERIFIED",
    readiness: {
      workOrderId: "WO-MAO-034",
      state: "READY",
      completed: false,
      dependencyWorkOrderId: "WO-MAO-033",
      dependencyState: "DEFERRED_PROVIDER_UNAVAILABLE",
      assessmentWorkOrderId: "WO-MAO-032",
      assessmentState: "COMPLETE",
    },
    binding: {
      assessmentEnvelopeHash: envelopes.assessmentEnvelopeHash,
      subjectEnvelopeHash: envelopes.subjectEnvelopeHash,
      consumerEnvelopeHash: envelopes.consumerEnvelopeHash,
      sourceAssessmentContentHash: envelopes.sourceAssessmentContentHash,
      assessmentArtifactId: assessment.artifactId,
      assessmentContentHash: assessment.contentHash,
      trustRegistryId: TRUST_REFERENCE.registryId,
      trustRegistryVersion: TRUST_REFERENCE.registryVersion,
      trustRootFingerprint: trust.rootFingerprint,
      trustBundleContentHash: trust.bundleContentHash,
      trustStatusHeadHash: trust.statusHeadHash,
      trustRegistryRecordContentHash: registryEntry.pinnedRegistryRecordContentHash,
      trustRegistryContentHash: PROVIDER_ASSESSMENT_PIN_REGISTRY_METADATA.contentHash,
      sourceCommitSha: "42a63e3e11e5bb1a9c1e9419db3e0f2651b1789c",
    },
    provider: {
      providerId: "claude-code",
      status: "UNAVAILABLE",
      enabled: false,
      reasonCode: "PROVIDER_UNAVAILABLE",
    },
    downstream: {
      woMao035State: "PENDING",
      woMao036State: "PENDING",
    },
    dispatchPerformed: false,
    providerContractDispatchAllowed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    secretsExposed: false,
    ownerRelayRequired: false,
    ownerOperationCounters: {
      OWNER_OPERATION_TOUCH_COUNT: 0,
      OWNER_CREDENTIAL_TOUCH_COUNT: 0,
      OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
      OWNER_ROUTINE_DECISION_COUNT: 0,
      OWNER_ROUTINE_CONTACT_COUNT: 0,
    },
  }
  return deepFreeze({ ...output, resultHash: woMao034ProviderSettlementContentHash(output) })
}
