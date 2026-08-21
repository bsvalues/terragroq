import { createHash } from "node:crypto"

export const HERMES_WORK_CONTRACT_VERSION = "hermes-work-contract.v1"
export const HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_ID = "selected-thread-latest-evidence.v1"
export const HERMES_ISSUE_911_RELIABILITY_CONTRACT_ID = "issue-911-runtime-reliability-evidence.v1"
export const HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_ID = "issue-911-live-nonempty-acceptance.v1"

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

const ISSUE_911_LIVE_ACCEPTANCE = Object.freeze({
  ...ISSUE_911_RELIABILITY_EVIDENCE,
  id: HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_ID,
  acceptance: Object.freeze({
    evidencePath: "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md",
    requestedFindingClasses: Object.freeze([
      "ordinary_repository_follow_up",
      "owner_gated_host_storage_container_policy_or_scope_follow_up",
    ]),
    emptyOrPartialAllowed: true,
    hostMutationAllowed: false,
    noFabrication: true,
    gatedDispatchAllowed: false,
  }),
})

export const HERMES_ISSUE_911_RELIABILITY_CONTRACT_DIGEST = sha256(
  ISSUE_911_RELIABILITY_EVIDENCE,
)
export const HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_DIGEST = sha256(
  ISSUE_911_LIVE_ACCEPTANCE,
)

export function isExactIssue911LiveAcceptanceContract(value) {
  if (!value || typeof value !== "object") return false
  const exactKeys = (candidate, keys) => candidate && typeof candidate === "object"
    && Object.keys(candidate).sort().join(",") === [...keys].sort().join(",")
  if (!exactKeys(value, [
    "version", "id", "repository", "lane", "reservations", "validationCommands",
    "projection", "delivery", "acceptance", "digest",
  ]) || !exactKeys(value.projection, ["issueNumber", "completionOwned"])
    || !exactKeys(value.delivery, [
      "authorityLevel", "allowedActions", "commitAllowed", "tagAllowed", "pushAllowed",
    ]) || !exactKeys(value.acceptance, [
      "evidencePath", "requestedFindingClasses", "emptyOrPartialAllowed",
      "hostMutationAllowed", "noFabrication", "gatedDispatchAllowed",
    ]) || !Array.isArray(value.validationCommands)
    || value.validationCommands.some((command) => !exactKeys(command, [
      "command", "args", "timeoutMs",
    ]))) return false
  const reconstructed = {
    version: value.version,
    id: value.id,
    repository: value.repository,
    lane: value.lane,
    reservations: value.reservations,
    validationCommands: value.validationCommands.map((command) => ({
      command: command.command,
      args: command.args,
      timeoutMs: command.timeoutMs,
    })),
    projection: {
      issueNumber: value.projection.issueNumber,
      completionOwned: value.projection.completionOwned,
    },
    delivery: {
      authorityLevel: value.delivery.authorityLevel,
      allowedActions: value.delivery.allowedActions,
      commitAllowed: value.delivery.commitAllowed,
      tagAllowed: value.delivery.tagAllowed,
      pushAllowed: value.delivery.pushAllowed,
    },
    acceptance: {
      evidencePath: value.acceptance.evidencePath,
      requestedFindingClasses: value.acceptance.requestedFindingClasses,
      emptyOrPartialAllowed: value.acceptance.emptyOrPartialAllowed,
      hostMutationAllowed: value.acceptance.hostMutationAllowed,
      noFabrication: value.acceptance.noFabrication,
      gatedDispatchAllowed: value.acceptance.gatedDispatchAllowed,
    },
  }
  return value.digest === HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_DIGEST
    && sha256(reconstructed) === HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_DIGEST
}

/**
 * Resolve an owner outcome to a reviewed, exact repository work contract.
 * Text selects no paths dynamically: it may only match a pre-registered contract.
 */
export function resolveHermesWorkContract(outcome) {
  if (!outcome || typeof outcome !== "object") return null
  const command = normalizeIntent(outcome.command)
  const acceptedContractIds = outcome.acceptedContractIds === undefined
    ? []
    : outcome.acceptedContractIds
  if (!Array.isArray(acceptedContractIds)
    || acceptedContractIds.some((value) => typeof value !== "string")) return null
  const defaultContractSelection = acceptedContractIds.length === 0
  const liveAcceptanceSelection = acceptedContractIds.length === 1
    && acceptedContractIds[0] === HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_ID
  const registered = command === REGISTERED_INTENT
    && defaultContractSelection
    && outcome.lane === "ui"
    && ["low", "R1"].includes(outcome.risk)
    ? SELECTED_THREAD_LATEST_EVIDENCE
    : command === REGISTERED_ISSUE_911_INTENT
      && outcome.lane === "operator-objective"
      && outcome.risk === "R1"
      && (defaultContractSelection || liveAcceptanceSelection)
      ? liveAcceptanceSelection
        ? ISSUE_911_LIVE_ACCEPTANCE
        : ISSUE_911_RELIABILITY_EVIDENCE
      : null
  if (!registered || outcome.authority !== "A2_WRITE_OWN") return null
  for (const field of [outcome.title, outcome.objective]) {
    if (field != null && normalizeIntent(field) !== command) return null
  }
  return Object.freeze({
    ...registered,
    digest: registered === SELECTED_THREAD_LATEST_EVIDENCE
      ? HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST
      : registered === ISSUE_911_LIVE_ACCEPTANCE
        ? HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_DIGEST
        : HERMES_ISSUE_911_RELIABILITY_CONTRACT_DIGEST,
  })
}
