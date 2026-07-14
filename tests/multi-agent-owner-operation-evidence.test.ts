import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

import {
  canonicalJson,
  computeAuthorityContentHash,
} from "../scripts/multi-agent-operator/authority-events.mjs"
import { validateOwnerOperationEvidenceArtifacts } from "../scripts/multi-agent-operator/owner-operation-evidence.mjs"

const temporaryDirectories: string[] = []
const zeroCounters = {
  OWNER_OPERATION_TOUCH_COUNT: 0,
  OWNER_CREDENTIAL_TOUCH_COUNT: 0,
  OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
  OWNER_ROUTINE_DECISION_COUNT: 0,
}

function fixture() {
  const owner = crypto.generateKeyPairSync("ed25519")
  const recorder = crypto.generateKeyPairSync("ed25519")
  const checkpoint = crypto.generateKeyPairSync("ed25519")
  const sign = <T extends Record<string, unknown>>(record: T, privateKey: crypto.KeyObject, keyId: string) => {
    const contentHash = computeAuthorityContentHash(record)
    return {
      ...record,
      contentHash,
      signature: {
        algorithm: "Ed25519",
        keyId,
        value: crypto.sign(null, Buffer.from(canonicalJson(record)), privateKey).toString("base64"),
      },
    }
  }
  const runId = "11111111-1111-4111-8111-111111111111"
  const scope = {
    programId: "PROGRAM-MAO-TEST",
    goalId: "GOAL-MAO-TEST",
    loopId: "LOOP-MAO-TEST",
    workOrderId: "WO-MAO-TEST",
    decisionId: null,
    action: "VERIFY",
  }
  const expected = {
    runId,
    runManifestHash: "a".repeat(64),
    sourceLogId: "owner-operation-source-test",
    classificationPolicyHash: "b".repeat(64),
    scope,
  }
  const evidence = sign({
    schemaVersion: 1,
    artifactType: "OWNER_OPERATION_EVIDENCE",
    canonicalization: "WILLIAMOS-CANONICAL-JSON-V1",
    hashAlgorithm: "SHA-256",
    evidenceId: "owner-operation-evidence-test-001",
    runId,
    runManifestHash: expected.runManifestHash,
    scope,
    observation: {
      sourceLogId: expected.sourceLogId,
      startSequence: 0,
      startEventHash: "0".repeat(64),
      endSequence: 4,
      endEventHash: "c".repeat(64),
      observedEventCount: 4,
      classificationPolicyHash: expected.classificationPolicyHash,
      complete: true,
    },
    runState: "COMPLETED",
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:05:00.000Z",
    recordedAt: "2026-07-13T00:05:01.000Z",
    counters: zeroCounters,
    issuer: { role: "ASSURANCE", recorderId: "assurance-recorder-test" },
  }, recorder.privateKey, "assurance-recorder-key-test")
  const checkpointRecord = sign({
    schemaVersion: 1,
    artifactType: "OWNER_OPERATION_EVIDENCE_CHECKPOINT",
    checkpointId: "checkpoint-test-001",
    logId: "assurance-checkpoint-log-test",
    sequence: 1,
    previousCheckpointHash: null,
    commitment: { runId, evidenceContentHash: evidence.contentHash },
    issuedAt: "2026-07-13T00:05:02.000Z",
    issuer: { role: "ASSURANCE_LOG", logId: "assurance-checkpoint-log-test" },
  }, checkpoint.privateKey, "assurance-checkpoint-key-test")
  const ownerPublicKeyPem = owner.publicKey.export({ type: "spki", format: "pem" }).toString()
  const trustedOwners = sign({
    schemaVersion: 1,
    artifactType: "OWNER_TRUST_BUNDLE",
    issuer: { role: "OWNER", ownerId: "fixture-owner-not-authority" },
    issuedAt: "2026-07-01T00:00:00.000Z",
    statusHeads: [],
    legacyRevocationHeads: [],
    owners: [{
      ownerId: "fixture-owner-not-authority",
      publicKeyId: "owner-key-test",
      algorithm: "Ed25519",
      publicKeyPem: ownerPublicKeyPem,
      status: "ACTIVE",
    }],
    assuranceRecorders: [{
      recorderId: "assurance-recorder-test",
      publicKeyId: "assurance-recorder-key-test",
      algorithm: "Ed25519",
      publicKeyPem: recorder.publicKey.export({ type: "spki", format: "pem" }).toString(),
      purpose: "OWNER_OPERATION_ASSURANCE",
      programIds: [scope.programId],
      validFrom: "2026-07-01T00:00:00.000Z",
      validUntil: "2026-08-01T00:00:00.000Z",
      status: "ACTIVE",
    }],
    assuranceCheckpointKeys: [{
      logId: "assurance-checkpoint-log-test",
      publicKeyId: "assurance-checkpoint-key-test",
      algorithm: "Ed25519",
      publicKeyPem: checkpoint.publicKey.export({ type: "spki", format: "pem" }).toString(),
      purpose: "OWNER_OPERATION_CHECKPOINT",
      programIds: [scope.programId],
      validFrom: "2026-07-01T00:00:00.000Z",
      validUntil: "2026-08-01T00:00:00.000Z",
      status: "ACTIVE",
    }],
  }, owner.privateKey, "owner-key-test")
  const ownerKeyFingerprint = crypto.createHash("sha256")
    .update(owner.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
  return {
    expected,
    evidence,
    checkpoints: [checkpointRecord],
    checkpointAnchor: {
      logId: checkpointRecord.logId,
      sequence: 1,
      checkpointContentHash: checkpointRecord.contentHash,
    },
    trustedOwners,
    trustedOwnerKeyFingerprint: ownerKeyFingerprint,
    trustedOwnerBundleContentHash: trustedOwners.contentHash,
    sign,
    ownerPrivateKey: owner.privateKey,
    recorderPrivateKey: recorder.privateKey,
    checkpointPrivateKey: checkpoint.privateKey,
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe("independently anchored owner-operation evidence", () => {
  it("validates signed and context-bound zero artifacts without certifying or granting authority", () => {
    expect(validateOwnerOperationEvidenceArtifacts(fixture())).toMatchObject({
      status: "EVIDENCE_ARTIFACTS_VALIDATED_NOT_CERTIFIED",
      counterAssessment: "ZERO_COUNTERS_UNVERIFIED",
      certified: false,
      authorityGranted: false,
      checkpointSequence: 1,
      counters: zeroCounters,
    })
  })

  it("records validated nonzero evidence as failed babysitting, never authority", () => {
    const data = fixture()
    const { contentHash: _evidenceHash, signature: _evidenceSignature, ...evidencePayload } = data.evidence
    const changedEvidence = data.sign({
      ...evidencePayload,
      counters: { ...zeroCounters, OWNER_DIAGNOSTIC_TOUCH_COUNT: 1 },
    }, data.recorderPrivateKey, "assurance-recorder-key-test")
    const { contentHash: _checkpointHash, signature: _checkpointSignature, ...checkpointPayload } = data.checkpoints[0]
    const changedCheckpoint = data.sign({
      ...checkpointPayload,
      commitment: { runId: data.expected.runId, evidenceContentHash: changedEvidence.contentHash },
    }, data.checkpointPrivateKey, "assurance-checkpoint-key-test")
    expect(validateOwnerOperationEvidenceArtifacts({
      ...data,
      evidence: changedEvidence,
      checkpoints: [changedCheckpoint],
      checkpointAnchor: { ...data.checkpointAnchor, checkpointContentHash: changedCheckpoint.contentHash },
    })).toMatchObject({
      status: "EVIDENCE_ARTIFACTS_VALIDATED_NOT_CERTIFIED",
      reasonCode: "INDEPENDENT_EVIDENCE_SOURCE_REQUIRED",
      counterAssessment: "NONZERO_COUNTERS_OBSERVED",
      certified: false,
      authorityGranted: false,
    })
  })

  it("rejects stale anchors, evidence mutation, context replay, and incomplete observation", () => {
    const data = fixture()
    expect(() => validateOwnerOperationEvidenceArtifacts({
      ...data,
      checkpointAnchor: { ...data.checkpointAnchor, checkpointContentHash: "d".repeat(64) },
    })).toThrow(/OWNER_OPERATION_EVIDENCE_ANCHOR_WALL/)
    expect(() => validateOwnerOperationEvidenceArtifacts({ ...data, evidence: { ...data.evidence, evidenceId: "changed" } }))
      .toThrow(/OWNER_OPERATION_EVIDENCE_SIGNATURE_WALL/)
    expect(() => validateOwnerOperationEvidenceArtifacts({
      ...data,
      expected: { ...data.expected, scope: { ...data.expected.scope, workOrderId: "WO-OTHER" } },
    })).toThrow(/OWNER_OPERATION_EVIDENCE_CONTEXT_WALL/)
    expect(() => validateOwnerOperationEvidenceArtifacts({
      ...data,
      evidence: { ...data.evidence, observation: { ...data.evidence.observation, complete: false } },
    })).toThrow(/OWNER_OPERATION_EVIDENCE_COMPLETENESS_WALL/)
    expect(() => validateOwnerOperationEvidenceArtifacts({ ...data, now: "2026-07-12T00:00:00.000Z" }))
      .toThrow(/OWNER_OPERATION_EVIDENCE_TIME_WALL/)
  })

  it("rejects duplicate run commitments and checkpoint-log forks", () => {
    const data = fixture()
    const second = data.sign({
      schemaVersion: 1,
      artifactType: "OWNER_OPERATION_EVIDENCE_CHECKPOINT",
      checkpointId: "checkpoint-test-002",
      logId: data.checkpointAnchor.logId,
      sequence: 2,
      previousCheckpointHash: data.checkpoints[0].contentHash,
      commitment: { runId: data.expected.runId, evidenceContentHash: data.evidence.contentHash },
      issuedAt: "2026-07-13T00:05:03.000Z",
      issuer: { role: "ASSURANCE_LOG", logId: data.checkpointAnchor.logId },
    }, data.checkpointPrivateKey, "assurance-checkpoint-key-test")
    expect(() => validateOwnerOperationEvidenceArtifacts({
      ...data,
      checkpoints: [...data.checkpoints, second],
      checkpointAnchor: { ...data.checkpointAnchor, sequence: 2, checkpointContentHash: second.contentHash },
    })).toThrow(/OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL/)
    expect(() => validateOwnerOperationEvidenceArtifacts({
      ...data,
      checkpoints: [{ ...data.checkpoints[0], logId: "forked-log" }],
    })).toThrow(/OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL/)
    expect(() => validateOwnerOperationEvidenceArtifacts({
      ...data,
      checkpoints: [{ ...data.checkpoints[0], issuer: { role: "ASSURANCE", logId: data.checkpointAnchor.logId } }],
    })).toThrow(/OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL/)
  })

  it("fails malformed direct input with typed walls", () => {
    expect(() => validateOwnerOperationEvidenceArtifacts(null)).toThrow(/OWNER_OPERATION_EVIDENCE_SCHEMA_WALL/)
    expect(() => validateOwnerOperationEvidenceArtifacts({ ...fixture(), evidence: null })).toThrow(/OWNER_OPERATION_EVIDENCE_SCHEMA_WALL/)
    const extraCounterData = fixture()
    const { contentHash: _evidenceHash, signature: _evidenceSignature, ...evidencePayload } = extraCounterData.evidence
    const extraCounterEvidence = extraCounterData.sign({
      ...evidencePayload,
      counters: { ...zeroCounters, OWNER_OTHER_TOUCH_COUNT: 0 },
    }, extraCounterData.recorderPrivateKey, "assurance-recorder-key-test")
    expect(() => validateOwnerOperationEvidenceArtifacts({ ...extraCounterData, evidence: extraCounterEvidence }))
      .toThrow(/OWNER_OPERATION_EVIDENCE_SCHEMA_WALL/)
    const data = fixture()
    const { contentHash: _hash, signature: _signature, ...trustPayload } = data.trustedOwners
    const malformedTrust = data.sign({ ...trustPayload, assuranceRecorders: {} }, data.ownerPrivateKey, "owner-key-test")
    expect(() => validateOwnerOperationEvidenceArtifacts({
      ...data,
      trustedOwners: malformedTrust,
      trustedOwnerBundleContentHash: malformedTrust.contentHash,
    })).toThrow(/OWNER_OPERATION_EVIDENCE_RECORDER_WALL/)
  })

  it("exposes a typed verifier CLI without creating authority", () => {
    const data = fixture()
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-owner-operation-evidence-"))
    temporaryDirectories.push(directory)
    const inputs = {
      evidence: data.evidence,
      checkpoints: data.checkpoints,
      anchor: data.checkpointAnchor,
      expected: data.expected,
      owners: data.trustedOwners,
    }
    for (const [name, value] of Object.entries(inputs)) fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value))
    const cli = path.resolve("scripts/multi-agent-operator/owner-operation-evidence-cli.mjs")
    const args = [cli, "verify", "--evidence", path.join(directory, "evidence.json"),
      "--checkpoints", path.join(directory, "checkpoints.json"),
      "--checkpoint-anchor", path.join(directory, "anchor.json"),
      "--expected-run", path.join(directory, "expected.json"),
      "--trusted-owners", path.join(directory, "owners.json"),
      "--owner-key-fingerprint", data.trustedOwnerKeyFingerprint,
      "--owner-bundle-hash", data.trustedOwnerBundleContentHash]
    const pass = spawnSync(process.execPath, args, { encoding: "utf8" })
    expect(pass.status).toBe(0)
    expect(pass.stdout).toContain('"authorityGranted":false')
    const denied = spawnSync(process.execPath, args.map((value) => value === data.trustedOwnerBundleContentHash ? "f".repeat(64) : value), { encoding: "utf8" })
    expect(denied.status).toBe(2)
    expect(denied.stderr.trim()).toBe("AUTHORITY_TRUST_BUNDLE_REPLAY_WALL")
    expect(denied.stdout).toBe("")
  })
})
