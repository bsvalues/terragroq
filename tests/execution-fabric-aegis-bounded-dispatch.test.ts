import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  executeAegisHashVerify,
  prepareAegisHashVerify,
} from "../scripts/execution-fabric/bounded-dispatch/aegis-hash-verify.mjs"

type Json = Record<string, any>
const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex")
const configPaths = [
  "config/execution-fabric/aegis-bounded-dispatch-templates.json",
  "config/execution-fabric/agent-forge-aegis-bounded-hash-verify-permission.json",
  "config/execution-fabric/aegis-resident-identity.json",
  "config/execution-fabric/aegis-bounded-dispatch-work-order.json",
]

function receipt(overrides: Json = {}) {
  return {
    schema_version: "0.2-pinned-placement-recommendation",
    status: "RECOMMENDED",
    recommendation_only: true,
    eligibility_scope: "recommendation-only",
    evaluated_at: "2026-08-10T08:00:00.000Z",
    workload: { id: "cpu-heavy-build", title: "CPU-heavy build", storage_semantics: "scratch-only" },
    scheduler: { state: "disabled", authority: "not-granted", autonomous_dispatch: "forbidden" },
    recommendation: {
      node_id: "aegis", rank: 1, rank_basis: { stable_node_id: "aegis" },
      execution_authorized: false, dispatch_allowed: false,
    },
    eligible_nodes: [{
      node_id: "aegis", eligible: true, rank: 1, rank_basis: { stable_node_id: "aegis" },
      reasons: [], evidence_used: [], confidence: "observed",
      freshness: { state: "fresh", expires_at: "2026-08-10T08:10:00.000Z" },
      execution_authorized: false, dispatch_allowed: false,
    }],
    ineligible_nodes: [],
    confidence: { state: "observed", freshness: "fresh", registry_freshness: "fresh" },
    placement_policy_version: "execution-fabric-placement/0.2",
    evidence_snapshot: [
      { node: "aegis", snapshot_sha256: "2".repeat(64) },
      { node: "atlas", snapshot_sha256: "3".repeat(64) },
      { node: "hermes-node", snapshot_sha256: "4".repeat(64) },
    ],
    evidence_verifier: { contract: "jcs-rfc8785/1", sha256: "5".repeat(64), result: "PASS" },
    input_artifacts: { registry_base_sha256: "6".repeat(64) },
    decision_input_sha256: "1".repeat(64),
    authority_mutated: false,
    remote_systems_modified: false,
    ...overrides,
  }
}

function placementProof({ receiptSha256, receipt: value }: Json) {
  return {
    schema_version: "0.1-trusted-pinned-placement-proof",
    receipt_sha256: receiptSha256,
    semantic_replay_sha256: sha(Buffer.from(canonicalizeJcs(value))),
    evidence_count: value.evidence_snapshot.length,
    verified: true,
  }
}

function forgeProof({ permissionSha256, templateRegistrySha256, identityRegistrySha256, workOrderSha256 }: Json) {
  return {
    schema_version: "0.1-trusted-aegis-forge-proof",
    trusted_ref: "refs/heads/main",
    permission_sha256: permissionSha256,
    template_registry_sha256: templateRegistrySha256,
    identity_registry_sha256: identityRegistrySha256,
    work_order_sha256: workOrderSha256,
    exact_template_count: 1,
    verified: true,
  }
}

function identity(overrides: Json = {}) {
  return {
    node_id: "aegis",
    hostname: "aegis",
    machine_id_sha256: "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b",
    agent_identity: "resident-aegis",
    provider_identity: "resident-aegis",
    ...overrides,
  }
}

function authorityProof({ registrySha256, authority, scopeSha256, scopeArtifactSha256 }: Json) {
  return {
    schema_version: "0.1-trusted-aegis-authority-proof",
    trusted_ref: "refs/heads/main",
    registry_sha256: registrySha256,
    authority_reference: authority.reference,
    producer_identity: authority.producer_identity,
    reviewer_identity: authority.reviewer_identity,
    execution_commit: authority.execution_commit,
    authority_reviewed_commit: authority.reviewed_commit,
    strict_after_commit: authority.execution_commit,
    review_commit_is_strict_descendant: true,
    scope_sha256: scopeSha256,
    scope_artifact_sha256: scopeArtifactSha256,
    exact_entry_count: 1,
  }
}

