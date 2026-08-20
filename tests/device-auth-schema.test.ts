import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { getTableName } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import * as schema from "@/lib/db/schema"

const tables = {
  credential: schema.deviceCredential,
  challenge: schema.deviceChallenge,
  session: schema.deviceSession,
  event: schema.deviceAuthEvent,
}

describe("device authentication schema", () => {
  it("defines a separate durable device-auth table set", () => {
    expect(schema).toMatchObject({
      deviceCredential: expect.anything(),
      deviceChallenge: expect.anything(),
      deviceSession: expect.anything(),
      deviceAuthEvent: expect.anything(),
    })
    expect(Object.values(tables).map(getTableName)).toEqual([
      "device_credential",
      "device_challenge",
      "device_session",
      "device_auth_event",
    ])
  })

  it("stores Ed25519 public identity without private key material", () => {
    const config = getTableConfig(tables.credential)
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "userId",
      "label",
      "kind",
      "publicKeySpki",
      "publicKeyFingerprintSha256",
      "activeAt",
      "revokedAt",
      "lastUsedAt",
      "createdAt",
    ])
    expect(config.checks.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      "device_credential_fingerprint_check",
      "device_credential_label_check",
      "device_credential_spki_check",
    ]))
    expect(config.indexes.some((entry) => (
      entry.config.name === "device_credential_fingerprint_idx" && entry.config.unique
    ))).toBe(true)
  })

  it("persists bounded challenges and durable limiter indexes", () => {
    const config = getTableConfig(tables.challenge)
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "userId",
      "credentialId",
      "purpose",
      "challengeHash",
      "origin",
      "expiresAt",
      "consumedAt",
      "attempts",
      "createdAt",
    ])
    expect(config.checks.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      "device_challenge_purpose_check",
      "device_challenge_hash_check",
      "device_challenge_attempts_check",
      "device_challenge_expiry_check",
      "device_challenge_consumed_check",
    ]))
    expect(config.indexes.map((entry) => entry.config.name)).toEqual(expect.arrayContaining([
      "device_challenge_hash_idx",
      "device_challenge_user_purpose_created_idx",
      "device_challenge_credential_purpose_created_idx",
      "device_challenge_origin_purpose_created_idx",
      "device_challenge_expiry_idx",
    ]))
  })

  it("stores only hashed opaque device sessions and nullable audit links", () => {
    const session = getTableConfig(tables.session)
    expect(session.columns.map((column) => column.name)).toEqual([
      "id",
      "userId",
      "credentialId",
      "tokenHash",
      "expiresAt",
      "revokedAt",
      "lastSeenAt",
      "createdAt",
    ])
    expect(session.indexes.some((entry) => (
      entry.config.name === "device_session_token_hash_idx" && entry.config.unique
    ))).toBe(true)

    const event = getTableConfig(tables.event)
    for (const nullableLink of ["userId", "credentialId", "sessionId"]) {
      expect(event.columns.find((column) => column.name === nullableLink)?.notNull).toBe(false)
    }
    expect(event.columns.find((column) => column.name === "metadata")?.notNull).toBe(true)
  })

  it("uses timestamptz for every device clock", () => {
    const clockNames = new Set([
      "activeAt",
      "revokedAt",
      "lastUsedAt",
      "expiresAt",
      "consumedAt",
      "lastSeenAt",
      "createdAt",
    ])
    for (const table of Object.values(tables)) {
      const clocks = getTableConfig(table).columns.filter((column) => clockNames.has(column.name))
      expect(clocks.length).toBeGreaterThan(0)
      expect(clocks.every((column) => column.getSQLType() === "timestamp with time zone")).toBe(true)
    }
  })

  it("cascades owned identity state while retaining generic audit evidence", () => {
    expect(getTableConfig(tables.credential).foreignKeys.map((key) => key.onDelete)).toEqual([
      "cascade",
    ])
    expect(getTableConfig(tables.challenge).foreignKeys.map((key) => key.onDelete)).toEqual([
      "cascade",
      "set null",
    ])
    expect(getTableConfig(tables.session).foreignKeys.map((key) => key.onDelete)).toEqual([
      "cascade",
      "cascade",
    ])
    expect(getTableConfig(tables.event).foreignKeys.map((key) => key.onDelete)).toEqual([
      "set null",
      "set null",
      "set null",
    ])
  })

  it("ships the additive 0004 migration after the project model", () => {
    const migrationPath = path.resolve("migrations/0004-device-auth.sql")
    expect(existsSync(migrationPath)).toBe(true)
    const migration = readFileSync(migrationPath, "utf8")
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "device_credential"')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "device_challenge"')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "device_session"')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "device_auth_event"')
    expect(migration).toContain('ON DELETE cascade ON UPDATE no action')
    expect(migration).toContain('ON DELETE set null ON UPDATE no action')
    expect(migration).not.toContain("access_grant")
  })
})
