import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  authorizeRemoteDevActivation,
  inspectActivationCriticalWorkingFiles,
  inspectControlPlaneTrustedCheckout,
  inspectRemoteDevActivationWindow,
  inspectResidentIdentityBinding,
  inspectResidentNoSudoResult,
  settleRemoteDevActivationState,
  settleRemoteDevActivation,
  validateRemoteDevActivationAuthority,
} from "../scripts/execution-fabric/live/remote-dev-offload-activation.mjs"

const root = process.cwd()
const authorityPath = path.join(root, "config/execution-fabric/remote-dev-offload-v1-activation.json")
const authority = () => JSON.parse(fs.readFileSync(authorityPath, "utf8"))
const fabricatedClaimId = "claim-766b694bc86df27f564d5adb"

function candidate() {
  const value = authority()
  return {
    runId: value.run.runId,
    workOrderId: value.workOrderId,
    issue: value.issue,
    repository: value.target.repository,
    baseRef: value.target.baseRef,
    baseSha: value.trustedMain.target.pinnedCommit,
    nodeId: value.target.nodeId,
    workspace: value.target.workspace,
    branch: value.target.branch,
    operations: value.operations,
    resources: value.resources,
    network: value.network,
    executionIdentity: value.executionIdentity,
  }
}

function settlement() {
  const value = authority()
  return {
    runId: value.run.runId,
    claimId: fabricatedClaimId,
    leaseId: "lease-56b41a963bbf4c80907bd37d",
    release: {
      provider: "createLedgerProviders",
      released: true,
      runId: value.run.runId,
      claimId: fabricatedClaimId,
      leaseId: "lease-56b41a963bbf4c80907bd37d",
      releaseSha256: "2".repeat(64),
    },
    replay: {
      provider: "createLedgerProviders",
      status: "REPLAY_REJECTED",
      rejectionCode: "REQUEST_ALREADY_CONSUMED",
      runId: value.run.runId,
      claimId: fabricatedClaimId,
      authorityReference: value.authorityReference,
      operationAttempted: false,
      replaySha256: "3".repeat(64),
    },
  }
}

const now = "2026-08-11T05:00:00.000Z"

