import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  parseDeclaredDeliverySeals,
  parseDeclaredReceipt,
  reviewPullRequestReceipt,
} from "@/lib/governance/pr-receipt"

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`
}

function fixture(path = "lib/governance/owner.ts", patchDigest = "f".repeat(64), keys?: { privateKey: KeyObject; publicKey: KeyObject }) {
  const pair = keys ?? generateKeyPairSync("ed25519")
  const payload = {
    version: "williamos-delivery-seal.v1",
    issuer: "WilliamOS",
    keyId: "test-key",
    issuedAt: "2026-08-29T20:00:00.000Z",
    assignment: {
      assignmentHash: "a".repeat(64), owner: "owner-1", worldId: "world-1",
      outcome: { id: 5, key: "WILLIAMOS_EXPERIENCE_V2", version: 7 },
      workOrder: { id: 41, ref: "WO-0041", version: "work-v1" },
      grant: { id: 9, ref: "GRANT-0009", version: "grant-v1" },
      reservation: { allowed: [path], forbidden: [], version: "c".repeat(64) },
      task: { digest: "d".repeat(64), text: `Deliver ${path}.` },
      session: { threadId: `thread-${path}`, executionBindingHash: "e".repeat(64) },
    },
    delivery: {
      repository: "https://github.com/bsvalues/terragroq",
      baseSha: "1".repeat(40), commitSha: "2".repeat(40), paths: [path], patchDigest,
    },
  } as const
  const signature = sign(null, Buffer.from(canonical(payload)), pair.privateKey).toString("base64url")
  const block = ["```WILLIAMOS_DELIVERY_SEAL", JSON.stringify({ payload, signature }, null, 2), "```"].join("\n")
  return { block, seal: { payload, signature }, keys: pair }
}

function review(block: string, changedFiles = ["lib/governance/owner.ts"], patchDigests = { "lib/governance/owner.ts": "f".repeat(64) }, publicKey?: KeyObject) {
  return reviewPullRequestReceipt({
    body: block,
    changedFiles,
    headSha: "2".repeat(40),
    patchDigests,
    publicKeys: { "test-key": publicKey ?? fixture().keys.publicKey },
  })
}

function adoptionFixture(keys = generateKeyPairSync("ed25519")) {
  const payload = {
    version: "williamos-delivery-seal.v2",
    authorityKind: "prospective_artifact_adoption",
    issuer: "WilliamOS",
    keyId: "test-key",
    issuedAt: "2026-08-31T20:00:00.000Z",
    adoption: {
      adoptionHash: "8".repeat(64), owner: "owner-1", worldId: "world-1", spaceRevision: 9,
      outcome: { id: 5, key: "WILLIAMOS_EXPERIENCE_V2", version: 7 },
      workOrder: { id: 41, ref: "WO-0041", version: "work-v1" },
      grant: { id: 9, ref: "GRANT-0009", version: "grant-v1" },
      reservation: { allowed: ["app/a.ts", "lib/b.ts"], forbidden: [], version: "c".repeat(64) },
      artifact: { pullRequest: 1117, headSha: "2".repeat(40), paths: ["app/a.ts", "lib/b.ts"] },
      evidence: { validationDigest: "6".repeat(64), reviewDigest: "7".repeat(64), validationHeadSha: "2".repeat(40), reviewHeadSha: "2".repeat(40) },
    },
    delivery: {
      repository: "https://github.com/bsvalues/terragroq", baseSha: "1".repeat(40),
      commitSha: "2".repeat(40), paths: ["app/a.ts", "lib/b.ts"], patchDigest: "9".repeat(64), contentDigest: "5".repeat(64),
    },
  } as const
  const signature = sign(null, Buffer.from(canonical(payload)), keys.privateKey).toString("base64url")
  return { block: ["```WILLIAMOS_DELIVERY_SEAL", JSON.stringify({ payload, signature }), "```"].join("\n"), keys }
}

describe("WilliamOS delivery seal review", () => {
  it("accepts a WilliamOS-signed seal bound to the exact PR head, patch, and changed path", () => {
    const signed = fixture()
    expect(review(signed.block, undefined, undefined, signed.keys.publicKey)).toEqual({ ok: true })
  })

  it("accepts multiple existing assignments only when together they cover the complete PR diff", () => {
    const keys = generateKeyPairSync("ed25519")
    const first = fixture("app/a.ts", "a".repeat(64), keys)
    const second = fixture("lib/b.ts", "b".repeat(64), keys)
    expect(reviewPullRequestReceipt({
      body: `${first.block}\n\n${second.block}`,
      changedFiles: ["app/a.ts", "lib/b.ts"],
      headSha: "2".repeat(40),
      patchDigests: { "app/a.ts": "a".repeat(64), "lib/b.ts": "b".repeat(64) },
      publicKeys: { "test-key": keys.publicKey },
    })).toEqual({ ok: true })
  })

  it("accepts one truthful prospective adoption seal for an exact multi-file artifact", () => {
    const signed = adoptionFixture()
    expect(reviewPullRequestReceipt({
      body: signed.block,
      changedFiles: ["app/a.ts", "lib/b.ts"],
      headSha: "2".repeat(40),
      repository: "https://github.com/bsvalues/terragroq",
      patchDigests: { ["app/a.ts\0lib/b.ts"]: "9".repeat(64) },
      publicKeys: { "test-key": signed.keys.publicKey },
    })).toEqual({ ok: true })
  })

  it("rejects a signature after any assignment or delivery claim is edited", () => {
    const signed = fixture()
    const edited = JSON.parse(JSON.stringify(signed.seal))
    edited.payload.assignment.reservation.allowed.push("app/**")
    const body = ["```WILLIAMOS_DELIVERY_SEAL", JSON.stringify(edited), "```"].join("\n")
    expect(review(body, undefined, undefined, signed.keys.publicKey)).toMatchObject({
      ok: false, failure: "FAILED_RECEIPT_MISMATCH",
    })
  })

  it("rejects a seal signed by a key that is not the repository-configured WilliamOS verifier", () => {
    const signed = fixture()
    const foreign = generateKeyPairSync("ed25519")
    expect(review(signed.block, undefined, undefined, foreign.publicKey)).toMatchObject({
      ok: false, failure: "FAILED_RECEIPT_MISMATCH",
    })
  })

  it("rejects a seal for an older PR head", () => {
    const signed = fixture()
    expect(reviewPullRequestReceipt({
      body: signed.block, changedFiles: ["lib/governance/owner.ts"], headSha: "3".repeat(40),
      patchDigests: { "lib/governance/owner.ts": "f".repeat(64) }, publicKeys: { "test-key": signed.keys.publicKey },
    })).toMatchObject({ ok: false, failure: "FAILED_STALE_MAIN" })
  })

  it("rejects a seal copied from a different repository", () => {
    const signed = fixture()
    expect(reviewPullRequestReceipt({
      body: signed.block,
      changedFiles: ["lib/governance/owner.ts"],
      headSha: "2".repeat(40),
      repository: "https://github.com/elsewhere/other-repo",
      patchDigests: { "lib/governance/owner.ts": "f".repeat(64) },
      publicKeys: { "test-key": signed.keys.publicKey },
    } as never)).toMatchObject({ ok: false, failure: "FAILED_RECEIPT_MISMATCH" })
  })

  it("rejects a changed patch even when the file name and head claim are unchanged", () => {
    const signed = fixture()
    expect(review(signed.block, undefined, { "lib/governance/owner.ts": "0".repeat(64) }, signed.keys.publicKey))
      .toMatchObject({ ok: false, failure: "FAILED_RECEIPT_MISMATCH" })
  })

  it("rejects every PR path that no signed assignment covers", () => {
    const signed = fixture()
    expect(review(
      signed.block,
      ["lib/governance/owner.ts", "app/escape.ts"],
      { "lib/governance/owner.ts": "f".repeat(64) },
      signed.keys.publicKey,
    )).toMatchObject({ ok: false, failure: "FAILED_SCOPE_ESCAPE" })
  })

  it("fails closed when repository public verification material is absent", () => {
    const signed = fixture()
    expect(reviewPullRequestReceipt({
      body: signed.block, changedFiles: ["lib/governance/owner.ts"], headSha: "2".repeat(40), patchDigests: {}, publicKeys: {},
    })).toMatchObject({ ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN" })
  })

  it("rejects legacy client-authored and self-hashed work-context receipts", () => {
    const legacy = ["```WORK_CONTEXT_RECEIPT", JSON.stringify({ token: "self-hash", facts: { reservedPaths: ["app/**"] } }), "```"].join("\n")
    expect(parseDeclaredReceipt(legacy)).not.toBeNull()
    expect(reviewPullRequestReceipt({ body: legacy, changedFiles: [] })).toMatchObject({
      ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: expect.stringContaining("retired"),
    })
  })

  it("does not treat prose or malformed blocks as signed delivery evidence", () => {
    expect(parseDeclaredDeliverySeals("WilliamOS issued a seal, honest.")).toEqual([])
    expect(parseDeclaredDeliverySeals("```WILLIAMOS_DELIVERY_SEAL\n{not json\n```")).toEqual([])
  })
})
