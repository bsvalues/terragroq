import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function fail(code, detail) {
  process.stderr.write(`${code}: ${detail}\n`)
  process.exitCode = 2
}

export async function validateMigrationDirectory(directory, environment = process.env) {
  if (environment.DATABASE_URL || environment.AEH_DATABASE_URL) {
    throw new Error("LIVE_DATABASE_INPUT_FORBIDDEN")
  }
  if (environment.AEH_MIGRATION_MODE && environment.AEH_MIGRATION_MODE !== "disposable-static") {
    throw new Error("NON_DISPOSABLE_MODE_FORBIDDEN")
  }

  const manifestPath = path.join(directory, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  if (manifest.schemaVersion !== 1 || manifest.databaseUse !== "DISPOSABLE_ONLY") {
    throw new Error("MANIFEST_BOUNDARY_INVALID")
  }
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
    throw new Error("MIGRATIONS_REQUIRED")
  }

  const expectedSqlFiles = new Set()
  const allowedRecovery = new Set([
    "restore-before-writes-or-forward-fix-after-writes",
    "rollback-before-writes-or-forward-fix-after-writes",
  ])
  const claimFile = (file, kind) => {
    if (typeof file !== "string" || !/^[0-9]{4}_[a-z0-9_]+(?:\.rollback)?\.sql$/.test(file)) {
      throw new Error(`${kind}_PATH_INVALID`)
    }
    if (path.basename(file) !== file || path.resolve(directory, file) !== path.join(path.resolve(directory), file)) {
      throw new Error(`${kind}_PATH_ESCAPE`)
    }
    if (expectedSqlFiles.has(file)) throw new Error(`SQL_FILE_REUSED:${file}`)
    expectedSqlFiles.add(file)
  }

  const migrationIds = new Set()
  for (const migration of manifest.migrations) {
    if (migrationIds.has(migration.id)) throw new Error(`MIGRATION_ID_REUSED:${migration.id}`)
    migrationIds.add(migration.id)
    if (migration.file !== `${migration.id}.sql`) {
      throw new Error(`MIGRATION_FILENAME_MISMATCH:${migration.id}`)
    }
    claimFile(migration.file, "MIGRATION")
    if (migration.phase === "contract" &&
      (!migration.rollbackFile || !migration.rollbackSha256 || !migration.recovery)) {
      throw new Error(`CONTRACT_RECOVERY_METADATA_REQUIRED:${migration.id}`)
    }
    if (migration.phase === "contract" && migration.rollbackFile !== `${migration.id}.rollback.sql`) {
      throw new Error(`ROLLBACK_FILENAME_MISMATCH:${migration.id}`)
    }
    if (migration.rollbackFile) claimFile(migration.rollbackFile, "ROLLBACK")
  }

  const actualSqlFiles = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort()
  const expected = [...expectedSqlFiles].sort()
  const extra = actualSqlFiles.filter((file) => !expectedSqlFiles.has(file))
  const missing = expected.filter((file) => !actualSqlFiles.includes(file))
  if (extra.length || missing.length) {
    throw new Error(`SQL_FILE_SET_MISMATCH:extra=${extra.join(",")};missing=${missing.join(",")}`)
  }

  let priorId = ""
  const checked = []
  for (const migration of manifest.migrations) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(migration.id) || migration.id <= priorId) {
      throw new Error("MIGRATION_ORDER_INVALID")
    }
    priorId = migration.id
    if (!["expand", "contract", "forward_fix"].includes(migration.phase)) {
      throw new Error("MIGRATION_PHASE_INVALID")
    }
    if (migration.phase === "contract") {
      if (!migration.requiresOldReaderDrain) throw new Error("CONTRACT_DRAIN_GATE_REQUIRED")
    }
    if (!migration.requiresBackupReceipt) throw new Error("BACKUP_RECEIPT_GATE_REQUIRED")
    if (!allowedRecovery.has(migration.recovery)) throw new Error("RECOVERY_CONTRACT_INVALID")

    const sql = await readFile(path.join(directory, migration.file), "utf8")
    if (/\b(DROP\s+(DATABASE|SCHEMA|TABLE)|TRUNCATE)\b/i.test(sql)) {
      throw new Error("DESTRUCTIVE_SQL_FORBIDDEN")
    }
    const digest = createHash("sha256").update(sql).digest("hex")
    if (digest !== migration.sha256) throw new Error(`MIGRATION_DRIFT:${migration.id}`)

    if (migration.rollbackFile) {
      const rollback = await readFile(path.join(directory, migration.rollbackFile), "utf8")
      const rollbackDigest = createHash("sha256").update(rollback).digest("hex")
      if (rollbackDigest !== migration.rollbackSha256) {
        throw new Error(`ROLLBACK_DRIFT:${migration.id}`)
      }
    }
    checked.push({ id: migration.id, phase: migration.phase, sha256: digest })
  }
  return { status: "PASS", mode: "disposable-static", checked }
}

async function main() {
  const requested = process.argv[2]
  const directory = requested ? path.resolve(requested) : path.join(root, "migrations/ai-evalops-harness")
  try {
    const result = await validateMigrationDirectory(directory)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    fail(error instanceof Error ? error.message : "VALIDATION_FAILED", directory)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
