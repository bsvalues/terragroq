import assert from "node:assert/strict"
import test from "node:test"

import {
  AI_EVALOPS_CURRENT_STATUS,
  AI_EVALOPS_MATURITY_STATES,
  deriveAiEvalOpsStatusLabel,
  validateAiEvalOpsCurrentStatus,
  type AiEvalOpsCurrentStatus,
} from "../components/operator/ai-evalops-harness-status.ts"

const mutate = (changes: Partial<AiEvalOpsCurrentStatus>): AiEvalOpsCurrentStatus => ({
  ...AI_EVALOPS_CURRENT_STATUS,
  ...changes,
})

test("defines six distinct ordered maturity states", () => {
  assert.deepEqual(AI_EVALOPS_MATURITY_STATES, [
    "MODEL_VERIFIED", "CONTRACT_VERIFIED", "ADAPTER_PROVEN",
    "RECOVERY_PROVEN", "SOAK_PROVEN", "PRODUCTION_AUTHORIZED",
  ])
  assert.equal(new Set(AI_EVALOPS_MATURITY_STATES).size, 6)
})

test("accepts the canonical model-verified non-runtime projection", () => {
  assert.doesNotThrow(() => validateAiEvalOpsCurrentStatus(AI_EVALOPS_CURRENT_STATUS))
  assert.equal(AI_EVALOPS_CURRENT_STATUS.statusLabel, "MODEL_VERIFIED / RUNTIME_NOT_ACTIVE / PRODUCTION_NOT_AUTHORIZED")
  assert.equal(AI_EVALOPS_CURRENT_STATUS.evidence.contractVerified, false)
})

test("rejects a maturity skip", () => {
  const runtime = AI_EVALOPS_CURRENT_STATUS.runtime
  assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({
    currentMaturity: "RECOVERY_PROVEN",
    statusLabel: deriveAiEvalOpsStatusLabel({ currentMaturity: "RECOVERY_PROVEN", runtime }),
    evidence: { ...AI_EVALOPS_CURRENT_STATUS.evidence, contractVerified: false, adapterProven: true, recoveryProven: true },
  })), /maturity skip: CONTRACT_VERIFIED/)
})

test("rejects adapter evidence above current maturity", () => {
  assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({
    evidence: { ...AI_EVALOPS_CURRENT_STATUS.evidence, adapterProven: true },
  })), /maturity overclaim/)
})

test("rejects scheduler, worker, or runtime activation below adapter proof", () => {
  for (const field of ["schedulerActive", "backgroundWorkerActive", "runtimeActivated"] as const) {
    const runtime = { ...AI_EVALOPS_CURRENT_STATUS.runtime, [field]: true }
    assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({
      runtime,
      statusLabel: deriveAiEvalOpsStatusLabel({ currentMaturity: "MODEL_VERIFIED", runtime }),
    })), /runtime overclaim/)
  }
})

test("rejects production authority without the final maturity state", () => {
  const runtime = { ...AI_EVALOPS_CURRENT_STATUS.runtime, productionAuthorized: true }
  assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({
    runtime,
    statusLabel: deriveAiEvalOpsStatusLabel({ currentMaturity: "MODEL_VERIFIED", runtime }),
  })), /production authority claim conflicts/)
})

test("rejects a prose status label that conflicts with structured truth", () => {
  assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({
    statusLabel: "SOAK_PROVEN / RUNTIME_ACTIVE / PRODUCTION_AUTHORIZED",
  })), /status label conflicts/)
})

test("rejects weakening issue 357 terminal quarantine", () => {
  assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({
    runtime: { ...AI_EVALOPS_CURRENT_STATUS.runtime, issue357QuarantinedTerminal: false },
  })), /quarantine must remain terminal/)
})

test("rejects mutable or duplicate historical references", () => {
  const duplicate = AI_EVALOPS_CURRENT_STATUS.historyReferences[0]
  assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({ historyReferences: [duplicate, duplicate] })), /unique/)
  assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({
    historyReferences: [{ ...duplicate, immutable: false } as never],
  })), /immutable/)
})

test("rejects an internally consistent claim that remains future-gated", () => {
  const currentMaturity = "CONTRACT_VERIFIED" as const
  assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({
    currentMaturity,
    statusLabel: deriveAiEvalOpsStatusLabel({ currentMaturity, runtime: AI_EVALOPS_CURRENT_STATUS.runtime }),
    evidence: { ...AI_EVALOPS_CURRENT_STATUS.evidence, contractVerified: true },
  })), /unsupported CONTRACT_VERIFIED claim remains future-gated/)
})

test("rejects evidenced maturity whose reference is not digest-bound history", () => {
  assert.throws(() => validateAiEvalOpsCurrentStatus(mutate({
    maturityGates: {
      ...AI_EVALOPS_CURRENT_STATUS.maturityGates,
      MODEL_VERIFIED: { status: "EVIDENCED", evidencePaths: ["docs/reports/missing.md"], requiredWorkOrders: [] },
    },
  })), /unbound history reference/)
})
