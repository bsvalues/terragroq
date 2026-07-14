import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

import {
  assertLegacyAuthorityRevocations,
  validateOwnerAuthorityArtifacts,
  canonicalJson,
  computeAuthorityContentHash,
  evaluateOwnerOperationCounters,
} from "../scripts/multi-agent-operator/authority-events.mjs"

const temporaryDirectories: string[] = []
const counters = {
  OWNER_OPERATION_TOUCH_COUNT: 0,
  OWNER_CREDENTIAL_TOUCH_COUNT: 0,
  OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
  OWNER_ROUTINE_DECISION_COUNT: 0,
}

function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const ownerKeyFingerprint = crypto.createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
  const sign = <T extends Record<string, unknown>>(record: T) => {
    const contentHash = computeAuthorityContentHash(record)
    const payload = canonicalJson(record)
    return {
      ...record,
      contentHash,
      signature: {
        algorithm: "Ed25519",
        keyId: "owner-key-test",
        value: crypto.sign(null, Buffer.from(payload), privateKey).toString("base64"),
      },
    }
  }
  const grant = sign({
    schemaVersion: 1,
    artifactType: "OWNER_AUTHORITY_GRANT",
    grantKind: "ACTION_AUTHORITY",
    grantId: "grant-test-001",
    authorityDecisionId: "decision-test-001",
    issuer: { role: "OWNER", ownerId: "fixture-owner-not-authority" },
    subject: { type: "PROGRAM", id: "PROGRAM-TEST-001" },
    scope: {
      programIds: ["PROGRAM-TEST-001"],
      goalIds: ["GOAL-TEST-001"],
      loopIds: ["LOOP-TEST-001"],
      workOrderIds: ["WO-TEST-001"],
      decisionIds: ["decision-test-001"],
      repositories: ["bsvalues/terragroq"],
      riskClasses: ["R0", "R1"],
      actions: ["VERIFY", "MERGE"],
      mergeModes: ["NONE", "AUTO_ELIGIBLE"],
    },
    issuedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:00:00.000Z",
  })
  const active = sign({
    schemaVersion: 1,
    artifactType: "OWNER_AUTHORITY_STATUS_EVENT",
    eventId: "event-test-001",
    grantId: grant.grantId,
    sequence: 1,
    status: "ACTIVE",
    issuedAt: "2026-07-01T00:00:01.000Z",
    previousEventHash: null,
    issuer: { role: "OWNER", ownerId: "fixture-owner-not-authority" },
  })
  const trustedOwners = sign({
    schemaVersion: 1,
    artifactType: "OWNER_TRUST_BUNDLE",
    issuer: { role: "OWNER", ownerId: "fixture-owner-not-authority" },
    issuedAt: "2026-07-01T00:00:00.000Z",
    statusHeads: [{
      grantId: grant.grantId,
      eventCount: 1,
      latestEventHash: active.contentHash,
    }],
    legacyRevocationHeads: [] as Array<{ adapterId: string; eventCount: number; latestEventHash: string }>,
    owners: [{
      ownerId: "fixture-owner-not-authority",
      publicKeyId: "owner-key-test",
      algorithm: "Ed25519",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      status: "ACTIVE",
    }],
  })
  const sealTrustBundle = () => {
    const { contentHash: _contentHash, signature: _signature, ...payload } = trustedOwners
    Object.assign(trustedOwners, sign(payload))
  }
  const request = {
    subjectType: "PROGRAM",
    subjectId: "PROGRAM-TEST-001",
    programId: "PROGRAM-TEST-001",
    goalId: "GOAL-TEST-001",
    loopId: "LOOP-TEST-001",
    workOrderId: "WO-TEST-001",
    decisionId: "decision-test-001",
    repository: "bsvalues/terragroq",
    riskClass: "R0",
    action: "VERIFY",
    mergeMode: "NONE",
  }
  return {
    trustedOwners,
    ownerKeyFingerprint,
    trustedOwnerKeyFingerprint: ownerKeyFingerprint,
    get trustedOwnerBundleContentHash() { return trustedOwners.contentHash },
    sign,
    sealTrustBundle,
    grant,
    active,
    request,
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe("owner authority event verifier", () => {
  it("keeps the canonical JSON v1 hash vector stable across implementations", () => {
    expect(canonicalJson({ b: 1, a: "x" })).toBe('{"a":"x","b":1}')
    expect(crypto.createHash("sha256").update(canonicalJson({ b: 1, a: "x" })).digest("hex"))
      .toBe("cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246")
  })

  it("accepts an owner-signed, active, in-scope grant without creating authority", () => {
    const data = fixture()
    const result = validateOwnerAuthorityArtifacts({ ...data, events: [data.active], counters, now: "2026-07-13T00:00:00.000Z" })
    expect(result).toMatchObject({
      status: "ARTIFACTS_VALIDATED_NOT_AUTHORIZED",
      authorityGranted: false,
      currentGrantStatus: "ACTIVE",
      statusEventCount: 1,
      ownerOperations: {
        certified: false,
        lifecycleState: "UNVERIFIED_ZERO_OWNER_OPERATIONS",
      },
    })
  })

  it("fails closed when immutable grant content is changed", () => {
    const data = fixture()
    const changed = { ...data.grant, expiresAt: "2026-09-01T00:00:00.000Z" }
    expect(() => validateOwnerAuthorityArtifacts({ ...data, grant: changed, events: [data.active], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_HASH_WALL/)
  })

  it("rejects an untrusted bundle and exact-scope mismatches", () => {
    const data = fixture()
    expect(() => validateOwnerAuthorityArtifacts({ ...data, events: [data.active], trustedOwners: { schemaVersion: 1, owners: [] }, counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_TRUST_BUNDLE_WALL/)
    expect(() => validateOwnerAuthorityArtifacts({ ...data, events: [data.active], request: { ...data.request, action: "DISPATCH" }, counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_SCOPE_WALL/)
    expect(() => validateOwnerAuthorityArtifacts({ ...data, events: [data.active], request: { ...data.request, workOrderId: "WO-OTHER" }, counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_SCOPE_WALL/)
  })

  it("fails with typed walls for malformed direct-consumer input", () => {
    const data = fixture()
    expect(() => validateOwnerAuthorityArtifacts(null as never)).toThrow(/AUTHORITY_SCHEMA_WALL/)
    expect(() => validateOwnerAuthorityArtifacts({ ...data, grant: null, events: [data.active], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_SCHEMA_WALL/)
    expect(() => validateOwnerAuthorityArtifacts({ ...data, events: [null], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_EVENT_CHAIN_WALL/)
  })

  it("rejects expired grants", () => {
    const data = fixture()
    expect(() => validateOwnerAuthorityArtifacts({ ...data, events: [data.active], counters, now: "2026-08-01T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_EXPIRED_WALL/)
  })

  it("requires a distinct program-activation grant for activation scope", () => {
    const data = fixture()
    expect(() => validateOwnerAuthorityArtifacts({
      ...data,
      events: [data.active],
      request: { ...data.request, action: "ACTIVATE_PROGRAM" },
      counters,
      now: "2026-07-13T00:00:00.000Z",
    })).toThrow(/AUTHORITY_GRANT_KIND_WALL/)
  })

  it("honors terminal revocation and verifies the event chain", () => {
    const data = fixture()
    const revoked = data.sign({
      schemaVersion: 1,
      artifactType: "OWNER_AUTHORITY_STATUS_EVENT",
      eventId: "event-test-002",
      grantId: data.grant.grantId,
      sequence: 2,
      status: "REVOKED",
      issuedAt: "2026-07-12T00:00:00.000Z",
      previousEventHash: data.active.contentHash,
      issuer: { role: "OWNER", ownerId: "fixture-owner-not-authority" },
    })
    data.trustedOwners.statusHeads = [{
      grantId: data.grant.grantId,
      eventCount: 2,
      latestEventHash: revoked.contentHash,
    }]
    data.sealTrustBundle()
    expect(() => validateOwnerAuthorityArtifacts({ ...data, events: [data.active, revoked], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_REVOKED_WALL/)
    expect(() => validateOwnerAuthorityArtifacts({ ...data, events: [data.active, { ...revoked, previousEventHash: "0".repeat(64) }], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_EVENT_CHAIN_WALL/)
  })

  it("rejects a valid but stale stream that omits the owner-anchored head", () => {
    const data = fixture()
    data.trustedOwners.statusHeads = [{
      grantId: data.grant.grantId,
      eventCount: 2,
      latestEventHash: "a".repeat(64),
    }]
    data.sealTrustBundle()
    expect(() => validateOwnerAuthorityArtifacts({ ...data, events: [data.active], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_EVENT_HEAD_WALL/)
  })

  it("rejects a rewritten stream head when the signed trust bundle is not reissued", () => {
    const data = fixture()
    data.trustedOwners.statusHeads = [{
      grantId: data.grant.grantId,
      eventCount: 1,
      latestEventHash: "b".repeat(64),
    }]
    expect(() => validateOwnerAuthorityArtifacts({
      ...data, events: [data.active], counters, now: "2026-07-13T00:00:00.000Z",
    })).toThrow(/AUTHORITY_TRUST_BUNDLE_WALL/)
  })

  it("rejects a valid signed bundle that does not match the independently anchored current hash", () => {
    const data = fixture()
    expect(() => validateOwnerAuthorityArtifacts({
      ...data,
      trustedOwnerBundleContentHash: "c".repeat(64),
      events: [data.active],
      counters,
      now: "2026-07-13T00:00:00.000Z",
    })).toThrow(/AUTHORITY_TRUST_BUNDLE_REPLAY_WALL/)
  })

  it("never certifies caller-supplied zeros and preserves babysitting failure", () => {
    expect(evaluateOwnerOperationCounters(counters)).toMatchObject({
      certified: false,
      lifecycleState: "UNVERIFIED_ZERO_OWNER_OPERATIONS",
      reasonCode: "OWNER_OPERATION_EVIDENCE_UNVERIFIED",
    })
    const data = fixture()
    expect(evaluateOwnerOperationCounters({ ...counters, OWNER_DIAGNOSTIC_TOUCH_COUNT: 1 })).toMatchObject({
      certified: false,
      lifecycleState: "FAILED_OWNER_BABYSITTING",
      reasonCode: "FAIL_OWNER_BABYSITTING",
    })
    expect(() => validateOwnerAuthorityArtifacts({ ...data, events: [data.active], counters: { ...counters, OWNER_DIAGNOSTIC_TOUCH_COUNT: 1 }, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/OWNER_BABYSITTING_WALL/)
    expect(() => evaluateOwnerOperationCounters({ ...counters, OWNER_OTHER_TOUCH_COUNT: 0 }))
      .toThrow(/OWNER_TOUCH_EVIDENCE_WALL/)
  })

  it("exposes typed CLI artifact validation without producing an authority assertion", () => {
    const data = fixture()
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-authority-"))
    temporaryDirectories.push(directory)
    const inputs = {
      grant: data.grant,
      events: [data.active],
      owners: data.trustedOwners,
      counters,
    }
    for (const [name, value] of Object.entries(inputs)) fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value))
    const cli = path.resolve("scripts/multi-agent-operator/authority-event-cli.mjs")
    const args = [cli, "validate-artifacts", "--grant", path.join(directory, "grant.json"), "--events", path.join(directory, "events.json"),
      "--trusted-owners", path.join(directory, "owners.json"),
      "--owner-counters", path.join(directory, "counters.json"),
      "--owner-key-fingerprint", data.ownerKeyFingerprint,
      "--owner-bundle-hash", data.trustedOwners.contentHash,
      "--subject-type", "PROGRAM", "--subject-id", "PROGRAM-TEST-001", "--program", "PROGRAM-TEST-001",
      "--goal", "GOAL-TEST-001", "--loop", "LOOP-TEST-001", "--work-order", "WO-TEST-001",
      "--decision", "decision-test-001",
      "--repository", "bsvalues/terragroq", "--risk", "R0", "--action", "VERIFY", "--merge-mode", "NONE",
      "--at", "2026-07-13T00:00:00.000Z"]
    const pass = spawnSync(process.execPath, args, { encoding: "utf8" })
    expect(pass.status).toBe(0)
    expect(pass.stdout).toContain("OWNER_AUTHORITY_ARTIFACT_VALIDATION=")
    const denied = spawnSync(process.execPath, args.map((value) => value === "VERIFY" ? "DISPATCH" : value), { encoding: "utf8" })
    expect(denied.status).toBe(2)
    expect(denied.stderr.trim()).toBe("AUTHORITY_SCOPE_WALL")
    expect(denied.stdout).toBe("")
  })

  it("verifies direct owner-signed revocation of every legacy authority record", () => {
    const data = fixture()
    const first = data.sign({
      schemaVersion: 1,
      artifactType: "OWNER_LEGACY_AUTHORITY_REVOCATION_EVENT",
      eventId: "legacy-revocation-test-001",
      sequence: 1,
      authorityRecordId: "WO-RUNTIME-KERNEL-PILOT-001",
      adapterId: "local-nested-codex-exec",
      status: "REVOKED_TERMINAL",
      terminalIssueNumber: 357,
      terminalReason: "CODEX_NETWORK_WALL",
      issuedAt: "2026-07-12T00:00:00.000Z",
      previousEventHash: null,
      issuer: { role: "OWNER", ownerId: "fixture-owner-not-authority" },
    })
    const second = data.sign({
      schemaVersion: 1,
      artifactType: "OWNER_LEGACY_AUTHORITY_REVOCATION_EVENT",
      eventId: "legacy-revocation-test-002",
      sequence: 2,
      authorityRecordId: "WO-RUNTIME-KERNEL-CONTINUATION-001",
      adapterId: "local-nested-codex-exec",
      status: "REVOKED_TERMINAL",
      terminalIssueNumber: 357,
      terminalReason: "CODEX_NETWORK_WALL",
      issuedAt: "2026-07-12T00:00:01.000Z",
      previousEventHash: first.contentHash,
      issuer: { role: "OWNER", ownerId: "fixture-owner-not-authority" },
    })
    data.trustedOwners.legacyRevocationHeads = [{
      adapterId: "local-nested-codex-exec",
      eventCount: 2,
      latestEventHash: second.contentHash,
    }]
    data.sealTrustBundle()
    const expected = {
      adapterId: "local-nested-codex-exec",
      authorityRecordIds: ["WO-RUNTIME-KERNEL-PILOT-001", "WO-RUNTIME-KERNEL-CONTINUATION-001"],
      terminalIssueNumber: 357,
      terminalReason: "CODEX_NETWORK_WALL",
    }
    expect(assertLegacyAuthorityRevocations({
      events: [first, second], trustedOwners: data.trustedOwners,
      trustedOwnerKeyFingerprint: data.ownerKeyFingerprint,
      trustedOwnerBundleContentHash: data.trustedOwners.contentHash,
      expected, now: "2026-07-13T00:00:00.000Z",
    })).toMatchObject({ status: "VERIFIED_REVOKED", eventCount: 2 })

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-legacy-revocation-"))
    temporaryDirectories.push(directory)
    const registry = {
      adapter: {
        adapterId: expected.adapterId,
        terminalIssueNumber: expected.terminalIssueNumber,
        terminalReason: expected.terminalReason,
        revocationEvent: {
          ownerKeyFingerprint: data.ownerKeyFingerprint,
          trustBundleContentHash: data.trustedOwners.contentHash,
        },
      },
      workOrders: expected.authorityRecordIds.map((workOrderId) => ({ workOrderId, adapterId: expected.adapterId })),
    }
    for (const [name, value] of Object.entries({
      registry,
      events: [first, second],
      owners: data.trustedOwners,
    })) fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value))
    const cli = path.resolve("scripts/multi-agent-operator/authority-event-cli.mjs")
    const cliResult = spawnSync(process.execPath, [cli, "assert-legacy-revocations",
      "--registry", path.join(directory, "registry.json"), "--events", path.join(directory, "events.json"),
      "--trusted-owners", path.join(directory, "owners.json"), "--at", "2026-07-13T00:00:00.000Z"],
    { encoding: "utf8" })
    expect(cliResult.status).toBe(0)
    expect(cliResult.stdout).toContain('OWNER_REVOCATION_ASSERTION={"status":"VERIFIED_REVOKED"')

    expect(() => assertLegacyAuthorityRevocations({
      events: [first, { ...second, authorityRecordId: "WO-OTHER" }],
      trustedOwners: data.trustedOwners,
      trustedOwnerKeyFingerprint: data.ownerKeyFingerprint,
      trustedOwnerBundleContentHash: data.trustedOwners.contentHash,
      expected,
      now: "2026-07-13T00:00:00.000Z",
    })).toThrow(/AUTHORITY_LEGACY_REVOCATION_WALL/)
  })

  it("fails with typed walls for malformed legacy-revocation input", () => {
    const data = fixture()
    const expected = {
      adapterId: "local-nested-codex-exec",
      authorityRecordIds: ["WO-RUNTIME-KERNEL-PILOT-001"],
      terminalIssueNumber: 357,
      terminalReason: "CODEX_NETWORK_WALL",
    }
    expect(() => assertLegacyAuthorityRevocations(null as never)).toThrow(/AUTHORITY_LEGACY_REVOCATION_WALL/)
    expect(() => assertLegacyAuthorityRevocations({
      events: [null],
      trustedOwners: data.trustedOwners,
      trustedOwnerKeyFingerprint: data.ownerKeyFingerprint,
      trustedOwnerBundleContentHash: data.trustedOwners.contentHash,
      expected,
      now: "2026-07-13T00:00:00.000Z",
    })).toThrow(/AUTHORITY_LEGACY_REVOCATION_WALL/)
  })
})
