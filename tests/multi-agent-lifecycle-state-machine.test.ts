import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  CANONICAL_LIFECYCLE_STATES,
  LifecycleStateError,
  TERMINAL_LIFECYCLE_STATES,
  allowedLifecycleTransitions,
  classifyLifecycleFailure,
  isTerminalLifecycleState,
  transitionLifecycle,
} from "../scripts/multi-agent-operator/lifecycle-state-machine.mjs"

function failure(failureClass = "TRANSIENT_TRANSPORT") {
  return {
    schemaVersion: 1,
    failureClass,
    reasonCode: failureClass === "TRANSIENT_TRANSPORT" ? "CODEX_NETWORK_WALL" : failureClass,
    attemptsUsed: 0,
    maxAttempts: 3,
    reroutesUsed: 0,
    maxReroutes: 1,
    compatibleHealthyProviders: [] as string[],
    portfolioHealthyProviders: [] as string[],
    authorityGap: { present: false, condition: null as string | null, conditionRef: null as string | null },
  }
}

const noAuthorityGap = { present: false, condition: null, conditionRef: null }

function expectWall(callback: () => unknown, code: string, field?: string) {
  try {
    callback()
    throw new Error("expected lifecycle wall")
  } catch (error) {
    expect(error).toBeInstanceOf(LifecycleStateError)
    expect(error).toMatchObject({ code, ...(field ? { field } : {}) })
  }
}

