import crypto from "node:crypto"

const EMBEDDED_REGISTRY = Object.freeze({
  artifactType: "PROVIDER_ASSESSMENT_PIN_REGISTRY",
  records: Object.freeze([
    Object.freeze({
      registryRecord: Object.freeze({
        schemaVersion: 1,
        artifactType: "PROVIDER_ASSESSMENT_PIN_RECORD",
        registryId: "williamos-provider-assessment-pins",
        registryVersion: 1,
        status: "ACTIVE",
        immutable: true,
        trustBundle: Object.freeze({
          schemaVersion: 1,
          artifactType: "PROVIDER_ASSESSMENT_TRUST_BUNDLE",
          bundleId: "williamos-provider-assessment-trust-1",
          issuer: Object.freeze({ role: "TRUST_ROOT", rootId: "provider-assessment-root-1" }),
          issuedAt: "2026-07-02T00:00:00.000Z",
          expiresAt: "2027-07-01T00:00:00.000Z",
          root: Object.freeze({
            rootId: "provider-assessment-root-1",
            keyId: "provider-assessment-root-key-1",
            algorithm: "ED25519",
            publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAvxuxXrc0eOmieWLjgqy30RVrnrvK9tv3HvV/gn6qiVY=\n-----END PUBLIC KEY-----\n",
            fingerprint: "b6b8366dffc8278632aa72b172938ae49903984e2a4d74e69d4ebaaf60c02ecc",
            status: "ACTIVE",
            notBefore: "2026-07-02T00:00:00.000Z",
            expiresAt: "2027-07-01T00:00:00.000Z",
          }),
          writers: Object.freeze([
            Object.freeze({
              writerId: "assurance-wo-mao-032",
              keyId: "assurance-key-1",
              algorithm: "ED25519",
              publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAoWVpKpyw6jhtMyDOffORJQnJoK/dU8TVeVG0yG+MZQU=\n-----END PUBLIC KEY-----\n",
              fingerprint: "c464831569b07708c0326b2e666209b86a22bf84f23daa0ca042ed3d7e353c85",
              status: "ACTIVE",
              notBefore: "2026-07-02T00:00:00.000Z",
              expiresAt: "2027-07-01T00:00:00.000Z",
              providerIds: Object.freeze(["claude-code"]),
              assessmentWorkOrderIds: Object.freeze(["WO-MAO-032"]),
              subjectWorkOrderIds: Object.freeze(["WO-MAO-033"]),
            }),
          ]),
          ledgerAnchors: Object.freeze([
            Object.freeze({
              anchorId: "anchor-wo-mao-032-claude-unavailable",
              ledgerId: "williamos-mao-evidence-ledger",
              eventId: "event-wo-mao-032-provider-assessment",
              eventHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              eventCount: 32,
              headEventHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              externalAnchorId: "wo-mao-032-provider-assessment-checkpoint",
              assessmentContentHash: "26577fd0b25d08451a924f65c1230d657111526f996c1465bba1e99377267fa7",
              artifactId: "assessment-wo-mao-032-claude-code",
              providerId: "claude-code",
              assessmentWorkOrderId: "WO-MAO-032",
              subjectWorkOrderId: "WO-MAO-033",
              assessmentEnvelopeHash: "04d6f2a5cdf8886bf9106be98f5498301b446e7433e8eb59116fa76efe35bf0d",
              subjectEnvelopeHash: "5922b02868f2be423d87ad15c81520cb9a16833112b694dc68c86186c24d2292",
              status: "ACTIVE",
              issuedAt: "2026-07-02T00:00:00.000Z",
              expiresAt: "2027-07-01T00:00:00.000Z",
            }),
          ]),
          statusEvents: Object.freeze([
            Object.freeze({
              sequence: 1,
              version: 1,
              fence: 201,
              eventId: "provider-assessment-status-1",
              subjectType: "ROOT",
              subjectId: "provider-assessment-root-1",
              status: "ACTIVE",
              issuedAt: "2026-07-02T00:00:00.000Z",
              previousEventHash: null,
              eventHash: "b8eb9191fa8b0bbe483851d5436f7bc3782fced003d1565319d620b5c1ac075f",
            }),
            Object.freeze({
              sequence: 2,
              version: 2,
              fence: 202,
              eventId: "provider-assessment-status-2",
              subjectType: "WRITER",
              subjectId: "assurance-wo-mao-032",
              status: "ACTIVE",
              issuedAt: "2026-07-03T00:00:00.000Z",
              previousEventHash: "b8eb9191fa8b0bbe483851d5436f7bc3782fced003d1565319d620b5c1ac075f",
              eventHash: "e22b57021e83a438b7efaae97a448f8844ca3cb171997679b72e8fae61624b1e",
            }),
            Object.freeze({
              sequence: 3,
              version: 3,
              fence: 203,
              eventId: "provider-assessment-status-3",
              subjectType: "LEDGER_ANCHOR",
              subjectId: "anchor-wo-mao-032-claude-unavailable",
              status: "ACTIVE",
              issuedAt: "2026-07-04T00:00:00.000Z",
              previousEventHash: "e22b57021e83a438b7efaae97a448f8844ca3cb171997679b72e8fae61624b1e",
              eventHash: "de9592d3ea2369c8f246cd6d2b9c8c40da26be2e5616ffc20b96841fd5ec28b7",
            }),
          ]),
          statusHead: Object.freeze({
            eventCount: 3,
            latestEventHash: "de9592d3ea2369c8f246cd6d2b9c8c40da26be2e5616ffc20b96841fd5ec28b7",
          }),
          contentHash: "fc07325e8df5eab018678af6921ba7b4661fff71a4815a01acfa7a1e17f8ad32",
          signature: Object.freeze({
            algorithm: "ED25519",
            keyId: "provider-assessment-root-key-1",
            value: "nGPf1SRtmoO32Mly1KQJAjlPG3x8pkq7hw47qsztSpms3Q523N6ZewHYNUrwJ7+onYeKjesIedqUfOioX8VhCQ==",
          }),
        }),
        pinnedRootFingerprint: "b6b8366dffc8278632aa72b172938ae49903984e2a4d74e69d4ebaaf60c02ecc",
        pinnedBundleContentHash: "fc07325e8df5eab018678af6921ba7b4661fff71a4815a01acfa7a1e17f8ad32",
        pinnedStatusHeadHash: "de9592d3ea2369c8f246cd6d2b9c8c40da26be2e5616ffc20b96841fd5ec28b7",
      }),
      pinnedRegistryRecordContentHash: "780e4bf4800abf376f085f32a05e34e1fdf182e24762d0a7a22491eb19bc43c6",
    }),
  ]),
  registryId: "williamos-provider-assessment-pins",
  schemaVersion: 1,
  version: 1,
})
const EMBEDDED_REGISTRY_CONTENT_HASH = "ae97559dba3baccef1305fc0ce50fc736cdde0392d885f5e95399c528f8616de"

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
  activeRecordCount: 1,
  mutableRegistrationAllowed: false,
  authorityGranted: false,
})
