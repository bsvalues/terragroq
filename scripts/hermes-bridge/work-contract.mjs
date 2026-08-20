import { createHash } from "node:crypto"

export const HERMES_WORK_CONTRACT_VERSION = "hermes-work-contract.v1"
export const HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_ID = "selected-thread-latest-evidence.v1"
export const HERMES_ISSUE_911_RELIABILITY_CONTRACT_ID = "issue-911-runtime-reliability-evidence.v1"

const REGISTERED_INTENT = "add a compact on-screen latest-evidence timestamp to selected thread work status"
const REGISTERED_ISSUE_911_INTENT = "record structured #911 reliability remediation without host mutation"

function normalizeIntent(value) {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toLowerCase()
  return normalized || null
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

const SELECTED_THREAD_LATEST_EVIDENCE = Object.freeze({
  version: HERMES_WORK_CONTRACT_VERSION,
  id: HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_ID,
  repository: "bsvalues/terragroq",
  lane: "ui",
  reservations: Object.freeze([
    "components/workbench/outcome-execution-control.tsx",
    "lib/workbench/thread-trust.ts",
    "tests/outcome-execution-control-rendered.test.tsx",
  ]),
  validationCommands: Object.freeze([
    Object.freeze({
      command: "npx",
      args: Object.freeze(["vitest", "run", "tests/outcome-execution-control-rendered.test.tsx"]),
      timeoutMs: 5 * 60 * 1000,
    }),
    Object.freeze({
      command: "npm",
      args: Object.freeze(["run", "lint"]),
      timeoutMs: 10 * 60 * 1000,
    }),
    Object.freeze({
      command: "npm",
      args: Object.freeze(["run", "build"]),
      env: Object.freeze({ NEXT_PRIVATE_BUILD_WORKER: "0", NEXT_TELEMETRY_DISABLED: "1" }),
      timeoutMs: 15 * 60 * 1000,
    }),
  ]),
})

export const HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST = sha256(
  SELECTED_THREAD_LATEST_EVIDENCE,
)

const ISSUE_911_RELIABILITY_EVIDENCE = Object.freeze({
  version: HERMES_WORK_CONTRACT_VERSION,
  id: HERMES_ISSUE_911_RELIABILITY_CONTRACT_ID,
  repository: "bsvalues/terragroq",
  lane: "operator-objective",
  reservations: Object.freeze([
    "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md",
  ]),
  validationCommands: Object.freeze([
    Object.freeze({
      command: "git",
      args: Object.freeze(["diff", "--check"]),
      timeoutMs: 5 * 60 * 1000,
    }),
    Object.freeze({
      command: "npx",
      args: Object.freeze(["vitest", "run", "tests/hermes-work-contract.test.ts"]),
      timeoutMs: 5 * 60 * 1000,
    }),
  ]),
  projection: Object.freeze({ issueNumber: 911, completionOwned: false }),
  delivery: Object.freeze({
    authorityLevel: "A2_WRITE_OWN",
    allowedActions: Object.freeze(["implement"]),
    commitAllowed: true,
    tagAllowed: false,
    pushAllowed: true,
  }),
})

export const HERMES_ISSUE_911_RELIABILITY_CONTRACT_DIGEST = sha256(
  ISSUE_911_RELIABILITY_EVIDENCE,
)

/**
 * Resolve an owner outcome to a reviewed, exact repository work contract.
 * Text selects no paths dynamically: it may only match a pre-registered contract.
 */
export function resolveHermesWorkContract(outcome) {
  if (!outcome || typeof outcome !== "object") return null
  const command = normalizeIntent(outcome.command)
  const registered = command === REGISTERED_INTENT
    && outcome.lane === "ui"
    && ["low", "R1"].includes(outcome.risk)
    ? SELECTED_THREAD_LATEST_EVIDENCE
    : command === REGISTERED_ISSUE_911_INTENT
      && outcome.lane === "operator-objective"
      && outcome.risk === "R1"
      ? ISSUE_911_RELIABILITY_EVIDENCE
      : null
  if (!registered || outcome.authority !== "A2_WRITE_OWN") return null
  for (const field of [outcome.title, outcome.objective]) {
    if (field != null && normalizeIntent(field) !== command) return null
  }
  return Object.freeze({
    ...registered,
    digest: registered === SELECTED_THREAD_LATEST_EVIDENCE
      ? HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST
      : HERMES_ISSUE_911_RELIABILITY_CONTRACT_DIGEST,
  })
}
