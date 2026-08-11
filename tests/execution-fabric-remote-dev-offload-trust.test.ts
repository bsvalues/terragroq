import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import * as remoteDevContract from "../scripts/execution-fabric/live/remote-dev-offload-contract.mjs"

const root = process.cwd()
const digest = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex")
const trustedTextBytes = (bytes: Buffer) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8")
const artifact = (relativePath: string) => {
  const bytes = fs.readFileSync(path.join(root, relativePath))
  return { path: relativePath, sha256: digest(trustedTextBytes(bytes)), bytes }
}

const canonical = {
  contract: artifact("config/execution-fabric/aegis-bounded-dispatch-contract.json"),
  profiles: artifact("config/execution-fabric/aegis-bounded-operation-profiles.json"),
  authorityRegistry: artifact("config/execution-fabric/aegis-bounded-dispatch-authority-registry.json"),
  identity: artifact("config/execution-fabric/aegis-resident-identity.json"),
  forgePermission: artifact("config/execution-fabric/agent-forge-aegis-bounded-dispatch-permission.json"),
  trustedRunner: artifact("scripts/execution-fabric/bounded-dispatch/run-resident-aegis-hash-verify.mjs"),
  proofWorker: artifact("scripts/execution-fabric/live/aegis-remote-dev-worker.sh"),
  hashScope: artifact("config/execution-fabric/aegis-bounded-dispatch-authority-scopes/WO-EF-DISPATCH-AEGIS-001.json"),
  hashClaim: artifact("docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-claim.json"),
  hashLease: artifact("docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-lease.json"),
  hashRelease: artifact("docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-release.json"),
  hashReplay: artifact("docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-replay-evidence.json"),
}

function scope() {
  return {
    schemaVersion: 1,
    scopeId: "remote-dev-offload-v1-ci-build-inactive",
    workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001",
    templateId: "aegis.ci-build-test.v1",
    selectedNodeId: "aegis",
    status: "OWNER_AUTHORIZED_EXCEPTION_INACTIVE",
    executionAuthorized: false,
    activationAllowed: false,
    executionIdentity: {
      account: "williamos-fabric",
      privilege: "non-root-no-sudo",
      required: true,
      verified: false,
      provider: "trustedResidentIdentity",
    },
    trustedMain: {
      ref: "refs/heads/main",
      checkoutState: "EXACT_CLEAN_HEAD",
      ancestryRequired: true,
      proofProvider: "createTrustedProofProviders",
      bindings: Object.fromEntries([
        ["contract", canonical.contract], ["profiles", canonical.profiles],
        ["authorityRegistry", canonical.authorityRegistry], ["identity", canonical.identity],
        ["forgePermission", canonical.forgePermission], ["trustedRunner", canonical.trustedRunner],
        ["proofWorker", canonical.proofWorker],
      ].map(([name, value]: any) => [name, { path: value.path, sha256: value.sha256 }])),
    },
    authoritySeparation: {
      closedCiTemplate: {
        contractId: "resident-aegis-bounded-compute-v1",
        templateId: "aegis.ci-build-test.v1",
        profileId: "williamos.standard-validation.v1",
        contractStatus: "NON_ACTIVE_CONTRACT",
        profileStatus: "NON_ACTIVE_PROFILES",
      },
      consumedHashProof: {
        workOrderId: "WO-EF-DISPATCH-AEGIS-001",
        authorityReference: "issue-538-aegis-single-use-hash-001",
        templateId: "aegis.hash-verify.v1",
        claimId: "claim-dce2320e5b737d481de2bc69",
        reuseAllowed: false,
        mutationAllowed: false,
        artifacts: {
          scope: { path: canonical.hashScope.path, sha256: canonical.hashScope.sha256 },
          claim: { path: canonical.hashClaim.path, sha256: canonical.hashClaim.sha256 },
          lease: { path: canonical.hashLease.path, sha256: canonical.hashLease.sha256 },
          release: { path: canonical.hashRelease.path, sha256: canonical.hashRelease.sha256 },
          replay: { path: canonical.hashReplay.path, sha256: canonical.hashReplay.sha256 },
        },
      },
    },
    ownerAuthorizedException: {
      canonicalProfileEquivalent: false,
      reason: "ISSUE_734_DOTNET_RESTORE_TEST_BUILD_PROOF",
      resources: { cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 },
      network: {
        defaultDeny: true,
        atlasAllowed: false,
        endpoints: [
          { host: "ssh.github.com", port: 443, operations: ["git-fetch", "git-push"] },
          { host: "api.github.com", port: 443, operations: ["github-pr"] },
          { host: "api.nuget.org", port: 443, operations: ["dotnet-restore"] },
          { host: "globalcdn.nuget.org", port: 443, operations: ["dotnet-restore"] },
        ],
      },
    },
    futureActivationRequirements: {
      dedicatedExecutionIdentity: true,
      canonicalIdentityProviderEvidence: true,
      noSudoCapabilityEvidence: true,
      trustedMainAncestry: true,
      durableSingleUseClaim: true,
      nodeExclusiveLease: true,
      durableLeaseRelease: true,
      replayRejectionEvidence: true,
      ledgerProvider: "createLedgerProviders",
      sameRunAndScopeBinding: true,
      networkDefaultDenyEvidence: true,
    },
    scheduler: { state: "disabled", standingAegisAuthority: false, autonomousDispatch: false },
  }
}

