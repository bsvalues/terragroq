import { sql } from "drizzle-orm"
import {
  check,
  pgTable,
  text,
  timestamp,
  boolean,
  serial,
  integer,
  jsonb,
  vector,
  index,
  unique,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core"

const utcWallTimestamp = customType<{ data: Date; driverData: string | Date }>({
  dataType() {
    return "timestamp"
  },
  toDriver(value) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error("AUTHORITY_TIMESTAMP_INVALID")
    }
    return value.toISOString().slice(0, -1).replace("T", " ")
  },
  fromDriver(value) {
    if (value instanceof Date) {
      return new Date(Date.UTC(
        value.getFullYear(),
        value.getMonth(),
        value.getDate(),
        value.getHours(),
        value.getMinutes(),
        value.getSeconds(),
        value.getMilliseconds(),
      ))
    }
    const normalized = value.trim().replace(" ", "T")
    const instant = new Date(/[zZ]$|[+-]\d\d(?::?\d\d)?$/.test(normalized)
      ? normalized
      : `${normalized}Z`)
    if (!Number.isFinite(instant.getTime())) throw new Error("AUTHORITY_TIMESTAMP_INVALID")
    return instant
  },
})

/* ------------------------------------------------------------------ */
/* Better Auth tables (camelCase columns required by Better Auth)      */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

/* ------------------------------------------------------------------ */
/* WilliamOS governance registers                                      */
/* ------------------------------------------------------------------ */

