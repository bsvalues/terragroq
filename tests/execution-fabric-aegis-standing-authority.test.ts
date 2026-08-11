import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  evaluateAegisStandingEligibility,
  validateAegisStandingAuthority,
} from "../scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs"

type Json = Record<string, any>

const authorityPath = path.join(process.cwd(), "config/execution-fabric/aegis-standing-compute-authority.v1.json")
const schemaPath = path.join(process.cwd(), "config/execution-fabric/aegis-standing-compute-authority.schema.v1.json")
const evaluatorPath = path.join(process.cwd(), "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs")
const authority = JSON.parse(fs.readFileSync(authorityPath, "utf8"))
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"))
const now = Date.parse("2026-08-10T22:00:00.000Z")

const canonical = (value: any): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value)
const sha256 = (value: any) => crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex")

function request(): Json {
  return {
    schema_version: "1.0-aegis-standing-admission-request",
    job_id: "job-standing-001",
    outcome: { outcome_id: "approved-outcome-001", origin: "WILLIAMOS_NATIVE", risk_class: "R1", approval_status: "ALREADY_APPROVED" },
    work_order_id: "WO-EF-AEGIS-STANDING-001",
    source: { repository: "bsvalues/terragroq", commit_sha: "a".repeat(40) },
    workload: {
      workload_class: "HASH_VERIFY",
      template_id: "aegis.hash-verify.v1",
      adapter_id: "resident-aegis-hash-verify-v1",
      profile_id: "resident-aegis-bounded-hash-verify-v1",
    },
    execution_identity: {
      node_id: "aegis",
      machine_id_sha256: "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b",
      execution_account: "williamos-fabric",
      privilege: "non-root-no-sudo",
    },
    reviewed_binding: {
      adapter_sha256: "2fe20b5efb3944d001e86ba2da33578d327ee37fafd8b88397ca2d5cc1eb1c84",
      template_sha256: "7217d0486fb67e17d27b7854bb8f44d0ba7d063bddde7d45282c091306d8d58b",
      profile_sha256: "ff8587a3e05eeb0aa7abaa80ed882b0f43010ad2fd119e71f0b58e353dfd2989",
    },
    placement_evidence: {
      evidence_id: "placement-job-standing-001",
      node_id: "aegis",
      machine_id_sha256: "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b",
      observed_at: "2026-08-10T21:59:00.000Z",
      expires_at: "2026-08-10T22:01:00.000Z",
      evidence_sha256: "b".repeat(64),
    },
    capability_evidence: {
      evidence_id: "capability-job-standing-001",
      node_id: "aegis",
      machine_id_sha256: "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b",
      observed_at: "2026-08-10T21:59:00.000Z",
      expires_at: "2026-08-10T22:01:00.000Z",
      evidence_sha256: "c".repeat(64),
      available_cpu_threads: 12,
      available_memory_bytes: 8589934592,
      free_scratch_bytes: 112742891520,
    },
    limits: { cpu_threads: 12, memory_bytes: 8589934592, runtime_ms: 1800000, output_bytes: 536870912, scratch_write_bytes: 5368709120 },
    boundary: structuredClone(authority.execution_boundary),
    lease: { lease_id: "lease-job-standing-001", fencing_token: 1 },
    claim: { claim_id: "claim-standing-001", admission_sha256: "0".repeat(64) },
  }
}

function candidateAdmission(value: Json): Json {
  return {
    schema_version: "1.0-aegis-standing-job-admission",
    admission_id: "candidate-admission-001",
    issuer: "williamos-authority-control-plane",
    authority_id: authority.authority_id,
    job_id: value.job_id,
    outcome_id: value.outcome.outcome_id,
    approval_status: "ALREADY_APPROVED",
    risk_class: value.outcome.risk_class,
    work_order_id: value.work_order_id,
    source: structuredClone(value.source),
    workload: structuredClone(value.workload),
    issued_at: "2026-08-10T21:59:00.000Z",
    expires_at: "2026-08-10T22:01:00.000Z",
  }
}

