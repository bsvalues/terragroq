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
  foreignKey,
  customType,
} from "drizzle-orm/pg-core"

import { fromUtcWallDriver, toUtcWallDriver } from "@/lib/db/utc-wall-timestamp"

// The conversion itself lives in `lib/db/utc-wall-timestamp.ts` so that the raw-`pg` readers of these
// same columns can share it. While it was a closure here, they could not, and read the stored UTC wall
// clock as local time -- CONT-EXPV2-GRANT-EXPIRY-TZ-SKEW.
const utcWallTimestamp = customType<{ data: Date; driverData: string | Date }>({
  dataType() {
    return "timestamp"
  },
  toDriver: toUtcWallDriver,
  fromDriver: fromUtcWallDriver,
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
  embedding: vector("embedding", { dimensions: 1024 }),
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

// Projects are durable operating context, not repository aliases or task boards.
export const project = pgTable(
  "project",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    lifecycle: text("lifecycle").default("standby").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("project_user_key_unique").on(table.userId, table.key),
    unique("project_user_id_unique").on(table.userId, table.id),
    check(
      "project_lifecycle_check",
      sql`${table.lifecycle} IN ('active', 'standby', 'archived')`,
    ),
  ],
)

// A project can span several concrete resources; none of them defines the project.
export const projectResource = pgTable(
  "project_resource",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    projectId: integer("projectId")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    canonicalIdentity: text("canonicalIdentity").notNull(),
    label: text("label").notNull(),
    relationship: text("relationship").notNull(),
    // What may be done to this resource at all. Resolution is a read; this is a declaration, not a grant.
    allowedOperations: text("allowedOperations").array().notNull().default(sql`'{}'::text[]`),
    // An agent drafts the first version of a record from artefacts it found. Until a human confirms it,
    // every answer derived from it has to be able to say it is unconfirmed.
    ratifiedAt: timestamp("ratifiedAt", { withTimezone: true }),
    ratifiedBy: text("ratifiedBy"),
    // Names the resource these rows describe, e.g. "pacs". Without it the parts of a resource have no
    // handle to resolve by, which is what acceptance run 4 hit.
    resourceKey: text("resourceKey"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("project_resource_identity_unique").on(
      table.projectId,
      table.type,
      table.canonicalIdentity,
      table.relationship,
    ),
    index("project_resource_user_project_idx").on(table.userId, table.projectId),
    index("project_resource_user_identity_idx").on(
      table.userId,
      table.type,
      table.canonicalIdentity,
    ),
    check(
      "project_resource_type_check",
      sql`${table.type} IN ('repo', 'database', 'node', 'service', 'data_source')`,
    ),
  ],
)

// Threads own Workbench context only. Goals and outcomes remain the durable
// sources of task, execution, decision, and delivery truth.
export const workbenchThread = pgTable(
  "workbench_thread",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    projectId: integer("projectId").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("workbench_thread_user_id_unique").on(table.userId, table.id),
    foreignKey({
      columns: [table.userId, table.projectId],
      foreignColumns: [project.userId, project.id],
      name: "workbench_thread_user_project_fk",
    }).onDelete("restrict"),
    index("workbench_thread_user_project_updated_idx").on(
      table.userId,
      table.projectId,
      table.updatedAt,
      table.id,
    ),
  ],
)

export const workbenchThreadSource = pgTable(
  "workbench_thread_source",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    threadId: text("threadId").notNull(),
    sourceType: text("sourceType").notNull(),
    sourceId: text("sourceId").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.threadId],
      foreignColumns: [workbenchThread.userId, workbenchThread.id],
      name: "workbench_thread_source_user_thread_fk",
    }).onDelete("cascade"),
    unique("workbench_thread_source_binding_unique").on(
      table.userId,
      table.threadId,
      table.sourceType,
      table.sourceId,
    ),
    uniqueIndex("workbench_thread_source_root_unique_idx")
      .on(table.userId, table.sourceType, table.sourceId)
      .where(sql`${table.role} = 'root'`),
    uniqueIndex("workbench_thread_source_thread_root_unique_idx")
      .on(table.userId, table.threadId)
      .where(sql`${table.role} = 'root'`),
    check(
      "workbench_thread_source_type_check",
      sql`${table.sourceType} IN ('goal', 'outcome')`,
    ),
    check(
      "workbench_thread_source_role_check",
      sql`${table.role} IN ('root', 'member')`,
    ),
  ],
)

