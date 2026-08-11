import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { evaluateEligibility, requestBindingSha256, jobScopeSha256 } = vi.hoisted(() => ({
  evaluateEligibility: vi.fn(),
  requestBindingSha256: vi.fn(() => "7".repeat(64)),
  jobScopeSha256: vi.fn(() => "9".repeat(64)),
}))

vi.mock("../scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs", () => ({
  aegisStandingRequestBindingSha256: requestBindingSha256,
  aegisStandingJobScopeSha256: jobScopeSha256,
  evaluateAegisStandingEligibility: evaluateEligibility,
}))

import {
  AegisStandingHashRuntimeError,
  executeAegisStandingHash,
} from "../scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs"

type Json = Record<string, any>

const sha256Bytes = (value: crypto.BinaryLike) => crypto.createHash("sha256").update(value).digest("hex")
const canonical = (value: any): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value)
const sha256Object = (value: any) => sha256Bytes(canonical(value))

const inputBytes = Buffer.from("standing AEGIS hash input\n", "utf8")
const baseTime = Date.parse("2026-08-10T22:00:00.000Z")

function authority(): Json {
  return {
    authority_id: "aegis-standing-compute-authority-v1",
    evidence_policy: { maximum_age_ms: 300000 },
  }
}

function request(id = "001"): Json {
  return {
    schema_version: "1.0-aegis-standing-admission-request",
    job_id: `job-standing-${id}`,
    outcome: {
      outcome_id: `approved-outcome-${id}`,
      origin: "WILLIAMOS_NATIVE",
      risk_class: "R1",
      approval_status: "ALREADY_APPROVED",
      dependency_status: "CLEARED",
    },
    work_order_id: `WO-EF-AEGIS-STANDING-${id}`,
    source: { repository: "bsvalues/terragroq", commit_sha: id.padEnd(40, "a") },
    workload: {
      workload_class: "HASH_VERIFY",
      template_id: "aegis.hash-verify.v1",
      adapter_id: "resident-aegis-hash-verify-v1",
      profile_id: "resident-aegis-bounded-hash-verify-v1",
    },
    execution_identity: {
      node_id: "aegis",
      machine_id_sha256: "1".repeat(64),
      execution_account: "williamos-fabric",
      privilege: "non-root-no-sudo",
    },
    reviewed_binding: {
      adapter_sha256: "2".repeat(64),
      template_sha256: "3".repeat(64),
      profile_sha256: "4".repeat(64),
      operation_core_sha256: "8".repeat(64),
      runtime_sha256: "5".repeat(64),
      resident_runner_sha256: "6".repeat(64),
      standing_contract_sha256: "7".repeat(64),
    },
    placement_evidence: {
      evidence_id: `placement-${id}`,
      node_id: "aegis",
      machine_id_sha256: "1".repeat(64),
      observed_at: "2026-08-10T21:59:00.000Z",
      expires_at: "2026-08-10T22:05:00.000Z",
      evidence_sha256: "5".repeat(64),
    },
    capability_evidence: {
      evidence_id: `capability-${id}`,
      node_id: "aegis",
      machine_id_sha256: "1".repeat(64),
      observed_at: "2026-08-10T21:59:00.000Z",
      expires_at: "2026-08-10T22:05:00.000Z",
      evidence_sha256: "6".repeat(64),
      available_cpu_threads: 12,
      available_memory_bytes: 8 * 1024 ** 3,
      free_scratch_bytes: 110 * 1024 ** 3,
    },
    limits: {
      cpu_threads: 1,
      memory_bytes: 256 * 1024 ** 2,
      runtime_ms: 30000,
      output_bytes: 1024,
      scratch_write_bytes: 1,
    },
    boundary: {
      network_scope: "none",
      durable_storage_allowed: false,
      control_evidence_storage_required: true,
      nas_allowed: false,
      backup_allowed: false,
      archive_authority_allowed: false,
      destructive_disk_allowed: false,
      sudo_allowed: false,
      privilege_escalation_allowed: false,
      scheduler_state: "disabled",
      scheduler_authority: "not-granted",
      autonomous_selection: false,
    },
    lease: { lease_id: `lease-standing-${id}`, fencing_token: Number(id) },
    claim: { claim_id: `claim-standing-${id}`, admission_sha256: "0".repeat(64) },
    input: {
      relative_path: `approved/input-${id}.bin`,
      expected_byte_length: inputBytes.length,
      expected_sha256: sha256Bytes(inputBytes),
    },
  }
}

