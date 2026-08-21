import { randomBytes, randomUUID } from "node:crypto"
import type { PoolClient } from "pg"

import { pool } from "@/lib/db"
import { buildDeviceProof, hashOpaqueValue, verifyDeviceProof } from "./contract"

const CHALLENGE_TTL_MS = 2 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const RATE_WINDOW_MS = 60 * 1000
const RATE_LIMIT = 5

export type DeviceChallengePurpose = "enroll" | "authenticate"

type ChallengeRow = {
  id: string
  userId: string
  credentialId: string | null
  purpose: DeviceChallengePurpose
  challengeHash: string
  origin: string
  expiresAt: Date
  consumedAt: Date | null
  attempts: number
}

type CredentialRow = {
  id: string
  userId: string
  publicKeySpki: string
  revokedAt: Date | null
}

type EnrollmentCredentialRow = CredentialRow & {
  publicKeyFingerprintSha256: string
}

function opaque(bytes = 32) {
  return randomBytes(bytes).toString("base64url")
}

function assertLabel(label: unknown) {
  if (typeof label !== "string") throw new Error("DEVICE_INPUT_INVALID")
  const normalized = label.trim()
  if (normalized.length < 1 || normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("DEVICE_INPUT_INVALID")
  }
  return normalized
}

function assertBase64Url(value: unknown, min: number, max: number) {
  if (typeof value !== "string" || value.length < min || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("DEVICE_INPUT_INVALID")
  }
  return value
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query("begin")
    const result = await fn(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

async function enforceRateLimit(client: PoolClient, userId: string, purpose: DeviceChallengePurpose, now: Date) {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`device-auth:${userId}:${purpose}`])
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from device_challenge
       where "userId" = $1 and purpose = $2 and "createdAt" >= $3`,
    [userId, purpose, new Date(now.getTime() - RATE_WINDOW_MS)],
  )
  if (Number(result.rows[0]?.count ?? 0) >= RATE_LIMIT) throw new Error("DEVICE_RATE_LIMITED")
}

export async function issueEnrollmentChallenge(input: { userId: string; origin: string; now?: Date }) {
  return issueChallenge({ ...input, purpose: "enroll", credentialId: null })
}

export async function issueAuthenticationChallenge(input: { credentialId: string; origin: string; now?: Date }) {
  const credentialId = assertBase64Url(input.credentialId, 20, 80)
  const credential = await pool.query<CredentialRow>(
    `select id, "userId", "publicKeySpki", "revokedAt" from device_credential where id = $1`,
    [credentialId],
  )
  const row = credential.rows[0]
  if (!row || row.revokedAt) throw new Error("DEVICE_AUTH_REJECTED")
  return issueChallenge({
    userId: row.userId,
    origin: input.origin,
    now: input.now,
    purpose: "authenticate",
    credentialId: row.id,
  })
}

async function issueChallenge(input: {
  userId: string
  origin: string
  purpose: DeviceChallengePurpose
  credentialId: string | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const id = randomUUID()
  const challenge = opaque()
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS)
  await withTransaction(async (client) => {
    await enforceRateLimit(client, input.userId, input.purpose, now)
    await client.query(
      `insert into device_challenge
        (id, "userId", "credentialId", purpose, "challengeHash", origin, "expiresAt", attempts, "createdAt")
       values ($1,$2,$3,$4,$5,$6,$7,0,$8)`,
      [id, input.userId, input.credentialId, input.purpose, hashOpaqueValue(challenge), input.origin, expiresAt, now],
    )
  })
  const expiresAtIso = expiresAt.toISOString()
  return {
    challengeId: id,
    challenge,
    origin: input.origin,
    expiresAt: expiresAtIso,
    purpose: input.purpose,
    algorithm: "Ed25519" as const,
    proof: buildDeviceProof({
      purpose: input.purpose,
      challengeId: id,
      challenge,
      origin: input.origin,
      expiresAt: expiresAtIso,
    }),
  }
}

async function lockChallenge(client: PoolClient, input: {
  challengeId: string
  challenge: string
  purpose: DeviceChallengePurpose
  origin: string
  now: Date
}) {
  if (!/^[0-9a-f-]{36}$/i.test(input.challengeId)) throw new Error("DEVICE_AUTH_REJECTED")
  assertBase64Url(input.challenge, 43, 43)
  const result = await client.query<ChallengeRow>(
    `select id, "userId", "credentialId", purpose, "challengeHash", origin,
            "expiresAt", "consumedAt", attempts
       from device_challenge where id = $1 for update`,
    [input.challengeId],
  )
  const row = result.rows[0]
  if (!row || row.purpose !== input.purpose || row.origin !== input.origin || row.consumedAt || row.expiresAt <= input.now || row.attempts >= 3 || row.challengeHash !== hashOpaqueValue(input.challenge)) {
    throw new Error("DEVICE_AUTH_REJECTED")
  }
  return row
}

async function recordRejectedProof(client: PoolClient, challengeId: string) {
  await client.query(
    `update device_challenge set attempts = attempts + 1,
       "consumedAt" = case when attempts + 1 >= 3 then now() else "consumedAt" end
     where id = $1`,
    [challengeId],
  )
}

export async function completeDeviceEnrollment(input: {
  userId: string
  origin: string
  challengeId: string
  challenge: string
  publicKeySpki: string
  signature: string
  label: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const label = assertLabel(input.label)
  const publicKeySpki = assertBase64Url(input.publicKeySpki, 40, 128)
  const signature = assertBase64Url(input.signature, 80, 128)
  const result = await withTransaction(async (client) => {
    const challenge = await lockChallenge(client, { ...input, purpose: "enroll", now })
    if (challenge.userId !== input.userId) throw new Error("DEVICE_AUTH_REJECTED")
    const proof = buildDeviceProof({ purpose: "enroll", challengeId: challenge.id, challenge: input.challenge, origin: input.origin, expiresAt: challenge.expiresAt.toISOString() })
    if (!verifyDeviceProof({ proof, signature, publicKeySpki })) {
      await recordRejectedProof(client, challenge.id)
      return null
    }

    const fingerprint = hashOpaqueValue(publicKeySpki)
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`device-key:${fingerprint}`])
    const existingResult = await client.query<EnrollmentCredentialRow>(
      `select id, "userId", "publicKeySpki", "publicKeyFingerprintSha256", "revokedAt"
         from device_credential where "publicKeyFingerprintSha256" = $1 for update`,
      [fingerprint],
    )
    const existing = existingResult.rows[0]
    if (existing && (existing.userId !== input.userId || existing.publicKeySpki !== publicKeySpki)) {
      throw new Error("DEVICE_AUTH_REJECTED")
    }

    await client.query(`update device_challenge set "consumedAt" = $2 where id = $1 and "consumedAt" is null`, [challenge.id, now])
    if (existing) {
      const reenrolled = existing.revokedAt !== null
      await client.query(
        `update device_credential
            set label = $2, "revokedAt" = null,
                "activeAt" = case when "revokedAt" is null then "activeAt" else $3 end
          where id = $1 and "userId" = $4`,
        [existing.id, label, now, input.userId],
      )
      await client.query(
        `insert into device_auth_event (id, "userId", "credentialId", "eventType", metadata, "createdAt")
         values ($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          input.userId,
          existing.id,
          reenrolled ? "device_reenrolled" : "device_enrollment_recovered",
          JSON.stringify({ label, algorithm: "Ed25519" }),
          now,
        ],
      )
      return {
        credentialId: existing.id,
        label,
        algorithm: "Ed25519" as const,
        recovered: !reenrolled,
        reenrolled,
      }
    }

    const credentialId = opaque(24)
    await client.query(
      `insert into device_credential
        (id, "userId", label, "publicKeySpki", "publicKeyFingerprintSha256", "activeAt", "createdAt")
       values ($1,$2,$3,$4,$5,$6,$6)`,
      [credentialId, input.userId, label, publicKeySpki, fingerprint, now],
    )
    await client.query(
      `insert into device_auth_event (id, "userId", "credentialId", "eventType", metadata, "createdAt")
       values ($1,$2,$3,'device_enrolled',$4,$5)`,
      [randomUUID(), input.userId, credentialId, JSON.stringify({ label, algorithm: "Ed25519" }), now],
    )
    return { credentialId, label, algorithm: "Ed25519" as const, recovered: false, reenrolled: false }
  })
  if (!result) throw new Error("DEVICE_AUTH_REJECTED")
  return result
}

