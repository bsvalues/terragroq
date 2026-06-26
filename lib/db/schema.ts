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
