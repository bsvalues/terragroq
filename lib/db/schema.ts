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
export const memoryFact = pgTable("memory_fact", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  content: text("content").notNull(),
  kind: text("kind").default("fact").notNull(), // fact | preference | identity | relationship
  source: text("source"),
  confidence: text("confidence").default("medium").notNull(), // low | medium | high
  tags: text("tags").array().default([]).notNull(),
  pinned: boolean("pinned").default(false).notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

// Decisions: the decision register (ADR-style) with status lifecycle.
export const decision = pgTable("decision", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  title: text("title").notNull(),
  context: text("context"),
  decision: text("decision").notNull(),
  rationale: text("rationale"),
  consequences: text("consequences"),
  status: text("status").default("proposed").notNull(), // proposed | accepted | superseded | rejected
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

// Doctrine: the operating principles / rules that govern behavior.
export const doctrine = pgTable("doctrine", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  category: text("category").default("principle").notNull(), // principle | policy | guardrail
  priority: integer("priority").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
})

// Work Orders: governed units of work.
export const workOrder = pgTable("work_order", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").default("backlog").notNull(), // backlog | in_progress | blocked | done
  priority: text("priority").default("medium").notNull(), // low | medium | high | critical
  assignee: text("assignee"),
  linkedDecisionId: integer("linkedDecisionId"),
  dueAt: timestamp("dueAt"),
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