export async function completeDeviceAuthentication(input: {
  origin: string
  challengeId: string
  challenge: string
  signature: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const signature = assertBase64Url(input.signature, 80, 128)
  const result = await withTransaction(async (client) => {
    const challenge = await lockChallenge(client, { ...input, purpose: "authenticate", now })
    if (!challenge.credentialId) throw new Error("DEVICE_AUTH_REJECTED")
    const result = await client.query<CredentialRow>(
      `select id, "userId", "publicKeySpki", "revokedAt" from device_credential where id = $1 for update`,
      [challenge.credentialId],
    )
    const credential = result.rows[0]
    const proof = buildDeviceProof({ purpose: "authenticate", challengeId: challenge.id, challenge: input.challenge, origin: input.origin, expiresAt: challenge.expiresAt.toISOString() })
    if (!credential || credential.revokedAt || !verifyDeviceProof({ proof, signature, publicKeySpki: credential.publicKeySpki })) {
      await recordRejectedProof(client, challenge.id)
      return null
    }
    const rawToken = `wds_${opaque()}`
    const sessionId = opaque(24)
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
    await client.query(`update device_challenge set "consumedAt" = $2 where id = $1 and "consumedAt" is null`, [challenge.id, now])
    await client.query(
      `insert into device_session
        (id, "userId", "credentialId", "tokenHash", "expiresAt", "createdAt", "lastSeenAt")
       values ($1,$2,$3,$4,$5,$6,$6)`,
      [sessionId, credential.userId, credential.id, hashOpaqueValue(rawToken), expiresAt, now],
    )
    await client.query(`update device_credential set "lastUsedAt" = $2 where id = $1`, [credential.id, now])
    await client.query(
      `insert into device_auth_event (id, "userId", "credentialId", "sessionId", "eventType", metadata, "createdAt")
       values ($1,$2,$3,$4,'device_session_created','{}'::jsonb,$5)`,
      [randomUUID(), credential.userId, credential.id, sessionId, now],
    )
    return { rawToken, expiresAt }
  })
  if (!result) throw new Error("DEVICE_AUTH_REJECTED")
  return result
}

export async function resolveDeviceSession(rawToken: string, now = new Date()) {
  if (!/^wds_[A-Za-z0-9_-]{43}$/.test(rawToken)) return null
  const result = await pool.query<{
    sessionId: string
    userId: string
    credentialId: string
    credentialKind: "owner" | "runtime"
    expiresAt: Date
    name: string
    email: string
    image: string | null
  }>(
    `select ds.id as "sessionId", ds."userId", ds."credentialId", dc."kind" as "credentialKind", ds."expiresAt",
            u.name, u.email, u.image
       from device_session ds
       join device_credential dc on dc.id = ds."credentialId" and dc."userId" = ds."userId"
       join "user" u on u.id = ds."userId"
      where ds."tokenHash" = $1 and ds."revokedAt" is null and ds."expiresAt" > $2
        and dc."revokedAt" is null`,
    [hashOpaqueValue(rawToken), now],
  )
  return result.rows[0] ?? null
}

export async function listDeviceCredentials(userId: string) {
  const result = await pool.query<{
    id: string
    label: string
    kind: "owner" | "runtime"
    activeAt: Date
    lastUsedAt: Date | null
    revokedAt: Date | null
  }>(
    `select id, label, kind, "activeAt", "lastUsedAt", "revokedAt"
       from device_credential where "userId" = $1 order by "createdAt" desc, id desc`,
    [userId],
  )
  return result.rows
}

export async function revokeDeviceCredential(input: { userId: string; credentialId: string; now?: Date }) {
  const credentialId = assertBase64Url(input.credentialId, 20, 80)
  const now = input.now ?? new Date()
  return withTransaction(async (client) => {
    const revoked = await client.query<{ id: string }>(
      `update device_credential set "revokedAt" = $3
        where id = $1 and "userId" = $2 and "revokedAt" is null returning id`,
      [credentialId, input.userId, now],
    )
    if (!revoked.rows[0]) throw new Error("DEVICE_NOT_FOUND")
    await client.query(
      `update device_session set "revokedAt" = $3
        where "credentialId" = $1 and "userId" = $2 and "revokedAt" is null`,
      [credentialId, input.userId, now],
    )
    await client.query(
      `insert into device_auth_event (id, "userId", "credentialId", "eventType", metadata, "createdAt")
       values ($1,$2,$3,'device_revoked','{}'::jsonb,$4)`,
      [randomUUID(), input.userId, credentialId, now],
    )
    return { revoked: true as const }
  })
}
