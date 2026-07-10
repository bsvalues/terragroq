export type OperatorRiskClass = "R0" | "R1" | "R2" | "R3" | "R4"
export type OperatorWorkOrderStatus = "PENDING" | "READY" | "COMPLETE" | "BLOCKED"

export type OperatorGoalContract = {
  goalId: string
  title: string
  system: string
  owner: "Primary"
  operator: "Codex"
  purpose: string
  desiredState: string
  currentBase: string
  riskCeiling: OperatorRiskClass
  standingOperatorAuthority: string[]
  allowed: string[]
  blocked: string[]
  successCriteria: string[]
  validationRequired: string[]
  mergePolicy: "CODEX_ELIGIBLE"
  productionPolicy: "READ_ONLY_VERIFY"
  initialLoop: string
  initialWorkOrder: string
}

export type OperatorLoopContract = {
  loopId: string
  goalId: string
  programId: string
  operator: "Codex"
  mode: "SEQUENTIAL"
  startFrom: string
  continueUntil: "GOAL_COMPLETE_OR_AUTHORITY_WALL"
  selectionRule: string
  batchRule: string
  baselineRule: string
  validationRule: string
  reviewRule: string
  mergeRule: string
  postMergeRule: string
  evidenceRule: string
  retryRule: string
  stopWalls: string[]
}

export type OperatorWorkOrderRecord = {
  workOrderId: string
  title: string
  phase: "FOUNDATION" | "CONTRACTS" | "CONTINUATION" | "ALIGNMENT" | "ADOPTION"
  riskClass: "R0" | "R1"
  dependsOn: string[]
  purpose: string
  status: OperatorWorkOrderStatus
  mergeAuthority: "CODEX_ELIGIBLE"
  evidencePath: string
  nextOnPass: string
}

export type OperatorProgramRecord = {
  documentId: "WILLIAMOS-CODEX-OPERATOR-PLAYBOOK-001"
  version: "1.0"
  programId: "PROGRAM-WILLIAMOS-CODEX-OPERATOR-001"
  status: "ACTIVE" | "COMPLETE"
  provenance: "DECLARED"
  ownerRole: "Primary / authority owner"
  operatorRole: "Codex Work Order Operator"
  goal: OperatorGoalContract
  loop: OperatorLoopContract
  workOrders: OperatorWorkOrderRecord[]
  safety: {
    staticReadOnlyProductModel: true
    commandRunnerAdded: false
    autonomousRuntimeLoopAdded: false
    backgroundWorkerAdded: false
    productionWriteAdded: false
    authChanged: false
    databaseOrSchemaChanged: false
    envOrPackageChanged: false
    hermesMcpWorkerActivated: false
    memoryWriteAdded: false
    dynamicIngestionAdded: false
    terraFusionPacsTouched: false
    secretsExposed: false
  }
}

export const CODEX_OPERATOR_GOAL: OperatorGoalContract = {
  goalId: "GOAL-WOS-CODEX-OPERATOR-001",
  title: "WilliamOS Codex Operator System",
  system: "WilliamOS / TerraGroq",
  owner: "Primary",
  operator: "Codex",
  purpose:
    "Make Codex the day-to-day Work Order Operator while the Primary retains consequential authority.",
  desiredState:
    "A deterministic, evidence-backed operating contract carries eligible R0/R1 work from goal intake through verified completion without making the Owner a courier.",
  currentBase: "47cdcc03eafc04b601ce477ae8f1cb383b6e0125",
  riskCeiling: "R1",
  standingOperatorAuthority: [
    "Inspect current truth and classify dirty state.",
    "Create branches or worktrees and edit registered R0/R1 scope.",
    "Run validation, commit, push, open and maintain pull requests.",
    "Remediate narrow review feedback and merge eligible R0/R1 pull requests.",
    "Verify origin/main and required read-only production routes.",
    "Record evidence and continue to the next dependency-ready Work Order.",
  ],
  allowed: [
    "Static governance models and registries",
    "Read-only operator console surfaces",
    "Documentation, Academy, Wiki, tests, and evidence reports",
    "Normal Git and pull-request lifecycle inside registered scope",
  ],
  blocked: [
    "Command runner, shell bridge, scheduler, background worker, or autonomous runtime loop",
    "Auth behavior, access policy, public signup, credentials, or secrets",
    "Database, schema, data, environment, package, dependency, or Vercel change",
    "Hermes, MCP, external worker, Agent Forge skill, or Brain Council runtime activation",
    "Memory write, runtime retrieval, vector store, embeddings, RAG, or dynamic ingestion",
    "Production write, deploy, release, tag, TerraFusion, PACS, or county-system mutation",
  ],
  successCriteria: [
    "Canonical goal, loop, Work Order, evidence, stop, and decision contracts are registered.",
    "The next-WO resolver and continuation evaluator are deterministic and read-only.",
    "The operator console exposes current truth, evidence, stop walls, and next action without controls.",
    "Adversarial tests prove routine continuation and consequential authority walls.",
    "A real low-risk pilot completes through merge and post-merge verification.",
  ],
  validationRequired: [
    "Focused operator tests",
    "git diff --check",
    "npm run lint",
    "npm test -- --run",
    "NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build",
    "Pull-request checks and zero unresolved substantive review threads",
    "Read-only production route verification",
  ],
  mergePolicy: "CODEX_ELIGIBLE",
  productionPolicy: "READ_ONLY_VERIFY",
  initialLoop: "LOOP-WOS-CODEX-OPERATOR-001",
  initialWorkOrder: "WO-CODEX-OPERATOR-001",
}

