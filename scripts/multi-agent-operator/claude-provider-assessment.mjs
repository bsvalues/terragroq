import crypto from "node:crypto"

const OWNER_COUNTERS = Object.freeze({
  OWNER_OPERATION_TOUCH_COUNT: 0,
  OWNER_CREDENTIAL_TOUCH_COUNT: 0,
  OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
  OWNER_ROUTINE_DECISION_COUNT: 0,
  OWNER_ROUTINE_CONTACT_COUNT: 0,
})

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

const CLAIMS = Object.freeze({
  schemaVersion: 1,
  artifactType: "STATIC_PROVIDER_CAPABILITY_ASSESSMENT",
  workOrderId: "WO-MAO-032",
  providerId: "claude-code",
  assessmentStatus: "COMPLETE_PROVIDER_ASSESSMENT",
  availability: "UNAVAILABLE",
  reasonCode: "PROVIDER_UNAVAILABLE",
  enabled: false,
  maxConcurrency: 0,
  serviceCompatible: false,
  trustGateStatus: "NOT_EVALUATED_NO_TRANSPORT",
  lifecycleState: "DEFERRED",
  continuationPolicy: "DEFER_AFFECTED_LANE_CONTINUE_HEALTHY_PROVIDERS",
  resumable: true,
  codexLaneStatus: "ELIGIBLE_UNAFFECTED",
  ownerDecisionRequired: false,
  assessmentMethod: "STATIC_REPOSITORY_EVIDENCE_ONLY",
  evidenceRefs: Object.freeze([
    "AGENTS.md#multi-agent-execution",
    "components/operator/multi-agent-capability-registry.ts#claude-code-provider",
    "docs/governance/multi-agent-operator-playbook.md#phase-4-provider-adapters-and-federation",
  ]),
  prohibitedOperationsPerformed: Object.freeze({
    claudeCommand: false,
    claudeVersionProbe: false,
    authenticationProbe: false,
    credentialInspection: false,
    networkProbe: false,
    smokeExecution: false,
    runtimeActivation: false,
    githubOperation: false,
    ownerContact: false,
  }),
  ownerOperationCounters: OWNER_COUNTERS,
  authorityGranted: false,
  dispatchPerformed: false,
})

export function createStaticClaudeProviderAssessment() {
  const contentHash = crypto.createHash("sha256").update(canonicalJson(CLAIMS)).digest("hex")
  return Object.freeze({ ...CLAIMS, contentHash })
}

export function verifyStaticClaudeProviderAssessment(input) {
  const expected = createStaticClaudeProviderAssessment()
  if (canonicalJson(input) !== canonicalJson(expected)) {
    const error = new Error("CLAUDE_PROVIDER_ASSESSMENT_MISMATCH")
    error.code = "CLAUDE_PROVIDER_ASSESSMENT_MISMATCH"
    throw error
  }
  return Object.freeze({
    ok: true,
    code: "CLAUDE_PROVIDER_ASSESSMENT_VALID",
    assessment: expected,
    staticOnly: true,
    providerInvoked: false,
    authorityGranted: false,
  })
}

export const CLAUDE_PROVIDER_OWNER_COUNTERS = OWNER_COUNTERS
