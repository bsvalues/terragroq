import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  aegisStandingRequestBindingSha256,
  aegisStandingJobScope,
  aegisStandingJobScopeSha256,
  aegisStandingAuthoritySha256,
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
const sha256File = (relative: string) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n"), "utf8")
  .digest("hex")

function request(): Json {
  const value = {
    schema_version: "1.0-aegis-standing-admission-request",
    job_id: "job-standing-001",
    outcome: { outcome_id: "approved-outcome-001", origin: "WILLIAMOS_NATIVE", risk_class: "R1", approval_status: "ALREADY_APPROVED", dependency_status: "CLEARED" },
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
      adapter_sha256: authority.workload_adapters[1].adapter_sha256,
      template_sha256: authority.workload_adapters[1].template_sha256,
      profile_sha256: "ff8587a3e05eeb0aa7abaa80ed882b0f43010ad2fd119e71f0b58e353dfd2989",
      operation_core_sha256: authority.standing_integration.operation_core_sha256,
      runtime_sha256: authority.standing_integration.runtime_sha256,
      resident_runner_sha256: authority.standing_integration.resident_runner_sha256,
      standing_contract_sha256: authority.standing_integration.standing_contract_sha256,
    },
    input: {
      relative_path: "approved/input.bin",
      expected_sha256: "d".repeat(64),
      expected_byte_length: 137,
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
  for (const field of ["placement_evidence", "capability_evidence"] as const) {
    const { evidence_sha256: _ignored, ...body } = value[field]
    value[field].evidence_sha256 = sha256(body)
  }
  return value
}

function candidateAdmission(value: Json): Json {
  return {
    schema_version: "1.0-aegis-standing-job-admission",
    admission_id: "candidate-admission-001",
    issuer: "williamos-authority-control-plane",
    authority_id: authority.authority_id,
    authority_sha256: aegisStandingAuthoritySha256(authority),
    status: "ACTIVE",
    single_use: true,
    consumption_count: 0,
    consumed_at: null,
    revoked_at: null,
    job_scope: aegisStandingJobScope(value),
    job_scope_sha256: aegisStandingJobScopeSha256(value),
    approval_provenance: {
      mode: "REVIEWED_MAIN",
      authority_reference: authority.authority_reference,
      outcome_id: value.outcome.outcome_id,
      work_order_id: value.work_order_id,
      dependency_status: value.outcome.dependency_status,
    },
    issued_at: "2026-08-10T21:59:00.000Z",
    expires_at: "2026-08-10T22:01:00.000Z",
  }
}

function evaluate(value = request(), admission = candidateAdmission(value)) {
  value.claim.admission_sha256 = sha256(admission)
  return evaluateAegisStandingEligibility({ authority: structuredClone(authority), request: value, candidateAdmission: admission, now: () => now })
}

describe("AEGIS v1 limited standing compute authority", () => {
  it("activates only the reviewed HASH_VERIFY adapter", () => {
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
      ["HASH_VERIFY", "ACTIVE"],
      ["COMPRESSION", "ADAPTER_BLOCKED"],
    ])
  })

  it("pins the authorized adapter and standing integration to exact reviewed bytes", () => {
    expect(authority.workload_adapters[1]).toMatchObject({
      adapter_sha256: sha256File("scripts/execution-fabric/bounded-dispatch/aegis-hash-verify.mjs"),
      template_sha256: sha256File("config/execution-fabric/aegis-bounded-dispatch-templates.json"),
      profile_sha256: sha256File("config/execution-fabric/agent-forge-aegis-bounded-hash-verify-permission.json"),
    })
    expect(authority.standing_integration).toMatchObject({
      operation_core_sha256: sha256File("scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs"),
      runtime_sha256: sha256File("scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs"),
      resident_runner_sha256: sha256File("scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs"),
      standing_contract_sha256: sha256File("config/execution-fabric/aegis-standing-hash-template.v1.json"),
      trusted_release_manifest_required: true,
      status: "ACTIVE",
    })
  })

  it("authorizes one exact active HASH_VERIFY request while keeping scheduling off", () => {
    expect(evaluate()).toMatchObject({
      status: "ADMITTED",
      execution_authorized: true,
      dispatch_allowed: true,
      scheduler_activated: false,
      autonomous_selection: false,
      request_binding_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it.each([
    ["CI_BUILD_TEST", "aegis.ci-build-test.v1", null, "williamos.standard-validation.v1"],
    ["COMPRESSION", "aegis.compression.v1", null, "tar-zstd.deterministic.v1"],
  ])("keeps %s blocked", (workloadClass, templateId, adapterId, profileId) => {
    const value = request()
    Object.assign(value.workload, { workload_class: workloadClass, template_id: templateId, adapter_id: adapterId, profile_id: profileId })
    expect(evaluate(value)).toMatchObject({ status: "REJECTED", code: "ADAPTER_INACTIVE", execution_authorized: false, dispatch_allowed: false })
  })

  it.each([
    ["input path", (value: Json) => { value.input.relative_path = "approved/other.bin" }],
    ["input digest", (value: Json) => { value.input.expected_sha256 = "e".repeat(64) }],
    ["input length", (value: Json) => { value.input.expected_byte_length += 1 }],
    ["source", (value: Json) => { value.source.commit_sha = "b".repeat(40) }],
    ["workload", (value: Json) => { value.workload.profile_id = "changed-profile" }],
    ["limits", (value: Json) => { value.limits.cpu_threads = 11 }],
    ["boundary", (value: Json) => { value.boundary.autonomous_selection = true }],
  ])("rejects post-admission drift in %s", (_label, mutate) => {
    const value = request()
    const admission = candidateAdmission(value)
    mutate(value)
    value.claim.admission_sha256 = sha256(admission)
    expect(evaluateAegisStandingEligibility({ authority, request: value, candidateAdmission: admission, now: () => now }))
      .toMatchObject({ status: "REJECTED", execution_authorized: false, dispatch_allowed: false })
  })

  it("allows fresh runtime evidence, claim, and lease to be attached after reviewed admission", () => {
    const value = request()
    const admission = candidateAdmission(value)
    value.placement_evidence.evidence_id = "placement-job-standing-fresh"
    value.capability_evidence.evidence_id = "capability-job-standing-fresh"
    for (const field of ["placement_evidence", "capability_evidence"] as const) {
      const { evidence_sha256: _ignored, ...body } = value[field]
      value[field].evidence_sha256 = sha256(body)
    }
    value.lease = { lease_id: "lease-job-standing-fresh", fencing_token: 2 }
    value.claim = { claim_id: "claim-standing-fresh", admission_sha256: sha256(admission) }
    expect(evaluateAegisStandingEligibility({ authority, request: value, candidateAdmission: admission, now: () => now }))
      .toMatchObject({ status: "ADMITTED", execution_authorized: true, dispatch_allowed: true })
  })

  it.each([
    ["expired", (admission: Json) => { admission.expires_at = "2026-08-10T22:00:00.000Z" }, "ADMISSION_EXPIRED"],
    ["revoked", (admission: Json) => { admission.status = "REVOKED"; admission.revoked_at = "2026-08-10T21:59:30.000Z" }, "ADMISSION_REVOKED"],
    ["consumed", (admission: Json) => { admission.consumption_count = 1; admission.consumed_at = "2026-08-10T21:59:30.000Z" }, "ADMISSION_REPLAYED"],
  ])("rejects a %s admission", (_label, mutate, code) => {
    const value = request()
    const admission = candidateAdmission(value)
    mutate(admission)
    value.claim.admission_sha256 = sha256(admission)
    expect(evaluateAegisStandingEligibility({ authority, request: value, candidateAdmission: admission, now: () => now }))
      .toMatchObject({ status: "REJECTED", code, execution_authorized: false, dispatch_allowed: false })
  })

  it("rejects stale evidence and admission shape expansion", () => {
    const stale = request()
    stale.placement_evidence.expires_at = "2026-08-10T22:00:00.000Z"
    const { evidence_sha256: _ignored, ...staleBody } = stale.placement_evidence
    stale.placement_evidence.evidence_sha256 = sha256(staleBody)
    expect(evaluate(stale)).toMatchObject({ status: "REJECTED", code: "EVIDENCE_STALE" })

    const value = request()
    const expanded = candidateAdmission(value)
    expanded.replay_override = false
    value.claim.admission_sha256 = sha256(expanded)
    expect(evaluateAegisStandingEligibility({ authority, request: value, candidateAdmission: expanded, now: () => now }))
      .toMatchObject({ status: "REJECTED", code: "INVALID_SHAPE" })
  })

  it("rejects missing, unsafe, mismatched, and malformed bindings", () => {
    expect(evaluateAegisStandingEligibility({ authority, request: request(), candidateAdmission: null, now: () => now }))
      .toMatchObject({ status: "REJECTED", code: "ADMISSION_REQUIRED" })

    const unsafe = request()
    unsafe.input.command = "sha256sum input.bin"
    expect(evaluate(unsafe)).toMatchObject({ status: "REJECTED", code: "UNSAFE_FIELD" })

    const mismatch = request()
    const admission = candidateAdmission(mismatch)
    mismatch.claim.admission_sha256 = "f".repeat(64)
    expect(evaluateAegisStandingEligibility({ authority, request: mismatch, candidateAdmission: admission, now: () => now }))
      .toMatchObject({ status: "REJECTED", code: "ADMISSION_DIGEST_MISMATCH" })

    const traversal = request()
    traversal.input.relative_path = "../outside.bin"
    expect(evaluate(traversal)).toMatchObject({ status: "REJECTED", code: "INPUT_PATH_INVALID" })

    const drivePath = request()
    drivePath.input.relative_path = "C:/outside.bin"
    expect(evaluate(drivePath)).toMatchObject({ status: "REJECTED", code: "INPUT_PATH_INVALID" })
  })

  it("rejects authority drift and contains no execution or durable-ledger primitive", () => {
    const changed = structuredClone(authority)
    changed.resource_limits.maximum_concurrency = 2
    expect(() => validateAegisStandingAuthority(changed)).toThrow("does not match the reviewed v1 contract")
    expect(evaluateAegisStandingEligibility({ authority: changed, request: request(), candidateAdmission: null, now: () => now }))
      .toMatchObject({ status: "REJECTED", code: "AUTHORITY_INVALID", execution_authorized: false, dispatch_allowed: false })

    const source = fs.readFileSync(evaluatorPath, "utf8")
    expect(source).not.toMatch(/node:(?:child_process|fs|net|http|https)/)
    expect(source).not.toContain("execFile")
    expect(source).not.toContain("spawn(")
    expect(source).not.toContain("process.")
    expect(source).not.toContain("new Set")
    expect(source).not.toContain("new Map")
  })
})
