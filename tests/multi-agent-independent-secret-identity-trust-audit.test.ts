import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao045SecretTrustAuditEvidence,
  MULTI_AGENT_SECRET_TRUST_AUDIT_EVIDENCE,
} from "@/components/operator/multi-agent-secret-trust-audit-registry"
import {
  evaluateIndependentSecretIdentityTrustAudit,
  IndependentSecretIdentityTrustAuditError,
  independentSecretIdentityTrustAuditPlanContentHash,
  loadCanonicalIndependentSecretIdentityTrustAuditPlan,
  runCanonicalIndependentSecretIdentityTrustAudit,
  verifyCanonicalIndependentSecretIdentityTrustAuditPlan,
} from "../scripts/multi-agent-operator/independent-secret-identity-trust-audit.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected secret trust audit wall")
  } catch (error) {
    expect(error).toBeInstanceOf(IndependentSecretIdentityTrustAuditError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-045 independent secret identity trust-boundary audit", () => {
  it("proves the independent audit without reading secrets or touching runtime", () => {
    const result = runCanonicalIndependentSecretIdentityTrustAudit()
    expect(result).toMatchObject({
      artifactType: "INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_RESULT",
      workOrderId: "WO-MAO-045",
      status: "INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_PROVEN",
      planContentHash: "413975c5dd9babeb61b7bb8d188c9c5809185cc6d12c2e0e0cbf16dddf84b52e",
      baseCommitSha: "e3f3b02b7bea5f062e7a4dbd63cfe918dae6edb2",
      baseTreeHash: "7387f4dc3ba56e0ffb92cf29aac7043adb0059aa",
      dependencyCount: 10,
      auditDomainCount: 5,
      trustBoundaryGateCount: 6,
      reservedPathCount: 5,
      changedPathCount: 5,
      runtimeActivated: false,
      secretReadAttempted: false,
      secretValueObserved: false,
      identityMutated: false,
      githubApiCalled: false,
      authorityGranted: false,
      resultHash: "5d4219b7d9ea133b9fdcd09595a1d7879c05a6ffb9103956508707c7925c4d5e",
    })
    expect(result.dependencyWorkOrders).toEqual(["WO-MAO-022", "WO-MAO-036", "WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042", "WO-MAO-043", "WO-MAO-044"])
    expect(result.auditedBoundaries).toEqual(["github-authority", "identity-material", "owner-boundary", "runtime-boundary", "secret-material"])
    expect(result.orderedOperations).toContain("VERIFY_NO_SECRET_ACCESS_OR_STORAGE")
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId|token/i)
  })

  it("rejects caller-supplied audit input and pins the canonical plan", () => {
    expect(runCanonicalIndependentSecretIdentityTrustAudit()).toEqual(runCanonicalIndependentSecretIdentityTrustAudit())
    expectWall(() => evaluateIndependentSecretIdentityTrustAudit({ token: "x" }), "SECRET_TRUST_AUDIT_HOST_TRUST_WALL")
    expect(verifyCanonicalIndependentSecretIdentityTrustAuditPlan()).toMatchObject({
      ok: true,
      code: "INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_PLAN_VERIFIED",
      contentHash: "413975c5dd9babeb61b7bb8d188c9c5809185cc6d12c2e0e0cbf16dddf84b52e",
      runtimeActivated: false,
      secretReadAttempted: false,
      secretValueObserved: false,
      identityMutated: false,
      githubApiCalled: false,
      authorityGranted: false,
    })
  })

  it("publishes tamper-evident typed evidence for the independent audit", () => {
    expect(isVerifiedWoMao045SecretTrustAuditEvidence()).toBe(true)
    expect(MULTI_AGENT_SECRET_TRUST_AUDIT_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-045-INDEPENDENT-SECRET-IDENTITY-TRUST-AUDIT-V1",
      status: "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_VERIFIED",
      recordContentHash: "2850c0c9690a32c2a8454c389473f94d63ba30be3bbea6f90108fa067d34828d",
      runtimeActivated: false,
      secretReadAttempted: false,
      secretValueObserved: false,
      identityMutated: false,
      githubApiCalled: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, domain, gate, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence.pop() },
      (value: any) => { value.auditDomains[0].expectedState = "SECRET_ACCESS_ALLOWED" },
      (value: any) => { value.trustBoundaryGates[0].required = false },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.githubLifecycleConformanceVerified = false },
      (value: any) => { value.safety.secretReadAttempted = true },
      (value: any) => { value.safety.identityMutated = true },
      (value: any) => { value.safety.githubApiCalled = true },
      (value: any) => { value.safety.authorityGranted = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalIndependentSecretIdentityTrustAuditPlan())
      mutate(plan)
      expect(independentSecretIdentityTrustAuditPlanContentHash(plan)).not.toBe("413975c5dd9babeb61b7bb8d188c9c5809185cc6d12c2e0e0cbf16dddf84b52e")
      expectWall(() => verifyCanonicalIndependentSecretIdentityTrustAuditPlan(plan), "SECRET_TRUST_AUDIT_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/independent-secret-identity-trust-audit-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_PROVEN",
      resultHash: "5d4219b7d9ea133b9fdcd09595a1d7879c05a6ffb9103956508707c7925c4d5e",
      runtimeActivated: false,
      secretReadAttempted: false,
      secretValueObserved: false,
      identityMutated: false,
      githubApiCalled: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--read-secret", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/independent-secret-identity-trust-audit-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "SECRET_TRUST_AUDIT_CLI_ARGUMENT_WALL",
        runtimeActivated: false,
        secretReadAttempted: false,
        secretValueObserved: false,
        identityMutated: false,
        githubApiCalled: false,
        authorityGranted: false,
      })
    }
  })
})

