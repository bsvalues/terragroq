import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { aegisStandingAuthoritySha256, aegisStandingJobScope, aegisStandingJobScopeSha256, aegisStandingRequestBindingSha256, evaluateAegisStandingEligibility } from "../scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs"
import { issueAegisStandingHashAdmission } from "../scripts/execution-fabric/admission/issue-aegis-standing-hash-admission.mjs"
import { executeAegisStandingHash } from "../scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs"

type Json = Record<string, any>

const authority = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config/execution-fabric/aegis-standing-compute-authority.v1.json"), "utf8"))
const issuerPath = path.join(process.cwd(), "scripts/execution-fabric/admission/issue-aegis-standing-hash-admission.mjs")
const issuedAt = "2026-08-10T21:59:30.000Z"
const expiresAt = "2026-08-10T22:01:00.000Z"
const exactInput = Buffer.from("reviewed standing hash input\n", "utf8")

const canonical = (value: any): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value)
const sha256 = (value: any) => crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex")

function request(): Json {
  const value = {
    schema_version: "1.0-aegis-standing-admission-request",
    job_id: "job-standing-issuer-001",
    outcome: { outcome_id: "approved-outcome-issuer-001", origin: "WILLIAMOS_NATIVE", risk_class: "R1", approval_status: "ALREADY_APPROVED", dependency_status: "CLEARED" },
    work_order_id: "WO-EF-AEGIS-STANDING-ISSUER-001",
    source: { repository: "bsvalues/terragroq", commit_sha: "a".repeat(40) },
    workload: {
      workload_class: "HASH_VERIFY",
      template_id: "aegis.hash-verify.v1",
      adapter_id: "resident-aegis-hash-verify-v1",
      profile_id: "resident-aegis-bounded-hash-verify-v1",
    },
    execution_identity: {
      node_id: "aegis",
      machine_id_sha256: authority.node_identity.machine_id_sha256,
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
    input: { relative_path: "inputs/input.bin", expected_sha256: crypto.createHash("sha256").update(exactInput).digest("hex"), expected_byte_length: exactInput.length },
    placement_evidence: {
      evidence_id: "placement-job-standing-issuer-001",
      node_id: "aegis",
      machine_id_sha256: authority.node_identity.machine_id_sha256,
      observed_at: "2026-08-10T21:59:00.000Z",
      expires_at: "2026-08-10T22:02:00.000Z",
      evidence_sha256: "b".repeat(64),
    },
    capability_evidence: {
      evidence_id: "capability-job-standing-issuer-001",
      node_id: "aegis",
      machine_id_sha256: authority.node_identity.machine_id_sha256,
      observed_at: "2026-08-10T21:59:00.000Z",
      expires_at: "2026-08-10T22:02:00.000Z",
      evidence_sha256: "c".repeat(64),
      available_cpu_threads: 12,
      available_memory_bytes: 8589934592,
      free_scratch_bytes: 112742891520,
    },
    limits: { cpu_threads: 12, memory_bytes: 8589934592, runtime_ms: 1800000, output_bytes: 536870912, scratch_write_bytes: 5368709120 },
    boundary: structuredClone(authority.execution_boundary),
    lease: { lease_id: "lease-job-standing-issuer-001", fencing_token: 1 },
    claim: { claim_id: "claim-standing-issuer-001", admission_sha256: "0".repeat(64) },
  }
  for (const field of ["placement_evidence", "capability_evidence"] as const) {
    const { evidence_sha256: _ignored, ...body } = value[field]
    value[field].evidence_sha256 = sha256(body)
  }
  return value
}

function issue(overrides: Json = {}) {
  return issueAegisStandingHashAdmission({
    authority: structuredClone(authority),
    request: request(),
    admission_id: "admission-standing-issuer-001",
    issued_at: issuedAt,
    expires_at: expiresAt,
    ...overrides,
  })
}

describe("AEGIS standing HASH_VERIFY admission issuer", () => {
  it("issues the exact active single-use shape and a separately bound request clone", () => {
    const prepared = request()
    const before = structuredClone(prepared)
    const result = issueAegisStandingHashAdmission({
      authority: structuredClone(authority), request: prepared,
      admission_id: "admission-standing-issuer-001", issued_at: issuedAt, expires_at: expiresAt,
    })

    expect(prepared).toEqual(before)
    expect(result.admission).toEqual({
      schema_version: "1.0-aegis-standing-job-admission",
      admission_id: "admission-standing-issuer-001",
      issuer: "williamos-authority-control-plane",
      authority_id: authority.authority_id,
      authority_sha256: aegisStandingAuthoritySha256(authority),
      status: "ACTIVE",
      single_use: true,
      consumption_count: 0,
      consumed_at: null,
      revoked_at: null,
      job_scope: aegisStandingJobScope(prepared),
      job_scope_sha256: aegisStandingJobScopeSha256(prepared),
      approval_provenance: {
        mode: "REVIEWED_MAIN",
        authority_reference: authority.authority_reference,
        outcome_id: prepared.outcome.outcome_id,
        work_order_id: prepared.work_order_id,
        dependency_status: prepared.outcome.dependency_status,
      },
      issued_at: issuedAt,
      expires_at: expiresAt,
    })
    expect(result.request).not.toBe(prepared)
    expect(result.request.claim.admission_sha256).toBe(sha256(result.admission))
    expect(aegisStandingJobScopeSha256(result.request)).toBe(result.admission.job_scope_sha256)
    expect(result.evaluation).toMatchObject({
      status: "ADMITTED",
      authority_id: authority.authority_id,
      authority_sha256: result.admission.authority_sha256,
      job_id: prepared.job_id,
      admission_id: result.admission.admission_id,
      admission_sha256: result.request.claim.admission_sha256,
      request_binding_sha256: aegisStandingRequestBindingSha256(result.request),
      job_scope_sha256: result.admission.job_scope_sha256,
      execution_authorized: true,
      dispatch_allowed: true,
      scheduler_activated: false,
      autonomous_selection: false,
    })
    expect(evaluateAegisStandingEligibility({ authority, request: result.request, candidateAdmission: result.admission, now: () => Date.parse(issuedAt) }))
      .toEqual(result.evaluation)
  })

  it("executes the issued binding through the real evaluator exactly once", async () => {
    const issued = issue()
    const consumed = new Set<string>()
    const chronology = [
      Date.parse("2026-08-10T21:59:31.000Z"),
      Date.parse("2026-08-10T21:59:31.010Z"),
      Date.parse("2026-08-10T21:59:31.020Z"),
      Date.parse("2026-08-10T21:59:31.030Z"),
    ]
    const now = () => chronology.shift() ?? Date.parse("2026-08-10T21:59:31.030Z")
    let activeLease = false
    let persisted = false
    const callbacks = {
      now,
      claimAdmission: async (binding: Json) => {
        const key = `${binding.authority_id}:${binding.admission_id}:${binding.request_binding_sha256}`
        if (consumed.has(key)) return { claimed: false, ...binding, claimed_at: "2026-08-10T21:59:31.001Z" }
        consumed.add(key)
        return { claimed: true, ...binding, claimed_at: "2026-08-10T21:59:31.001Z" }
      },
      persistClaimFailure: async (evidence: Json) => ({ persisted: true, evidence_sha256: evidence.evidence_sha256 }),
      acquireLease: async (binding: Json) => {
        if (activeLease) return { acquired: false, ...binding, acquired_at: "2026-08-10T21:59:31.005Z" }
        activeLease = true
        return { acquired: true, ...binding, acquired_at: "2026-08-10T21:59:31.005Z" }
      },
      readInput: async () => Buffer.from(exactInput),
      persistResult: async (evidence: Json) => {
        persisted = true
        return { persisted: true, evidence_sha256: evidence.evidence_sha256 }
      },
      releaseLease: async (binding: Json) => {
        activeLease = false
        return { released: true, lease_id: binding.lease_id, fencing_token: binding.fencing_token }
      },
    }
    await expect(executeAegisStandingHash({ authority, request: issued.request, candidateAdmission: issued.admission, ...callbacks }))
      .resolves.toMatchObject({ status: "COMPLETED", lease_released: true, evidence: { result: "VERIFIED" } })
    expect(persisted).toBe(true)

    await expect(executeAegisStandingHash({ authority, request: issued.request, candidateAdmission: issued.admission, ...callbacks }))
      .rejects.toMatchObject({ code: "ADMISSION_REPLAY" })
  })

  it.each([
    ["outer command", { command: "hash input" }],
    ["outer status", { status: "REVOKED" }],
    ["outer revoked field", { revoked_at: issuedAt }],
    ["outer environment", { env: { TOKEN: "value" } }],
  ])("rejects caller-provided %s fields", (_label, extra) => {
    expect(() => issue(extra)).toThrowError(expect.objectContaining({ code: "ISSUER_INPUT_INVALID" }))
  })

  it.each([
    ["command", (value: Json) => { value.command = "sha256sum approved/input.bin" }, "UNSAFE_FIELD"],
    ["shell", (value: Json) => { value.shell = "powershell" }, "UNSAFE_FIELD"],
    ["environment", (value: Json) => { value.env = { SAFE: "no" } }, "UNSAFE_FIELD"],
    ["network", (value: Json) => { value.endpoint = "https://example.invalid" }, "UNSAFE_FIELD"],
    ["secret", (value: Json) => { value.input.relative_path = "sk-proj-abcdefghijklmnop" }, "SECRET_LIKE_VALUE"],
  ])("rejects request %s material through evaluator", (_label, mutate, code) => {
    const value = request()
    mutate(value)
    expect(() => issue({ request: value })).toThrowError(expect.objectContaining({ code }))
  })

  it.each([
    ["R2 outcome", (value: Json) => { value.outcome.risk_class = "R2" }, "RISK_NOT_AUTHORIZED"],
    ["inactive CI adapter", (value: Json) => { Object.assign(value.workload, { workload_class: "CI_BUILD_TEST", template_id: "aegis.ci-build-test.v1", adapter_id: null, profile_id: "williamos.standard-validation.v1" }) }, "ADAPTER_INACTIVE"],
    ["expanded request", (value: Json) => { value.extra = false }, "INVALID_SHAPE"],
    ["unsafe boundary", (value: Json) => { value.boundary.network_scope = "outbound" }, "BOUNDARY_MISMATCH"],
  ])("rejects %s", (_label, mutate, code) => {
    const value = request()
    mutate(value)
    expect(() => issue({ request: value })).toThrowError(expect.objectContaining({ code }))
  })

  it("rejects invalid authority, identifier, timestamps, and excessive lifetime", () => {
    const changedAuthority = structuredClone(authority)
    changedAuthority.authority_status = "REVOKED"
    expect(() => issue({ authority: changedAuthority })).toThrowError(expect.objectContaining({ code: "AUTHORITY_INVALID" }))
    expect(() => issue({ admission_id: "bad id" })).toThrowError(expect.objectContaining({ code: "INVALID_IDENTIFIER" }))
    expect(() => issue({ issued_at: "not-a-time" })).toThrowError(expect.objectContaining({ code: "INVALID_TIMESTAMP" }))
    expect(() => issue({ expires_at: issuedAt })).toThrowError(expect.objectContaining({ code: "ADMISSION_LIFETIME_INVALID" }))
    expect(() => issue({ expires_at: "2026-08-11T21:59:30.001Z" })).toThrowError(expect.objectContaining({ code: "ADMISSION_LIFETIME_INVALID" }))
  })

  it("contains no host, persistence, network, process, or scheduler primitive", () => {
    const source = fs.readFileSync(issuerPath, "utf8")
    expect(source).not.toMatch(/node:(?:fs|child_process|net|http|https)/)
    expect(source).not.toMatch(/\b(?:process|fetch|XMLHttpRequest|WebSocket|execFile|spawn)\b/)
    expect(source).not.toMatch(/\b(?:writeFile|appendFile|mkdir|setInterval|setTimeout|cron)\b/i)
    expect(source).not.toContain("scheduler_activated: true")
  })
})
