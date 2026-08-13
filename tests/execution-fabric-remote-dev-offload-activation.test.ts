import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"
import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"

import {
  authorizeRemoteDevActivation,
  inspectActivationCriticalWorkingFiles,
  inspectControlPlaneTrustedCheckout,
  inspectRemoteDevActivationWindow,
  inspectResidentIdentityBinding,
  inspectResidentNoSudoResult,
  inspectRootNoSudoProof,
  inspectRootPrerequisiteReceiptEvidence,
  settleRemoteDevActivationState,
  settleRemoteDevActivation,
  validateRemoteDevActivationAuthority,
} from "../scripts/execution-fabric/live/remote-dev-offload-activation.mjs"

const root = process.cwd()
const authorityPath = path.join(root, "config/execution-fabric/remote-dev-offload-v1-activation.json")
const authority = () => JSON.parse(fs.readFileSync(authorityPath, "utf8"))
const fabricatedClaimId = "claim-766b694bc86df27f564d5adb"
const normalizedDigest = (bytes: Buffer) => crypto.createHash("sha256").update(Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8")).digest("hex")

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
    const value = authority()
    expect(inspectRemoteDevActivationWindow(value, new Date(Date.parse(value.run.validFrom) - 1).toISOString())).toMatchObject({ status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "ACTIVATION_NOT_YET_VALID" }] })
    expect(inspectRemoteDevActivationWindow(value, value.run.expiresAt)).toMatchObject({ status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "ACTIVATION_EXPIRED" }] })
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

  it("binds activation to the fixed resident network provider and reviewed policy bytes", () => {
    const value = authority()
    expect(value.bindings.networkProvider).toMatchObject({
      path: "scripts/execution-fabric/live/aegis-resident-network-boundary.mjs",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(value.bindings.networkPolicy).toMatchObject({
      path: "config/execution-fabric/aegis-resident-network-boundary.json",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(value.bindings.networkLauncher).toMatchObject({
      path: "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(value.trustedMain.controlPlane.criticalPaths).toEqual(expect.arrayContaining([
      value.bindings.networkProvider.path,
      value.bindings.networkPolicy.path,
      value.bindings.networkLauncher.path,
    ]))

    for (const binding of ["networkProvider", "networkPolicy", "networkLauncher"] as const) {
      expect(value.bindings[binding].sha256).toBe(normalizedDigest(fs.readFileSync(path.join(root, value.bindings[binding].path))))
      const drifted = authority()
      drifted.bindings[binding].sha256 = "0".repeat(64)
      expect(validateRemoteDevActivationAuthority(drifted, candidate())).toMatchObject({
        status: "BLOCKED",
        reasons: [{ code: "ACTIVATION_BINDING_DRIFT" }],
      })
    }
  })

  it("retains the exact network proof generation in the opaque authorization session", () => {
    const source = fs.readFileSync(path.join(root, "scripts/execution-fabric/live/remote-dev-offload-activation.mjs"), "utf8")
    expect(source).toContain("networkProofId: networkBoundary.proofId")
    expect(source).toContain("networkEnforcementGenerationId: networkBoundary.enforcementGenerationId")
    expect(source).toContain("networkControlGroupIdentity: networkBoundary.controlGroupIdentity")
    expect(source).toContain("networkLauncherSha256: networkBoundary.launcherSha256")
    expect(source).toContain("networkWorkerSha256: networkBoundary.workerSha256")
    expect(source).toContain("networkLaunchAuthorityPublicKeySha256: networkBoundary.launchAuthorityPublicKeySha256")
  })

  it("evaluates the fixed network proof before creating any claim or lease provider", () => {
    const source = fs.readFileSync(path.join(root, "scripts/execution-fabric/live/remote-dev-offload-activation.mjs"), "utf8")
    const authorizeStart = source.indexOf("export async function authorizeRemoteDevActivation")
    const prerequisiteGate = source.indexOf("proveRootPrerequisites(checkout.head_commit, authority)", authorizeStart)
    const networkGate = source.indexOf("await proveResidentAegisNetworkBoundary()", authorizeStart)
    const ledgerGate = source.indexOf("createLedgerProviders()", authorizeStart)
    expect(authorizeStart).toBeGreaterThanOrEqual(0)
    expect(prerequisiteGate).toBeGreaterThan(authorizeStart)
    expect(networkGate).toBeGreaterThan(prerequisiteGate)
    expect(ledgerGate).toBeGreaterThan(networkGate)
  })

  it("requires one exact non-authorizing durable prerequisite receipt bound to the reviewed package generation", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "config/execution-fabric/aegis-remote-dev-root-handoff.json"), "utf8"))
    const machine = manifest.target.machineIdSha256
    const receipt = {
      schemaVersion: 1, status: "PREREQUISITES_VERIFIED", workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001",
      transactionId: "2ac672df-eb80-48df-a887-e2bc26bf401b", authorityId: "b6726cab-1f13-47da-9d25-1a199bb52c0f",
      completedAt: "2026-08-11T20:10:00.000Z", machineIdSha256: machine, trustedMainCommit: "98b458b998010f8ccfe9902fd307d75c0ec8c309",
      reviewedPackageCommit: "98b458b998010f8ccfe9902fd307d75c0ec8c309", observedFreshMainCommit: "98b458b998010f8ccfe9902fd307d75c0ec8c309",
      rootHandoffManifestSha256: crypto.createHash("sha256").update(canonicalizeJcs(manifest)).digest("hex"),
      historicalPreflightManifestJcsSha256: manifest.prerequisitePackage.supersededPreflight.manifestJcsSha256, appliedAssets: manifest.appliedAssets,
      authoritySha256: "b".repeat(64), inputsSha256: "c".repeat(64), launchAuthorityPublicKeySha256: "d".repeat(64),
      storage: { mode: "VERIFY_ONLY", filesystemUuid: manifest.storage.filesystemUuid, projectId: 734, hardLimitBytes: 85899345920 },
      journalHeadSha256: "a".repeat(64), schedulerEnabled: false, standingAuthority: false, dispatchOccurred: false,
      closedHashMutation: false, executionAuthorized: false, activationAuthorized: false,
    }
    const bytes = Buffer.from(`${canonicalizeJcs(receipt)}\n`)
    expect(inspectRootPrerequisiteReceiptEvidence(bytes, manifest, machine, "d".repeat(40))).toMatchObject({ status: "ROOT_PREREQUISITES_VERIFIED", executionAuthorized: false })
    for (const changed of [
      { ...receipt, machineIdSha256: "0".repeat(64) },
      { ...receipt, journalHeadSha256: "0" },
      { ...receipt, activationAuthorized: true },
      { ...receipt, appliedAssets: receipt.appliedAssets.slice(1) },
    ]) expect(inspectRootPrerequisiteReceiptEvidence(Buffer.from(`${canonicalizeJcs(changed)}\n`), manifest, machine, "b".repeat(40))).toMatchObject({ status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "ROOT_PREREQUISITES_UNPROVEN" }] })
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
    }, (args: string[]) => {
      expect(args).toEqual(["--no-replace-objects", "merge-base", "--is-ancestor", value.trustedMain.controlPlane.minimumCommit, "b".repeat(40)])
      return { status: 0 }
    })).toMatchObject({ status: "CONTROL_PLANE_TRUSTED_MAIN_VERIFIED", executionAuthorized: false })
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
      const runGit = (args: string[]) => {
        expect(args[0]).toBe("--no-replace-objects")
        return trusted.get(String(args[2]).replace(/^refs\/heads\/main:/, ""))!
      }
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

  it("accepts only a fresh root policy proof for the exact locked activation identity", () => {
    const proof:any={schemaVersion:1,status:"ROOT_NO_SUDO_VERIFIED",activationId:"remote-dev-offload-v1-issue-734-single-use-001",authorityReference:"issue-734-terrafusion-remote-dev-single-use-001",runId:"a3961b87-ed54-45d0-a975-678a02f1e163",machineIdSha256:"a".repeat(64),bootId:"11111111-1111-4111-8111-111111111111",activationHostSha256:"b".repeat(64),authoritySha256:"c".repeat(64),account:"williamos-fabric",passwordStatus:"L",sudoStatus:0,sudoStdout:"User williamos-fabric is not allowed to run sudo on aegis.\n",sudoStderr:"",issuedAt:"2026-08-13T01:10:00.000Z",expiresAt:"2026-08-13T01:15:00.000Z"}
    const expected={machineIdSha256:proof.machineIdSha256,bootId:proof.bootId,activationHostSha256:proof.activationHostSha256,authoritySha256:proof.authoritySha256}
    expect(inspectRootNoSudoProof(proof,"2026-08-13T01:10:30.000Z",expected)).toMatchObject({status:"ROOT_NO_SUDO_VERIFIED"})
    for(const value of [{...proof,passwordStatus:"P"},{...proof,sudoStatus:1},{...proof,sudoStdout:"sudo: a password is required\n"},{...proof,expiresAt:"2026-08-13T01:10:30.000Z"},{...proof,extra:true}])expect(inspectRootNoSudoProof(value,"2026-08-13T01:10:30.000Z",expected)).toMatchObject({status:"BLOCKED"})
  })
})