// The Environment's working world (S6, #762): one row per assembled world; snapshot holds meaning,
// validated chrome-free at the boundary by lib/environment/working-world.ts.
export const workingWorld = pgTable(
  "working_world",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    intent: text("intent").notNull(),
    snapshot: text("snapshot").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("working_world_user_updated_idx").on(table.userId, table.updatedAt, table.id),
  ],
)

// A Thread is a conversation (#762 CONVERSATION-FIRST). Messages are its primary content; work
// objects hang off the conversation, never the other way around. Roles are the projection's two
// voices; agent/system voices arrive by widening the check, the way 0010 widened source kinds.
export const workbenchThreadMessage = pgTable(
  "workbench_thread_message",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    threadId: text("threadId").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.threadId],
      foreignColumns: [workbenchThread.userId, workbenchThread.id],
      name: "workbench_thread_message_user_thread_fk",
    }).onDelete("cascade"),
    index("workbench_thread_message_thread_created_idx").on(
      table.userId,
      table.threadId,
      table.createdAt,
      table.id,
    ),
    check(
      "workbench_thread_message_role_check",
      sql`${table.role} IN ('owner', 'williamos')`,
    ),
  ],
)

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
  embedding: vector("embedding", { dimensions: 1024 }),
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
  acceptedContractIds: text("acceptedContractIds").array().default([]).notNull(),
  recommendedMove: text("recommendedMove"),
  requiresApproval: boolean("requiresApproval").default(false).notNull(),
  linkedWorkOrderId: integer("linkedWorkOrderId"),
  status: text("status").default("classified").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("goal_issue_911_live_acceptance_singleton_idx")
    .on(table.userId)
    .where(sql`${table.acceptedContractIds} = ARRAY['issue-911-live-nonempty-acceptance.v1']::text[]`),
])

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
    acceptedContractIds: text("acceptedContractIds").array().default([]).notNull(),
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
    // Bridge from the canonical work graph: when set, this row is the executable lease PROJECTION of
    // a routed_dependency. Authority is the resource-scoped envelope below, never authorityLevel.
    // See lib/outcome-queue/dependency-projection.ts.
    canonicalDependencyId: integer("canonicalDependencyId").references(() => routedDependency.id, {
      onDelete: "cascade",
    }),
    envelopeResource: text("envelopeResource"),
    envelopeClass: text("envelopeClass"),
    envelopeCapability: text("envelopeCapability"),
    envelopeDigest: text("envelopeDigest"),
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
    uniqueIndex("outcome_queue_item_issue_911_live_acceptance_singleton_idx")
      .on(table.userId)
      .where(sql`${table.acceptedContractIds} = ARRAY['issue-911-live-nonempty-acceptance.v1']::text[]`),
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
    acceptedContractIds: text("acceptedContractIds").array().default([]).notNull(),
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
    uniqueIndex("goal_intake_issue_911_live_acceptance_singleton_idx")
      .on(table.userId)
      .where(sql`${table.acceptedContractIds} = ARRAY['issue-911-live-nonempty-acceptance.v1']::text[]`),
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

