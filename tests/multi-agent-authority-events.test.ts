import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

import {
  assertOwnerAuthority,
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
  const trustedOwners = {
    schemaVersion: 1,
    statusHeads: [] as Array<{ grantId: string; eventCount: number; latestEventHash: string }>,
    owners: [{
      ownerId: "fixture-owner-not-authority",
      publicKeyId: "owner-key-test",
      algorithm: "Ed25519",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      status: "ACTIVE",
    }],
  }
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
  trustedOwners.statusHeads = [{
    grantId: grant.grantId,
    eventCount: 1,
    latestEventHash: active.contentHash,
  }]
  const request = {
    subjectType: "PROGRAM",
    subjectId: "PROGRAM-TEST-001",
    programId: "PROGRAM-TEST-001",
    repository: "bsvalues/terragroq",
    riskClass: "R0",
    action: "VERIFY",
    mergeMode: "NONE",
  }
  return { trustedOwners, sign, grant, active, request }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe("owner authority event verifier", () => {
  it("accepts an owner-signed, active, in-scope grant without creating authority", () => {
    const data = fixture()
    const result = assertOwnerAuthority({ ...data, events: [data.active], counters, now: "2026-07-13T00:00:00.000Z" })
    expect(result).toMatchObject({ status: "PASS", currentGrantStatus: "ACTIVE", statusEventCount: 1 })
  })

  it("fails closed when immutable grant content is changed", () => {
    const data = fixture()
    const changed = { ...data.grant, expiresAt: "2026-09-01T00:00:00.000Z" }
    expect(() => assertOwnerAuthority({ ...data, grant: changed, events: [data.active], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_HASH_WALL/)
  })

  it("rejects an untrusted issuer and exact-scope mismatches", () => {
    const data = fixture()
    expect(() => assertOwnerAuthority({ ...data, events: [data.active], trustedOwners: { schemaVersion: 1, owners: [] }, counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_ISSUER_WALL/)
    expect(() => assertOwnerAuthority({ ...data, events: [data.active], request: { ...data.request, action: "DISPATCH" }, counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_SCOPE_WALL/)
  })

  it("rejects expired grants", () => {
    const data = fixture()
    expect(() => assertOwnerAuthority({ ...data, events: [data.active], counters, now: "2026-08-01T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_EXPIRED_WALL/)
  })

  it("requires a distinct program-activation grant for activation scope", () => {
    const data = fixture()
    expect(() => assertOwnerAuthority({
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
    expect(() => assertOwnerAuthority({ ...data, events: [data.active, revoked], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_REVOKED_WALL/)
    expect(() => assertOwnerAuthority({ ...data, events: [data.active, { ...revoked, previousEventHash: "0".repeat(64) }], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_EVENT_CHAIN_WALL/)
  })

  it("rejects a valid but stale stream that omits the owner-anchored head", () => {
    const data = fixture()
    data.trustedOwners.statusHeads = [{
      grantId: data.grant.grantId,
      eventCount: 2,
      latestEventHash: "a".repeat(64),
    }]
    expect(() => assertOwnerAuthority({ ...data, events: [data.active], counters, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/AUTHORITY_EVENT_HEAD_WALL/)
  })

  it("separates the owner-babysitting lifecycle state from its reason code", () => {
    expect(evaluateOwnerOperationCounters(counters)).toMatchObject({ certified: true, reasonCode: null })
    expect(evaluateOwnerOperationCounters({ ...counters, OWNER_DIAGNOSTIC_TOUCH_COUNT: 1 })).toMatchObject({
      certified: false,
      lifecycleState: "FAILED_OWNER_BABYSITTING",
      reasonCode: "FAIL_OWNER_BABYSITTING",
    })
    const data = fixture()
    expect(() => assertOwnerAuthority({ ...data, events: [data.active], counters: { ...counters, OWNER_DIAGNOSTIC_TOUCH_COUNT: 1 }, now: "2026-07-13T00:00:00.000Z" }))
      .toThrow(/OWNER_BABYSITTING_WALL/)
  })

  it("exposes a typed fail-closed CLI assertion without signing capabilities", () => {
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
    const args = [cli, "assert", "--grant", path.join(directory, "grant.json"), "--events", path.join(directory, "events.json"),
      "--trusted-owners", path.join(directory, "owners.json"), "--owner-counters", path.join(directory, "counters.json"),
      "--subject-type", "PROGRAM", "--subject-id", "PROGRAM-TEST-001", "--program", "PROGRAM-TEST-001",
      "--repository", "bsvalues/terragroq", "--risk", "R0", "--action", "VERIFY", "--merge-mode", "NONE",
      "--at", "2026-07-13T00:00:00.000Z"]
    const pass = spawnSync(process.execPath, args, { encoding: "utf8" })
    expect(pass.status).toBe(0)
    expect(pass.stdout).toContain("OWNER_AUTHORITY_ASSERTION=")
    const denied = spawnSync(process.execPath, args.map((value) => value === "VERIFY" ? "DISPATCH" : value), { encoding: "utf8" })
    expect(denied.status).toBe(2)
    expect(denied.stderr.trim()).toBe("AUTHORITY_SCOPE_WALL")
    expect(denied.stdout).toBe("")
  })
})
