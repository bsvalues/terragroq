import { describe, expect, it } from "vitest"

import {
  evaluateWorkOrderPolicy,
  parseWorkOrderEnvelope,
  validateChangedPaths,
} from "@/scripts/runtime-operator/policy.mjs"

const envelope = {
  schemaVersion: 1,
  programId: "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001",
  goalId: "GOAL-RUNTIME-OPERATOR-PILOT-001",
  loopId: "LOOP-RUNTIME-OPERATOR-PILOT-001",
  workOrderId: "WO-RUNTIME-PILOT-001",
  title: "Low-risk evidence pilot",
  task: "Add one static evidence report proving the bounded runtime path.",
  riskClass: "R0",
  baseBranch: "main",
  allowedPaths: ["docs/reports/WO-RUNTIME-PILOT-001.md"],
  requiredValidation: ["diff-check", "lint", "test", "build"],
  mergeMode: "AUTO_ELIGIBLE",
}

describe("runtime operator authority policy", () => {
  it("parses a versioned JSON envelope from a trusted issue body", () => {
    const body = `Owner context\n\n<!-- WILLIAMOS_RUNTIME_WO\n${JSON.stringify(envelope)}\nWILLIAMOS_RUNTIME_WO -->`

    expect(parseWorkOrderEnvelope(body)).toEqual(envelope)
  })

  it("rejects shell-unsafe identifiers and path traversal before leasing", () => {
    expect(() => parseWorkOrderEnvelope(`<!-- WILLIAMOS_RUNTIME_WO\n${JSON.stringify({ ...envelope, workOrderId: "WO; rm -rf" })}\nWILLIAMOS_RUNTIME_WO -->`)).toThrow(/identifier/i)
    expect(() => parseWorkOrderEnvelope(`<!-- WILLIAMOS_RUNTIME_WO\n${JSON.stringify({ ...envelope, allowedPaths: ["docs/../package.json"] })}\nWILLIAMOS_RUNTIME_WO -->`)).toThrow(/path/i)
  })

  it("allows a bounded R0 work order from the Primary", () => {
    expect(
      evaluateWorkOrderPolicy({
        envelope,
        actor: "bsvalues",
        repository: "bsvalues/terragroq",
        enabled: true,
      }),
    ).toMatchObject({ allowed: true, reasonCode: "POLICY_ALLOWED" })
  })

  it.each([
    [{ actor: "untrusted" }, "ACTOR_NOT_ALLOWED"],
    [{ repository: "other/repo" }, "REPOSITORY_NOT_ALLOWED"],
    [{ enabled: false }, "KILL_SWITCH_ACTIVE"],
    [{ envelope: { ...envelope, riskClass: "R2" } }, "RISK_NOT_ALLOWED"],
    [{ envelope: { ...envelope, task: "Deploy to production" } }, "CAPABILITY_NOT_ALLOWED"],
    [{ envelope: { ...envelope, allowedPaths: ["app/api/auth/route.ts"] } }, "PATH_NOT_ALLOWED"],
  ])("denies protected authority with %s", (override, reasonCode) => {
    expect(
      evaluateWorkOrderPolicy({
        envelope,
        actor: "bsvalues",
        repository: "bsvalues/terragroq",
        enabled: true,
        ...override,
      }),
    ).toMatchObject({ allowed: false, reasonCode })
  })

  it("rejects changed files outside the exact Work Order allowlist", () => {
    expect(validateChangedPaths(envelope, ["docs/reports/WO-RUNTIME-PILOT-001.md"])).toEqual({
      allowed: true,
      violations: [],
    })
    expect(validateChangedPaths(envelope, ["docs/reports/WO-RUNTIME-PILOT-001.md", "package.json"])).toEqual({
      allowed: false,
      violations: ["package.json"],
    })
  })

  it("allows only a runtime branch tied to an explicit remediation PR", () => {
    expect(evaluateWorkOrderPolicy({
      envelope: { ...envelope, baseBranch: "runtime/wo-pilot-issue-12", remediationOf: 44 },
      actor: "bsvalues",
      repository: "bsvalues/terragroq",
      enabled: true,
    })).toMatchObject({ allowed: true })
    expect(evaluateWorkOrderPolicy({
      envelope: { ...envelope, baseBranch: "runtime/wo-pilot-issue-12" },
      actor: "bsvalues",
      repository: "bsvalues/terragroq",
      enabled: true,
    })).toMatchObject({ allowed: false, reasonCode: "BASE_BRANCH_NOT_ALLOWED" })
  })
})