function admission(value: Json, id = value.job_id.split("-").at(-1)): Json {
  return {
    schema_version: "1.0-aegis-standing-job-admission",
    admission_id: `admission-standing-${id}`,
    issuer: "williamos-authority-control-plane",
    authority_id: "aegis-standing-compute-authority-v1",
    authority_sha256: "8".repeat(64),
    job_id: value.job_id,
    outcome_id: value.outcome.outcome_id,
    approval_status: "ALREADY_APPROVED",
    dependency_status: "CLEARED",
    risk_class: value.outcome.risk_class,
    work_order_id: value.work_order_id,
    source: structuredClone(value.source),
    workload: structuredClone(value.workload),
    issued_at: "2026-08-10T21:59:30.000Z",
    expires_at: "2026-08-10T22:05:00.000Z",
  }
}

function clocks(...values: number[]) {
  const queue = [...values]
  return () => queue.shift() ?? values.at(-1)!
}

function harness(overrides: Json = {}) {
  const claimed = new Set<string>()
  let activeLease: string | null = null
  const events: string[] = []
  const claimAdmission = vi.fn(async (binding: Json) => {
    const key = `${binding.authority_id}:${binding.admission_id}:${binding.admission_sha256}`
    if (claimed.has(key)) return { claimed: false, ...binding, claimed_at: "2026-08-10T22:00:00.010Z" }
    claimed.add(key)
    return { claimed: true, ...binding, claimed_at: "2026-08-10T22:00:00.010Z" }
  })
  const acquireLease = vi.fn(async (binding: Json) => {
    if (activeLease) return { acquired: false, ...binding, acquired_at: "2026-08-10T22:00:00.020Z" }
    activeLease = binding.lease_id
    return { acquired: true, ...binding, acquired_at: "2026-08-10T22:00:00.020Z" }
  })
  const releaseLease = vi.fn(async (binding: Json) => {
    events.push("release")
    const released = activeLease === binding.lease_id
    if (released) activeLease = null
    return { released, lease_id: binding.lease_id, fencing_token: binding.fencing_token }
  })
  const readInput = vi.fn(async () => Buffer.from(inputBytes))
  const persistResult = vi.fn(async (evidence: Json) => {
    events.push("persist")
    return { persisted: true, evidence_sha256: evidence.evidence_sha256 }
  })
  return {
    claimed,
    events,
    claimAdmission,
    acquireLease,
    releaseLease,
    readInput,
    persistResult,
    ...overrides,
  }
}

beforeEach(() => {
  evaluateEligibility.mockReset()
})

function authorize(value: Json, candidate: Json) {
  const admissionSha256 = sha256Object(candidate)
  value.claim.admission_sha256 = admissionSha256
  evaluateEligibility.mockReturnValue({
    status: "ELIGIBLE",
    authority_id: "aegis-standing-compute-authority-v1",
    authority_sha256: candidate.authority_sha256,
    job_id: value.job_id,
    admission_id: candidate.admission_id,
    admission_sha256: admissionSha256,
    request_binding_sha256: requestBindingSha256(value),
    job_scope_sha256: jobScopeSha256(value),
    execution_authorized: true,
    dispatch_allowed: true,
    scheduler_activated: false,
    autonomous_selection: false,
  })
}

async function execute(value: Json, candidate: Json, runtime = harness(), now = clocks(
  baseTime, baseTime + 20, baseTime + 30, baseTime + 40,
)) {
  authorize(value, candidate)
  return executeAegisStandingHash({
    authority: authority(),
    request: value,
    candidateAdmission: candidate,
    now,
    claimAdmission: runtime.claimAdmission,
    acquireLease: runtime.acquireLease,
    releaseLease: runtime.releaseLease,
    readInput: runtime.readInput,
    persistResult: runtime.persistResult,
  })
}