function policy() {
  const value = JSON.parse(fs.readFileSync(path.join(root, "config/execution-fabric/remote-dev-offload-v1.policy.json"), "utf8"))
  value.trustBaseline = {
    scopePath: "config/execution-fabric/remote-dev-offload-v1-inactive-scope.json",
    scopeSha256: digest(Buffer.from(`${JSON.stringify(scope(), null, 2)}\n`, "utf8")),
  }
  value.canonicalAegisContract.sha256 = canonical.contract.sha256
  return value
}

function artifacts(approvedScope = scope()) {
  return {
    ...Object.fromEntries(Object.entries(canonical).map(([name, value]) => [name, value.bytes])),
    trustScope: Buffer.from(`${JSON.stringify(approvedScope, null, 2)}\n`, "utf8"),
  }
}

function reconcile(value = policy(), approvedScope = scope(), boundArtifacts = artifacts(approvedScope), rebindScope = true) {
  const boundPolicy = structuredClone(value)
  if (rebindScope) boundPolicy.trustBaseline.scopeSha256 = digest(Buffer.from(`${JSON.stringify(approvedScope, null, 2)}\n`, "utf8"))
  return (remoteDevContract as any).validateRemoteDevTrustBaseline(boundPolicy, approvedScope, boundArtifacts)
}

describe("remote development trusted-main reconciliation", () => {
  it("recognizes the proof as trusted-main-ready but inactive by default", () => {
    expect(typeof (remoteDevContract as any).validateRemoteDevTrustBaseline).toBe("function")
    expect(reconcile()).toEqual({
      status: "INACTIVE_TRUSTED_MAIN_READY",
      executionAuthorized: false,
      workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001",
      executionIdentity: "williamos-fabric",
    })
  })

  it("rejects stale canonical artifact digests", () => {
    const value = scope(); value.trustedMain.bindings.contract.sha256 = "0".repeat(64)
    expect(reconcile(policy(), value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "TRUST_BASELINE_DRIFT" }] })
  })

  it("rejects unknown trust-scope fields even when the altered scope is rebound", () => {
    const value: any = scope(); value.activationHint = "enable"
    expect(reconcile(policy(), value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "TRUST_BASELINE_DRIFT" }] })
  })

  it("rejects execution identity drift", () => {
    const value = scope(); value.executionIdentity.account = "bs"
    expect(reconcile(policy(), value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "EXECUTION_IDENTITY_MISMATCH" }] })
  })

  it("rejects a substituted execution identity provider", () => {
    const value = scope(); value.executionIdentity.provider = "local-id-check"
    expect(reconcile(policy(), value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "EXECUTION_IDENTITY_MISMATCH" }] })
  })

  it("keeps identity proof explicitly unverified until the future activation gate", () => {
    const value = scope(); value.executionIdentity.verified = true
    expect(reconcile(policy(), value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "EXECUTION_IDENTITY_MISMATCH" }] })
  })

  it.each([
    ["trusted-main ancestry", "trustedMainAncestry"],
    ["canonical identity provider evidence", "canonicalIdentityProviderEvidence"],
    ["no-sudo capability evidence", "noSudoCapabilityEvidence"],
    ["durable claim", "durableSingleUseClaim"],
    ["exclusive lease", "nodeExclusiveLease"],
    ["durable release", "durableLeaseRelease"],
    ["replay evidence", "replayRejectionEvidence"],
    ["network default-deny evidence", "networkDefaultDenyEvidence"],
  ])("rejects missing %s activation evidence", (_label, field) => {
    const value = scope(); (value.futureActivationRequirements as any)[field] = false
    expect(reconcile(policy(), value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "FUTURE_ACTIVATION_EVIDENCE_INCOMPLETE" }] })
  })

  it("rejects reuse of the consumed HASH_VERIFY authority scope", () => {
    const value = scope()
    value.workOrderId = "WO-EF-DISPATCH-AEGIS-001"
    value.authoritySeparation.consumedHashProof.reuseAllowed = true
    expect(reconcile(policy(), value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "HASH_SCOPE_REUSE_REJECTED" }] })
  })

  it.each([
    ["profile equivalence ambiguity", (value: any) => { value.ownerAuthorizedException.canonicalProfileEquivalent = true }],
    ["resource drift", (value: any) => { value.ownerAuthorizedException.resources.memoryBytes = 8589934592 }],
    ["network wildcard", (value: any) => { value.ownerAuthorizedException.network.endpoints[0].host = "*.github.com" }],
    ["unapproved network operation", (value: any) => { value.ownerAuthorizedException.network.endpoints[0].operations.push("arbitrary-http") }],
    ["Atlas access", (value: any) => { value.ownerAuthorizedException.network.atlasAllowed = true }],
  ])("rejects %s", (_label, mutate) => {
    const value = scope(); mutate(value)
    expect(reconcile(policy(), value)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "OWNER_EXCEPTION_INVALID" }] })
  })

  it("rejects a policy-to-scope digest mismatch", () => {
    const value = policy(); value.trustBaseline.scopeSha256 = "f".repeat(64)
    expect(reconcile(value, scope(), artifacts(), false)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "TRUST_SCOPE_DIGEST_MISMATCH" }] })
  })

  it("binds the policy digest to the exact reviewed scope bytes", () => {
    const approvedScope = scope()
    const boundArtifacts = artifacts(approvedScope)
    boundArtifacts.trustScope = Buffer.from(`${JSON.stringify(approvedScope)}\n`, "utf8")
    expect(reconcile(policy(), approvedScope, boundArtifacts)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "TRUST_SCOPE_DIGEST_MISMATCH" }] })
  })
})