function evaluate(value = request(), admission = candidateAdmission(value)) {
  value.claim.admission_sha256 = sha256(admission)
  return evaluateAegisStandingEligibility({ authority: structuredClone(authority), request: value, candidateAdmission: admission, now: () => now })
}

describe("AEGIS v1 limited standing compute authority", () => {
  it("records the exact authority envelope while every standing adapter remains non-active", () => {
    expect(validateAegisStandingAuthority(structuredClone(authority))).toBe(true)
    expect(schema).toMatchObject({ type: "object", additionalProperties: false })
    expect(authority).toMatchObject({
      authority_status: "ACTIVE",
      allowed_risk_classes: ["R0", "R1"],
      resource_limits: {
        maximum_concurrency: 1,
        maximum_cpu_threads: 12,
        maximum_memory_bytes: 8 * 1024 ** 3,
        maximum_runtime_ms: 30 * 60 * 1000,
        maximum_output_bytes: 512 * 1024 ** 2,
        maximum_scratch_write_bytes: 5 * 1024 ** 3,
        minimum_free_bytes_after_requested_writes: 100 * 1024 ** 3,
      },
      execution_boundary: { network_scope: "none", scheduler_state: "disabled", scheduler_authority: "not-granted", autonomous_selection: false },
    })
    expect(authority.workload_adapters.map((entry: Json) => [entry.workload_class, entry.status])).toEqual([
      ["CI_BUILD_TEST", "ADAPTER_BLOCKED"],
      ["HASH_VERIFY", "REVIEWED_NOT_STANDING_INTEGRATED"],
      ["COMPRESSION", "ADAPTER_BLOCKED"],
    ])
  })

  it("never turns candidate request or evidence bytes into execution authority", () => {
    expect(evaluate()).toMatchObject({ status: "REJECTED", code: "ADAPTER_INACTIVE", execution_authorized: false, dispatch_allowed: false })
    const value = request()
    const admission = candidateAdmission(value)
    value.workload.workload_class = "CI_BUILD_TEST"
    value.workload.template_id = "aegis.ci-build-test.v1"
    value.workload.adapter_id = "not-active"
    value.workload.profile_id = "williamos.standard-validation.v1"
    expect(evaluate(value, admission)).toMatchObject({ status: "REJECTED", code: "ADAPTER_INACTIVE", execution_authorized: false, dispatch_allowed: false })
  })

  it("rejects missing candidate admission and caller-expanded boundaries", () => {
    const value = request()
    value.boundary.network_scope = "outbound"
    expect(evaluateAegisStandingEligibility({ authority, request: request(), candidateAdmission: null, now: () => now })).toMatchObject({ status: "REJECTED", code: "ADAPTER_INACTIVE" })
    expect(evaluate(value)).toMatchObject({ status: "REJECTED", code: "ADAPTER_INACTIVE" })
  })

  it("rejects authority drift and contains no execution or durable-ledger primitive", () => {
    const changed = structuredClone(authority)
    changed.resource_limits.maximum_concurrency = 2
    expect(() => validateAegisStandingAuthority(changed)).toThrow("does not match the reviewed v1 contract")
    expect(evaluateAegisStandingEligibility({
      authority: changed,
      request: request(),
      candidateAdmission: null,
      now: () => now,
    })).toMatchObject({
      status: "REJECTED",
      code: "AUTHORITY_INVALID",
      execution_authorized: false,
      dispatch_allowed: false,
    })

    const source = fs.readFileSync(evaluatorPath, "utf8")
    expect(source).not.toMatch(/node:(?:child_process|fs|net|http|https)/)
    expect(source).not.toContain("execFile")
    expect(source).not.toContain("spawn(")
    expect(source).not.toContain("process.")
    expect(source).not.toContain("new Set")
    expect(source).not.toContain("new Map")
  })
})
