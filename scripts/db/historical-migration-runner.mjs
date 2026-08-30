#!/usr/bin/env node
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const FIXED_MIGRATIONS = Object.freeze([
  ["0003", "migrations/0003-project-model.sql", "37c4e94ea29e7fa9ae25852ec57c8323122a6e48d10d8eef108227af7370d622"],
  ["0005", "migrations/0005-workbench-thread.sql", "32470e1caededea0a04853974c25bbcfe054a80fffacad68b2c6d26bad87ee2d"],
  ["0010", "migrations/0010-thread-source-kinds.sql", "85ded5c36d14f5baa4d03b6e526e4bf7d88b5cfd45609350aa49e65d1dd2ddf3"],
  ["0014", "migrations/0014-historical-knowledge-promotion.sql", "bd7e0e083c1c7a049a8a26a9ba218507ec3650ef5b47bd518b319d35d2d260bf"],
])

/** @typedef {{
 * baseSchemaReady:boolean, userTable:boolean, doctrineTable:boolean, documentTable:boolean,
 * documentChunkTable:boolean, eventLogTable:boolean, projectTable:boolean,
 * projectUserKeyUnique:boolean, projectUserIdUnique:boolean,
 * workbenchThreadTable:boolean, workbenchThreadSourceTable:boolean,
 * threadSourceConstraintCurrent:boolean, projectArtifactsPresent:boolean,
 * projectSchemaReady:boolean, threadArtifactsPresent:boolean,
 * threadSchemaReady:boolean, threadSourceConstraintKnown:boolean,
 * historicalArtifactsPresent:boolean, historicalPromotionReady:boolean
 * }} HistoricalSchemaProbe */

function digestSql(sql) {
  return createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex")
}

function migrationTransactionBody(sql) {
  return sql
    .replace(/(^|\n)BEGIN;\s*/, "$1")
    .replace(/COMMIT;\s*$/, "")
}

export function loadHistoricalMigrationBundle() {
  return FIXED_MIGRATIONS.map(([id, relativePath, digest]) => {
    const sql = readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8").replaceAll("\r\n", "\n")
    if (digestSql(sql) !== digest || !/(?:^|\n)BEGIN;/.test(sql) || !/COMMIT;\s*$/.test(sql)) {
      throw new Error(`HISTORICAL_MIGRATION_INPUT_WALL:${id}`)
    }
    return { id, relativePath, digest, sql }
  })
}

const PROBE_SQL = `
/* HISTORICAL_SCHEMA_PROBE */
SELECT jsonb_build_object(
  'tables', COALESCE((SELECT jsonb_agg(table_name) FROM information_schema.tables WHERE table_schema = current_schema()), '[]'::jsonb),
  'columns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'tableName', table_name, 'name', column_name, 'dataType', data_type,
    'udtName', udt_name, 'nullable', is_nullable
  )) FROM information_schema.columns WHERE table_schema = current_schema()), '[]'::jsonb),
  'constraints', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'tableName', c.relname, 'name', con.conname, 'type', con.contype,
    'definition', pg_get_constraintdef(con.oid)
  )) FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema()), '[]'::jsonb),
  'indexes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'tableName', tablename, 'name', indexname, 'definition', indexdef,
    'unique', indexdef ILIKE 'CREATE UNIQUE INDEX%'
  )) FROM pg_indexes WHERE schemaname = current_schema()), '[]'::jsonb),
  'functions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'name', p.proname, 'definition', pg_get_functiondef(p.oid)
  )) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema()), '[]'::jsonb),
  'triggers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'tableName', c.relname, 'name', t.tgname, 'definition', pg_get_triggerdef(t.oid),
    'enabled', t.tgenabled
  )) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND NOT t.tgisinternal), '[]'::jsonb)
) AS catalog
`

function normalizeDefinition(value) {
  return String(value ?? "").replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase()
}