export const CODEX_OPERATOR_LOOP: OperatorLoopContract = {
  loopId: "LOOP-WOS-CODEX-OPERATOR-001",
  goalId: CODEX_OPERATOR_GOAL.goalId,
  programId: "PROGRAM-WILLIAMOS-CODEX-OPERATOR-001",
  operator: "Codex",
  mode: "SEQUENTIAL",
  startFrom: "WO-CODEX-OPERATOR-001",
  continueUntil: "GOAL_COMPLETE_OR_AUTHORITY_WALL",
  selectionRule: "Select the first incomplete Work Order whose declared dependencies are complete.",
  batchRule: "Adjacent same-risk Work Orders may share a branch and pull request when evidence stays distinct.",
  baselineRule: "Refresh origin/main, branch, dirty state, pull-request state, and required live routes before relying on declared state.",
  validationRule: "Run focused tests plus diff, lint, full tests, build, review, check, secret, and scope gates.",
  reviewRule: "Remediate substantive in-scope feedback; stop only when a comment requires broader or higher-risk authority.",
  mergeRule: "Squash-merge eligible R0/R1 pull requests when all local and remote gates pass.",
  postMergeRule: "Verify origin/main and required read-only production routes, then record evidence.",
  evidenceRule: "Every completion claim records observable validation, PR, review, merge, and safety proof.",
  retryRule: "Retry or narrowly repair recoverable in-scope failures without returning routine work to the Owner.",
  stopWalls: [...CODEX_OPERATOR_GOAL.blocked],
}

type WorkOrderSeed = readonly [
  title: string,
  phase: OperatorWorkOrderRecord["phase"],
  riskClass: OperatorWorkOrderRecord["riskClass"],
  dependencies: number[],
  purpose: string,
]