describe("TerraFusion remote development one-run activation", () => {
  it("keeps the trusted inactive baseline unable to activate without separate authority", () => {
    expect(validateRemoteDevActivationAuthority(null, candidate())).toMatchObject({
      status: "BLOCKED",
      executionAuthorized: false,
      reasons: [{ code: "REMOTE_DEV_SCOPE_INACTIVE" }],
    })
  })

  it("accepts only the exact future-dated issue #734 authority without authorizing execution", () => {
    expect(validateRemoteDevActivationAuthority(authority(), candidate())).toMatchObject({
      status: "ACTIVATION_AUTHORITY_MATCHED",
      executionAuthorized: false,
      runId: authority().run.runId,
      authorityReference: authority().authorityReference,
      nextGate: "TRUSTED_RUNTIME_PROOFS",
    })
  })

  it.each([
    ["run", (value: any) => { value.runId = "0f8fad5b-d9cb-469f-a165-70867728950e" }, "ACTIVATION_RUN_MISMATCH"],
    ["issue", (value: any) => { value.issue.number = 735 }, "ACTIVATION_SCOPE_MISMATCH"],
    ["repository", (value: any) => { value.repository = "bsvalues/other" }, "ACTIVATION_SCOPE_MISMATCH"],
    ["workspace", (value: any) => { value.workspace += "-other" }, "ACTIVATION_SCOPE_MISMATCH"],
    ["branch", (value: any) => { value.branch += "-other" }, "ACTIVATION_SCOPE_MISMATCH"],
    ["operations", (value: any) => { value.operations.push("ARBITRARY_SHELL") }, "ACTIVATION_SCOPE_MISMATCH"],
    ["resources", (value: any) => { value.resources.cpuThreads = 13 }, "ACTIVATION_SCOPE_MISMATCH"],
    ["network", (value: any) => { value.network.endpoints[0].host = "github.com" }, "ACTIVATION_SCOPE_MISMATCH"],
    ["identity", (value: any) => { value.executionIdentity.account = "bs" }, "ACTIVATION_SCOPE_MISMATCH"],
  ])("rejects %s drift from the single declared run", (_label, mutate, code) => {
    const value = candidate(); mutate(value)
    expect(validateRemoteDevActivationAuthority(authority(), value)).toMatchObject({ status: "BLOCKED", reasons: [{ code }] })
  })

  it("rejects not-yet-valid and expired use", () => {
    expect(inspectRemoteDevActivationWindow(authority(), "2026-08-11T03:59:59.999Z")).toMatchObject({ status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "ACTIVATION_NOT_YET_VALID" }] })
    expect(inspectRemoteDevActivationWindow(authority(), "2026-08-11T08:00:00.000Z")).toMatchObject({ status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "ACTIVATION_EXPIRED" }] })
  })

  it("rejects stale trusted-main artifact bindings and HASH_VERIFY scope reuse", () => {
    const drifted = authority(); drifted.bindings.worker.sha256 = "0".repeat(64)
    expect(validateRemoteDevActivationAuthority(drifted, candidate())).toMatchObject({ status: "BLOCKED", reasons: [{ code: "ACTIVATION_BINDING_DRIFT" }] })
    const reused = authority(); reused.authorityReference = "issue-538-aegis-single-use-hash-001"
    expect(validateRemoteDevActivationAuthority(reused, candidate())).toMatchObject({ status: "BLOCKED", reasons: [{ code: "HASH_SCOPE_REUSE_REJECTED" }] })
    const substituted = authority(); substituted.run.runId = "0f8fad5b-d9cb-469f-a165-70867728950e"
    const substitutedCandidate = candidate(); substitutedCandidate.runId = substituted.run.runId
    expect(validateRemoteDevActivationAuthority(substituted, substitutedCandidate)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "ACTIVATION_BINDING_DRIFT" }] })
  })

  it("separates the trusted control-plane checkout from the pinned TerraFusion target base", () => {
    const value = authority()
    expect(value.trustedMain.controlPlane.repository).toBe("bsvalues/terragroq")
    expect(value.trustedMain.target).toMatchObject({
      repository: "bsvalues/terrafusion_os_1.0",
      ref: "refs/heads/main",
      pinnedCommit: candidate().baseSha,
      freshRemoteEqualityOperation: "CREATE_WORKSPACE",
    })
    expect(inspectControlPlaneTrustedCheckout(value, candidate(), {
      verified: true,
      clean: true,
      trusted_ref: "refs/heads/main",
      head_commit: "b".repeat(40),
    }, () => ({ status: 0 }))).toMatchObject({ status: "CONTROL_PLANE_TRUSTED_MAIN_VERIFIED", executionAuthorized: false })
    const targetDrift = candidate(); targetDrift.baseSha = "c".repeat(40)
    expect(validateRemoteDevActivationAuthority(value, targetDrift)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "TARGET_TRUSTED_MAIN_UNPROVEN" }] })
  })

  it("binds the live resident identity to the reviewed AEGIS machine id", () => {
    const value = authority()
    const reviewed = JSON.parse(fs.readFileSync(path.join(root, value.executionIdentity.reviewedIdentityPath), "utf8"))
    const actual = { node_id: "aegis", hostname: "aegis", machine_id_sha256: reviewed.machine_id_sha256, agent_identity: "resident-aegis", provider_identity: "resident-aegis" }
    expect(inspectResidentIdentityBinding(value, actual, reviewed)).toMatchObject({ status: "RESIDENT_IDENTITY_VERIFIED", executionAuthorized: false })
    expect(inspectResidentIdentityBinding(value, { ...actual, machine_id_sha256: "0".repeat(64) }, reviewed)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "EXECUTION_IDENTITY_UNPROVEN" }] })
  })

  it("compares every activation-critical working file directly with trusted main bytes", () => {
    const value = authority()
    expect(value.trustedMain.controlPlane.criticalPaths).toEqual(expect.arrayContaining([
      "config/execution-fabric/remote-dev-offload-v1-activation.json",
      "scripts/execution-fabric/live/remote-dev-offload-activation.mjs",
      "scripts/execution-fabric/live/aegis-remote-dev-worker.sh",
      "scripts/execution-fabric/live/invoke-remote-dev-offload.ps1",
      "config/execution-fabric/aegis-resident-identity.json",
    ]))
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "activation-trust-"))
    try {
      const trusted = new Map<string, Buffer>()
      for (const relativePath of value.trustedMain.controlPlane.criticalPaths) {
        const bytes = Buffer.from(`trusted:${relativePath}\n`)
        trusted.set(relativePath, bytes)
        const localPath = path.join(fixture, ...relativePath.split("/"))
        fs.mkdirSync(path.dirname(localPath), { recursive: true })
        fs.writeFileSync(localPath, bytes)
      }
      const runGit = (args: string[]) => trusted.get(String(args[1]).replace(/^refs\/heads\/main:/, ""))!
      expect(inspectActivationCriticalWorkingFiles(value, { repositoryRoot: fixture, runGit })).toMatchObject({ status: "ACTIVATION_CRITICAL_FILES_VERIFIED", executionAuthorized: false })
      fs.writeFileSync(path.join(fixture, ...value.trustedMain.controlPlane.criticalPaths[0].split("/")), "substituted\n")
      expect(inspectActivationCriticalWorkingFiles(value, { repositoryRoot: fixture, runGit })).toMatchObject({ status: "BLOCKED", reasons: [{ code: "TRUSTED_MAIN_UNPROVEN" }] })
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true })
    }
  })

  it("fails closed through the actual two-argument authorization API on every platform", async () => {
    const result = await authorizeRemoteDevActivation(authority(), candidate())
    expect(result.status).toBe("BLOCKED")
    expect(result.executionAuthorized).toBe(false)
    expect(result.reasons).toEqual([{ code: expect.any(String), detail: expect.any(String) }])
  })

  it("settles only an opaque module-issued live session, never fabricated release/replay JSON", async () => {
    expect(await settleRemoteDevActivation(settlement())).toMatchObject({
      status: "BLOCKED",
      executionAuthorized: false,
      reasons: [{ code: "ACTIVATION_SESSION_INVALID" }],
    })
  })

  it("reopens settlement after failure and replays the authorization-time scope digest", async () => {
    let releaseAttempts = 0
    let replayAttempts = 0
    const replayScopes: string[] = []
    const state = {
      settling: false,
      leaseReleased: false,
      runId: authority().run.runId,
      claimId: "claim-766b694bc86df27f564d5adb",
      leaseId: "lease-56b41a963bbf4c80907bd37d",
      authorityReference: authority().authorityReference,
      maximumAttempts: authority().resources.maxAttempts,
      requestSha256: "1".repeat(64),
      scopeSha256: "a".repeat(64),
      ledger: {
        releaseExclusiveLease: async () => {
          releaseAttempts += 1
          if (releaseAttempts === 1) throw new Error("transient ledger error")
          return releaseAttempts > 2
        },
        claimSingleUse: async ({ scope_sha256 }: any) => {
          replayAttempts += 1
          replayScopes.push(scope_sha256)
          if (replayAttempts === 1) throw new Error("transient replay error")
          return { claimed: false, claim_id: "claim-766b694bc86df27f564d5adb" }
        },
        runtimeEvidence: () => ({ release_sha256: "2".repeat(64) }),
      },
    }
    expect(await settleRemoteDevActivationState(state)).toMatchObject({ status: "BLOCKED" })
    expect(state.settling).toBe(false)
    expect(await settleRemoteDevActivationState(state)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "ACTIVATION_EVIDENCE_MISMATCH" }] })
    expect(state.settling).toBe(false)
    expect(await settleRemoteDevActivationState(state)).toMatchObject({ status: "BLOCKED" })
    expect(state.settling).toBe(false)
    expect(state.leaseReleased).toBe(true)
    expect(await settleRemoteDevActivationState(state)).toMatchObject({ status: "SETTLEMENT_EVIDENCE_VERIFIED", releaseSha256: "2".repeat(64) })
    expect(releaseAttempts).toBe(3)
    expect(replayScopes).toEqual(["a".repeat(64), "a".repeat(64)])
  })

  it("accepts only the exact fixed resident sudo denial and rejects inconclusive failures", () => {
    expect(inspectResidentNoSudoResult({ status: 1, signal: null, errorCode: null, stdout: "", stderr: "Sorry, user williamos-fabric may not run sudo on aegis.\n" })).toMatchObject({ status: "NO_SUDO_VERIFIED", executionAuthorized: false })
    for (const evidence of [
      { status: 1, signal: null, errorCode: null, stdout: "", stderr: "sudo: a password is required\n" },
      { status: 1, signal: null, errorCode: null, stdout: "", stderr: "sudo: error initializing audit plugin\n" },
      { status: 1, signal: null, errorCode: "ENOENT", stdout: "", stderr: "" },
      { status: 0, signal: null, errorCode: null, stdout: "User may run commands\n", stderr: "" },
    ]) expect(inspectResidentNoSudoResult(evidence)).toMatchObject({ status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "EXECUTION_IDENTITY_UNPROVEN" }] })
  })
})
