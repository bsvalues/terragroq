import {
  pgTable,
  text,
  timestamp,
  boolean,
  serial,
  integer,
  jsonb,
  vector,
} from "drizzle-orm/pg-core"

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
  expiresAt: timestamp("expiresAt"),
  revokedAt: timestamp("revokedAt"),
  revokedBy: text("revokedBy"),
  revokeReason: text("revokeReason"),
  contentHash: text("contentHash"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
})

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
export type LoopRun = typeof loopRun.$inferSelect
export type EvidenceRecord = typeof evidenceRecord.$inferSelect
export type GovernanceEvent = typeof governanceEvent.$inferSelect
export type AuthorityGrant = typeof authorityGrant.$inferSelect
export type TruthClaim = typeof truthClaim.$inferSelect
export type AgentClaim = typeof agentClaim.$inferSelect
export type ConflictRecord = typeof conflictRecord.$inferSelect
export type LockRecord = typeof lockRecord.$inferSelect
export type ParkedIdea = typeof parkedIdea.$inferSelect
