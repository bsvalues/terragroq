import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"

import {
  authorizeRemoteDevActivation,
  inspectRemoteDevActivationWindow,
  inspectResidentNoSudoResult,
  settleRemoteDevActivation,
  validateRemoteDevActivationAuthority,
} from "../scripts/execution-fabric/live/remote-dev-offload-activation.mjs"

const root = process.cwd()
const authorityPath = path.join(root, "config/execution-fabric/remote-dev-offload-v1-activation.json")
const authority = () => JSON.parse(fs.readFileSync(authorityPath, "utf8"))
const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex")
const activationScopeSha = () => sha(Buffer.from(fs.readFileSync(authorityPath, "utf8").replace(/\r\n/g, "\n"), "utf8"))
const requestSha = () => sha(canonicalizeJcs(candidate()))
const claimKeySha = () => sha(canonicalizeJcs({ authority_reference: authority().authorityReference, scope_sha256: activationScopeSha() }))
const claimId = () => `claim-${claimKeySha().slice(0, 24)}`

function candidate() {
  const value = authority()
  return {
    runId: value.run.runId,
    workOrderId: value.workOrderId,
    issue: value.issue,
    repository: value.target.repository,
    baseRef: value.target.baseRef,
    baseSha: value.trustedMain.minimumCommit,
    nodeId: value.target.nodeId,
    workspace: value.target.workspace,
    branch: value.target.branch,
    operations: value.operations,
    resources: value.resources,
    network: value.network,
    executionIdentity: value.executionIdentity,
  }
}

function runtimeProof() {
  const value = authority()
  return {
    identity: {
      provider: "trustedResidentIdentity",
      account: "williamos-fabric",
      uid: 1001,
      nonRoot: true,
      noSudo: true,
      verified: true,
    },
    trustedMain: {
      provider: "createTrustedProofProviders",
      trustedRef: "refs/heads/main",
      headCommit: value.trustedMain.minimumCommit,
      minimumCommit: value.trustedMain.minimumCommit,
      ancestryVerified: true,
      clean: true,
      exactArtifactBindings: true,
      verified: true,
    },
    network: {
      provider: "remoteDevDefaultDenyProof",
      defaultDeny: true,
      atlasDenied: true,
      endpoints: value.network.endpoints,
      verified: true,
    },
    claim: {
      provider: "createLedgerProviders",
      claimed: true,
      claimId: claimId(),
      claimKeySha256: claimKeySha(),
      authorityReference: value.authorityReference,
      runId: value.run.runId,
      scopeSha256: activationScopeSha(),
      requestSha256: requestSha(),
      maximumAttempts: 3,
    },
    lease: {
      provider: "createLedgerProviders",
      acquired: true,
      leaseId: "lease-56b41a963bbf4c80907bd37d",
      claimId: claimId(),
      runId: value.run.runId,
      nodeId: "aegis",
    },
  }
}

function settlement() {
  const value = authority()
  return {
    runId: value.run.runId,
    claimId: claimId(),
    leaseId: "lease-56b41a963bbf4c80907bd37d",
    release: {
      provider: "createLedgerProviders",
      released: true,
      runId: value.run.runId,
      claimId: claimId(),
      leaseId: "lease-56b41a963bbf4c80907bd37d",
      releaseSha256: "2".repeat(64),
    },
    replay: {
      provider: "createLedgerProviders",
      status: "REPLAY_REJECTED",
      rejectionCode: "REQUEST_ALREADY_CONSUMED",
      runId: value.run.runId,
      claimId: claimId(),
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

  it("rejects fabricated serialized proof and caller time without invoking a caller-selected provider", async () => {
    for (const suppliedTime of [now, "1999-01-01T00:00:00.000Z"]) {
      expect(await authorizeRemoteDevActivation(authority(), candidate(), suppliedTime, runtimeProof())).toMatchObject({
        status: "BLOCKED",
        executionAuthorized: false,
        reasons: [{ code: "ACTIVATION_RUNTIME_NODE_INVALID" }],
      })
    }
  })

  it("never accepts caller proof objects at an active time outside resident AEGIS", async () => {
    expect(await authorizeRemoteDevActivation(authority(), candidate(), now, runtimeProof())).not.toMatchObject({ executionAuthorized: true })
  })

  it("settles only an opaque module-issued live session, never fabricated release/replay JSON", async () => {
    expect(await settleRemoteDevActivation(settlement())).toMatchObject({
      status: "BLOCKED",
      executionAuthorized: false,
      reasons: [{ code: "ACTIVATION_SESSION_INVALID" }],
    })
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
