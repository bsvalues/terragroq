import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  executeResidentHermesBoundedDispatch,
  prepareResidentHermesBoundedDispatch,
} from "../scripts/execution-fabric/bounded-dispatch/resident-hermes-bounded-dispatch.mjs"

const receiptPath = "docs/reports/shadow-admission/WO-EF-SHADOW-004-resident-8e063f9de03e0471-receipt.json"
const permissionPath = "config/execution-fabric/agent-forge-bounded-dispatch-permission.json"
const templatePath = "config/execution-fabric/bounded-dispatch-templates.json"
const permissionSha256 = "a2e2938b58440d5d46ad92d08da43f79e714f34140bed375abc897ac8bb64760"
const authorityReference = "issue-538-phase3-bounded-dispatch-test"

function sha256(value: Buffer | string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function request(receiptBytes: Buffer) {
  return {
    schema_version: "0.1-bounded-dispatch-request",
    request_id: "phase3-hermes-inference-001",
    work_order_id: "WO-EF-DISPATCH-001",
    template_id: "hermes.local-llm-inference.v1",
    placement_receipt_sha256: sha256(receiptBytes),
    input: {
      model: "llama3.2:3b",
      prompt: "Return exactly HERMES_PHASE3_OK.",
      expected_marker: "HERMES_PHASE3_OK",
    },
    limits: { timeout_ms: 30000, max_response_bytes: 1024 },
    forge: { producer_identity: "resident-hermes", permission_set_sha256: permissionSha256 },
    authority_reference: authorityReference,
  }
}

function scopeSha256(value: ReturnType<typeof request>) {
  return sha256(canonicalizeJcs({
    work_order_id: value.work_order_id,
    template_id: value.template_id,
    selected_node_id: "hermes-node",
    input: value.input,
    limits: value.limits,
    forge: value.forge,
  }))
}

function fixture({ admitAuthority = true } = {}) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-bounded-dispatch-"))
  for (const relativePath of [permissionPath, templatePath]) {
    const destination = path.join(repositoryRoot, relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, fs.readFileSync(path.join(process.cwd(), relativePath)))
  }
  const receiptBytes = fs.readFileSync(path.join(process.cwd(), receiptPath))
  const value = request(receiptBytes)
  const scopePath = "config/execution-fabric/bounded-dispatch-authority-scopes/WO-EF-DISPATCH-001.json"
  const scope = `${JSON.stringify({
    schema_version: "0.1-bounded-dispatch-authority-scope",
    reference: authorityReference,
    work_order_id: value.work_order_id,
    template_id: value.template_id,
    selected_node_id: "hermes-node",
    scope_sha256: scopeSha256(value),
    maximum_attempts: 1,
    risk_class: "R1",
    forge_permission_set_sha256: permissionSha256,
    prohibited_actions: [
      "arbitrary-shell", "autonomous-scheduling", "authority-mutation", "external-provider-access",
      "remote-node-access", "silent-replacement", "stateful-storage-write",
    ],
    status: "REVIEWED_NON_ACTIVE_SCOPE",
  }, null, 2)}\n`
  const scopeDestination = path.join(repositoryRoot, scopePath)
  fs.mkdirSync(path.dirname(scopeDestination), { recursive: true })
  fs.writeFileSync(scopeDestination, scope)
  const entries = admitAuthority ? [{
    reference: authorityReference,
    work_order_id: value.work_order_id,
    template_id: value.template_id,
    selected_node_id: "hermes-node",
    scope_sha256: scopeSha256(value),
    valid_from: "2026-08-10T15:20:55.000Z",
    expires_at: "2026-08-10T15:25:40.000Z",
    maximum_attempts: 1,
    scope_path: scopePath,
    scope_artifact_sha256: sha256(scope),
    reviewed_commit: "a".repeat(40),
    status: "ACTIVE",
  }] : []
  const registry = `${JSON.stringify({
    schema_version: "0.1-bounded-dispatch-authority-registry",
    registry_id: "execution-fabric-bounded-dispatch-authorities",
    entries,
  }, null, 2)}\n`
  const registryPath = path.join(repositoryRoot, "config/execution-fabric/bounded-dispatch-authority-registry.json")
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, registry)
  const proveTrustedAuthority = ({ registrySha256, authority, scope: scopeBinding }: any) => ({
    schema_version: "0.1-trusted-bounded-dispatch-authority-proof",
    trusted_ref: "refs/heads/main",
    registry_sha256: registrySha256,
    authority_reference: authority.reference,
    authority_reviewed_commit: authority.reviewed_commit,
    scope_artifact_sha256: scopeBinding.sha256,
    exact_entry_count: 1,
  })
  const proveTrustedPlacement = ({ receiptSha256, receipt }: any) => ({
    schema_version: "0.1-trusted-pinned-placement-proof",
    receipt_sha256: receiptSha256,
    semantic_replay_sha256: sha256(canonicalizeJcs(receipt)),
    evidence_count: receipt.evidence_snapshot.length,
    verified: true,
  })
  return { repositoryRoot, receiptBytes, request: value, proveTrustedPlacement, proveTrustedAuthority }
}

