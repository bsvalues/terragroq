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
  HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_DIGEST,
  HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_ID,
  isExactIssue911LiveAcceptanceContract,
  deriveHermesWorkContract,
  resolveHermesWorkContract,
  resolveOrDeriveHermesWorkContract,
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

  it("selects the live-acceptance contract only from its exact persisted singleton marker", () => {
    const issue911Intent = "record structured #911 reliability remediation without host mutation"
    const contract = resolveHermesWorkContract({
      command: issue911Intent,
      title: issue911Intent,
      objective: issue911Intent,
      lane: "operator-objective",
      risk: "R1",
      authority: "A2_WRITE_OWN",
      acceptedContractIds: ["issue-911-live-nonempty-acceptance.v1"],
    })

    expect(contract).toEqual({
      version: HERMES_WORK_CONTRACT_VERSION,
      id: HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_ID,
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
      acceptance: {
        evidencePath: "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md",
        requestedFindingClasses: [
          "ordinary_repository_follow_up",
          "owner_gated_host_storage_container_policy_or_scope_follow_up",
        ],
        emptyOrPartialAllowed: true,
        hostMutationAllowed: false,
        noFabrication: true,
        gatedDispatchAllowed: false,
      },
      digest: HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_DIGEST,
    })
    expect(contract?.digest).toMatch(/^[0-9a-f]{64}$/)
    const reordered = Object.fromEntries(Object.entries(contract!).reverse())
    reordered.acceptance = Object.fromEntries(Object.entries(contract!.acceptance!).reverse())
    expect(isExactIssue911LiveAcceptanceContract(reordered)).toBe(true)
    expect(isExactIssue911LiveAcceptanceContract({
      ...reordered,
      acceptance: { ...reordered.acceptance, noFabrication: false },
    })).toBe(false)
    expect(isExactIssue911LiveAcceptanceContract({ ...reordered, extra: true })).toBe(false)
  })

  it.each([
    { acceptedContractIds: [] },
    { acceptedContractIds: ["issue-911-runtime-reliability-evidence.v1"] },
    { acceptedContractIds: ["issue-911-live-nonempty-acceptance.v1", "extra"] },
    { acceptedContractIds: ["extra", "issue-911-live-nonempty-acceptance.v1"] },
  ])("does not re-derive live acceptance from unchanged intent with marker $acceptedContractIds", ({ acceptedContractIds }) => {
    const issue911Intent = "record structured #911 reliability remediation without host mutation"
    const contract = resolveHermesWorkContract({
      command: issue911Intent,
      title: issue911Intent,
      objective: issue911Intent,
      lane: "operator-objective",
      risk: "R1",
      authority: "A2_WRITE_OWN",
      acceptedContractIds,
    })

    if (acceptedContractIds.length === 0) {
      expect(contract?.id).toBe(HERMES_ISSUE_911_RELIABILITY_CONTRACT_ID)
    } else {
      expect(contract).toBeNull()
    }
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

describe("governed lane-policy derivation (owner invariant 2026-08-21)", () => {
  // A missing execution contract is system work to create, not a terminal wall. The LANE — a
  // structured governed field, never free text — selects a reviewed envelope; text selects no paths.
  const uiOutcome = {
    command: "Make the sign-in page speak to the owner with neutral copy",
    title: "Make the sign-in page speak to the owner with neutral copy",
    objective: null,
    lane: "ui",
    risk: "low",
    authority: "A2_WRITE_OWN",
  }

  it("derives a ui-lane contract for unregistered governed work, deterministic and schema-exact", () => {
    const contract = deriveHermesWorkContract(uiOutcome)
    expect(contract?.id).toBe("derived-lane-ui.v1")
    expect(contract?.repository).toBe("bsvalues/terragroq")
    // Client-owned paths only (review P1): a ui derivation must never reach lib/ (auth, sessions,
    // governance) or app/ (API routes).
    expect(contract?.reservations).toEqual(["components/", "tests/"])
    expect(contract?.digest).toMatch(/^[0-9a-f]{64}$/)
    // deterministic: idempotent replay hash-compares identically
    expect(deriveHermesWorkContract(uiOutcome)?.digest).toBe(contract?.digest)
    // exact schema parity with the runtime's contract shape check — no extra keys
    expect(Object.keys(contract ?? {}).sort()).toEqual(
      ["delivery", "digest", "id", "lane", "repository", "reservations", "validationCommands", "version"],
    )
  })

  it.each([
    ["lane with no policy", { ...uiOutcome, lane: "read_model" }],
    ["release lane (A9 territory)", { ...uiOutcome, lane: "release" }],
    ["auth lane (A6 territory)", { ...uiOutcome, lane: "auth" }],
    ["insufficient authority", { ...uiOutcome, authority: "A1_DRAFT" }],
    ["elevated authority is not derivable either", { ...uiOutcome, authority: "A9_RELEASE" }],
    ["risk above the envelope", { ...uiOutcome, risk: "R2" }],
  ])("refuses derivation for %s — true boundaries remain walls", (_label, outcome) => {
    expect(deriveHermesWorkContract(outcome)).toBeNull()
  })

  it("registered contracts always take precedence over derivation", () => {
    const registered = resolveOrDeriveHermesWorkContract({
      command,
      title: command,
      objective: command,
      lane: "ui",
      risk: "low",
      authority: "A2_WRITE_OWN",
    })
    expect(registered?.digest).toBe(HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST)
    expect(registered?.id).not.toContain("derived")
  })

  it("falls through to derivation only when no registered contract matches", () => {
    expect(resolveOrDeriveHermesWorkContract(uiOutcome)?.id).toBe("derived-lane-ui.v1")
  })
})
