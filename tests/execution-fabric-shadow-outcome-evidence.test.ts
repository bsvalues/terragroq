import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  runShadowOutcomeEvidenceCli,
  validateShadowOutcomeEvidence,
} from "../scripts/execution-fabric/shadow-outcome-evidence.mjs"

type JsonObject = Record<string, any>

function artifact(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: "0.1-shadow-outcome-evidence",
    work_order_id: "WO-LOCAL-107",
    actual_target_node: "omen",
    status: "COMPLETED",
    result: "SUCCEEDED",
    started_at: "2026-07-04T14:40:56.000Z",
    completed_at: "2026-07-04T14:41:08.345Z",
    authority_outcome: {
      status: "COMPLIANT",
      reference: "authority-local-omen-manual-v1",
      checked_at: "2026-07-04T14:40:56.000Z",
    },
    resource_observations: [
      { metric: "cpu_load_pct", unit: "percent", value: 31.5, observed_at: "2026-07-04T14:41:00.000Z" },
      { metric: "ram_used_bytes", unit: "bytes", value: 8589934592, observed_at: "2026-07-04T14:41:00.000Z" },
    ],
    ...overrides,
  }
}

function encode(value: JsonObject) {
  const bytes = Buffer.from(`${canonicalizeJcs(value)}\n`, "utf8")
  return { bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }
}

function validate(value = artifact()) {
  const encoded = encode(value)
  return validateShadowOutcomeEvidence({ artifactBytes: encoded.bytes, expectedSha256: encoded.sha256 }) as JsonObject
}

function expectRejected(action: () => unknown, detail: RegExp) {
  expect(action).toThrowError(detail)
}

function expectSafety(value: JsonObject) {
  expect(value).toMatchObject({
    observation_only: true,
    dispatch_allowed: false,
    execution_authorized: false,
    remote_systems_modified: false,
    shell_executed: false,
  })
}