const WORK_ORDER_SEEDS: WorkOrderSeed[] = [
  ["Playbook Canonicalization and Supersession Audit", "FOUNDATION", "R0", [], "Adopt one canonical operator playbook and identify superseded guidance."],
  ["Role and Responsibility Contract", "FOUNDATION", "R0", [1], "Assign routine operation to Codex and consequential authority to the Primary."],
  ["Authority and Risk Registry", "FOUNDATION", "R0", [2], "Encode R0-R4 risk, standing permissions, merge eligibility, and authority walls."],
  ["/goal Contract", "CONTRACTS", "R0", [3], "Define owner-approved intent, boundaries, success, and standing authority."],
  ["/loop Contract", "CONTRACTS", "R0", [4], "Define governed repeated execution and continuation semantics."],
  ["Work Order Contract", "CONTRACTS", "R0", [4, 5], "Standardize bounded mutation and proof packets with dependencies."],
  ["Evidence and Completion Contract", "CONTRACTS", "R0", [6], "Define observable Work Order, batch, and goal completion proof."],
  ["Program Playbook Register", "CONTINUATION", "R0", [4, 5, 6, 7], "Register program, goal, loop, Work Orders, status, and evidence lineage."],
  ["Next-WO Resolver", "CONTINUATION", "R1", [8], "Select the next dependency-ready Work Order deterministically without mutation."],
  ["Continuation Gate Evaluator", "CONTINUATION", "R1", [3, 5, 9], "Decide continue, remediate, complete, or stop using typed reason codes."],
  ["/stop and Owner Decision Queue", "CONTINUATION", "R1", [10], "Create decision-ready, resumable authority-wall packets."],
  ["Git and Worktree Operator Doctrine", "CONTINUATION", "R0", [2, 3], "Define safe branch, worktree, dirty-state, and non-destructive defaults."],
  ["PR, Review, and CI Operator Doctrine", "CONTINUATION", "R0", [7, 12], "Assign the complete pull-request and review lifecycle to Codex."],
  ["Eligible Merge and Post-Merge Doctrine", "CONTINUATION", "R0", [3, 7, 13], "Define eligible merge gates and post-merge proof."],
  ["Current Truth State Model", "ALIGNMENT", "R1", [8, 9, 10, 11, 12, 13, 14], "Represent observed, declared, stale, unknown, blocked, and next-action state."],
  ["Operator Console Surface", "ALIGNMENT", "R1", [15], "Present read-only operator truth, progress, evidence, walls, and next action."],
  ["Evidence/Trace/Memory Cross-References", "ALIGNMENT", "R1", [7, 15], "Link operator work to existing static proof and governance layers."],
  ["Academy/Wiki Operator Curriculum", "ALIGNMENT", "R0", [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], "Teach the canonical operator system and anti-courier doctrine."],
  ["Command and Program Map Alignment", "ALIGNMENT", "R0", [8, 18], "Give goal, loop, status, resume, and stop semantics one meaning everywhere."],
  ["Adversarial Continuation Tests", "ADOPTION", "R1", [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], "Prove ordinary continuation and consequential authority walls."],
  ["Existing Program Migration", "ADOPTION", "R0", [19, 20], "Adopt the new schema prospectively without reopening completed goals."],
  ["End-to-End Low-Risk Pilot", "ADOPTION", "R1", Array.from({ length: 21 }, (_, index) => index + 1), "Operate one real R0/R1 goal through verified merge without owner courier work."],
  ["Safety and Secret Sweep", "ADOPTION", "R0", [22], "Prove blocked runtime capabilities remain absent and no secrets entered the change."],
  ["Final Rollup and Operator Acceptance", "ADOPTION", "R0", Array.from({ length: 23 }, (_, index) => index + 1), "Prove the complete goal and establish the doctrine for future programs."],
]

function workOrderId(number: number) {
  return `WO-CODEX-OPERATOR-${String(number).padStart(3, "0")}`
}

function evidencePath(number: number) {
  if (number <= 21) return "docs/reports/WO-CODEX-OPERATOR-001-021-adoption-evidence.md"
  if (number === 22) return "docs/reports/WO-CODEX-OPERATOR-022-low-risk-pilot.md"
  if (number === 23) return "docs/reports/WO-CODEX-OPERATOR-023-safety-secret-sweep.md"
  return "docs/reports/WO-CODEX-OPERATOR-024-final-rollup.md"
}

export const CODEX_OPERATOR_WORK_ORDERS: OperatorWorkOrderRecord[] = WORK_ORDER_SEEDS.map(
  ([title, phase, riskClass, dependencies, purpose], index) => {
    const number = index + 1
    return {
      workOrderId: workOrderId(number),
      title,
      phase,
      riskClass,
      dependsOn: dependencies.map(workOrderId),
      purpose,
      status: number <= 21 ? "COMPLETE" : number === 22 ? "READY" : "PENDING",
      mergeAuthority: "CODEX_ELIGIBLE",
      evidencePath: evidencePath(number),
      nextOnPass: number === 24 ? "GOAL_REVIEW" : workOrderId(number + 1),
    }
  },
)

export function getCodexOperatorProgram(): OperatorProgramRecord {
  return {
    documentId: "WILLIAMOS-CODEX-OPERATOR-PLAYBOOK-001",
    version: "1.0",
    programId: "PROGRAM-WILLIAMOS-CODEX-OPERATOR-001",
    status: "ACTIVE",
    provenance: "DECLARED",
    ownerRole: "Primary / authority owner",
    operatorRole: "Codex Work Order Operator",
    goal: CODEX_OPERATOR_GOAL,
    loop: CODEX_OPERATOR_LOOP,
    workOrders: CODEX_OPERATOR_WORK_ORDERS,
    safety: {
      staticReadOnlyProductModel: true,
      commandRunnerAdded: false,
      autonomousRuntimeLoopAdded: false,
      backgroundWorkerAdded: false,
      productionWriteAdded: false,
      authChanged: false,
      databaseOrSchemaChanged: false,
      envOrPackageChanged: false,
      hermesMcpWorkerActivated: false,
      memoryWriteAdded: false,
      dynamicIngestionAdded: false,
      terraFusionPacsTouched: false,
      secretsExposed: false,
    },
  }
}