describe("canonical multi-agent lifecycle state machine", () => {
  it("contains every canonical success and typed non-success state exactly once", () => {
    expect(new Set(CANONICAL_LIFECYCLE_STATES).size).toBe(CANONICAL_LIFECYCLE_STATES.length)
    expect(CANONICAL_LIFECYCLE_STATES).toEqual(expect.arrayContaining([
      "PLANNED", "PROVIDER_DISPATCHED", "INDEPENDENT_REVIEW", "DEPENDENTS_RELEASED",
      "RETRY_SCHEDULED", "REROUTE_PENDING", "BLOCKED_NO_ELIGIBLE_PROVIDER",
      "FAILED_SECURITY_TERMINAL", "FAILED_OWNER_BABYSITTING", "OWNER_DECISION_REQUIRED",
    ]))
  })

  it("advances deterministically through the clean canonical success path", () => {
    const cleanPath = CANONICAL_LIFECYCLE_STATES.slice(0, 10).concat(CANONICAL_LIFECYCLE_STATES.slice(11, 16))
    for (let index = 0; index < cleanPath.length - 1; index += 1) {
      expect(transitionLifecycle({
        from: cleanPath[index],
        to: cleanPath[index + 1],
        reasonCode: null,
        failureClass: null,
        authorityGap: noAuthorityGap,
      })).toMatchObject({ code: "LIFECYCLE_TRANSITION_ALLOWED", terminal: index === cleanPath.length - 2 })
    }
    expect(isTerminalLifecycleState("DEPENDENTS_RELEASED")).toBe(true)
  })

  it("walls illegal jumps, self transitions, and every transition out of a terminal state", () => {
    expectWall(() => transitionLifecycle({ from: "PLANNED", to: "EXECUTING", reasonCode: null, failureClass: null, authorityGap: noAuthorityGap }), "LIFECYCLE_ILLEGAL_TRANSITION_WALL", "to")
    expectWall(() => transitionLifecycle({ from: "EXECUTING", to: "EXECUTING", reasonCode: null, failureClass: null, authorityGap: noAuthorityGap }), "LIFECYCLE_ILLEGAL_TRANSITION_WALL", "to")
    for (const terminal of TERMINAL_LIFECYCLE_STATES) {
      expect(allowedLifecycleTransitions(terminal)).toEqual([])
      expectWall(() => transitionLifecycle({ from: terminal, to: "PLANNED", reasonCode: null, failureClass: null, authorityGap: noAuthorityGap }), "LIFECYCLE_TERMINAL_IMMUTABILITY_WALL", "from")
    }
  })

  it("branches review into clean merge eligibility or bounded remediation that must be rechecked", () => {
    expect(allowedLifecycleTransitions("INDEPENDENT_REVIEW")).toEqual(expect.arrayContaining(["MERGE_ELIGIBLE", "REMEDIATING"]))
    expect(allowedLifecycleTransitions("REMEDIATING")).toEqual(expect.arrayContaining(["VALIDATING", "INDEPENDENT_REVIEW"]))
    expect(allowedLifecycleTransitions("REMEDIATING")).not.toContain("MERGE_ELIGIBLE")
    expect(transitionLifecycle({ from: "REMEDIATING", to: "INDEPENDENT_REVIEW", reasonCode: null, failureClass: null, authorityGap: noAuthorityGap })).toMatchObject({
      code: "LIFECYCLE_TRANSITION_ALLOWED",
      terminal: false,
    })
    expectWall(() => transitionLifecycle({ from: "REMEDIATING", to: "MERGE_ELIGIBLE", reasonCode: null, failureClass: null, authorityGap: noAuthorityGap }), "LIFECYCLE_ILLEGAL_TRANSITION_WALL", "to")
  })

  it("never maps transport, network, authentication, rate-limit, or provider failures to an owner decision", () => {
    for (const failureClass of ["TRANSIENT_TRANSPORT", "PROVIDER_AUTHENTICATION", "RATE_LIMIT", "PROVIDER_SERVER", "PROVIDER_UNAVAILABLE"]) {
      const input = failure(failureClass)
      input.attemptsUsed = input.maxAttempts
      const result = classifyLifecycleFailure(input)
      expect(result.ownerDecisionRequired).toBe(false)
      expect(result.ownerContactAllowed).toBe(false)
      expect(result.state).not.toBe("OWNER_DECISION_REQUIRED")
    }
  })

  it("bounds retry and then reroutes only to a compatible healthy provider", () => {
    expect(classifyLifecycleFailure(failure())).toMatchObject({ state: "RETRY_SCHEDULED", retryScheduled: true, ownerDecisionRequired: false })
    const exhausted = failure()
    exhausted.attemptsUsed = 3
    exhausted.compatibleHealthyProviders = ["claude-code"]
    expect(classifyLifecycleFailure(exhausted)).toMatchObject({ state: "REROUTE_PENDING", reroutePending: true, eligibleProviderIds: ["claude-code"] })
    exhausted.reroutesUsed = 1
    expect(classifyLifecycleFailure(exhausted)).toMatchObject({ state: "BLOCKED_NO_ELIGIBLE_PROVIDER", blocked: true })
  })

  it("does not same-provider retry authentication failures", () => {
    const input = failure("PROVIDER_AUTHENTICATION")
    input.maxAttempts = 5
    expect(classifyLifecycleFailure(input)).toMatchObject({ state: "BLOCKED_NO_ELIGIBLE_PROVIDER", retryScheduled: false, ownerDecisionRequired: false })
    input.compatibleHealthyProviders = ["hosted-codex-fallback"]
    expect(classifyLifecycleFailure(input)).toMatchObject({ state: "REROUTE_PENDING", resolution: "QUARANTINE_PROVIDER_AND_REROUTE", retryScheduled: false })
  })

  it("defers only the provider-unavailable lane while unrelated healthy providers stay eligible", () => {
    const input = failure("PROVIDER_UNAVAILABLE")
    input.portfolioHealthyProviders = ["hosted-codex"]
    const result = classifyLifecycleFailure(input)
    expect(result).toMatchObject({
      state: "DEFERRED",
      resolution: "DEFER_AFFECTED_LANE_CONTINUE_HEALTHY_PROVIDERS",
      affectedLaneDeferred: true,
      healthyProvidersRemainEligible: true,
      eligibleProviderIds: ["hosted-codex"],
      ownerDecisionRequired: false,
    })
  })

  it("classifies dependency, reservation, policy, duplicate, security, validation, and review failures", () => {
    expect(classifyLifecycleFailure(failure("DEPENDENCY_INCOMPLETE"))).toMatchObject({ state: "BLOCKED_DEPENDENCY", blocked: true })
    expect(classifyLifecycleFailure(failure("RESERVATION_COLLISION"))).toMatchObject({ state: "BLOCKED_RESERVATION", resolution: "REPLAN_BEFORE_WRITE" })
    expect(classifyLifecycleFailure(failure("POLICY_CHANGED"))).toMatchObject({ state: "BLOCKED_POLICY_CHANGED", resolution: "STOP_WITHOUT_POLICY_BYPASS" })
    expect(classifyLifecycleFailure(failure("DUPLICATE_DELIVERY"))).toMatchObject({ state: "DEFERRED", resolution: "IDEMPOTENT_NOOP" })
    expect(classifyLifecycleFailure(failure("SECURITY_BOUNDARY"))).toMatchObject({ state: "FAILED_SECURITY_TERMINAL", securityTerminal: true })
    expect(classifyLifecycleFailure(failure("DETERMINISTIC_VALIDATION"))).toMatchObject({ state: "REMEDIATING", resolution: "RETURN_TO_ORIGINAL_BUILDER" })
    const review = failure("REVIEW_CHANGES")
    review.attemptsUsed = review.maxAttempts
    expect(classifyLifecycleFailure(review)).toMatchObject({ state: "FAILED_REVIEW_TERMINAL", resolution: "BOUNDED_REMEDIATION_EXHAUSTED" })
  })

  it("permits owner decisions only for complete evidence of a genuine authority gap", () => {
    const input = failure("OWNER_AUTHORITY_GAP")
    input.authorityGap = { present: true, condition: "NEW_SPENDING_OR_CONTRACT", conditionRef: "decision-condition-42" }
    expect(classifyLifecycleFailure(input)).toMatchObject({
      state: "OWNER_DECISION_REQUIRED",
      resolution: "PRESENT_GENUINE_AUTHORITY_DECISION",
      ownerDecisionRequired: true,
      ownerContactAllowed: true,
      authorityGranted: false,
    })
    expect(transitionLifecycle({
      from: "AUTHORITY_MATCHED",
      to: "OWNER_DECISION_REQUIRED",
      reasonCode: "NEW_SPEND_NOT_AUTHORIZED",
      failureClass: "OWNER_AUTHORITY_GAP",
      authorityGap: input.authorityGap,
    })).toMatchObject({ ownerDecisionRequired: true, authorityGap: input.authorityGap })
    expectWall(() => classifyLifecycleFailure(failure("OWNER_AUTHORITY_GAP")), "LIFECYCLE_OWNER_DECISION_WALL", "authorityGap")
    const spoofed = failure("TRANSIENT_TRANSPORT")
    spoofed.authorityGap = { present: true, condition: "NEW_SPENDING_OR_CONTRACT", conditionRef: "spoofed-gap" }
    expectWall(() => classifyLifecycleFailure(spoofed), "LIFECYCLE_OWNER_DECISION_WALL", "authorityGap")
    expectWall(() => transitionLifecycle({ from: "EXECUTING", to: "OWNER_DECISION_REQUIRED", reasonCode: "CODEX_NETWORK_WALL", failureClass: "TRANSIENT_TRANSPORT", authorityGap: noAuthorityGap }), "LIFECYCLE_OWNER_DECISION_WALL", "failureClass")
  })

  it("rejects exceeded budgets and contradictory authority gap fields", () => {
    const exceeded = failure()
    exceeded.attemptsUsed = 4
    expectWall(() => classifyLifecycleFailure(exceeded), "LIFECYCLE_BUDGET_WALL", "attemptsUsed")
    const contradiction = failure()
    contradiction.authorityGap.condition = "MATERIAL_PRODUCT_SCOPE"
    expectWall(() => classifyLifecycleFailure(contradiction), "LIFECYCLE_OWNER_DECISION_WALL", "authorityGap")
  })

  it("exposes deterministic transition/classification CLI output and typed errors", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-lifecycle-"))
    const transitionPath = path.join(directory, "transition.json")
    const classifyPath = path.join(directory, "classify.json")
    fs.writeFileSync(transitionPath, JSON.stringify({ from: "PLANNED", to: "AUTHORITY_MATCHED", reasonCode: null, failureClass: null, authorityGap: noAuthorityGap }))
    fs.writeFileSync(classifyPath, JSON.stringify(failure("TRANSIENT_TRANSPORT")))
    const cli = path.resolve("scripts/multi-agent-operator/lifecycle-state-machine-cli.mjs")
    expect(JSON.parse(execFileSync(process.execPath, [cli, "transition", transitionPath], { encoding: "utf8" }))).toMatchObject({ code: "LIFECYCLE_TRANSITION_ALLOWED" })
    expect(JSON.parse(execFileSync(process.execPath, [cli, "classify", classifyPath], { encoding: "utf8" }))).toMatchObject({ state: "RETRY_SCHEDULED", ownerContactAllowed: false })
    const failureResult = spawnSync(process.execPath, [cli, "bad-operation", transitionPath], { encoding: "utf8" })
    expect(failureResult.status).toBe(2)
    expect(JSON.parse(failureResult.stdout)).toMatchObject({ code: "LIFECYCLE_CLI_WALL", ok: false })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
