import { describe, expect, it } from "vitest"

import { classifyGoal } from "@/lib/goal/classifier"
import {
  requireHermesWorkContract,
} from "../scripts/hermes-bridge/orchestrator.mjs"
import {
  HERMES_WORK_CONTRACT_VERSION,
  HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST,
  HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_ID,
  HERMES_ISSUE_911_RELIABILITY_CONTRACT_DIGEST,
  HERMES_ISSUE_911_RELIABILITY_CONTRACT_ID,
  resolveHermesWorkContract,
} from "../scripts/hermes-bridge/work-contract.mjs"

const command = "Add a compact on-screen latest-evidence timestamp to selected Thread work status."

describe("Hermes exact work contract", () => {
  it("classifies the registered ordinary-language outcome inside the bounded write envelope", () => {
    expect(classifyGoal(command)).toMatchObject({
      lane: "ui",
      mode: "implement",
      risk: "low",
      authority: "A2_WRITE_OWN",
      verdict: "requires_approval",
      requiresApproval: true,
    })
  })

  it("resolves the single bounded v1 outcome to exact files and validators", () => {
    const contract = resolveHermesWorkContract({
      command,
      title: command,
      objective: command,
      lane: "ui",
      risk: "low",
      authority: "A2_WRITE_OWN",
    })

    if (!contract) throw new Error("EXPECTED_REGISTERED_WORK_CONTRACT")
    expect(contract).toMatchObject({
      version: HERMES_WORK_CONTRACT_VERSION,
      id: HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_ID,
      repository: "bsvalues/terragroq",
      lane: "ui",
      reservations: [
        "components/workbench/outcome-execution-control.tsx",
        "lib/workbench/thread-trust.ts",
        "tests/outcome-execution-control-rendered.test.tsx",
      ],
    })
    expect(contract.digest).toBe(HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST)
    expect(contract.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(contract.validationCommands).toEqual([
      { command: "npx", args: ["vitest", "run", "tests/outcome-execution-control-rendered.test.tsx"], timeoutMs: 300_000 },
      { command: "npm", args: ["run", "lint"], timeoutMs: 600_000 },
      { command: "npm", args: ["run", "build"], env: { NEXT_PRIVATE_BUILD_WORKER: "0", NEXT_TELEMETRY_DISABLED: "1" }, timeoutMs: 900_000 },
    ])
  })

  it("normalizes harmless casing, whitespace, and terminal punctuation only", () => {
    expect(resolveHermesWorkContract({
      command: "  ADD a compact on-screen latest-evidence timestamp to selected Thread work status  ",
      title: command,
      objective: command,
      lane: "ui",
      risk: "R1",
      authority: "A2_WRITE_OWN",
    })?.id).toBe("selected-thread-latest-evidence.v1")
  })

  it("resolves only the pre-registered #911 evidence outcome without granting host mutation", () => {
    const issue911Intent = "record structured #911 reliability remediation without host mutation"
    const contract = resolveHermesWorkContract({
      command: issue911Intent,
      title: issue911Intent,
      objective: issue911Intent,
      lane: "operator-objective",
      risk: "R1",
      authority: "A2_WRITE_OWN",
    })

    expect(contract).toEqual({
      version: HERMES_WORK_CONTRACT_VERSION,
      id: HERMES_ISSUE_911_RELIABILITY_CONTRACT_ID,
      repository: "bsvalues/terragroq",
      lane: "operator-objective",
      reservations: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
      validationCommands: [
        { command: "git", args: ["diff", "--check"], timeoutMs: 300_000 },
        { command: "npx", args: ["vitest", "run", "tests/hermes-work-contract.test.ts"], timeoutMs: 300_000 },
      ],
      projection: { issueNumber: 911, completionOwned: false },
      delivery: {
        authorityLevel: "A2_WRITE_OWN",
        allowedActions: ["implement"],
        commitAllowed: true,
        tagAllowed: false,
        pushAllowed: true,
      },
      digest: HERMES_ISSUE_911_RELIABILITY_CONTRACT_DIGEST,
    })
    expect(contract?.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each([
    "RELIABILITY: D: is a single operational concentration point on HERMES",
    "Inventory each D: path and classify it",
    "record structured #911 reliability remediation with host mutation",
  ])("does not infer the #911 work contract from issue prose: %s", (unregisteredIntent) => {
    expect(resolveHermesWorkContract({
      command: unregisteredIntent,
      title: unregisteredIntent,
      objective: unregisteredIntent,
      lane: "operator-objective",
      risk: "R1",
      authority: "A2_WRITE_OWN",
    })).toBeNull()
  })

  it.each([
    { command: `${command} Also edit any useful files.`, title: command, objective: command, lane: "ui", risk: "low", authority: "A2_WRITE_OWN" },
    { command, title: command, objective: command, lane: "read_model", risk: "low", authority: "A2_WRITE_OWN" },
    { command, title: command, objective: command, lane: "ui", risk: "R2", authority: "A2_WRITE_OWN" },
    { command, title: command, objective: command, lane: "ui", risk: "low", authority: "A1_DRAFT" },
  ])("rejects text or policy that does not match the registered contract", (outcome) => {
    expect(resolveHermesWorkContract(outcome)).toBeNull()
  })

  it("makes an unregistered production outcome a terminal work-contract wall", () => {
    expect(() => requireHermesWorkContract({
      command: "Improve anything useful",
      lane: "ui",
      risk: "low",
      authority: "A2_WRITE_OWN",
    })).toThrow(expect.objectContaining({ code: "HERMES_WORK_CONTRACT_WALL" }))
  })
})