// Device identity is distinct from browser sessions, scoped access grants, and
// authority grants. Only public-key material and opaque credential hashes are
// durable; raw challenges and session tokens must never be stored here.
export const deviceCredential = pgTable(
  "device_credential",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    publicKeySpki: text("publicKeySpki").notNull(),
    publicKeyFingerprintSha256: text("publicKeyFingerprintSha256").notNull(),
    activeAt: timestamp("activeAt", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    lastUsedAt: timestamp("lastUsedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("device_credential_fingerprint_idx").on(table.publicKeyFingerprintSha256),
    index("device_credential_user_active_idx").on(table.userId, table.revokedAt, table.activeAt),
    check(
      "device_credential_fingerprint_check",
      sql`${table.publicKeyFingerprintSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("device_credential_label_check", sql`length(trim(${table.label})) > 0`),
    check("device_credential_spki_check", sql`length(${table.publicKeySpki}) > 0`),
  ],
)

export const deviceChallenge = pgTable(
  "device_challenge",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialId: text("credentialId").references(() => deviceCredential.id, {
      onDelete: "set null",
    }),
    purpose: text("purpose").notNull(),
    challengeHash: text("challengeHash").notNull(),
    origin: text("origin").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumedAt", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("device_challenge_hash_idx").on(table.challengeHash),
    index("device_challenge_user_purpose_created_idx").on(
      table.userId,
      table.purpose,
      table.createdAt,
    ),
    index("device_challenge_credential_purpose_created_idx").on(
      table.credentialId,
      table.purpose,
      table.createdAt,
    ),
    index("device_challenge_origin_purpose_created_idx").on(
      table.origin,
      table.purpose,
      table.createdAt,
    ),
    index("device_challenge_expiry_idx").on(table.expiresAt, table.consumedAt),
    check("device_challenge_purpose_check", sql`${table.purpose} IN ('enroll', 'authenticate')`),
    check("device_challenge_hash_check", sql`${table.challengeHash} ~ '^[0-9a-f]{64}$'`),
    check("device_challenge_attempts_check", sql`${table.attempts} >= 0`),
    check("device_challenge_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "device_challenge_consumed_check",
      sql`${table.consumedAt} IS NULL OR ${table.consumedAt} >= ${table.createdAt}`,
    ),
  ],
)

export const deviceSession = pgTable(
  "device_session",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialId: text("credentialId")
      .notNull()
      .references(() => deviceCredential.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("device_session_token_hash_idx").on(table.tokenHash),
    index("device_session_user_expiry_idx").on(table.userId, table.expiresAt, table.revokedAt),
    index("device_session_credential_expiry_idx").on(
      table.credentialId,
      table.expiresAt,
      table.revokedAt,
    ),
    check("device_session_token_hash_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("device_session_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "device_session_revoked_check",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
    check(
      "device_session_last_seen_check",
      sql`${table.lastSeenAt} IS NULL OR ${table.lastSeenAt} >= ${table.createdAt}`,
    ),
  ],
)

export const deviceAuthEvent = pgTable(
  "device_auth_event",
  {
    id: text("id").primaryKey(),
    userId: text("userId").references(() => user.id, { onDelete: "set null" }),
    credentialId: text("credentialId").references(() => deviceCredential.id, {
      onDelete: "set null",
    }),
    sessionId: text("sessionId").references(() => deviceSession.id, { onDelete: "set null" }),
    eventType: text("eventType").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("device_auth_event_user_created_idx").on(table.userId, table.createdAt),
    index("device_auth_event_credential_created_idx").on(table.credentialId, table.createdAt),
    index("device_auth_event_session_created_idx").on(table.sessionId, table.createdAt),
    index("device_auth_event_type_created_idx").on(table.eventType, table.createdAt),
    check("device_auth_event_type_check", sql`length(trim(${table.eventType})) > 0`),
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

// Who may actually ACT on a work order, as opposed to who owns it. Ownership was standing in for
// execution rights (WORK_ORDER_DELEGATED_SUBJECT_UNRESOLVED): reads filtered on userId, mutations
// went through requireOwn, and `agent` never reached a WHERE clause -- so approved agent work was
// held and truthfully reported as absent. An assignment is also an OFFER until accepted: declining
// is routine, typed, and ends the assignment rather than the work order. The policy this table
// carries lives in lib/work-orders/assignment.ts.
export const workOrderAssignment = pgTable(
  "work_order_assignment",
  {
    id: serial("id").primaryKey(),
    workOrderId: integer("workOrderId")
      .notNull()
      .references(() => workOrder.id, { onDelete: "cascade" }),
    // The authenticated identity that will act -- not a label, not a catalog name.
    principal: text("principal").notNull(),
    // Capability profile (codex | claude-code | copilot | local). A profile, never an identity.
    agentProfile: text("agentProfile"),
    role: text("role").default("implementer").notNull(),
    status: text("status").default("offered").notNull(),
    // Required when status = 'declined'. Information for the router, not a failure record.
    declineReason: text("declineReason"),
    declineDetail: text("declineDetail"),
    // Accepted work must heartbeat or be reclaimed and re-offered.
    leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeatAt", { withTimezone: true }),
    assignedBy: text("assignedBy"),
    assignedAt: timestamp("assignedAt", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("acceptedAt", { withTimezone: true }),
    declinedAt: timestamp("declinedAt", { withTimezone: true }),
    releasedAt: timestamp("releasedAt", { withTimezone: true }),
    reclaimedAt: timestamp("reclaimedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("work_order_assignment_principal_status_idx").on(
      table.principal,
      table.status,
      table.workOrderId,
    ),
    index("work_order_assignment_wo_status_idx").on(table.workOrderId, table.status),
    index("work_order_assignment_lease_idx").on(table.status, table.leaseExpiresAt),
    check(
      "work_order_assignment_status_check",
      sql`${table.status} IN ('offered', 'accepted', 'active', 'declined', 'released', 'revoked')`,
    ),
    check(
      "work_order_assignment_role_check",
      sql`${table.role} IN ('implementer', 'reviewer', 'collaborator', 'subagent')`,
    ),
    check(
      "work_order_assignment_declined_needs_reason",
      sql`${table.status} <> 'declined' OR ${table.declineReason} IS NOT NULL`,
    ),
  ],
)

// What a work order is actually working on. `work_order` could not say -- no projectId, no resource
// reference, no revision, only path strings -- so a contract could not express "canonical Project X,
// repo Y, at SHA Z" and correct work against the wrong tree contradicted nothing in the record.
// Bound at ACTIVATION, because binding first at acceptance discovers a failed premise days late.
// Rules live in lib/work-orders/truth-binding.ts.
export const workOrderTruthBinding = pgTable(
  "work_order_truth_binding",
  {
    id: serial("id").primaryKey(),
    workOrderId: integer("workOrderId")
      .notNull()
      .references(() => workOrder.id, { onDelete: "cascade" }),
    projectId: integer("projectId")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    // The resource the running application must be served FROM -- derived from the Project, never
    // an ambient environment URL.
    runtimeResourceKey: text("runtimeResourceKey"),
    status: text("status").default("bound").notNull(),
    boundAt: timestamp("boundAt", { withTimezone: true }).defaultNow().notNull(),
    boundBy: text("boundBy"),
    supersededAt: timestamp("supersededAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("work_order_truth_binding_project_idx").on(table.projectId, table.status),
    check(
      "work_order_truth_binding_status_check",
      sql`${table.status} IN ('bound', 'superseded')`,
    ),
  ],
)

// canonicalIdentity and ratifiedAt are SNAPSHOTS taken at binding time: if the resource record is
// later edited, acceptance is still judged against what the contract was activated against.
export const workOrderBoundResource = pgTable(
  "work_order_bound_resource",
  {
    id: serial("id").primaryKey(),
    bindingId: integer("bindingId")
      .notNull()
      .references(() => workOrderTruthBinding.id, { onDelete: "cascade" }),
    resourceKey: text("resourceKey").notNull(),
    projectResourceId: integer("projectResourceId").references(() => projectResource.id, {
      onDelete: "set null",
    }),
    resourceType: text("resourceType").notNull(),
    canonicalIdentity: text("canonicalIdentity").notNull(),
    role: text("role").default("source").notNull(),
    // NULL means the owner has never confirmed this resource record. Work may proceed; acceptance
    // must say so and cannot certify.
    ratifiedAt: timestamp("ratifiedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("work_order_bound_resource_unique").on(table.bindingId, table.resourceKey),
    check(
      "work_order_bound_resource_role_check",
      sql`${table.role} IN ('source', 'runtime', 'data', 'reference')`,
    ),
  ],
)

// The revision lineage. Append-only: movement between revisions is evidence, and rewriting it would
// defeat the point of binding at activation. bound = base at activation; rebound = moved for a
// reason outside this contract; successor = a revision this contract produced.
export const workOrderBindingEvent = pgTable(
  "work_order_binding_event",
  {
    id: serial("id").primaryKey(),
    bindingId: integer("bindingId")
      .notNull()
      .references(() => workOrderTruthBinding.id, { onDelete: "cascade" }),
    resourceKey: text("resourceKey").notNull(),
    event: text("event").notNull(),
    sha: text("sha").notNull(),
    reason: text("reason"),
    recordedBy: text("recordedBy"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("work_order_binding_event_lineage_idx").on(
      table.bindingId,
      table.resourceKey,
      table.at,
    ),
    check(
      "work_order_binding_event_kind_check",
      sql`${table.event} IN ('bound', 'rebound', 'successor')`,
    ),
  ],
)

// An acceptance ATTEMPT is not the work order's fate. PREMISE_FAILED normally sends the contract
// back to active to rebind and continue; it is terminal only when the outcome itself has become
// impossible. `observed` holds what was actually seen, never what was requested.
export const workOrderAcceptanceAttempt = pgTable(
  "work_order_acceptance_attempt",
  {
    id: serial("id").primaryKey(),
    workOrderId: integer("workOrderId")
      .notNull()
      .references(() => workOrder.id, { onDelete: "cascade" }),
    bindingId: integer("bindingId").references(() => workOrderTruthBinding.id, {
      onDelete: "set null",
    }),
    disposition: text("disposition").notNull(),
    reason: text("reason"),
    verifiedBy: text("verifiedBy").notNull(),
    // A WilliamOS-owned deterministic verifier is the default and preferred path; a distinct
    // principal is required only where the risk class needs judgment or separation of duties.
    verifierKind: text("verifierKind").default("deterministic").notNull(),
    observed: jsonb("observed"),
    divergences: jsonb("divergences"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("work_order_acceptance_attempt_wo_idx").on(table.workOrderId, table.at),
    check(
      "work_order_acceptance_attempt_disposition_check",
      sql`${table.disposition} IN ('PASS', 'FAIL', 'PARTIAL', 'PREMISE_FAILED')`,
    ),
    check(
      "work_order_acceptance_attempt_verifier_kind_check",
      sql`${table.verifierKind} IN ('deterministic', 'principal')`,
    ),
  ],
)

// A dependency sits BESIDE an active work order and does not consume its lifecycle. An executor
// that cannot perform ONE operation is not unemployed: the dependency is recorded, the router takes
// it elsewhere, and the contract keeps working every independent path. `blocked` is correspondingly
// narrowed to a computed condition -- lib/work-orders/routed-dependency.ts -- so that a single
// forbidden mutation can never reach it.
export const routedDependency = pgTable(
  "routed_dependency",
  {
    id: serial("id").primaryKey(),
    // The work order that REMAINS ACTIVE while this is routed elsewhere.
    workOrderId: integer("workOrderId")
      .notNull()
      .references(() => workOrder.id, { onDelete: "cascade" }),
    // Specific prose: "modify deploy/hermes/start-williamos-live.ps1", not "config problem".
    operation: text("operation").notNull(),
    // What authority WOULD have been needed: resource x class x capability.
    requiredResource: text("requiredResource"),
    requiredClass: text("requiredClass"),
    requiredCapability: text("requiredCapability"),
    // Non-authority blockers: an unreachable node, an absent credential, a service that is down.
    requiredCapabilityNonAuth: text("requiredCapabilityNonAuth"),
    // The wall or error actually observed. Not a summary of it.
    evidence: text("evidence").array().default([]).notNull(),
    routingState: text("routingState").default("raised").notNull(),
    assignedWorkOrderId: integer("assignedWorkOrderId").references(() => workOrder.id, {
      onDelete: "set null",
    }),
    assignee: text("assignee"),
    // Only dependencies with this set can contribute to `blocked`.
    blocksAcceptance: boolean("blocksAcceptance").default(false).notNull(),
    raisedBy: text("raisedBy"),
    raisedAt: timestamp("raisedAt", { withTimezone: true }).defaultNow().notNull(),
    routedAt: timestamp("routedAt", { withTimezone: true }),
    resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
    resolution: text("resolution"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("routed_dependency_wo_state_idx").on(
      table.workOrderId,
      table.routingState,
      table.blocksAcceptance,
    ),
    index("routed_dependency_routing_idx").on(table.routingState, table.raisedAt),
    check(
      "routed_dependency_state_check",
      sql`${table.routingState} IN ('raised', 'routed', 'accepted', 'resolved', 'refused')`,
    ),
    check(
      "routed_dependency_class_check",
      sql`${table.requiredClass} IS NULL OR ${table.requiredClass} IN ('source', 'artifact', 'runtime_config', 'runtime_control', 'data', 'secrets', 'delivery', 'external')`,
    ),
    // A dependency that names no unavailable capability at all is a note, not a routable item.
    check(
      "routed_dependency_names_a_need",
      sql`${table.requiredClass} IS NOT NULL OR ${table.requiredCapabilityNonAuth} IS NOT NULL`,
    ),
    // Routing to the work order that raised it is a loop, not a route.
    check(
      "routed_dependency_no_self_route",
      sql`${table.assignedWorkOrderId} IS NULL OR ${table.assignedWorkOrderId} <> ${table.workOrderId}`,
    ),
  ],
)

// Where a Project's service is actually served, PER NODE. Same gap as the checkout table and the
// same reason: a URL is node-specific, so hanging one off the canonical service row would be
// WILLIAMOS_WORKSPACE_APP_URL rebuilt in the database. observedProjectId is the belonging proof --
// a runtime serving another Project is caught here, not by a header that happens to say TerraFusion.
export const projectServiceEndpoint = pgTable(
  "project_service_endpoint",
  {
    id: serial("id").primaryKey(),
    projectResourceId: integer("projectResourceId")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    node: text("node").notNull(),
    // The servable origin, e.g. https://192.168.88.9:5199. Origin only.
    endpoint: text("endpoint").notNull(),
    // What the endpoint reported about itself. observedProjectId is which Project the running
    // service claims to belong to; observedRevision is the SHA it reported, so a deployed revision
    // can be proven equal to the landed one rather than assumed.
    observedProjectId: integer("observedProjectId").references(() => project.id, {
      onDelete: "set null",
    }),
    observedServiceIdentity: text("observedServiceIdentity"),
    observedRevision: text("observedRevision"),
    observedAt: timestamp("observedAt", { withTimezone: true }),
    ratifiedAt: timestamp("ratifiedAt", { withTimezone: true }),
    ratifiedBy: text("ratifiedBy"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("project_service_endpoint_node_unique").on(table.projectResourceId, table.node),
    index("project_service_endpoint_node_idx").on(table.node, table.projectResourceId),
  ],
)

// Where a canonical resource is checked out, PER NODE. The path is NOT a property of the resource:
// the same repository is at C:\... on HERMES, /srv/... on AEGIS, elsewhere on OMEN and absent on
// ATLAS, and project_resource holds one row per canonical identity -- so a path column there could
// hold exactly one node's answer, which is WILLIAMOS_PROJECT_ROOT rebuilt inside the database.
// Absence of a row is meaningful and normal: most resources are not checked out on most nodes.
export const projectResourceCheckout = pgTable(
  "project_resource_checkout",
  {
    id: serial("id").primaryKey(),
    projectResourceId: integer("projectResourceId")
      .notNull()
      .references(() => projectResource.id, { onDelete: "cascade" }),
    // A path without a node is a path on somebody else's disk.
    node: text("node").notNull(),
    path: text("path").notNull(),
    // What was last actually SEEN there, as opposed to what the resource claims. Kept separately on
    // purpose: a checkout whose remote does not match the canonical identity is the stale-worktree
    // failure at its source, and it is only detectable if both are recorded.
    observedIdentity: text("observedIdentity"),
    observedRevision: text("observedRevision"),
    observedAt: timestamp("observedAt", { withTimezone: true }),
    // An agent may draft this from what it found on disk; until the owner confirms it, anything
    // derived from it may proceed but cannot certify.
    ratifiedAt: timestamp("ratifiedAt", { withTimezone: true }),
    ratifiedBy: text("ratifiedBy"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Two worktrees of one repo on one machine, one of them stale, with nothing able to say which
    // the workspace is serving -- exactly the ambiguity this table removes.
    unique("project_resource_checkout_node_unique").on(table.projectResourceId, table.node),
    index("project_resource_checkout_node_idx").on(table.node, table.projectResourceId),
  ],
)

export type MemoryFact = typeof memoryFact.$inferSelect
export type Decision = typeof decision.$inferSelect
export type Doctrine = typeof doctrine.$inferSelect
export type WorkOrder = typeof workOrder.$inferSelect
export type WorkOrderAssignment = typeof workOrderAssignment.$inferSelect
export type NewWorkOrderAssignment = typeof workOrderAssignment.$inferInsert
export type WorkOrderTruthBinding = typeof workOrderTruthBinding.$inferSelect
export type NewWorkOrderTruthBinding = typeof workOrderTruthBinding.$inferInsert
export type WorkOrderBoundResource = typeof workOrderBoundResource.$inferSelect
export type WorkOrderBindingEvent = typeof workOrderBindingEvent.$inferSelect
export type WorkOrderAcceptanceAttempt = typeof workOrderAcceptanceAttempt.$inferSelect
export type RoutedDependency = typeof routedDependency.$inferSelect
export type NewRoutedDependency = typeof routedDependency.$inferInsert
export type Project = typeof project.$inferSelect
export type NewProject = typeof project.$inferInsert
export type ProjectResource = typeof projectResource.$inferSelect
export type NewProjectResource = typeof projectResource.$inferInsert
export type ProjectResourceCheckout = typeof projectResourceCheckout.$inferSelect
export type ProjectServiceEndpoint = typeof projectServiceEndpoint.$inferSelect
export type NewProjectServiceEndpoint = typeof projectServiceEndpoint.$inferInsert
export type NewProjectResourceCheckout = typeof projectResourceCheckout.$inferInsert
export type WorkbenchThread = typeof workbenchThread.$inferSelect
export type WorkbenchThreadMessage = typeof workbenchThreadMessage.$inferSelect
export type NewWorkbenchThread = typeof workbenchThread.$inferInsert
export type WorkbenchThreadSource = typeof workbenchThreadSource.$inferSelect
export type NewWorkbenchThreadSource = typeof workbenchThreadSource.$inferInsert
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
export type DeviceCredential = typeof deviceCredential.$inferSelect
export type NewDeviceCredential = typeof deviceCredential.$inferInsert
export type DeviceChallenge = typeof deviceChallenge.$inferSelect
export type NewDeviceChallenge = typeof deviceChallenge.$inferInsert
export type DeviceSession = typeof deviceSession.$inferSelect
export type NewDeviceSession = typeof deviceSession.$inferInsert
export type DeviceAuthEvent = typeof deviceAuthEvent.$inferSelect
export type NewDeviceAuthEvent = typeof deviceAuthEvent.$inferInsert
export type TruthClaim = typeof truthClaim.$inferSelect
export type AgentClaim = typeof agentClaim.$inferSelect
export type ConflictRecord = typeof conflictRecord.$inferSelect
export type LockRecord = typeof lockRecord.$inferSelect
export type ParkedIdea = typeof parkedIdea.$inferSelect