describe("AEGIS standing HASH_VERIFY runtime", () => {
  it("executes two distinct admissions sequentially and rejects each replay", async () => {
    const runtime = harness()
    const first = request("001")
    const second = request("002")
    const firstAdmission = admission(first)
    const secondAdmission = admission(second)

    await expect(execute(first, firstAdmission, runtime)).resolves.toMatchObject({
      status: "COMPLETED",
      admission_id: firstAdmission.admission_id,
      lease_released: true,
      evidence: { result: "VERIFIED", operation: { observed_sha256: sha256Bytes(inputBytes) } },
    })
    expect(runtime.claimAdmission).toHaveBeenCalledWith(expect.objectContaining({
      authority_id: authority().authority_id,
      admission_id: firstAdmission.admission_id,
      admission_sha256: first.claim.admission_sha256,
      request_binding_sha256: requestBindingSha256(first),
    }))
    await expect(execute(second, secondAdmission, runtime)).resolves.toMatchObject({
      status: "COMPLETED",
      admission_id: secondAdmission.admission_id,
      lease_released: true,
    })
    await expect(execute(first, firstAdmission, runtime)).rejects.toMatchObject({ code: "ADMISSION_REPLAY" })
    await expect(execute(second, secondAdmission, runtime)).rejects.toMatchObject({ code: "ADMISSION_REPLAY" })
    expect(runtime.readInput).toHaveBeenCalledTimes(2)
    expect(runtime.persistResult).toHaveBeenCalledTimes(2)
  })

  it("requires eligibility to authorize execution and dispatch before any claim", async () => {
    const value = request()
    const candidate = admission(value)
    const runtime = harness()
    evaluateEligibility.mockReturnValue({
      status: "ELIGIBILITY_SHAPE_VALID",
      execution_authorized: false,
      dispatch_allowed: false,
      reason_code: "DURABLE_TRUSTED_MAIN_ADMISSION_NOT_INTEGRATED",
    })
    value.claim.admission_sha256 = sha256Object(candidate)

    await expect(executeAegisStandingHash({
      authority: authority(), request: value, candidateAdmission: candidate, now: () => baseTime,
      claimAdmission: runtime.claimAdmission, acquireLease: runtime.acquireLease,
      releaseLease: runtime.releaseLease, readInput: runtime.readInput, persistResult: runtime.persistResult,
    })).rejects.toMatchObject({ code: "ELIGIBILITY_NOT_AUTHORIZED" })
    expect(runtime.claimAdmission).not.toHaveBeenCalled()
  })

  it("rejects occupied concurrency and releases a valid but mismatched fence", async () => {
    const occupied = harness({
      acquireLease: vi.fn(async (binding: Json) => ({ acquired: false, ...binding, acquired_at: "2026-08-10T22:00:00.020Z" })),
    })
    const value = request()
    await expect(execute(value, admission(value), occupied)).rejects.toMatchObject({ code: "CONCURRENCY_LIMIT_REACHED" })
    expect(occupied.readInput).not.toHaveBeenCalled()
    expect(occupied.releaseLease).not.toHaveBeenCalled()

    const drifted = harness()
    drifted.acquireLease = vi.fn(async (binding: Json) => ({
      acquired: true,
      ...binding,
      fencing_token: binding.fencing_token + 1,
      acquired_at: "2026-08-10T22:00:00.020Z",
    }))
    const changed = request("002")
    await expect(execute(changed, admission(changed), drifted)).rejects.toMatchObject({ code: "LEASE_FENCE_MISMATCH" })
    expect(drifted.releaseLease).toHaveBeenCalledWith(expect.objectContaining({
      lease_id: changed.lease.lease_id,
      fencing_token: changed.lease.fencing_token + 1,
    }))
    expect(drifted.readInput).not.toHaveBeenCalled()
  })

  it("re-evaluates after claim and lease, rejects stale evidence, and releases", async () => {
    const value = request()
    const candidate = admission(value)
    const runtime = harness()
    authorize(value, candidate)
    evaluateEligibility
      .mockReturnValueOnce({
        status: "ELIGIBLE", authority_id: authority().authority_id, job_id: value.job_id,
        authority_sha256: candidate.authority_sha256,
        admission_id: candidate.admission_id, admission_sha256: value.claim.admission_sha256,
        request_binding_sha256: requestBindingSha256(value),
        job_scope_sha256: jobScopeSha256(value),
        execution_authorized: true, dispatch_allowed: true,
      })
      .mockReturnValueOnce({ status: "REJECTED", code: "EVIDENCE_STALE", execution_authorized: false, dispatch_allowed: false })

    await expect(executeAegisStandingHash({
      authority: authority(), request: value, candidateAdmission: candidate,
      now: clocks(baseTime, baseTime + 1000), claimAdmission: runtime.claimAdmission,
      acquireLease: runtime.acquireLease, releaseLease: runtime.releaseLease,
      readInput: runtime.readInput, persistResult: runtime.persistResult,
    })).rejects.toMatchObject({ code: "EVIDENCE_STALE" })
    expect(evaluateEligibility).toHaveBeenCalledTimes(2)
    expect(runtime.releaseLease).toHaveBeenCalledTimes(1)
    expect(runtime.readInput).not.toHaveBeenCalled()
  })

  it("enforces exact byte length, SHA-256, and completion freshness", async () => {
    const short = request()
    const shortRuntime = harness({ readInput: vi.fn(async () => inputBytes.subarray(1)) })
    await expect(execute(short, admission(short), shortRuntime)).rejects.toMatchObject({ code: "INPUT_LENGTH_MISMATCH" })
    expect(shortRuntime.releaseLease).toHaveBeenCalledTimes(1)

    const changed = request("002")
    const changedRuntime = harness({ readInput: vi.fn(async () => Buffer.alloc(inputBytes.length, 1)) })
    await expect(execute(changed, admission(changed), changedRuntime)).rejects.toMatchObject({ code: "HASH_MISMATCH" })
    expect(changedRuntime.releaseLease).toHaveBeenCalledTimes(1)

    const timedOut = request("003")
    await expect(execute(
      timedOut,
      admission(timedOut),
      harness(),
      clocks(baseTime, baseTime + 10, baseTime + 20, baseTime + timedOut.limits.runtime_ms + 21),
    )).rejects.toMatchObject({ code: "RUNTIME_TIMEOUT" })
  })

  it("persists immutable completion evidence before releasing and releases on persistence failure", async () => {
    const value = request()
    const runtime = harness()
    const result = await execute(value, admission(value), runtime)
    expect(runtime.events).toEqual(["persist", "release"])
    const { evidence_sha256: evidenceSha256, ...evidenceBody } = result.evidence
    expect(evidenceSha256).toBe(sha256Object(evidenceBody))
    expect(result.evidence.safety).toMatchObject({
      workload_storage_written: false,
      control_evidence_storage_written: true,
    })

    const failing = harness({
      persistResult: vi.fn(async () => { throw new Error("durable store unavailable") }),
    })
    const second = request("002")
    await expect(execute(second, admission(second), failing)).rejects.toThrow("durable store unavailable")
    expect(failing.releaseLease).toHaveBeenCalledTimes(1)
  })

  it("rejects command, shell, env, and network fields and contains no runtime primitives", async () => {
    for (const field of ["command", "shell", "env", "network"]) {
      const value = request()
      value[field] = field
      const runtime = harness()
      await expect(execute(value, admission(value), runtime)).rejects.toMatchObject({ code: "FORBIDDEN_RUNTIME_FIELD" })
      expect(runtime.claimAdmission).not.toHaveBeenCalled()
    }

    const source = fs.readFileSync(path.join(
      process.cwd(), "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs",
    ), "utf8")
    expect(source).not.toMatch(/node:(?:fs|child_process|net|http|https|tls|dns)/)
    expect(source).not.toMatch(/\b(?:exec|execFile|spawn|fork|fetch|WebSocket)\s*\(/)
    expect(source).not.toMatch(/scheduler|setInterval|setTimeout/)
  })
})

it("exports a typed runtime error", () => {
  expect(new AegisStandingHashRuntimeError("TEST", "detail")).toMatchObject({ code: "TEST" })
})