function fixture({ authority = true, input = Buffer.from("AEGIS exact hash bytes\n") } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-bounded-dispatch-"))
  const repositoryRoot = path.join(root, "repo")
  const stagingRoot = path.join(repositoryRoot, "docs", "reports", "bounded-dispatch", "aegis-inputs")
  fs.mkdirSync(repositoryRoot)
  fs.mkdirSync(stagingRoot, { recursive: true })
  for (const relative of configPaths) {
    const destination = path.join(repositoryRoot, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(process.cwd(), relative), destination)
  }
  const inputPath = path.join(stagingRoot, "approved", "input.bin")
  fs.mkdirSync(path.dirname(inputPath), { recursive: true })
  fs.writeFileSync(inputPath, input)
  const permissionBytes = fs.readFileSync(path.join(repositoryRoot, configPaths[1]))
  const templateBytes = fs.readFileSync(path.join(repositoryRoot, configPaths[0]))
  const identityBytes = fs.readFileSync(path.join(repositoryRoot, configPaths[2]))
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt())}\n`)
  const request = {
    schema_version: "0.1-aegis-hash-verify-request",
    request_id: "aegis-hash-request-001",
    work_order_id: "WO-EF-DISPATCH-AEGIS-001",
    template_id: "aegis.hash-verify.v1",
    placement_receipt_sha256: sha(receiptBytes),
    input: {
      relative_path: "approved/input.bin",
      expected_sha256: sha(input),
      expected_byte_length: input.length,
    },
    limits: { max_input_bytes: 1048576, timeout_ms: 30000 },
    forge: { permission_set_sha256: sha(permissionBytes), template_registry_sha256: sha(templateBytes) },
    authority_reference: "issue-538-aegis-hash-test-001",
  }
  const scope = {
    work_order_id: request.work_order_id,
    template_id: request.template_id,
    selected_node_id: "aegis",
    input: { ...request.input },
    limits: { ...request.limits },
    forge: { ...request.forge },
    identity_registry_sha256: sha(identityBytes),
    machine_id_sha256: identity().machine_id_sha256,
    producer_identity: "resident-aegis",
    reviewer_identity: "independent-assurance",
    staging_root_id: "docs/reports/bounded-dispatch/aegis-inputs",
    maximum_attempts: 1,
  }
  const scopeSha256 = sha(Buffer.from(canonicalizeJcs(scope)))
  const scopePath = "config/execution-fabric/aegis-bounded-dispatch-authority-scopes/WO-EF-DISPATCH-AEGIS-001.json"
  const scopeArtifact = {
    schema_version: "0.1-aegis-bounded-dispatch-authority-scope",
    reference: request.authority_reference,
    work_order_id: request.work_order_id,
    template_id: request.template_id,
    selected_node_id: "aegis",
    scope_sha256: scopeSha256,
    staging_root_id: "docs/reports/bounded-dispatch/aegis-inputs",
    relative_path: request.input.relative_path,
    expected_sha256: request.input.expected_sha256,
    expected_byte_length: request.input.expected_byte_length,
    max_input_bytes: request.limits.max_input_bytes,
    timeout_ms: request.limits.timeout_ms,
    permission_set_sha256: request.forge.permission_set_sha256,
    template_registry_sha256: request.forge.template_registry_sha256,
    identity_registry_sha256: sha(identityBytes),
    machine_id_sha256: identity().machine_id_sha256,
    producer_identity: "resident-aegis",
    reviewer_identity: "independent-assurance",
    execution_commit: "a".repeat(40),
    review_commit: "b".repeat(40),
    maximum_attempts: 1,
    risk_class: "R1",
    prohibited_actions: [
      "arbitrary-shell", "autonomous-scheduling", "authority-mutation", "external-provider-access",
      "network-access", "remote-node-access", "silent-replacement", "workload-storage-write",
    ],
    status: "REVIEWED_NON_ACTIVE_SCOPE",
  }
  const scopeBytes = Buffer.from(JSON.stringify(scopeArtifact))
  const scopeDestination = path.join(repositoryRoot, scopePath)
  fs.mkdirSync(path.dirname(scopeDestination), { recursive: true })
  fs.writeFileSync(scopeDestination, scopeBytes)
  const entries = authority ? [{
    reference: request.authority_reference,
    work_order_id: request.work_order_id,
    template_id: request.template_id,
    selected_node_id: "aegis",
    scope_sha256: scopeSha256,
    valid_from: "2026-08-10T08:00:00.000Z",
    expires_at: "2026-08-10T08:20:00.000Z",
    maximum_attempts: 1,
    producer_identity: "resident-aegis",
    reviewer_identity: "independent-assurance",
    execution_commit: "a".repeat(40),
    scope_path: scopePath,
    scope_artifact_sha256: sha(scopeBytes),
    reviewed_commit: "b".repeat(40),
    status: "ACTIVE",
  }] : []
  fs.writeFileSync(path.join(
    repositoryRoot, "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json",
  ), JSON.stringify({
    schema_version: "0.1-aegis-bounded-dispatch-authority-registry",
    registry_id: "execution-fabric-aegis-bounded-dispatch-authorities",
    entries,
  }))
  return {
    repositoryRoot,
    stagingRoot,
    inputPath,
    originalInput: Buffer.from(input),
    receiptBytes,
    request,
    evaluatedAt: "2026-08-10T08:01:00.000Z",
    proveTrustedPlacement: placementProof,
    proveTrustedForge: forgeProof,
    trustedResidentIdentity: () => identity(),
    proveTrustedAuthority: authorityProof,
  }
}

function runtime(value: Json, overrides: Json = {}) {
  const times = [
    "2026-08-10T08:01:00.000Z", "2026-08-10T08:01:01.000Z",
    "2026-08-10T08:01:02.000Z", "2026-08-10T08:01:03.000Z",
  ]
  return {
    ...value,
    clock: () => times.shift()!,
    claimSingleUse: vi.fn(async () => ({
      claimed: true, claim_id: "claim-aegis-hash-001", claimed_at: "2026-08-10T08:01:00.100Z",
    })),
    acquireExclusiveLease: vi.fn(async () => ({
      acquired: true, lease_id: "lease-aegis-hash-001", acquired_at: "2026-08-10T08:01:00.200Z",
    })),
    releaseExclusiveLease: vi.fn(async () => true),
    ...overrides,
  }
}

function authorityFiles(value: Json) {
  const registryPath = path.join(
    value.repositoryRoot, "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json",
  )
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
  const scopePath = path.join(value.repositoryRoot, registry.entries[0].scope_path)
  const scope = JSON.parse(fs.readFileSync(scopePath, "utf8"))
  return { registryPath, registry, scopePath, scope }
}

describe("AEGIS bounded HASH_VERIFY adapter", () => {
  it("keeps production non-active while the separate authority registry is empty", () => {
    const value = fixture()
    fs.copyFileSync(
      path.join(process.cwd(), "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json"),
      path.join(value.repositoryRoot, "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json"),
    )
    const result = prepareAegisHashVerify(value)
    expect(result).toMatchObject({
      status: "BLOCKED",
      operational_state: "BLOCKED_AUTHORITY",
      reasons: [{ code: "AUTHORITY_NOT_ADMITTED" }],
      execution_authorized: false,
      operation_allowed: false,
      safety: { scheduler_activated: false, remote_accessed: false, output_storage_modified: false },
    })
  })

  it("prepares only exact AEGIS identity, placement, Forge, input, and test authority", () => {
    const value = fixture()
    expect(prepareAegisHashVerify(value)).toMatchObject({
      status: "READY_FOR_SINGLE_USE_LOCAL_HASH",
      selected_node_id: "aegis",
      template_id: "aegis.hash-verify.v1",
      maximum_attempts: 1,
      operation_allowed: true,
      safety: { dispatch_performed: false, network_accessed: false, workload_storage_modified: false },
    })
  })

  it("rejects wrong host and machine identity before authority use", () => {
    for (const changed of [identity({ hostname: "not-aegis" }), identity({ machine_id_sha256: "f".repeat(64) })]) {
      const value = fixture()
      const proof = vi.fn(authorityProof)
      const result = prepareAegisHashVerify({ ...value, trustedResidentIdentity: () => changed, proveTrustedAuthority: proof })
      expect(result).toMatchObject({ status: "BLOCKED", reasons: [{ code: "IDENTITY_MISMATCH" }] })
      expect(proof).not.toHaveBeenCalled()
    }
  })

  it("reports resident provider unavailability without consulting authority", () => {
    const value = fixture()
    const proof = vi.fn(authorityProof)
    const result = prepareAegisHashVerify({
      ...value, trustedResidentIdentity: undefined, proveTrustedAuthority: proof,
    })
    expect(result).toMatchObject({
      status: "BLOCKED", operational_state: "BLOCKED_NO_ELIGIBLE_PROVIDER",
      reasons: [{ code: "PROVIDER_UNAVAILABLE" }],
    })
    expect(proof).not.toHaveBeenCalled()
  })

  it("rejects stale and misplaced receipts", () => {
    const stale = fixture()
    expect(prepareAegisHashVerify({ ...stale, evaluatedAt: "2026-08-10T08:10:00.000Z" }))
      .toMatchObject({ status: "BLOCKED", reasons: [{ code: "EVIDENCE_STALE" }] })

    const misplaced = fixture()
    const changed = receipt({
      recommendation: { node_id: "hermes-node", rank: 1, rank_basis: { stable_node_id: "hermes-node" }, execution_authorized: false, dispatch_allowed: false },
      eligible_nodes: [{
        node_id: "hermes-node", eligible: true, rank: 1, rank_basis: { stable_node_id: "hermes-node" }, reasons: [], evidence_used: [], confidence: "observed",
        freshness: { state: "fresh", expires_at: "2026-08-10T08:10:00.000Z" }, execution_authorized: false, dispatch_allowed: false,
      }],
    })
    misplaced.receiptBytes = Buffer.from(`${JSON.stringify(changed)}\n`)
    misplaced.request.placement_receipt_sha256 = sha(misplaced.receiptBytes)
    expect(prepareAegisHashVerify(misplaced)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "PLACEMENT_MISMATCH" }] })
  })

  it("rejects traversal, absolute paths, parent links, and final links", () => {
    for (const changedPath of ["../outside.bin", path.resolve(os.tmpdir(), "outside.bin"), "C:\\outside.bin"]) {
      const value = fixture()
      value.request.input.relative_path = changedPath
      expect(prepareAegisHashVerify(value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "PATH_ESCAPE" }] })
    }
    for (const parentLink of [true, false]) {
      const value = fixture()
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-hash-outside-"))
      fs.writeFileSync(path.join(outside, "input.bin"), value.originalInput)
      if (parentLink) {
        fs.rmSync(path.join(value.stagingRoot, "approved"), { recursive: true })
        fs.symlinkSync(outside, path.join(value.stagingRoot, "approved"), process.platform === "win32" ? "junction" : "dir")
      } else {
        fs.rmSync(value.inputPath)
        fs.symlinkSync(path.join(outside, "input.bin"), value.inputPath, "file")
      }
      expect(prepareAegisHashVerify(value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "PATH_ESCAPE" }] })
    }
  })

  it("rejects oversized and non-regular inputs before consuming a claim", async () => {
    const oversizedOperation = runtime(fixture({ input: Buffer.alloc(1048577, 0x41) }))
    const oversizedError = await executeAegisHashVerify(oversizedOperation).catch((caught) => caught)
    expect(oversizedError).toMatchObject({
      message: expect.stringContaining("INPUT_INVALID"),
      claimConsumed: false, operationAttempted: false,
    })
    expect(oversizedOperation.claimSingleUse).not.toHaveBeenCalled()

    const nonRegular = fixture()
    fs.rmSync(nonRegular.inputPath)
    fs.mkdirSync(nonRegular.inputPath)
    const nonRegularOperation = runtime(nonRegular)
    const nonRegularError = await executeAegisHashVerify(nonRegularOperation).catch((caught) => caught)
    expect(nonRegularError).toMatchObject({
      message: expect.stringContaining("INPUT_INVALID"),
      claimConsumed: false, operationAttempted: false,
    })
    expect(nonRegularOperation.claimSingleUse).not.toHaveBeenCalled()
  })

  it("fails closed when exact authority is missing or unproven", () => {
    expect(prepareAegisHashVerify(fixture({ authority: false })))
      .toMatchObject({ status: "BLOCKED", reasons: [{ code: "AUTHORITY_NOT_ADMITTED" }] })
    const forged = fixture()
    expect(prepareAegisHashVerify({
      ...forged,
      proveTrustedAuthority: ({ registrySha256, authority, scopeSha256, scopeArtifactSha256 }: Json) => ({
        ...authorityProof({ registrySha256, authority, scopeSha256, scopeArtifactSha256 }), verified: true,
      }),
    })).toMatchObject({ status: "BLOCKED" })
  })

  it("rejects self-review and a forged strict commit-order proof", () => {
    const selfReviewed = fixture()
    const files = authorityFiles(selfReviewed)
    files.registry.entries[0].reviewer_identity = "resident-aegis"
    fs.writeFileSync(files.registryPath, JSON.stringify(files.registry))
    expect(prepareAegisHashVerify(selfReviewed)).toMatchObject({
      status: "BLOCKED", reasons: [{ code: "AUTHORITY_SCOPE_MISMATCH" }],
    })

    const unordered = fixture()
    expect(prepareAegisHashVerify({
      ...unordered,
      proveTrustedAuthority: (args: Json) => ({
        ...authorityProof(args), review_commit_is_strict_descendant: false,
      }),
    })).toMatchObject({ status: "BLOCKED", reasons: [{ code: "AUTHORITY_UNPROVEN" }] })
  })

  it("rejects reviewed scope identity and Forge proof tampering", () => {
    const identityTampered = fixture()
    const files = authorityFiles(identityTampered)
    files.scope.identity_registry_sha256 = "f".repeat(64)
    const changedScopeBytes = Buffer.from(JSON.stringify(files.scope))
    fs.writeFileSync(files.scopePath, changedScopeBytes)
    files.registry.entries[0].scope_artifact_sha256 = sha(changedScopeBytes)
    fs.writeFileSync(files.registryPath, JSON.stringify(files.registry))
    expect(prepareAegisHashVerify(identityTampered)).toMatchObject({
      status: "BLOCKED", reasons: [{ code: "AUTHORITY_SCOPE_MISMATCH" }],
    })

    const forgeTampered = fixture()
    expect(prepareAegisHashVerify({
      ...forgeTampered,
      proveTrustedForge: (args: Json) => ({ ...forgeProof(args), permission_sha256: "f".repeat(64) }),
    })).toMatchObject({ status: "BLOCKED", reasons: [{ code: "FORGE_UNPROVEN" }] })
  })

  it("hashes exact bytes once and returns canonical evidence without modifying input or output storage", async () => {
    const value = fixture()
    const residentIdentity = vi.fn(() => identity())
    const operation = runtime({ ...value, trustedResidentIdentity: residentIdentity })
    const result = await executeAegisHashVerify(operation)
    expect(result).toMatchObject({
      status: "COMPLETED",
      result: "VERIFIED",
      actual_target_node: "aegis",
      adapter_id: "resident-aegis-hash-verify-v1",
      operation_performed: true,
      operation: {
        kind: "HASH_VERIFY", relative_path: "approved/input.bin",
        byte_length: value.originalInput.length, observed_sha256: sha(value.originalInput), matched: true,
      },
      safety: {
        dispatch_performed: true, scheduler_activated: false, network_accessed: false,
        workload_storage_modified: false, output_storage_modified: false, fallback_used: false,
      },
    })
    expect(result.evidence_sha256).toMatch(/^[a-f0-9]{64}$/)
    const { evidence_sha256: evidenceSha256, ...unsignedEvidence } = result
    expect(evidenceSha256).toBe(sha(Buffer.from(`${canonicalizeJcs(unsignedEvidence)}\n`)))
    expect(result).toMatchObject({
      runtime_lease_released: true,
      resource_observation: {
        metric: "input_bytes_hashed", unit: "bytes", value: value.originalInput.length,
        observed_at: "2026-08-10T08:01:03.000Z",
      },
    })
    expect(fs.readFileSync(value.inputPath)).toEqual(value.originalInput)
    expect(residentIdentity).toHaveBeenCalledTimes(2)
    expect(operation.claimSingleUse).toHaveBeenCalledTimes(1)
    expect(operation.acquireExclusiveLease).toHaveBeenCalledTimes(1)
    expect(operation.releaseExclusiveLease).toHaveBeenCalledTimes(1)
  })

  it("emits bounded mismatch evidence for a wrong expected digest", async () => {
    const value = fixture()
    value.request.input.expected_sha256 = "f".repeat(64)
    const identityBytes = fs.readFileSync(path.join(value.repositoryRoot, configPaths[2]))
    const scope = {
      work_order_id: value.request.work_order_id, template_id: value.request.template_id, selected_node_id: "aegis",
      input: { ...value.request.input }, limits: { ...value.request.limits }, forge: { ...value.request.forge },
      identity_registry_sha256: sha(identityBytes), machine_id_sha256: identity().machine_id_sha256, maximum_attempts: 1,
      staging_root_id: "docs/reports/bounded-dispatch/aegis-inputs",
      producer_identity: "resident-aegis", reviewer_identity: "independent-assurance",
    }
    const registryPath = path.join(value.repositoryRoot, "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json")
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
    registry.entries[0].scope_sha256 = sha(Buffer.from(canonicalizeJcs(scope)))
    const scopePath = path.join(value.repositoryRoot, registry.entries[0].scope_path)
    const scopeArtifact = JSON.parse(fs.readFileSync(scopePath, "utf8"))
    scopeArtifact.scope_sha256 = registry.entries[0].scope_sha256
    scopeArtifact.expected_sha256 = value.request.input.expected_sha256
    const scopeBytes = Buffer.from(JSON.stringify(scopeArtifact))
    fs.writeFileSync(scopePath, scopeBytes)
    registry.entries[0].scope_artifact_sha256 = sha(scopeBytes)
    fs.writeFileSync(registryPath, JSON.stringify(registry))
    const result = await executeAegisHashVerify(runtime(value))
    expect(result).toMatchObject({
      status: "FAILED_CLOSED", result: "HASH_MISMATCH",
      operation: { expected_sha256: "f".repeat(64), observed_sha256: sha(value.originalInput), matched: false },
    })
  })

  it("consumes the claim but never reads when exclusive AEGIS concurrency is occupied", async () => {
    const value = fixture()
    const operation = runtime(value, {
      acquireExclusiveLease: vi.fn(async () => ({
        acquired: false, lease_id: "lease-aegis-occupied", acquired_at: "2026-08-10T08:01:00.200Z",
      })),
    })
    const error = await executeAegisHashVerify(operation).catch((caught) => caught)
    expect(error).toMatchObject({
      message: expect.stringContaining("CONCURRENCY_LIMIT_REACHED"),
      claimConsumed: true, leaseAcquired: false, operationAttempted: false,
      releaseAttempted: false, runtimeLeaseReleased: false,
    })
    expect(operation.claimSingleUse).toHaveBeenCalledTimes(1)
    expect(operation.releaseExclusiveLease).not.toHaveBeenCalled()
  })

  it("fails a previously consumed request before lease or operation", async () => {
    const value = fixture()
    const operation = runtime(value, {
      claimSingleUse: vi.fn(async () => ({
        claimed: false, claim_id: "claim-aegis-hash-consumed", claimed_at: "2026-08-10T08:01:00.100Z",
      })),
    })
    const error = await executeAegisHashVerify(operation).catch((caught) => caught)
    expect(error).toMatchObject({
      message: expect.stringContaining("REQUEST_ALREADY_CONSUMED"),
      claimConsumed: false, leaseAcquired: false, operationAttempted: false,
      releaseAttempted: false, runtimeLeaseReleased: false,
    })
    expect(operation.acquireExclusiveLease).not.toHaveBeenCalled()
  })

  it("rechecks trust after claim and releases the lease on drift without hashing", async () => {
    const value = fixture()
    const residentIdentity = vi.fn()
      .mockReturnValueOnce(identity())
      .mockReturnValueOnce(identity({ hostname: "not-aegis" }))
    const operation = runtime({ ...value, trustedResidentIdentity: residentIdentity })
    const error = await executeAegisHashVerify(operation).catch((caught) => caught)
    expect(error).toMatchObject({
      message: expect.stringContaining("IDENTITY_MISMATCH"),
      claimConsumed: true, leaseAcquired: true, operationAttempted: false,
      releaseAttempted: true, runtimeLeaseReleased: true,
    })
    expect(operation.releaseExclusiveLease).toHaveBeenCalledTimes(1)
  })

  it("rechecks receipt freshness and authority bytes after the claim", async () => {
    const stale = fixture()
    const staleTimes = ["2026-08-10T08:01:00.000Z", "2026-08-10T08:10:00.000Z"]
    const staleOperation = runtime(stale, { clock: () => staleTimes.shift()! })
    const staleError = await executeAegisHashVerify(staleOperation).catch((caught) => caught)
    expect(staleError).toMatchObject({
      message: expect.stringContaining("EVIDENCE_STALE"), claimConsumed: true,
      leaseAcquired: true, operationAttempted: false, runtimeLeaseReleased: true,
    })

    const changed = fixture()
    let identityCalls = 0
    const changedOperation = runtime({
      ...changed,
      trustedResidentIdentity: () => {
        identityCalls += 1
        if (identityCalls === 2) {
          const files = authorityFiles(changed)
          files.registry.entries[0].status = "REVOKED"
          fs.writeFileSync(files.registryPath, JSON.stringify(files.registry))
        }
        return identity()
      },
    })
    const changedError = await executeAegisHashVerify(changedOperation).catch((caught) => caught)
    expect(changedError).toMatchObject({
      message: expect.stringContaining("AUTHORITY_SCOPE_MISMATCH"), claimConsumed: true,
      leaseAcquired: true, operationAttempted: false, runtimeLeaseReleased: true,
    })
  })

  it("rejects reversed claim, lease, and post-claim preflight chronology", async () => {
    const leaseBeforeClaim = fixture()
    const leaseBeforeClaimOperation = runtime(leaseBeforeClaim, {
      acquireExclusiveLease: vi.fn(async () => ({
        acquired: true, lease_id: "lease-aegis-before-claim", acquired_at: "2026-08-10T08:01:00.050Z",
      })),
    })
    const leaseError = await executeAegisHashVerify(leaseBeforeClaimOperation).catch((caught) => caught)
    expect(leaseError).toMatchObject({
      message: expect.stringContaining("LEASE_CHRONOLOGY_INVALID"),
      claimConsumed: true, leaseAcquired: true, operationAttempted: false,
      releaseAttempted: true, runtimeLeaseReleased: true,
    })
    expect(leaseBeforeClaimOperation.releaseExclusiveLease).toHaveBeenCalledTimes(1)

    const preflightBeforeLease = fixture()
    const preflightTimes = ["2026-08-10T08:01:00.000Z", "2026-08-10T08:01:00.150Z"]
    const preflightOperation = runtime(preflightBeforeLease, { clock: () => preflightTimes.shift()! })
    const preflightError = await executeAegisHashVerify(preflightOperation).catch((caught) => caught)
    expect(preflightError).toMatchObject({
      message: expect.stringContaining("PREFLIGHT_CHRONOLOGY_INVALID"),
      claimConsumed: true, leaseAcquired: true, operationAttempted: false,
      releaseAttempted: true, runtimeLeaseReleased: true,
    })
    expect(preflightOperation.releaseExclusiveLease).toHaveBeenCalledTimes(1)
  })

  it("detects an input inode swap between preflight and descriptor acquisition", async () => {
    const value = fixture()
    const originalOpen = fs.openSync.bind(fs)
    let swapped = false
    const openSpy = vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, flags: any, mode?: any) => {
      if (!swapped && path.resolve(String(target)) === path.resolve(value.inputPath)) {
        swapped = true
        const replacement = path.join(path.dirname(value.inputPath), "replacement.bin")
        fs.writeFileSync(replacement, value.originalInput)
        fs.renameSync(replacement, value.inputPath)
      }
      return originalOpen(target, flags, mode)
    }) as typeof fs.openSync)
    try {
      const operation = runtime(value)
      const error = await executeAegisHashVerify(operation).catch((caught) => caught)
      expect(error).toMatchObject({
        message: expect.stringContaining("INPUT_CHANGED"), claimConsumed: true,
        leaseAcquired: true, operationAttempted: true, runtimeLeaseReleased: true,
      })
      expect(operation.releaseExclusiveLease).toHaveBeenCalledTimes(1)
    } finally {
      openSpy.mockRestore()
    }
  })

  it("attempts lease release only once when release fails", async () => {
    const value = fixture()
    const releaseExclusiveLease = vi.fn(async () => false)
    const operation = runtime(value, { releaseExclusiveLease })
    const error = await executeAegisHashVerify(operation).catch((caught) => caught)
    expect(error).toMatchObject({
      message: expect.stringContaining("LEASE_RELEASE_FAILED"),
      claimConsumed: true, leaseAcquired: true, operationAttempted: true,
      releaseAttempted: true, runtimeLeaseReleased: false,
    })
    expect(releaseExclusiveLease).toHaveBeenCalledTimes(1)
  })

  it("fails closed when operation completion exceeds the reviewed timeout", async () => {
    const value = fixture()
    const times = [
      "2026-08-10T08:01:00.000Z", "2026-08-10T08:01:01.000Z",
      "2026-08-10T08:01:02.000Z", "2026-08-10T08:01:32.001Z",
    ]
    const operation = runtime(value, { clock: () => times.shift()! })
    const error = await executeAegisHashVerify(operation).catch((caught) => caught)
    expect(error).toMatchObject({
      message: expect.stringContaining("OPERATION_CHRONOLOGY_INVALID"),
      claimConsumed: true, leaseAcquired: true, operationAttempted: true,
      releaseAttempted: true, runtimeLeaseReleased: true,
    })
    expect(operation.releaseExclusiveLease).toHaveBeenCalledTimes(1)
  })

  it("fails closed when operation completion reaches the authority expiry boundary", async () => {
    const value = fixture()
    const files = authorityFiles(value)
    files.registry.entries[0].expires_at = "2026-08-10T08:01:03.000Z"
    fs.writeFileSync(files.registryPath, JSON.stringify(files.registry))
    const operation = runtime(value)
    const error = await executeAegisHashVerify(operation).catch((caught) => caught)
    expect(error).toMatchObject({
      message: expect.stringContaining("OPERATION_CHRONOLOGY_INVALID"),
      claimConsumed: true, leaseAcquired: true, operationAttempted: true,
      releaseAttempted: true, runtimeLeaseReleased: true,
    })
    expect(operation.releaseExclusiveLease).toHaveBeenCalledTimes(1)
  })

  it("has no network, SSH, GitHub, subprocess, shell, scheduler, registry-write, or fallback implementation", () => {
    const source = fs.readFileSync(path.join(
      process.cwd(), "scripts/execution-fabric/bounded-dispatch/aegis-hash-verify.mjs",
    ), "utf8")
    expect(source).not.toMatch(/node:(?:child_process|net|http|https)|fetch\(|execFile|spawn\(/i)
    expect(source).not.toMatch(/writeFile|appendFile|rename|unlink/)
    expect(source).not.toContain("hermes-node")
    expect(source).not.toContain("scheduler_activated: true")
    expect(source).not.toContain("fallback_used: true")
    expect(source).toContain("fs.constants.O_NOFOLLOW")
  })
})
