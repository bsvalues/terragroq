import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { validateMigrationDirectory } from "../scripts/ai-evalops-harness/schema-drift-check.mjs"

const canonical = path.resolve("migrations/ai-evalops-harness")

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "aeh-migrations-"))
  await cp(canonical, temporary, { recursive: true })
  return temporary
}

test("canonical fresh and upgrade sequence passes static disposable validation", async () => {
  const result = await validateMigrationDirectory(canonical, {})
  assert.equal(result.status, "PASS")
  assert.deepEqual(result.checked.map(({ phase }) => phase), ["expand", "contract", "expand", "expand", "expand", "expand", "expand", "expand"])
})

test("rejects live database inputs without reading them", async () => {
  await assert.rejects(validateMigrationDirectory(canonical, { DATABASE_URL: "redacted" }),
    /LIVE_DATABASE_INPUT_FORBIDDEN/)
})

test("detects migration drift", async () => {
  const temporary = await fixture()
  try {
    await writeFile(path.join(temporary, "0000_expand_migration_control.sql"), "SELECT 1;\n")
    await assert.rejects(validateMigrationDirectory(temporary, {}), /MIGRATION_DRIFT/)
  } finally { await rm(temporary, { recursive: true }) }
})

test("requires old-reader drain before contract", async () => {
  const temporary = await fixture()
  try {
    const manifestPath = path.join(temporary, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    delete manifest.migrations[1].requiresOldReaderDrain
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await assert.rejects(validateMigrationDirectory(temporary, {}), /CONTRACT_DRAIN_GATE_REQUIRED/)
  } finally { await rm(temporary, { recursive: true }) }
})

test("detects rollback drift and requires forward-fix recovery", async () => {
  const temporary = await fixture()
  try {
    const rollbackPath = path.join(temporary, "0001_contract_migration_control.rollback.sql")
    await writeFile(rollbackPath, "SELECT 1;\n")
    await assert.rejects(validateMigrationDirectory(temporary, {}), /ROLLBACK_DRIFT/)

    const manifestPath = path.join(temporary, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    const rollback = await readFile(rollbackPath)
    manifest.migrations[1].rollbackSha256 = createHash("sha256").update(rollback).digest("hex")
    manifest.migrations[1].recovery = "rollback-only"
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await assert.rejects(validateMigrationDirectory(temporary, {}), /RECOVERY_CONTRACT_INVALID/)
  } finally { await rm(temporary, { recursive: true }) }
})

test("rejects extra, unowned, and missing SQL files", async () => {
  const temporary = await fixture()
  try {
    await writeFile(path.join(temporary, "9999_unowned.sql"), "SELECT 1;\n")
    await assert.rejects(validateMigrationDirectory(temporary, {}), /SQL_FILE_SET_MISMATCH:extra=9999_unowned\.sql/)
    await rm(path.join(temporary, "9999_unowned.sql"))
    await rm(path.join(temporary, "0000_expand_migration_control.sql"))
    await assert.rejects(validateMigrationDirectory(temporary, {}), /SQL_FILE_SET_MISMATCH:.*missing=0000_expand_migration_control\.sql/)
  } finally { await rm(temporary, { recursive: true }) }
})

test("rejects path escapes and reused filenames", async () => {
  const temporary = await fixture()
  try {
    const manifestPath = path.join(temporary, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.migrations[0].file = "../0000_expand_migration_control.sql"
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await assert.rejects(validateMigrationDirectory(temporary, {}), /MIGRATION_FILENAME_MISMATCH|MIGRATION_PATH_INVALID|MIGRATION_PATH_ESCAPE/)

    manifest.migrations[0].file = "0000_expand_migration_control.sql"
    manifest.migrations[1].file = "0000_expand_migration_control.sql"
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await assert.rejects(validateMigrationDirectory(temporary, {}), /MIGRATION_FILENAME_MISMATCH/)
  } finally { await rm(temporary, { recursive: true }) }
})

test("requires contract rollback and recovery metadata", async () => {
  const temporary = await fixture()
  try {
    const manifestPath = path.join(temporary, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    delete manifest.migrations[1].rollbackFile
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await assert.rejects(validateMigrationDirectory(temporary, {}), /CONTRACT_RECOVERY_METADATA_REQUIRED/)
  } finally { await rm(temporary, { recursive: true }) }
})

test("rejects renamed or swapped migration and rollback files", async () => {
  const temporary = await fixture()
  try {
    const manifestPath = path.join(temporary, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.migrations[0].file = "0001_contract_migration_control.sql"
    manifest.migrations[1].file = "0000_expand_migration_control.sql"
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await assert.rejects(validateMigrationDirectory(temporary, {}), /MIGRATION_FILENAME_MISMATCH/)

    manifest.migrations[0].file = "0000_expand_migration_control.sql"
    manifest.migrations[1].file = "0001_contract_migration_control.sql"
    manifest.migrations[1].rollbackFile = "0001_contract_migration_control_renamed.rollback.sql"
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await assert.rejects(validateMigrationDirectory(temporary, {}), /ROLLBACK_FILENAME_MISMATCH/)
  } finally { await rm(temporary, { recursive: true }) }
})

test("rejects recovery strings that merely contain forward-fix", async () => {
  const temporary = await fixture()
  try {
    const manifestPath = path.join(temporary, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.migrations[1].recovery = "not-forward-fix"
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await assert.rejects(validateMigrationDirectory(temporary, {}), /RECOVERY_CONTRACT_INVALID/)
  } finally { await rm(temporary, { recursive: true }) }
})