function sameLiterals(definition, expected) {
  const actual = [...normalizeDefinition(definition).matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()
  return actual.length === expected.length && actual.every((value, index) => value === [...expected].sort()[index])
}

export function classifyHistoricalSchemaCatalog(catalog) {
  const tables = new Set(catalog.tables ?? [])
  const columns = catalog.columns ?? []
  const constraints = catalog.constraints ?? []
  const indexes = catalog.indexes ?? []
  const functions = catalog.functions ?? []
  const triggers = catalog.triggers ?? []
  const column = (tableName, name, dataType, nullable) => columns.some((entry) => (
    entry.tableName === tableName && entry.name === name
      && String(entry.dataType).toLowerCase() === dataType
      && entry.nullable === nullable
  ))
  const columnsMatch = (tableName, specs) => specs.every(([name, dataType, nullable]) => (
    column(tableName, name, dataType, nullable)
  ))
  const constraint = (tableName, name, type, fragments = []) => constraints.some((entry) => {
    const definition = normalizeDefinition(entry.definition)
    return entry.tableName === tableName && entry.name === name && entry.type === type
      && fragments.every((fragment) => definition.includes(fragment))
  })
  const namedConstraint = (tableName, name) => constraints.find((entry) => (
    entry.tableName === tableName && entry.name === name
  ))
  const index = (tableName, name, unique, fragments) => indexes.some((entry) => {
    const definition = normalizeDefinition(entry.definition)
    return entry.tableName === tableName && entry.name === name && entry.unique === unique
      && fragments.every((fragment) => definition.includes(fragment))
  })
  const functionMatches = (name, fragments) => functions.some((entry) => (
    entry.name === name && fragments.every((fragment) => normalizeDefinition(entry.definition).includes(fragment))
  ))
  const triggerMatches = (tableName, name, fragments) => triggers.some((entry) => (
    entry.tableName === tableName && entry.name === name && entry.enabled !== "D"
      && fragments.every((fragment) => normalizeDefinition(entry.definition).includes(fragment))
  ))

  const userTable = tables.has("user")
  const doctrineTable = tables.has("doctrine")
  const documentTable = tables.has("document")
  const documentChunkTable = tables.has("document_chunk")
  const eventLogTable = tables.has("event_log")
  const baseSchemaReady = userTable && doctrineTable && documentTable && documentChunkTable && eventLogTable
    && columnsMatch("user", [["id", "text", "NO"]])
    && columnsMatch("doctrine", [
      ["id", "integer", "NO"], ["userId", "text", "NO"], ["ref", "text", "YES"],
      ["title", "text", "NO"], ["statement", "text", "NO"], ["category", "text", "NO"],
      ["scope", "text", "YES"], ["status", "text", "NO"], ["priority", "integer", "NO"],
      ["active", "boolean", "NO"], ["allowed", "ARRAY", "NO"], ["forbidden", "ARRAY", "NO"],
      ["requiresApproval", "ARRAY", "NO"], ["evidence", "ARRAY", "NO"], ["owner", "text", "NO"],
      ["locked", "boolean", "NO"], ["supersedesId", "integer", "YES"],
      ["supersededById", "integer", "YES"], ["updatedAt", "timestamp without time zone", "NO"],
    ].map(([name, type, nullable]) => [name, String(type).toLowerCase(), nullable]))
    && columnsMatch("document", [
      ["id", "integer", "NO"], ["userId", "text", "NO"], ["title", "text", "NO"],
      ["source", "text", "YES"], ["mimeType", "text", "NO"], ["content", "text", "NO"],
      ["chunkCount", "integer", "NO"], ["status", "text", "NO"],
      ["updatedAt", "timestamp without time zone", "NO"],
    ])
    && columnsMatch("document_chunk", [
      ["id", "integer", "NO"], ["userId", "text", "NO"], ["documentId", "integer", "NO"],
      ["chunkIndex", "integer", "NO"], ["content", "text", "NO"],
    ])
    && columnsMatch("event_log", [
      ["id", "integer", "NO"], ["userId", "text", "NO"], ["type", "text", "NO"],
      ["summary", "text", "NO"], ["register", "text", "YES"], ["refId", "integer", "YES"],
      ["metadata", "jsonb", "YES"],
    ])

  const projectTable = tables.has("project")
  const projectResourceTable = tables.has("project_resource")
  const projectArtifactsPresent = projectTable || projectResourceTable
  const projectUserKeyUnique = constraint("project", "project_user_key_unique", "u", ["unique (userid, key)"])
  const projectUserIdUnique = constraint("project", "project_user_id_unique", "u", ["unique (userid, id)"])
  const projectSchemaReady = projectTable && projectResourceTable
    && columnsMatch("project", [
      ["id", "integer", "NO"], ["userId", "text", "NO"], ["key", "text", "NO"],
      ["name", "text", "NO"], ["lifecycle", "text", "NO"],
      ["createdAt", "timestamp with time zone", "NO"], ["updatedAt", "timestamp with time zone", "NO"],
    ])
    && columnsMatch("project_resource", [
      ["id", "integer", "NO"], ["userId", "text", "NO"], ["projectId", "integer", "NO"],
      ["type", "text", "NO"], ["canonicalIdentity", "text", "NO"], ["label", "text", "NO"],
      ["relationship", "text", "NO"], ["createdAt", "timestamp with time zone", "NO"],
      ["updatedAt", "timestamp with time zone", "NO"],
    ])
    && projectUserKeyUnique && projectUserIdUnique
    && constraint("project", "project_lifecycle_check", "c", ["lifecycle"])
    && sameLiterals(namedConstraint("project", "project_lifecycle_check")?.definition, ["active", "standby", "archived"])
    && constraint("project_resource", "project_resource_identity_unique", "u", ["projectid", "type", "canonicalidentity", "relationship"])
    && constraint("project_resource", "project_resource_projectId_project_id_fk", "f", ["foreign key (projectid)", "references project(id)", "on delete restrict"])
    && sameLiterals(namedConstraint("project_resource", "project_resource_type_check")?.definition, ["repo", "database", "node", "service", "data_source"])
    && index("project_resource", "project_resource_user_project_idx", false, ["(userid, projectid)"])
    && index("project_resource", "project_resource_user_identity_idx", false, ["(userid, type, canonicalidentity)"])

  const workbenchThreadTable = tables.has("workbench_thread")
  const workbenchThreadSourceTable = tables.has("workbench_thread_source")
  const threadArtifactsPresent = workbenchThreadTable || workbenchThreadSourceTable
  const sourceTypeConstraint = namedConstraint("workbench_thread_source", "workbench_thread_source_type_check")
  const oldSourceTypes = ["goal", "outcome"]
  const currentSourceTypes = [
    "goal", "outcome", "outcome_queue_item", "work_order", "conversation_message",
    "governance_event", "evidence_record", "decision", "event_log", "loop_run",
    "artifact", "resource", "reconciliation",
  ]
  const threadSourceConstraintCurrent = sourceTypeConstraint?.type === "c"
    && sameLiterals(sourceTypeConstraint.definition, currentSourceTypes)
  const threadSourceConstraintKnown = sourceTypeConstraint?.type === "c"
    && (sameLiterals(sourceTypeConstraint.definition, oldSourceTypes) || threadSourceConstraintCurrent)
  const threadSchemaReady = workbenchThreadTable && workbenchThreadSourceTable
    && columnsMatch("workbench_thread", [
      ["id", "text", "NO"], ["userId", "text", "NO"], ["projectId", "integer", "NO"],
      ["title", "text", "NO"], ["createdAt", "timestamp with time zone", "NO"],
      ["updatedAt", "timestamp with time zone", "NO"],
    ])
    && columnsMatch("workbench_thread_source", [
      ["id", "integer", "NO"], ["userId", "text", "NO"], ["threadId", "text", "NO"],
      ["sourceType", "text", "NO"], ["sourceId", "text", "NO"], ["role", "text", "NO"],
      ["createdAt", "timestamp with time zone", "NO"],
    ])
    && constraint("workbench_thread", "workbench_thread_user_id_unique", "u", ["unique (userid, id)"])
    && constraint("workbench_thread", "workbench_thread_user_project_fk", "f", ["foreign key (userid, projectid)", "references project(userid, id)", "on delete restrict"])
    && constraint("workbench_thread_source", "workbench_thread_source_binding_unique", "u", ["unique (userid, threadid, sourcetype, sourceid)"])
    && constraint("workbench_thread_source", "workbench_thread_source_user_thread_fk", "f", ["foreign key (userid, threadid)", "references workbench_thread(userid, id)", "on delete cascade"])
    && sameLiterals(namedConstraint("workbench_thread_source", "workbench_thread_source_role_check")?.definition, ["root", "member"])
    && index("workbench_thread", "workbench_thread_user_project_updated_idx", false, ["(userid, projectid, updatedat, id)"])
    && index("workbench_thread_source", "workbench_thread_source_root_unique_idx", true, ["(userid, sourcetype, sourceid)", "where (role = 'root'::text)"])
    && index("workbench_thread_source", "workbench_thread_source_thread_root_unique_idx", true, ["(userid, threadid)", "where (role = 'root'::text)"])

  const historicalColumnNames = new Set([
    "projectId", "threadId", "historicalCandidateId", "historicalClaimId", "historicalProvenance",
    "privacy", "authority", "executionMode", "archivedAt",
  ])
  const historicalArtifactsPresent = columns.some((entry) => (
    (entry.tableName === "doctrine" || entry.tableName === "document") && historicalColumnNames.has(entry.name)
  )) || constraints.some((entry) => entry.name.startsWith("doctrine_historical_")
      || entry.name.startsWith("document_historical_")
      || entry.name === "workbench_thread_user_project_id_unique")
    || indexes.some((entry) => entry.name === "doctrine_historical_candidate_user_idx"
      || entry.name === "document_historical_candidate_user_idx")
    || functions.some((entry) => entry.name === "lock_historical_document_chunk_invariant"
      || entry.name === "reject_historical_document_chunk"
      || entry.name === "reject_historical_document_with_chunks")
    || triggers.some((entry) => entry.name === "document_chunk_reject_historical_insert"
      || entry.name === "document_reject_historical_with_chunks")
  const historicalPromotionReady = columnsMatch("doctrine", [
    ["historicalCandidateId", "text", "YES"], ["historicalClaimId", "text", "YES"],
    ["historicalProvenance", "jsonb", "YES"],
  ]) && columnsMatch("document", [
    ["projectId", "integer", "YES"], ["threadId", "text", "YES"],
    ["historicalCandidateId", "text", "YES"], ["historicalClaimId", "text", "YES"],
    ["historicalProvenance", "jsonb", "YES"], ["privacy", "text", "YES"],
    ["authority", "text", "YES"], ["executionMode", "text", "YES"],
    ["archivedAt", "timestamp with time zone", "YES"],
  ])
    && constraint("doctrine", "doctrine_historical_identity_check", "c", ["historicalcandidateid", "historicalclaimid", "historicalprovenance", "historical_input", "historical_archived"])
    && constraint("doctrine", "doctrine_historical_safety_check", "c", ["active = false", "priority = 0", "historical_non_authoritative"])
    && constraint("workbench_thread", "workbench_thread_user_project_id_unique", "u", ["unique (userid, projectid, id)"])
    && constraint("document", "document_historical_user_project_fk", "f", ["foreign key (userid, projectid)", "references project(userid, id)", "on delete restrict"])
    && constraint("document", "document_historical_user_project_thread_fk", "f", ["foreign key (userid, projectid, threadid)", "references workbench_thread(userid, projectid, id)", "on delete restrict"])
    && constraint("document", "document_historical_identity_check", "c", ["historicalcandidateid", "historicalclaimid", "historicalprovenance", "private_project_context", "archived_private_project_context"])
    && constraint("document", "document_historical_safety_check", "c", ["chunkcount = 0", "privacy = 'private'::text", "historical_non_authoritative", "non_executing"])
    && index("doctrine", "doctrine_historical_candidate_user_idx", true, ["(userid, historicalcandidateid)", "where (historicalcandidateid is not null)"])
    && index("document", "document_historical_candidate_user_idx", true, ["(userid, historicalcandidateid)", "where (historicalcandidateid is not null)"])
    && functionMatches("lock_historical_document_chunk_invariant", ["pg_advisory_xact_lock", "historical-document-chunk", "schemaname", "documentid"])
    && functionMatches("reject_historical_document_chunk", ["historical_project_context_chunk_forbidden", "document_chunk", "historicalcandidateid"])
    && functionMatches("reject_historical_document_with_chunks", ["historical_project_context_chunk_forbidden", "document_chunk", "chunkcount"])
    && triggerMatches("document_chunk", "document_chunk_reject_historical_insert", ["before insert or update of documentid", "reject_historical_document_chunk"])
    && triggerMatches("document", "document_reject_historical_with_chunks", ["before insert or update of status, historicalcandidateid, chunkcount", "reject_historical_document_with_chunks"])

  return {
    baseSchemaReady,
    userTable,
    doctrineTable,
    documentTable,
    documentChunkTable,
    eventLogTable,
    projectTable,
    projectUserKeyUnique,
    projectUserIdUnique,
    workbenchThreadTable,
    workbenchThreadSourceTable,
    threadSourceConstraintCurrent,
    projectArtifactsPresent,
    projectSchemaReady,
    threadArtifactsPresent,
    threadSchemaReady,
    threadSourceConstraintKnown,
    historicalArtifactsPresent,
    historicalPromotionReady,
  }
}

export async function probeHistoricalSchema(client) {
  const result = await client.query(PROBE_SQL)
  if (result.rows.length !== 1) throw new Error("HISTORICAL_MIGRATION_PROBE_FAILED")
  return result.rows[0].catalog
    ? classifyHistoricalSchemaCatalog(result.rows[0].catalog)
    : result.rows[0]
}

/** @param {HistoricalSchemaProbe} probe */
export function buildHistoricalMigrationPlan(probe) {
  for (const [property, table] of [
    ["userTable", "user"],
    ["doctrineTable", "doctrine"],
    ["documentTable", "document"],
    ["documentChunkTable", "document_chunk"],
    ["eventLogTable", "event_log"],
  ]) {
    if (!probe[property]) throw new Error(`HISTORICAL_MIGRATION_BASE_SCHEMA_REQUIRED:${table}`)
  }
  if (!probe.baseSchemaReady) throw new Error("HISTORICAL_MIGRATION_BASE_SCHEMA_INVALID")
  if (probe.projectArtifactsPresent && !probe.projectSchemaReady) {
    throw new Error("HISTORICAL_MIGRATION_PARTIAL_SCHEMA:project")
  }
  if (probe.threadArtifactsPresent && (!probe.threadSchemaReady || !probe.threadSourceConstraintKnown)) {
    throw new Error("HISTORICAL_MIGRATION_PARTIAL_SCHEMA:thread")
  }
  if (probe.historicalArtifactsPresent && !probe.historicalPromotionReady) {
    throw new Error("HISTORICAL_MIGRATION_PARTIAL_SCHEMA:0014")
  }
  const apply0003 = !probe.projectArtifactsPresent
  const apply0005 = apply0003 || !probe.threadArtifactsPresent
  const apply0010 = apply0005 || !probe.threadSourceConstraintCurrent
  return [
    { id: "0003", action: apply0003 ? "apply" : "skip" },
    { id: "0005", action: apply0005 ? "apply" : "skip" },
    { id: "0010", action: apply0010 ? "apply" : "skip" },
    { id: "0014", action: probe.historicalPromotionReady ? "skip" : "apply" },
  ]
}

async function runHistoricalMigrationsOnConnection({ client, apply = false }) {
  const bundle = loadHistoricalMigrationBundle()
  const before = await probeHistoricalSchema(client)
  const plan = buildHistoricalMigrationPlan(before)
  if (!apply) return { status: "DRY_RUN", plan }

  const byId = new Map(bundle.map((entry) => [entry.id, entry]))
  const applied = []
  await client.query("BEGIN")
  try {
    for (const step of plan) {
      if (step.action === "skip") continue
      const migration = byId.get(step.id)
      if (!migration) throw new Error(`HISTORICAL_MIGRATION_UNRESOLVED:${step.id}`)
      await client.query(migrationTransactionBody(migration.sql))
      applied.push(step.id)
    }

    const after = await probeHistoricalSchema(client)
    if (!after.baseSchemaReady || !after.projectSchemaReady || !after.projectUserKeyUnique
      || !after.projectUserIdUnique || !after.threadSchemaReady
      || !after.threadSourceConstraintKnown || !after.threadSourceConstraintCurrent
      || !after.historicalPromotionReady) {
      throw new Error("HISTORICAL_MIGRATION_SCHEMA_VERIFICATION_FAILED")
    }
    await client.query("COMMIT")
    return { status: "APPLIED", applied, plan }
  } catch (error) {
    try { await client.query("ROLLBACK") } catch {}
    throw error
  }
}

export async function runHistoricalMigrations({ pool, apply = false }) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("HISTORICAL_MIGRATION_POOL_REQUIRED")
  }
  const client = await pool.connect()
  if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
    throw new Error("HISTORICAL_MIGRATION_DEDICATED_CONNECTION_REQUIRED")
  }
  try {
    return await runHistoricalMigrationsOnConnection({ client, apply })
  } finally {
    client.release()
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) {
    throw new Error("HISTORICAL_MIGRATION_ARGUMENT_WALL")
  }
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim()
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED")
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  try {
    console.log(JSON.stringify(await runHistoricalMigrations({ pool, apply: args[0] === "--apply" })))
  } finally {
    await pool.end()
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