// Memory: durable facts about the operator and their world, embedded for recall.
// Authority lifecycle (Track B governance):
//   intake | unreviewed | working | reviewed | canon | deprecated | superseded | archived
export const memoryFact = pgTable("memory_fact", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  content: text("content").notNull(),
  kind: text("kind").default("fact").notNull(), // fact | preference | identity | relationship
  source: text("source"),
  confidence: text("confidence").default("medium").notNull(), // low | medium | high
  authority: text("authority").default("unreviewed").notNull(),
  stale: boolean("stale").default(false).notNull(),
  tags: text("tags").array().default([]).notNull(),
  pinned: boolean("pinned").default(false).notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  reviewedAt: timestamp("reviewedAt"),
  lastUsedAt: timestamp("lastUsedAt"),
  supersededById: integer("supersededById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

// Decisions: the decision register (ADR-style) with status lifecycle.
// status:    proposed | accepted | superseded | rejected
// authority: binding (enforced, injected into agent context) | advisory | informational
export const decision = pgTable("decision", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // ADR-0001 style human reference
  title: text("title").notNull(),
  context: text("context"),
  decision: text("decision").notNull(),
  rationale: text("rationale"),
  consequences: text("consequences"),
  status: text("status").default("proposed").notNull(),
  authority: text("authority").default("advisory").notNull(),
  owner: text("owner").default("Bill").notNull(),
  scope: text("scope"),
  evidence: text("evidence").array().default([]).notNull(),
  tags: text("tags").array().default([]).notNull(),
  locked: boolean("locked").default(false).notNull(), // seeded governance decisions
  supersedesId: integer("supersedesId"),
  supersededById: integer("supersededById"),
  reviewAt: timestamp("reviewAt"),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

// Doctrine: machine-readable operating rules that govern behavior.
// status: active | superseded | retired
export const doctrine = pgTable("doctrine", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // RULE-0001 style human reference
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  category: text("category").default("principle").notNull(), // principle | policy | guardrail
  scope: text("scope"),
  status: text("status").default("active").notNull(),
  priority: integer("priority").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  allowed: text("allowed").array().default([]).notNull(),
  forbidden: text("forbidden").array().default([]).notNull(),
  requiresApproval: text("requiresApproval").array().default([]).notNull(),
  evidence: text("evidence").array().default([]).notNull(),
  owner: text("owner").default("Bill").notNull(),
  locked: boolean("locked").default(false).notNull(), // seeded doctrine
  supersedesId: integer("supersedesId"),
  supersededById: integer("supersededById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

// Work Orders: governed units of work (Track E — Work Order Engine).
// status lifecycle (8): draft | proposed | approved | active | blocked | review | closed | aborted
export const workOrder = pgTable("work_order", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // WO-0001 style human reference
  title: text("title").notNull(),
  description: text("description"),
  // The WO object (operator-grade contract)
  goal: text("goal"),
  loop: text("loop"), // the execution loop discipline for this WO
  scope: text("scope"),
  nonGoals: text("nonGoals").array().default([]).notNull(),
  allowedFiles: text("allowedFiles").array().default([]).notNull(),
  forbiddenFiles: text("forbiddenFiles").array().default([]).notNull(),
  validators: text("validators").array().default([]).notNull(),
  stopConditions: text("stopConditions").array().default([]).notNull(),
  lane: text("lane"), // e.g. "A — docs only", "client surface only"
  phase: text("phase"),
  status: text("status").default("draft").notNull(),
  priority: text("priority").default("medium").notNull(), // low | medium | high | critical
  assignee: text("assignee"),
  // Authority model (§6) + approval gate (§9)
  authorityLevel: text("authorityLevel").default("A0_READ_ONLY").notNull(), // requested A0–A9
  authorityGranted: text("authorityGranted"), // display mirror of the active grant
  authorityGrantId: integer("authorityGrantId"), // FK → authority_grant (WO-011, source of truth)
  acceptanceCriteria: text("acceptanceCriteria").array().default([]).notNull(),
  agent: text("agent"), // codex | claude | copilot | local | null — Agent Permission Matrix (§14)
  approvedBy: text("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  linkedDecisionId: integer("linkedDecisionId"),
  // Evidence & closure
  evidence: text("evidence").array().default([]).notNull(),
  result: text("result"), // PASS | FAIL | PARTIAL | null
  commitRef: text("commitRef"),
  tagRef: text("tagRef"),
  // Release gates (default closed — require explicit approval)
  commitAllowed: boolean("commitAllowed").default(false).notNull(),
  tagAllowed: boolean("tagAllowed").default(false).notNull(),
  pushAllowed: boolean("pushAllowed").default(false).notNull(),
  // Lineage
  supersedesId: integer("supersedesId"),
  supersededById: integer("supersededById"),
  dueAt: timestamp("dueAt"),
  closedAt: timestamp("closedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

/* ------------------------------------------------------------------ */
/* RAG corpus                                                          */
/* ------------------------------------------------------------------ */

export const document = pgTable("document", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  title: text("title").notNull(),
  source: text("source"),
  mimeType: text("mimeType").default("text/plain").notNull(),
  content: text("content").notNull(),
  chunkCount: integer("chunkCount").default(0).notNull(),
  status: text("status").default("indexed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

export const documentChunk = pgTable("document_chunk", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  documentId: integer("documentId").notNull(),
  chunkIndex: integer("chunkIndex").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

/* ------------------------------------------------------------------ */
/* Goal register (Goal Console — the /goal + /loop operating system)   */
/* ------------------------------------------------------------------ */

// Every operator goal is classified and persisted here before any execution.
// status: classified | converted | dismissed
export const goal = pgTable("goal", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // GOAL-0001 style human reference
  command: text("command").notNull(),
  // Classification (deterministic engine output)
  lane: text("lane").notNull(),
  mode: text("mode").notNull(),
  risk: text("risk").notNull(), // low | medium | high | critical
  authority: text("authority").default("A0_READ_ONLY").notNull(),
  verdict: text("verdict").notNull(), // allow | requires_approval | refuse
  rationale: text("rationale"),
  mistakePatterns: text("mistakePatterns").array().default([]).notNull(),
  matchedRules: text("matchedRules").array().default([]).notNull(),
  recommendedMove: text("recommendedMove"),
  requiresApproval: boolean("requiresApproval").default(false).notNull(),
  linkedWorkOrderId: integer("linkedWorkOrderId"),
  status: text("status").default("classified").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

/* ------------------------------------------------------------------ */
/* Durable outcome queue (WO-WOS-V1.2-001)                            */
/* ------------------------------------------------------------------ */

// Suggestions are intake only. An item is selectable only when its lifecycle,
// approval, current authority, dependencies, and lease state all independently
// satisfy the outcome-queue engine.
export const outcomeQueueItem = pgTable(
  "outcome_queue_item",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    outcomeKey: text("outcomeKey").notNull(),
    goalId: integer("goalId").references(() => goal.id, { onDelete: "set null" }),
    goalRef: text("goalRef"),
    title: text("title").notNull(),
    objective: text("objective"),
    queueOrder: integer("queueOrder").default(0).notNull(),
    dependencyKeys: text("dependencyKeys").array().default([]).notNull(),
    riskClass: text("riskClass").default("R1").notNull(),
    approvalState: text("approvalState").default("unapproved").notNull(),
    approvedBy: text("approvedBy"),
    approvedAt: timestamp("approvedAt", { withTimezone: true }),
    approvalDecisionId: integer("approvalDecisionId").references(() => decision.id, {
      onDelete: "set null",
    }),
    authorityState: text("authorityState").default("unverified").notNull(),
    authorityLevel: text("authorityLevel").default("A0_READ_ONLY").notNull(),
    authorityGrantRef: text("authorityGrantRef"),
    authoritySubject: text("authoritySubject").default("operator").notNull(),
    authorityAction: text("authorityAction").default("outcome:execute").notNull(),
    lifecycleState: text("lifecycleState").default("suggested").notNull(),
    lifecycleReason: text("lifecycleReason"),
    activeWorkOrderId: integer("activeWorkOrderId").references(() => workOrder.id, {
      onDelete: "set null",
    }),
    executionBinding: text("executionBinding"),
    leaseHolder: text("leaseHolder"),
    leaseToken: text("leaseToken"),
    leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true }),
    fencingToken: integer("fencingToken").default(0).notNull(),
    version: integer("version").default(0).notNull(),
    acquisitionKey: text("acquisitionKey"),
    terminalResult: text("terminalResult"),
    terminalEvidenceId: integer("terminalEvidenceId"),
    terminalEvidenceRefs: text("terminalEvidenceRefs").array().default([]).notNull(),
    terminalKey: text("terminalKey"),
    supersedesOutcomeKey: text("supersedesOutcomeKey"),
    supersededByOutcomeKey: text("supersededByOutcomeKey"),
    suggestedAt: timestamp("suggestedAt", { withTimezone: true }).defaultNow().notNull(),
    activatedAt: timestamp("activatedAt", { withTimezone: true }),
    terminalAt: timestamp("terminalAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("outcome_queue_item_user_key_idx").on(table.userId, table.outcomeKey),
    uniqueIndex("outcome_queue_item_user_acquisition_idx").on(table.userId, table.acquisitionKey),
    uniqueIndex("outcome_queue_item_user_terminal_idx").on(table.userId, table.terminalKey),
    uniqueIndex("outcome_queue_item_one_active_per_user_idx")
      .on(table.userId)
      .where(sql`${table.lifecycleState} = 'active'`),
    index("outcome_queue_item_selection_idx").on(
      table.userId,
      table.lifecycleState,
      table.approvalState,
      table.authorityState,
      table.queueOrder,
    ),
    index("outcome_queue_item_lease_idx").on(
      table.userId,
      table.lifecycleState,
      table.leaseExpiresAt,
    ),
    index("outcome_queue_item_goal_idx").on(table.goalId),
    index("outcome_queue_item_approval_decision_idx").on(table.approvalDecisionId),
    index("outcome_queue_item_work_order_idx").on(table.activeWorkOrderId),
    check(
      "outcome_queue_item_lifecycle_state_check",
      sql`${table.lifecycleState} IN ('suggested', 'approved', 'blocked', 'active', 'completed', 'declined', 'superseded')`,
    ),
    check(
      "outcome_queue_item_approval_state_check",
      sql`${table.approvalState} IN ('unapproved', 'approved', 'revoked')`,
    ),
    check(
      "outcome_queue_item_authority_state_check",
      sql`${table.authorityState} IN ('unverified', 'matched', 'denied', 'expired', 'revoked')`,
    ),
    check(
      "outcome_queue_item_nonnegative_fence_check",
      sql`${table.fencingToken} >= 0 AND ${table.version} >= 0`,
    ),
    check(
      "outcome_queue_item_active_binding_check",
      sql`${table.lifecycleState} <> 'active' OR (
        ${table.executionBinding} IS NOT NULL
        AND ${table.leaseHolder} IS NOT NULL
        AND ${table.leaseToken} IS NOT NULL
        AND ${table.leaseExpiresAt} IS NOT NULL
        AND ${table.acquisitionKey} IS NOT NULL
        AND ${table.fencingToken} > 0
      )`,
    ),
  ],
)

// Acquisition identities are permanent even after a queue row pauses or is
// acquired again. This prevents a delayed retry from selecting another outcome.
export const outcomeQueueAcquisitionReceipt = pgTable(
  "outcome_queue_acquisition_receipt",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    acquisitionKey: text("acquisitionKey").notNull(),
    outcomeKey: text("outcomeKey").notNull(),
    firstFencingToken: integer("firstFencingToken").notNull(),
    latestFencingToken: integer("latestFencingToken").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    unique("outcome_queue_acquisition_receipt_user_key_unique").on(
      table.userId,
      table.acquisitionKey,
    ),
    index("outcome_queue_acquisition_receipt_user_outcome_idx").on(
      table.userId,
      table.outcomeKey,
    ),
    check(
      "outcome_queue_acquisition_receipt_fence_check",
      sql`${table.firstFencingToken} > 0
        AND ${table.latestFencingToken} >= ${table.firstFencingToken}`,
    ),
  ],
)

// Exactly-once operator mutation receipts. The request hash and complete
// request/result bindings distinguish an exact replay from idempotency-key
// reuse with different intent.
export const outcomeQueueMutationReceipt = pgTable(
  "outcome_queue_mutation_receipt",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    idempotencyKey: text("idempotencyKey").notNull(),
    operation: text("operation").notNull(),
    outcomeKey: text("outcomeKey"),
    requestHash: text("requestHash").notNull(),
    requestBinding: jsonb("requestBinding").notNull(),
    resultBinding: jsonb("resultBinding").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    unique("outcome_queue_mutation_receipt_user_key_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("outcome_queue_mutation_receipt_user_outcome_idx").on(
      table.userId,
      table.outcomeKey,
      table.createdAt,
    ),
  ],
)

// Authenticated ordinary-language intake is exactly-once by a caller-stable
// key. The receipt binds the original request to one goal and one queue item.
export const goalOutcomeIntakeReceipt = pgTable(
  "goal_outcome_intake_receipt",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    idempotencyKey: text("idempotencyKey").notNull(),
    requestHash: text("requestHash").notNull(),
    goalId: integer("goalId")
      .notNull()
      .references(() => goal.id, { onDelete: "restrict" }),
    outcomeKey: text("outcomeKey").notNull(),
    resultDigest: text("resultDigest").notNull(),
    replayCount: integer("replayCount").default(0).notNull(),
    firstSubmittedAt: timestamp("firstSubmittedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastReplayedAt: timestamp("lastReplayedAt", { withTimezone: true }),
  },
  (table) => [
    unique("goal_outcome_intake_receipt_user_key_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    unique("goal_outcome_intake_receipt_user_goal_unique").on(
      table.userId,
      table.goalId,
    ),
    unique("goal_outcome_intake_receipt_user_outcome_unique").on(
      table.userId,
      table.outcomeKey,
    ),
    check(
      "goal_outcome_intake_receipt_replay_count_check",
      sql`${table.replayCount} >= 0`,
    ),
  ],
)

// Sanitized append-only acquisition proof. Raw lease tokens, execution
// bindings, and acquisition keys never enter this verifier-facing projection.
export const outcomeQueueAcquisitionAttempt = pgTable(
  "outcome_queue_acquisition_attempt",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    campaignWindowId: text("campaignWindowId").notNull(),
    processIdentity: text("processIdentity").notNull(),
    leaseHolder: text("leaseHolder").notNull(),
    acquisitionKeyDigest: text("acquisitionKeyDigest").notNull(),
    leaseIdentityDigest: text("leaseIdentityDigest").notNull(),
    checkpointDigest: text("checkpointDigest").notNull(),
    checkpointOutcomeId: text("checkpointOutcomeId").notNull(),
    checkpointSequence: integer("checkpointSequence").notNull(),
    checkpointState: text("checkpointState").notNull(),
    checkpointHeadSha: text("checkpointHeadSha"),
    checkpointMergeSha: text("checkpointMergeSha"),
    checkpointPrNumber: integer("checkpointPrNumber"),
    outcomeKey: text("outcomeKey"),
    fencingToken: integer("fencingToken"),
    leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true }),
    activeWorkOrderId: integer("activeWorkOrderId"),
    disposition: text("disposition").notNull(),
    reason: text("reason"),
    attemptedAt: timestamp("attemptedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("outcome_queue_acquisition_attempt_campaign_idx").on(
      table.userId,
      table.campaignWindowId,
      table.attemptedAt,
    ),
    index("outcome_queue_acquisition_attempt_identity_idx").on(
      table.userId,
      table.acquisitionKeyDigest,
      table.attemptedAt,
    ),
    check(
      "outcome_queue_acquisition_attempt_fence_check",
      sql`${table.fencingToken} IS NULL OR ${table.fencingToken} > 0`,
    ),
    check(
      "outcome_queue_acquisition_attempt_checkpoint_check",
      sql`${table.checkpointSequence} >= 0
        AND (${table.checkpointPrNumber} IS NULL OR ${table.checkpointPrNumber} > 0)`,
    ),
  ],
)

// Append-only, independently queryable proof of committed and replayed queue
// mutations. The result itself remains in the canonical mutation receipt.
export const outcomeQueueMutationAttempt = pgTable(
  "outcome_queue_mutation_attempt",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    idempotencyKey: text("idempotencyKey").notNull(),
    requestHash: text("requestHash").notNull(),
    resultDigest: text("resultDigest").notNull(),
    attemptOrdinal: integer("attemptOrdinal").notNull(),
    disposition: text("disposition").notNull(),
    attemptedAt: timestamp("attemptedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("outcome_queue_mutation_attempt_user_ordinal_unique").on(
      table.userId,
      table.idempotencyKey,
      table.attemptOrdinal,
    ),
    index("outcome_queue_mutation_attempt_request_idx").on(
      table.userId,
      table.requestHash,
      table.attemptedAt,
    ),
    check(
      "outcome_queue_mutation_attempt_ordinal_check",
      sql`${table.attemptOrdinal} > 0`,
    ),
    check(
      "outcome_queue_mutation_attempt_disposition_check",
      sql`${table.disposition} IN ('COMMITTED', 'REPLAY')`,
    ),
  ],
)

/* ------------------------------------------------------------------ */
/* Loop register (§8 — governed /loop iterations)                      */
/* ------------------------------------------------------------------ */

// Every /loop run is persisted with the playbook's §8.5 output shape.
// loopType: read | verify | plan | evidence | watch | execute
// status:   completed | stopped
export const loopRun = pgTable("loop_run", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // LOOP-0001 style human reference
  target: text("target").notNull(),
  workOrderId: integer("workOrderId"),
  loopType: text("loopType").notNull(),
  authority: text("authority").default("A0_READ_ONLY").notNull(),
  iteration: integer("iteration").default(1).notNull(),
  maxIterations: integer("maxIterations").default(1).notNull(),
  mode: text("mode"),
  actionsTaken: text("actionsTaken").array().default([]).notNull(),
  evidenceCollected: text("evidenceCollected").array().default([]).notNull(),
  findings: text("findings").array().default([]).notNull(),
  blockers: text("blockers").array().default([]).notNull(),
  stopReason: text("stopReason"),
  nextValidMove: text("nextValidMove"),
  status: text("status").default("completed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

/* ------------------------------------------------------------------ */
/* Evidence records (§11 — operator-grade evidence per work order)     */
/* ------------------------------------------------------------------ */

export const evidenceRecord = pgTable("evidence_record", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // EV-0001 style human reference
  workOrderId: integer("workOrderId").notNull(),
  result: text("result").notNull(), // PASS | FAIL | PARTIAL
  repo: text("repo"),
  branch: text("branch"),
  head: text("head"),
  worktreeStatus: text("worktreeStatus"),
  filesChanged: text("filesChanged").array().default([]).notNull(),
  validators: text("validators").array().default([]).notNull(),
  knownFailures: text("knownFailures").array().default([]).notNull(),
  outOfScopeChanges: text("outOfScopeChanges").array().default([]).notNull(),
  deferredItems: text("deferredItems").array().default([]).notNull(),
  nextValidMove: text("nextValidMove"),
  notes: text("notes"),
  // Tier-2/3 ledger: tamper-evidence hash + filesystem artifact path.
  contentHash: text("contentHash"),
  artifactPath: text("artifactPath"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

/* ------------------------------------------------------------------ */
/* Governance hardening registers (WO-011..020)                        */
/* ------------------------------------------------------------------ */

// Append-only event log for tamper-evident governance history (event sourcing).
// Never updated in place — every state change appends an event with before/after
// content hashes so WilliamOS can reconstruct how a state came to exist.
export const governanceEvent = pgTable("governance_event", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // GEV-0001
  eventType: text("eventType").notNull(), // AUTHORITY_GRANTED | AUTHORITY_REVOKED | LOCK_RELEASED | ...
  entityType: text("entityType"), // authority_grant | lock_record | work_order | ...
  entityId: text("entityId"),
  actor: text("actor"),
  reason: text("reason"),
  beforeHash: text("beforeHash"),
  afterHash: text("afterHash"),
  evidenceId: integer("evidenceId"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

// WO-011: durable Authority Grant Registry. Approval is NOT authority — an
// explicit grant record must exist (active, unexpired, unrevoked) before any
// loop or transition may act above A0.
// status: active | expired | revoked
export const authorityGrant = pgTable("authority_grant", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // GRANT-0001
  workOrderId: integer("workOrderId"),
  grantedBy: text("grantedBy").notNull(),
  grantedTo: text("grantedTo").default("operator").notNull(), // operator | codex | claude | ...
  authorityLevel: text("authorityLevel").notNull(), // A0..A9
  scope: text("scope"),
  allowedActions: text("allowedActions").array().default([]).notNull(),
  blockedActions: text("blockedActions").array().default([]).notNull(),
  reason: text("reason"),
  status: text("status").default("active").notNull(),
  expiresAt: utcWallTimestamp("expiresAt"),
  revokedAt: utcWallTimestamp("revokedAt"),
  revokedBy: text("revokedBy"),
  revokeReason: text("revokeReason"),
  contentHash: text("contentHash"),
  createdAt: utcWallTimestamp("createdAt").default(sql`timezone('UTC', now())`).notNull(),
})

// Scoped human access grants. These are NOT authority grants: they may open one
// bounded review surface, but they never confer operator/runtime authority.
export const accessGrant = pgTable(
  "access_grant",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    ref: text("ref"), // ACCESS-0001
    publicTokenHash: text("publicTokenHash").notNull(),
    tokenPrefix: text("tokenPrefix"),
    scope: text("scope").notNull(),
    targetResourceType: text("targetResourceType").notNull(),
    targetResourceId: text("targetResourceId").notNull(),
    recipientEmailHash: text("recipientEmailHash"),
    recipientEmailEncrypted: text("recipientEmailEncrypted"),
    emailVerificationRequired: boolean("emailVerificationRequired").default(false).notNull(),
    createdByOperatorId: text("createdByOperatorId").notNull(),
    createdReason: text("createdReason"),
    status: text("status").default("active").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    maxUses: integer("maxUses").default(1).notNull(),
    useCount: integer("useCount").default(0).notNull(),
    lastUsedAt: timestamp("lastUsedAt"),
    revokedAt: timestamp("revokedAt"),
    revokedBy: text("revokedBy"),
    revokeReason: text("revokeReason"),
    metadata: jsonb("metadata"),
    auditCorrelationId: text("auditCorrelationId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("access_grant_public_token_hash_idx").on(table.publicTokenHash),
    index("access_grant_user_status_expires_idx").on(table.userId, table.status, table.expiresAt),
    index("access_grant_target_idx").on(table.targetResourceType, table.targetResourceId),
    index("access_grant_recipient_email_hash_idx").on(table.recipientEmailHash),
  ],
)

export const accessGrantSession = pgTable(
  "access_grant_session",
  {
    id: serial("id").primaryKey(),
    grantId: integer("grantId")
      .notNull()
      .references(() => accessGrant.id, { onDelete: "cascade" }),
    sessionTokenHash: text("sessionTokenHash").notNull(),
    recipientEmailVerified: boolean("recipientEmailVerified").default(false).notNull(),
    ipAddressHash: text("ipAddressHash"),
    userAgentHash: text("userAgentHash"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt"),
  },
  (table) => [
    uniqueIndex("access_grant_session_token_hash_idx").on(table.sessionTokenHash),
    index("access_grant_session_grant_expires_idx").on(table.grantId, table.expiresAt),
  ],
)

export const accessGrantEvent = pgTable(
  "access_grant_event",
  {
    id: serial("id").primaryKey(),
    grantId: integer("grantId").references(() => accessGrant.id, { onDelete: "set null" }),
    correlationId: text("correlationId").notNull(),
    eventType: text("eventType").notNull(),
    actorType: text("actorType").notNull(),
    outcome: text("outcome").notNull(),
    scope: text("scope"),
    targetResourceType: text("targetResourceType"),
    targetResourceId: text("targetResourceId"),
    reasonCode: text("reasonCode"),
    ipAddressHash: text("ipAddressHash"),
    userAgentHash: text("userAgentHash"),
    tokenPrefix: text("tokenPrefix"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("access_grant_event_grant_created_idx").on(table.grantId, table.createdAt),
    index("access_grant_event_correlation_idx").on(table.correlationId),
    index("access_grant_event_type_created_idx").on(table.eventType, table.createdAt),
  ],
)

// WO-014: Current Truth with freshness + confidence categories. Volatile truth
// must be rechecked before mutation/commit/push/tag/release.
// truthType: STATIC | SESSION | VOLATILE | EVIDENCE | LOCK | UNKNOWN | STALE | ASSUMED
// freshness: fresh | aging | stale
export const truthClaim = pgTable("truth_claim", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // TRUTH-0001
  claim: text("claim").notNull(),
  system: text("system"),
  source: text("source"),
  truthType: text("truthType").default("UNKNOWN").notNull(),
  confidence: text("confidence").default("medium").notNull(), // low | medium | high
  freshness: text("freshness").default("fresh").notNull(),
  evidenceId: integer("evidenceId"),
  verificationRequiredBefore: text("verificationRequiredBefore").array().default([]).notNull(),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

// WO-016: agent claims are untrusted until verified.
// classification: SELF_REPORTED | EVIDENCE_BACKED | UNSUPPORTED | CONFLICTING | REQUIRES_VERIFICATION
export const agentClaim = pgTable("agent_claim", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // CLAIM-0001
  agent: text("agent").notNull(),
  claim: text("claim").notNull(),
  classification: text("classification").default("REQUIRES_VERIFICATION").notNull(),
  workOrderId: integer("workOrderId"),
  evidenceId: integer("evidenceId"),
  command: text("command"),
  repo: text("repo"),
  branch: text("branch"),
  head: text("head"),
  conflictId: integer("conflictId"),
  status: text("status").default("open").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

// WO-018: Conflict Register. High-risk unresolved conflicts block loops.
// status: open | resolved | accepted_risk
export const conflictRecord = pgTable("conflict_record", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // CONFLICT-0001
  detectedBetween: text("detectedBetween").notNull(),
  severity: text("severity").default("medium").notNull(), // low | medium | high | critical
  system: text("system"),
  workOrderId: integer("workOrderId"),
  doctrineRule: text("doctrineRule"),
  description: text("description"),
  resolution: text("resolution"),
  resolvedBy: text("resolvedBy"),
  resolvedAt: timestamp("resolvedAt"),
  status: text("status").default("open").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

// WO-020: explicit locks (HOLD/STOP/FREEZE) with a deliberate release protocol.
// Vague language can never release a lock; release requires reason + posture.
// kind: HOLD | STOP | FREEZE   status: active | released
export const lockRecord = pgTable("lock_record", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // LOCK-0001
  kind: text("kind").default("HOLD").notNull(),
  title: text("title").notNull(),
  scope: text("scope"),
  posture: text("posture"),
  reason: text("reason"),
  allowedActions: text("allowedActions").array().default([]).notNull(),
  blockedActions: text("blockedActions").array().default([]).notNull(),
  status: text("status").default("active").notNull(),
  newPosture: text("newPosture"),
  releasedBy: text("releasedBy"),
  releaseReason: text("releaseReason"),
  releasedAt: timestamp("releasedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

// WO-019: Not-Now Vault. Preserve vision without activating it. Parked ideas
// cannot create loops; promotion requires a decision record.
// maturity: seed | sketch | spec_ready   status: parked | promoted | dropped
export const parkedIdea = pgTable("parked_idea", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  ref: text("ref"), // IDEA-0001
  idea: text("idea").notNull(),
  lane: text("lane"),
  whyItMatters: text("whyItMatters"),
  whyNotNow: text("whyNotNow"),
  maturity: text("maturity").default("seed").notNull(),
  unlockCondition: text("unlockCondition"),
  relatedWorkOrderId: integer("relatedWorkOrderId"),
  promoteRequires: text("promoteRequires"),
  status: text("status").default("parked").notNull(),
  promotedWorkOrderId: integer("promotedWorkOrderId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

/* ------------------------------------------------------------------ */
/* Audit / event log                                                   */
/* ------------------------------------------------------------------ */

export const eventLog = pgTable("event_log", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  type: text("type").notNull(),
  summary: text("summary").notNull(),
  register: text("register"),
  refId: integer("refId"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

export type MemoryFact = typeof memoryFact.$inferSelect
export type Decision = typeof decision.$inferSelect
export type Doctrine = typeof doctrine.$inferSelect
export type WorkOrder = typeof workOrder.$inferSelect
export type Document = typeof document.$inferSelect
export type EventLog = typeof eventLog.$inferSelect
export type Goal = typeof goal.$inferSelect
export type OutcomeQueueItem = typeof outcomeQueueItem.$inferSelect
export type NewOutcomeQueueItem = typeof outcomeQueueItem.$inferInsert
export type OutcomeQueueAcquisitionReceipt =
  typeof outcomeQueueAcquisitionReceipt.$inferSelect
export type OutcomeQueueMutationReceipt = typeof outcomeQueueMutationReceipt.$inferSelect
export type GoalOutcomeIntakeReceipt = typeof goalOutcomeIntakeReceipt.$inferSelect
export type OutcomeQueueAcquisitionAttempt =
  typeof outcomeQueueAcquisitionAttempt.$inferSelect
export type OutcomeQueueMutationAttempt = typeof outcomeQueueMutationAttempt.$inferSelect
export type LoopRun = typeof loopRun.$inferSelect
export type EvidenceRecord = typeof evidenceRecord.$inferSelect
export type GovernanceEvent = typeof governanceEvent.$inferSelect
export type AuthorityGrant = typeof authorityGrant.$inferSelect
export type AccessGrant = typeof accessGrant.$inferSelect
export type AccessGrantSession = typeof accessGrantSession.$inferSelect
export type AccessGrantEvent = typeof accessGrantEvent.$inferSelect
export type TruthClaim = typeof truthClaim.$inferSelect
export type AgentClaim = typeof agentClaim.$inferSelect
export type ConflictRecord = typeof conflictRecord.$inferSelect
export type LockRecord = typeof lockRecord.$inferSelect
export type ParkedIdea = typeof parkedIdea.$inferSelect
