import crypto from "node:crypto"

const EMBEDDED_REGISTRY = Object.freeze({
  artifactType: "PROVIDER_ASSESSMENT_PIN_REGISTRY",
  records: Object.freeze([Object.freeze({
    registryRecord: Object.freeze({
      schemaVersion: 1,
      artifactType: "PROVIDER_ASSESSMENT_PIN_RECORD",
      registryId: "williamos-provider-assessment-pins",
      registryVersion: 2,
      status: "ACTIVE",
      immutable: true,
      trustBundle: Object.freeze({
        schemaVersion: 1,
        artifactType: "PROVIDER_ASSESSMENT_TRUST_BUNDLE",
        bundleId: "williamos-provider-assessment-trust-v2",
        issuer: Object.freeze({ role: "TRUST_ROOT", rootId: "williamos-provider-assessment-root-v2" }),
        issuedAt: "2026-07-16T00:00:00.000Z",
        expiresAt: "2031-07-16T00:00:00.000Z",
        root: Object.freeze({
          rootId: "williamos-provider-assessment-root-v2",
          keyId: "williamos-provider-assessment-root-key-v2",
          algorithm: "ED25519",
          publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAfM3PFt4vihPZ/XCBsL8uTSIRCMTBvaCYsj/ZN7mr+3E=\n-----END PUBLIC KEY-----\n",
          fingerprint: "55d270e3515c50354718835ff57bfb793b6575a03d43bb415eda9f58739a495a",
          status: "ACTIVE",
          notBefore: "2026-07-16T00:00:00.000Z",
          expiresAt: "2031-07-16T00:00:00.000Z",
        }),
        writers: Object.freeze([Object.freeze({
          writerId: "williamos-wo-mao-034-settlement-reviewer",
          keyId: "williamos-wo-mao-034-writer-key-1",
          algorithm: "ED25519",
          publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEADcC+7b0YgkcikGa6aw0frB4dcFrwYo6ubX3oztbSOWE=\n-----END PUBLIC KEY-----\n",
          fingerprint: "27aed65cb283090745014005e421cab3784674f0b46180a96f271b26824e4361",
          status: "ACTIVE",
          notBefore: "2026-07-16T00:00:00.000Z",
          expiresAt: "2031-07-16T00:00:00.000Z",
          providerIds: Object.freeze(["claude-code"]),
          assessmentWorkOrderIds: Object.freeze(["WO-MAO-032"]),
          subjectWorkOrderIds: Object.freeze(["WO-MAO-033"]),
          consumerWorkOrderIds: Object.freeze(["WO-MAO-034"]),
          consumerEnvelopeHashes: Object.freeze(["c03f2339666105cbe08b51ef32a50000d3b2441103f4420721f216c75667cb03"]),
          sourceAssessmentContentHashes: Object.freeze(["60917d122e314844e175c9d4e6e60e197a5e4f06bc2b6f2ea73b0fc1e09ed523"]),
        })]),
        ledgerAnchors: Object.freeze([Object.freeze({
          anchorId: "wo-mao-034-settlement-anchor-v2",
          ledgerId: "williamos-governance-evidence",
          eventId: "wo-mao-034-provider-settlement-v2",
          eventHash: "96de8a45c18540e1b96e60c4b27715301af28189445acbcb18522abd3945082b",
          eventCount: 1,
          headEventHash: "c4c40f1595e4955e17491e26b6a361395e20d6939b1a830bfcbb778d8085b89b",
          externalAnchorId: "terragroq-wo-mao-034-settlement-v2",
          assessmentContentHash: "5b19ba9eacf183ea8afaa799f3015c18e48ab0cf3356c5aa35de55056f68a3b6",
          artifactId: "settlement-wo-mao-034-claude-unavailable-v2",
          providerId: "claude-code",
          assessmentWorkOrderId: "WO-MAO-032",
          subjectWorkOrderId: "WO-MAO-033",
          consumerWorkOrderId: "WO-MAO-034",
          assessmentEnvelopeHash: "4f4495e4ca5e0691ba99ac277a74f5c29c594e9f300fd02979fa2eea07628da8",
          subjectEnvelopeHash: "5311ed8044b3b40a9ea7604cdb77a90d29f2d5562562a7c2988313f76a7226ee",
          consumerEnvelopeHash: "c03f2339666105cbe08b51ef32a50000d3b2441103f4420721f216c75667cb03",
          sourceAssessmentContentHash: "60917d122e314844e175c9d4e6e60e197a5e4f06bc2b6f2ea73b0fc1e09ed523",
          status: "ACTIVE",
          issuedAt: "2026-07-16T00:00:00.000Z",
          expiresAt: "2031-07-16T00:00:00.000Z",
        })]),
        statusEvents: Object.freeze([
          Object.freeze({
            sequence: 1, version: 1, fence: 3401, eventId: "wo-mao-034-trust-status-1",
            subjectType: "ROOT", subjectId: "williamos-provider-assessment-root-v2", status: "ACTIVE",
            issuedAt: "2026-07-16T00:01:00.000Z", previousEventHash: null,
            eventHash: "ddb1519bbcf7d0acac417ce41d219284412fc15a5dd7ff16b56f84657ecca510",
          }),
          Object.freeze({
            sequence: 2, version: 2, fence: 3402, eventId: "wo-mao-034-trust-status-2",
            subjectType: "WRITER", subjectId: "williamos-wo-mao-034-settlement-reviewer", status: "ACTIVE",
            issuedAt: "2026-07-16T00:02:00.000Z",
            previousEventHash: "ddb1519bbcf7d0acac417ce41d219284412fc15a5dd7ff16b56f84657ecca510",
            eventHash: "a0e629ac1fb00de8179a7c7ab4464a35a4c48e051923fb93f878b987bf005bce",
          }),
          Object.freeze({
            sequence: 3, version: 3, fence: 3403, eventId: "wo-mao-034-trust-status-3",
            subjectType: "LEDGER_ANCHOR", subjectId: "wo-mao-034-settlement-anchor-v2", status: "ACTIVE",
            issuedAt: "2026-07-16T00:03:00.000Z",
            previousEventHash: "a0e629ac1fb00de8179a7c7ab4464a35a4c48e051923fb93f878b987bf005bce",
            eventHash: "3f697265d1efc91373251d1f5bea3f847052ac425eb5a22d41fe74b8d86f8ff0",
          }),
        ]),
        statusHead: Object.freeze({
          eventCount: 3,
          latestEventHash: "3f697265d1efc91373251d1f5bea3f847052ac425eb5a22d41fe74b8d86f8ff0",
        }),
        contentHash: "7198e6c96a30f058f2384c98bed692df2c8a25997bede2138f374314eaf22ee1",
        signature: Object.freeze({
          algorithm: "ED25519",
          keyId: "williamos-provider-assessment-root-key-v2",
          value: "si8UxKWfnWxFKErxzG8lIFnYFWI4xsdZwpsXdRNyOC/CAh2toyMusLBj/ncNtj2Qv4K0wc4Ai9BQKpgu4f3PAg==",
        }),
      }),
      pinnedRootFingerprint: "55d270e3515c50354718835ff57bfb793b6575a03d43bb415eda9f58739a495a",
      pinnedBundleContentHash: "7198e6c96a30f058f2384c98bed692df2c8a25997bede2138f374314eaf22ee1",
      pinnedStatusHeadHash: "3f697265d1efc91373251d1f5bea3f847052ac425eb5a22d41fe74b8d86f8ff0",
    }),
    pinnedRegistryRecordContentHash: "8dfb934e0499518dfefe3215ffab3eb4e6fd42d18f0c9417db300eee280e9c11",
  })]),
  registryId: "williamos-provider-assessment-pins",
  schemaVersion: 1,
  version: 2,
})
const EMBEDDED_REGISTRY_CONTENT_HASH = "36e5454ad60f86580ca621beef685d195877a693eef4fb2c22f8e7fb454e5034"

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function verifyEmbeddedRegistry() {
  const computed = crypto.createHash("sha256").update(canonicalJson(EMBEDDED_REGISTRY)).digest("hex")
  if (computed !== EMBEDDED_REGISTRY_CONTENT_HASH) {
    throw new Error("PROVIDER_ASSESSMENT_PIN_REGISTRY_INTEGRITY_WALL")
  }
}

export function loadCanonicalProviderTrustRecord(registryId, registryVersion) {
  verifyEmbeddedRegistry()
  if (registryId !== EMBEDDED_REGISTRY.registryId || registryVersion !== EMBEDDED_REGISTRY.version) return null
  const entry = EMBEDDED_REGISTRY.records.find((record) => record.registryRecord.registryId === registryId
    && record.registryRecord.registryVersion === registryVersion)
  return entry ? Object.freeze({ ...entry, evaluationTime: new Date().toISOString() }) : null
}

export const PROVIDER_ASSESSMENT_PIN_REGISTRY_METADATA = Object.freeze({
  registryId: EMBEDDED_REGISTRY.registryId,
  version: EMBEDDED_REGISTRY.version,
  contentHash: EMBEDDED_REGISTRY_CONTENT_HASH,
  activeRecordCount: EMBEDDED_REGISTRY.records.length,
  mutableRegistrationAllowed: false,
  authorityGranted: false,
})