describe("Execution Fabric shadow outcome evidence", () => {
  it("validates exact immutable bytes and derives latency from chronology", () => {
    const first = validate()
    const second = validate()

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      status: "VALID",
      work_order_id: "WO-LOCAL-107",
      actual_target_node: "omen",
      outcome: { status: "COMPLETED", result: "SUCCEEDED" },
      chronology: {
        started_at: "2026-07-04T14:40:56.000Z",
        completed_at: "2026-07-04T14:41:08.345Z",
        latency_ms: 12345,
      },
      authority_outcome: { status: "COMPLIANT" },
    })
    expect(first.artifact_sha256).toMatch(/^[a-f0-9]{64}$/)
    expectSafety(first)
  })

  it("accepts each coherent terminal status/result pair", () => {
    for (const [status, result] of [
      ["COMPLETED", "SUCCEEDED"],
      ["FAILED", "FAILED"],
      ["BLOCKED", "BLOCKED"],
      ["CANCELLED", "CANCELLED"],
    ]) {
      expect(validate(artifact({ status, result })).outcome).toEqual({ status, result })
    }
  })

  it("rejects changed bytes and malformed expected digests", () => {
    const encoded = encode(artifact())
    const changed = Buffer.concat([encoded.bytes.subarray(0, -1), Buffer.from(" \n")])
    expectRejected(() => validateShadowOutcomeEvidence({
      artifactBytes: changed,
      expectedSha256: encoded.sha256,
    }), /do not match expected SHA-256/)

    expectRejected(() => validateShadowOutcomeEvidence({
      artifactBytes: encoded.bytes,
      expectedSha256: "A".repeat(64),
    }), /lowercase hex/)
  })

  it("rejects non-canonical, BOM-prefixed, and duplicate-key artifact bytes", () => {
    const pretty = Buffer.from(`${JSON.stringify(artifact(), null, 2)}\n`)
    const prettySha = crypto.createHash("sha256").update(pretty).digest("hex")
    expectRejected(() => validateShadowOutcomeEvidence({ artifactBytes: pretty, expectedSha256: prettySha }), /exact canonical JSON/)

    const canonical = encode(artifact()).bytes
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical])
    const bomSha = crypto.createHash("sha256").update(bom).digest("hex")
    expectRejected(() => validateShadowOutcomeEvidence({ artifactBytes: bom, expectedSha256: bomSha }), /BOM/)

    const duplicate = Buffer.from('{"actual_target_node":"omen","actual_target_node":"atlas"}\n')
    const duplicateSha = crypto.createHash("sha256").update(duplicate).digest("hex")
    expectRejected(() => validateShadowOutcomeEvidence({ artifactBytes: duplicate, expectedSha256: duplicateSha }), /exact canonical JSON/)
  })

  it("rejects caller-authored latency and inconsistent status/result", () => {
    expectRejected(() => validate(artifact({ latency_ms: 12345 })), /caller-authored derived timing/)
    expectRejected(() => validate(artifact({ status: "COMPLETED", result: "FAILED" })), /status\/result pair is inconsistent/)
  })

  it("rejects reversed chronology and evidence outside the outcome interval", () => {
    expectRejected(() => validate(artifact({
      completed_at: "2026-07-04T14:40:55.000Z",
    })), /completion precedes start/)

    expectRejected(() => validate(artifact({
      authority_outcome: {
        status: "COMPLIANT",
        reference: "authority-local-omen-manual-v1",
        checked_at: "2026-07-04T14:41:09.000Z",
      },
    })), /authority outcome timestamp is outside/)

    expectRejected(() => validate(artifact({
      resource_observations: [
        { metric: "cpu_load_pct", unit: "percent", value: 31.5, observed_at: "2026-07-04T14:41:09.000Z" },
      ],
    })), /outside outcome chronology/)
  })

  it("fails closed on a non-compliant authority outcome", () => {
    expectRejected(() => validate(artifact({
      authority_outcome: {
        status: "VIOLATION",
        reference: "authority-local-omen-manual-v1",
        checked_at: "2026-07-04T14:40:56.000Z",
      },
    })), /authority outcome is not COMPLIANT/)
  })

  it("validates resource metrics, units, values, uniqueness, and stable order", () => {
    expectRejected(() => validate(artifact({ resource_observations: [] })), /between 1 and 64/)
    expectRejected(() => validate(artifact({
      resource_observations: [
        { metric: "temperature_c", unit: "celsius", value: 45, observed_at: "2026-07-04T14:41:00.000Z" },
      ],
    })), /unsupported resource metric/)
    expectRejected(() => validate(artifact({
      resource_observations: [
        { metric: "cpu_load_pct", unit: "bytes", value: 31.5, observed_at: "2026-07-04T14:41:00.000Z" },
      ],
    })), /unit must be percent/)
    expectRejected(() => validate(artifact({
      resource_observations: [
        { metric: "cpu_load_pct", unit: "percent", value: 101, observed_at: "2026-07-04T14:41:00.000Z" },
      ],
    })), /must not exceed 100/)
    expectRejected(() => validate(artifact({
      resource_observations: [
        { metric: "concurrency_used", unit: "count", value: 1.5, observed_at: "2026-07-04T14:41:00.000Z" },
      ],
    })), /must be an integer/)
    expectRejected(() => validate(artifact({
      resource_observations: [
        { metric: "ram_used_bytes", unit: "bytes", value: Number.MAX_SAFE_INTEGER + 1, observed_at: "2026-07-04T14:41:00.000Z" },
      ],
    })), /safe integer/)
    expectRejected(() => validate(artifact({
      resource_observations: [
        { metric: "cpu_load_pct", unit: "percent", value: 20, observed_at: "2026-07-04T14:41:00.000Z" },
        { metric: "cpu_load_pct", unit: "percent", value: 21, observed_at: "2026-07-04T14:41:00.000Z" },
      ],
    })), /duplicate resource observation/)
    expectRejected(() => validate(artifact({
      resource_observations: [
        { metric: "ram_used_bytes", unit: "bytes", value: 100, observed_at: "2026-07-04T14:41:00.000Z" },
        { metric: "cpu_load_pct", unit: "percent", value: 20, observed_at: "2026-07-04T14:41:00.000Z" },
      ],
    })), /must be sorted/)
  })

  it("rejects executable fields, secret-like fields, and secret-like values", () => {
    for (const [field, value] of [
      ["command", "run build"],
      ["api_key", "not-a-key"],
      ["authorization", "not-authorized"],
    ]) {
      expectRejected(() => validate(artifact({ [field]: value })), /executable|secret-like/)
    }
    const token = `ghp_${"A".repeat(36)}`
    expectRejected(() => validate(artifact({ work_order_id: token })), /secret-like material/)
  })

  it("rejects missing identity, malformed timestamps, and unknown fields", () => {
    expectRejected(() => validate(artifact({ work_order_id: "bad id" })), /safe identifier/)
    expectRejected(() => validate(artifact({ actual_target_node: "aegis && run" })), /safe identifier/)
    expectRejected(() => validate(artifact({ started_at: "2026-02-30T00:00:00.000Z" })), /valid UTC timestamp/)
    expectRejected(() => validate(artifact({ extra: "not allowed" })), /must contain exactly/)
  })

  it("returns a non-executing CLI rejection for missing artifacts and hash mismatch", () => {
    const missing = runShadowOutcomeEvidenceCli([
      "--artifact", path.join(os.tmpdir(), "missing-shadow-outcome.json"),
      "--sha256", "a".repeat(64),
    ]) as JsonObject
    expect(missing.status).toBe("INPUT_REJECTED")
    expectSafety(missing)

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-outcome-evidence-"))
    const artifactPath = path.join(root, "outcome.json")
    const encoded = encode(artifact())
    fs.writeFileSync(artifactPath, encoded.bytes)
    const mismatch = runShadowOutcomeEvidenceCli([
      "--artifact", artifactPath,
      "--sha256", "b".repeat(64),
    ]) as JsonObject
    fs.rmSync(root, { recursive: true, force: true })
    expect(mismatch.status).toBe("INPUT_REJECTED")
    expect(mismatch.error.detail).toMatch(/SHA-256/)
    expectSafety(mismatch)

    const unknownOption = runShadowOutcomeEvidenceCli([
      "--artifact", artifactPath,
      "--sha256", encoded.sha256,
      "--command", "ignored",
    ]) as JsonObject
    expect(unknownOption.status).toBe("INPUT_REJECTED")
    expect(unknownOption.error.detail).toMatch(/unknown --command/)
    expectSafety(unknownOption)
  })
})
