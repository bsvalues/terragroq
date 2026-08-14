import { generateKeyPairSync, sign } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const databaseUrl = process.env.DEVICE_AUTH_TEST_DATABASE_URL
const run = databaseUrl ? describe : describe.skip

run("device auth PostgreSQL lifecycle", () => {
  let service: typeof import("@/lib/device-auth/service")
  let pool: typeof import("@/lib/db").pool
  const userId = "device-test-primary"

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl
    ;({ pool } = await import("@/lib/db"))
    service = await import("@/lib/device-auth/service")
    await pool.query(
      `insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt")
       values ($1,'Primary','bsvalues@gmail.com',true,now(),now())`,
      [userId],
    )
  })

  afterAll(async () => { await pool.end() })

  it("recovers enrollment across native binding failure and safely re-enrolls after revocation", async () => {
    const origin = "https://hermes.example.com"
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    const publicKeySpki = publicKey.export({ type: "spki", format: "der" }).toString("base64url")
    const enrollment = await service.issueEnrollmentChallenge({ userId, origin })
    const enrollmentSignature = sign(null, Buffer.from(enrollment.proof), privateKey).toString("base64url")
    const credential = await service.completeDeviceEnrollment({
      userId,
      origin,
      challengeId: enrollment.challengeId,
      challenge: enrollment.challenge,
      publicKeySpki,
      signature: enrollmentSignature,
      label: "Test Cockpit",
    })

    // A server commit can succeed before the native Cockpit persists credentialId.
    // A fresh authenticated enrollment must recover the same credential instead
    // of stranding the key behind the fingerprint uniqueness boundary.
    const recoveryChallenge = await service.issueEnrollmentChallenge({ userId, origin })
    const recoverySignature = sign(null, Buffer.from(recoveryChallenge.proof), privateKey).toString("base64url")
    const recovered = await service.completeDeviceEnrollment({
      userId,
      origin,
      challengeId: recoveryChallenge.challengeId,
      challenge: recoveryChallenge.challenge,
      publicKeySpki,
      signature: recoverySignature,
      label: "Recovered Cockpit",
    })
    expect(recovered).toMatchObject({ credentialId: credential.credentialId, recovered: true, reenrolled: false })
    await expect(service.completeDeviceEnrollment({
      userId,
      origin,
      challengeId: enrollment.challengeId,
      challenge: enrollment.challenge,
      publicKeySpki,
      signature: enrollmentSignature,
      label: "Replay",
    })).rejects.toThrow("DEVICE_AUTH_REJECTED")

    const auth = await service.issueAuthenticationChallenge({ credentialId: credential.credentialId, origin })
    const signature = sign(null, Buffer.from(auth.proof), privateKey).toString("base64url")
    const session = await service.completeDeviceAuthentication({
      origin,
      challengeId: auth.challengeId,
      challenge: auth.challenge,
      signature,
    })
    expect((await service.resolveDeviceSession(session.rawToken))?.userId).toBe(userId)
    await expect(service.completeDeviceAuthentication({
      origin,
      challengeId: auth.challengeId,
      challenge: auth.challenge,
      signature,
    })).rejects.toThrow("DEVICE_AUTH_REJECTED")

    await service.revokeDeviceCredential({ userId, credentialId: credential.credentialId })
    expect(await service.resolveDeviceSession(session.rawToken)).toBeNull()

    const reenrollChallenge = await service.issueEnrollmentChallenge({ userId, origin })
    const reenrollSignature = sign(null, Buffer.from(reenrollChallenge.proof), privateKey).toString("base64url")
    const reenrolled = await service.completeDeviceEnrollment({
      userId,
      origin,
      challengeId: reenrollChallenge.challengeId,
      challenge: reenrollChallenge.challenge,
      publicKeySpki,
      signature: reenrollSignature,
      label: "Re-enrolled Cockpit",
    })
    expect(reenrolled).toMatchObject({ credentialId: credential.credentialId, recovered: false, reenrolled: true })
    expect((await service.listDeviceCredentials(userId)).find((row) => row.id === credential.credentialId)?.revokedAt).toBeNull()
    expect(await service.resolveDeviceSession(session.rawToken)).toBeNull()

    const persisted = await pool.query(`select "challengeHash", "tokenHash" from device_challenge cross join device_session limit 1`)
    expect(JSON.stringify(persisted.rows)).not.toContain(enrollment.challenge)
    expect(JSON.stringify(persisted.rows)).not.toContain(session.rawToken)
  })

  it("durably rate limits challenge issuance", async () => {
    const otherUser = "device-rate-primary"
    await pool.query(
      `insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt")
       values ($1,'Rate','rate@example.com',true,now(),now())`,
      [otherUser],
    )
    for (let index = 0; index < 5; index += 1) {
      await service.issueEnrollmentChallenge({ userId: otherUser, origin: "https://hermes.example.com" })
    }
    await expect(service.issueEnrollmentChallenge({ userId: otherUser, origin: "https://hermes.example.com" }))
      .rejects.toThrow("DEVICE_RATE_LIMITED")
  })
})