function runtimeLease() {
  return {
    acquireExclusiveRuntimeLease: async () => ({
      acquired: true,
      lease_id: "lease-phase3-hermes-001",
      acquired_at: "2026-08-10T15:21:00.150Z",
    }),
    releaseExclusiveRuntimeLease: async () => true,
  }
}

describe("Execution Fabric Phase 3 resident HERMES bounded dispatch", () => {
  it("keeps unrelated production requests closed across the single exact activation", () => {
    const scope = JSON.parse(fs.readFileSync(path.join(
      process.cwd(),
      "config/execution-fabric/bounded-dispatch-authority-scopes/WO-EF-DISPATCH-001.json",
    ), "utf8"))
    const successorScope = JSON.parse(fs.readFileSync(path.join(
      process.cwd(),
      "config/execution-fabric/bounded-dispatch-authority-scopes/WO-EF-DISPATCH-002.json",
    ), "utf8"))
    const productionAuthority = JSON.parse(fs.readFileSync(path.join(
      process.cwd(),
      "config/execution-fabric/bounded-dispatch-authority-registry.json",
    ), "utf8"))
    expect(scope).toMatchObject({
      reference: "issue-538-phase3-bounded-dispatch-001",
      scope_sha256: "14a943bff96d32a891d17997ade343f3294abc14343ddf52b1ed99db78fb1fa1",
      maximum_attempts: 1,
      status: "REVIEWED_NON_ACTIVE_SCOPE",
    })
    expect(successorScope).toMatchObject({
      reference: "issue-538-phase3-bounded-dispatch-002",
      work_order_id: "WO-EF-DISPATCH-002",
      template_id: "hermes.local-llm-inference.v1",
      selected_node_id: "hermes-node",
      scope_sha256: "4344ffc727cab579289868664f6ba36bacaa7dadd719986833d562e5340c5330",
      maximum_attempts: 1,
      risk_class: "R1",
      forge_permission_set_sha256: permissionSha256,
      prohibited_actions: [
        "arbitrary-shell",
        "autonomous-scheduling",
        "authority-mutation",
        "external-provider-access",
        "remote-node-access",
        "silent-replacement",
        "stateful-storage-write",
      ],
      status: "REVIEWED_NON_ACTIVE_SCOPE",
    })
    expect(successorScope.scope_sha256).toBe(sha256(canonicalizeJcs({
      work_order_id: "WO-EF-DISPATCH-002",
      template_id: "hermes.local-llm-inference.v1",
      selected_node_id: "hermes-node",
      input: {
        model: "llama3.2:3b",
        prompt: "Repeat this word: HERMESOK002",
        expected_marker: "HERMESOK002",
      },
      limits: { timeout_ms: 30000, max_response_bytes: 1024 },
      forge: { producer_identity: "resident-hermes", permission_set_sha256: permissionSha256 },
    })))
    expect(productionAuthority.entries).toEqual([
      expect.objectContaining({
        reference: "issue-538-phase3-bounded-dispatch-001",
        scope_sha256: "14a943bff96d32a891d17997ade343f3294abc14343ddf52b1ed99db78fb1fa1",
        valid_from: "2026-08-10T16:20:00.000Z",
        maximum_attempts: 1,
        status: "ACTIVE",
      }),
      expect.objectContaining({
        reference: "issue-538-phase3-bounded-dispatch-002",
        work_order_id: "WO-EF-DISPATCH-002",
        template_id: "hermes.local-llm-inference.v1",
        selected_node_id: "hermes-node",
        scope_sha256: "4344ffc727cab579289868664f6ba36bacaa7dadd719986833d562e5340c5330",
        valid_from: "2026-08-10T16:40:00.000Z",
        expires_at: "2026-08-10T20:40:00.000Z",
        maximum_attempts: 1,
        scope_path: "config/execution-fabric/bounded-dispatch-authority-scopes/WO-EF-DISPATCH-002.json",
        scope_artifact_sha256: "cb856d4916bcf84aa87ea0a6dac21b8a4e0a97e0b0632c4cca3651a14686edd0",
        reviewed_commit: "59035427737b6fc71e1d1a09a57311ca331e9d54",
        status: "ACTIVE",
      }),
    ])
    const receiptBytes = fs.readFileSync(path.join(process.cwd(), receiptPath))
    expect(prepareResidentHermesBoundedDispatch({
      repositoryRoot: process.cwd(),
      receiptBytes,
      request: request(receiptBytes),
      evaluatedAt: "2026-08-10T15:21:00.000Z",
      proveTrustedPlacement: ({ receiptSha256, receipt }: any) => ({
        schema_version: "0.1-trusted-pinned-placement-proof",
        receipt_sha256: receiptSha256,
        semantic_replay_sha256: sha256(canonicalizeJcs(receipt)),
        evidence_count: receipt.evidence_snapshot.length,
        verified: true,
      }),
      proveTrustedAuthority: () => { throw new Error("must not be called") },
    })).toMatchObject({
      status: "BLOCKED",
      reasons: [{ code: "AUTHORITY_NOT_ADMITTED" }],
      execution_authorized: false,
      dispatch_allowed: false,
      scheduler_activated: false,
    })
  })

  it("prepares only an exact fresh, admitted, Forge-bound single-shot claim", () => {
    const value = fixture()
    expect(prepareResidentHermesBoundedDispatch({
      ...value,
      evaluatedAt: "2026-08-10T15:21:00.000Z",
    })).toMatchObject({
      status: "READY_FOR_SINGLE_SHOT_CLAIM",
      selected_node_id: "hermes-node",
      template_id: "hermes.local-llm-inference.v1",
      execution_authorized: true,
      dispatch_allowed: false,
      scheduler_activated: false,
      autonomous_dispatch: false,
      silent_replacement: false,
      external_provider_accessed: false,
    })
  })

  it("rejects a caller-shaped placement proof and changed reviewed scope bytes", () => {
    const forged = fixture()
    expect(prepareResidentHermesBoundedDispatch({
      ...forged,
      evaluatedAt: "2026-08-10T15:21:00.000Z",
      proveTrustedPlacement: ({ receiptSha256, receipt }: any) => ({
        schema_version: "0.1-trusted-pinned-placement-proof",
        receipt_sha256: receiptSha256,
        semantic_replay_sha256: sha256(canonicalizeJcs(receipt)),
        evidence_count: receipt.evidence_snapshot.length,
        verified: false,
      }),
    })).toMatchObject({ status: "BLOCKED", reasons: [{ code: "PLACEMENT_UNPROVEN" }] })

    const changedScope = fixture()
    fs.appendFileSync(path.join(
      changedScope.repositoryRoot,
      "config/execution-fabric/bounded-dispatch-authority-scopes/WO-EF-DISPATCH-001.json",
    ), " ")
    expect(prepareResidentHermesBoundedDispatch({
      ...changedScope,
      evaluatedAt: "2026-08-10T15:21:00.000Z",
    })).toMatchObject({ status: "BLOCKED", reasons: [{ code: "AUTHORITY_SCOPE_MISMATCH" }] })
  })

  it("pins the Agent Forge bytes and the production adapter to loopback-only invocation", () => {
    const permissionBytes = fs.readFileSync(path.join(process.cwd(), permissionPath))
    const templates = JSON.parse(fs.readFileSync(path.join(process.cwd(), templatePath), "utf8"))
    const runtimeSource = fs.readFileSync(path.join(
      process.cwd(),
      "scripts/execution-fabric/bounded-dispatch/run-resident-hermes-bounded-dispatch.mjs",
    ), "utf8")
    expect(sha256(permissionBytes)).toBe(permissionSha256)
    expect(templates.templates).toEqual([
      expect.objectContaining({
        template_id: "hermes.local-llm-inference.v1",
        selected_node_id: "hermes-node",
        network_scope: "loopback-only",
        forge_permission_set_sha256: permissionSha256,
        status: "IMPLEMENTED_NOT_AUTHORIZED",
      }),
    ])
    expect(runtimeSource).toContain('fetch("http://127.0.0.1:11434/api/generate"')
    expect(runtimeSource).not.toMatch(/fetch\(["']https?:\/\/(?!127\.0\.0\.1:11434)/)
  })

  it("executes one claimed loopback template and emits bounded evidence", async () => {
    const value = fixture()
    const times = [
      "2026-08-10T15:21:00.000Z",
      "2026-08-10T15:21:00.200Z",
      "2026-08-10T15:21:01.000Z",
    ]
    const result = await executeResidentHermesBoundedDispatch({
      ...value,
      ...runtimeLease(),
      clock: () => times.shift()!,
      claimSingleUse: async () => ({
        claimed: true,
        claim_id: "claim-phase3-hermes-001",
        claimed_at: "2026-08-10T15:21:00.100Z",
      }),
      invokeLoopbackModel: async ({ adapter_id, model }: any) => {
        expect(adapter_id).toBe("resident-hermes-loopback-ollama-v1")
        expect(model).toBe("llama3.2:3b")
        return "HERMES_PHASE3_OK"
      },
      captureResourceObservations: async ({ completed_at }: any) => [{
        metric: "ram_used_bytes", unit: "bytes", value: 1024, observed_at: completed_at,
      }],
    })
    expect(result).toMatchObject({
      status: "COMPLETED",
      result: "SUCCEEDED",
      actual_target_node: "hermes-node",
      execution_authorized: true,
      dispatch_performed: true,
      scheduler_activated: false,
      autonomous_dispatch: false,
      silent_replacement: false,
      external_provider_accessed: false,
      remote_systems_modified: false,
      shell_executed: false,
      runtime_lease_released: true,
      output: { expected_marker_observed: true },
    })
    expect(result.result_sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    ["unadmitted model", (value: any) => { value.input.model = "unreviewed:latest" }, "MODEL_NOT_ALLOWED"],
    ["resource ceiling", (value: any) => { value.limits.timeout_ms = 60001 }, "RESOURCE_CEILING_EXCEEDED"],
    ["Forge mismatch", (value: any) => { value.forge.permission_set_sha256 = "f".repeat(64) }, "FORGE_PERMISSION_MISMATCH"],
    ["scope drift", (value: any) => { value.input.prompt = "Return HERMES_PHASE3_CHANGED." }, "AUTHORITY_SCOPE_MISMATCH"],
  ])("blocks %s", (_name, mutate, code) => {
    const value = fixture()
    mutate(value.request)
    expect(prepareResidentHermesBoundedDispatch({
      ...value,
      evaluatedAt: "2026-08-10T15:21:00.000Z",
    })).toMatchObject({ status: "BLOCKED", reasons: [{ code }] })
  })

  it("blocks stale placement evidence", () => {
    const value = fixture()
    expect(prepareResidentHermesBoundedDispatch({
      ...value,
      evaluatedAt: "2026-08-10T15:25:51.000Z",
    })).toMatchObject({ status: "BLOCKED", reasons: [{ code: "PLACEMENT_STALE" }] })
  })

  it("does not invoke after a failed single-use claim", async () => {
    const value = fixture()
    let invoked = false
    await expect(executeResidentHermesBoundedDispatch({
      ...value,
      ...runtimeLease(),
      clock: () => "2026-08-10T15:21:00.000Z",
      claimSingleUse: async () => ({
        claimed: false,
        claim_id: "claim-phase3-hermes-001",
        claimed_at: "2026-08-10T15:21:00.000Z",
      }),
      invokeLoopbackModel: async () => { invoked = true; return "HERMES_PHASE3_OK" },
      captureResourceObservations: async () => [],
    })).rejects.toThrow("REQUEST_ALREADY_CONSUMED")
    expect(invoked).toBe(false)
  })

  it("consumes the request but does not invoke when resident concurrency is occupied", async () => {
    const value = fixture()
    let invoked = false
    let released = false
    await expect(executeResidentHermesBoundedDispatch({
      ...value,
      clock: () => "2026-08-10T15:21:00.000Z",
      claimSingleUse: async () => ({
        claimed: true,
        claim_id: "claim-phase3-hermes-concurrency",
        claimed_at: "2026-08-10T15:21:00.000Z",
      }),
      acquireExclusiveRuntimeLease: async () => ({
        acquired: false,
        lease_id: "lease-phase3-hermes-occupied",
        acquired_at: "2026-08-10T15:21:00.000Z",
      }),
      releaseExclusiveRuntimeLease: async () => { released = true; return true },
      invokeLoopbackModel: async () => { invoked = true; return "HERMES_PHASE3_OK" },
      captureResourceObservations: async () => [],
    })).rejects.toThrow("CONCURRENCY_LIMIT_REACHED")
    expect(invoked).toBe(false)
    expect(released).toBe(false)
  })

  it("rejects unknown executable fields and missing result markers", async () => {
    const unsafe = fixture()
    ;(unsafe.request.input as any).command = "do something"
    expect(prepareResidentHermesBoundedDispatch({
      ...unsafe,
      evaluatedAt: "2026-08-10T15:21:00.000Z",
    })).toMatchObject({ status: "BLOCKED" })

    const value = fixture()
    const times = [
      "2026-08-10T15:21:00.000Z",
      "2026-08-10T15:21:00.200Z",
    ]
    const failure = executeResidentHermesBoundedDispatch({
      ...value,
      ...runtimeLease(),
      clock: () => times.shift()!,
      claimSingleUse: async () => ({
        claimed: true,
        claim_id: "claim-phase3-hermes-002",
        claimed_at: "2026-08-10T15:21:00.100Z",
      }),
      invokeLoopbackModel: async () => "wrong result",
      captureResourceObservations: async () => [],
    })
    await expect(failure).rejects.toMatchObject({
      message: expect.stringContaining("EXPECTED_MARKER_MISSING"),
      dispatchAttempted: true,
      runtimeLeaseReleased: true,
      outputEvidence: {
        sha256: sha256(Buffer.from("wrong result", "utf8")),
        byte_length: 12,
        expected_marker: "HERMES_PHASE3_OK",
        expected_marker_observed: false,
      },
    })
  })

  it("retains the genuine first production attempt as consumed fail-closed evidence", () => {
    const retainedRoot = path.join(process.cwd(), "docs/reports/bounded-dispatch")
    const receiptBytes = fs.readFileSync(path.join(retainedRoot, "WO-EF-DISPATCH-001-receipt.json"))
    const retainedRequest = JSON.parse(fs.readFileSync(
      path.join(retainedRoot, "WO-EF-DISPATCH-001-request.json"), "utf8",
    ))
    const retainedClaim = JSON.parse(fs.readFileSync(
      path.join(retainedRoot, "WO-EF-DISPATCH-001-claim.json"), "utf8",
    ))
    const retainedResult = JSON.parse(fs.readFileSync(
      path.join(retainedRoot, "WO-EF-DISPATCH-001-result.json"), "utf8",
    ))
    expect(sha256(receiptBytes)).toBe("3b8d11da2c42289381aa7fd8793fad239f10dd48564af43fdb97099ac3987375")
    expect(retainedRequest.placement_receipt_sha256).toBe(sha256(receiptBytes))
    expect(retainedClaim).toMatchObject({
      request_sha256: sha256(canonicalizeJcs(retainedRequest)),
      authority_reference: retainedRequest.authority_reference,
      maximum_attempts: 1,
    })
    const claimWithoutDigest = structuredClone(retainedClaim)
    delete claimWithoutDigest.claim_sha256
    expect(retainedClaim.claim_sha256).toBe(sha256(canonicalizeJcs(claimWithoutDigest)))
    expect(retainedResult).toMatchObject({
      status: "FAILED_CLOSED",
      claim_id: `claim-${retainedClaim.claim_sha256.slice(0, 24)}`,
      dispatch_attempted: true,
      runtime_lease_released: true,
      dispatch_allowed: false,
      scheduler_activated: false,
      autonomous_dispatch: false,
      silent_replacement: false,
    })
  })
})
