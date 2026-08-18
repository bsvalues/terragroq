import { register } from "node:module"
import { pathToFileURL } from "node:url"

register("./repo-alias-loader.mjs", pathToFileURL(`${import.meta.dirname}/`))

const crypto = await import("node:crypto")
const fs = await import("node:fs")
const path = await import("node:path")
const os = await import("node:os")

const { pool } = await import("@/lib/db")
const { issueEnrollmentChallenge, completeDeviceEnrollment } = await import("@/lib/device-auth/service")
const { buildDeviceProof } = await import("@/lib/device-auth/contract")
const { resolveOwnerUserId } = await import("@/lib/governance/owner")
const { ownerLookup } = await import("@/lib/governance/owner-lookup")
const { appendGovernanceEvent } = await import("@/lib/governance/events")
const operator = await import("@/lib/device-auth/operator")

/**
 * Enrol the synthetic operator once, under recorded owner authority (#872).
 *
 * This is the seam #871 proved broken: a frontier agent could not authenticate, so it used a shell and
 * became the orchestrator. The repair deliberately adds no HTTP surface -- once a credential exists for
 * a distinct identity, the agent authenticates through the device-session routes that already exist,
 * and getSession() already accepts the resulting cookie.
 *
 * It runs through the real service functions rather than writing rows itself, because a credential
 * enrolled by rules the application does not use is a credential the application may later reject.
 */
const ORIGIN = process.env.WILLIAMOS_OPERATOR_ORIGIN ?? "https://192.168.88.9:3443"
const KEY_DIR = path.join(os.homedir(), ".williamos", "operator")
const KEY_FILE = path.join(KEY_DIR, "synthetic-operator.ed25519")

const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)

// Resolve or create the identity. Distinct from the owner by construction, and checked anyway.
const existing = await pool.query('SELECT "id" FROM "user" WHERE lower("email") = $1 LIMIT 1', [
  operator.SYNTHETIC_OPERATOR_EMAIL,
])
let operatorId = existing.rows[0]?.id ?? null
if (!operatorId) {
  operatorId = crypto.randomUUID()
  await pool.query(
    'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())',
    [operatorId, operator.SYNTHETIC_OPERATOR_NAME, operator.SYNTHETIC_OPERATOR_EMAIL],
  )
  console.log(`created synthetic operator identity ${operatorId}`)
} else {
  console.log(`synthetic operator identity already exists: ${operatorId}`)
}

const distinct = operator.assertOperatorDistinctFromOwner(operatorId, ownerId)
if (!distinct.ok) {
  console.error(`REFUSED ${distinct.failure}: ${distinct.detail}`)
  process.exit(1)
}

// The private key never leaves this host and is never printed. Only the public half reaches the server.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64url")

const challenge = await issueEnrollmentChallenge({ userId: operatorId, origin: ORIGIN })
const proof = buildDeviceProof({
  purpose: "enroll",
  challengeId: challenge.challengeId,
  challenge: challenge.challenge,
  origin: ORIGIN,
  // The service already returns the exact ISO string it stored; re-deriving it risks a
  // millisecond difference, and buildDeviceProof requires an exact round trip.
  expiresAt: challenge.expiresAt,
})
const signature = crypto.sign(null, Buffer.from(proof), privateKey).toString("base64url")

const enrolled = await completeDeviceEnrollment({
  userId: operatorId,
  challengeId: challenge.challengeId,
  challenge: challenge.challenge,
  publicKeySpki: spki,
  signature,
  label: "WilliamOS synthetic operator (commissioning driver)",
  origin: ORIGIN,
})

fs.mkdirSync(KEY_DIR, { recursive: true })
fs.writeFileSync(KEY_FILE, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 })

await appendGovernanceEvent({
  userId: ownerId ?? operatorId,
  eventType: "EVIDENCE_RECORDED",
  entityType: "synthetic_operator_credential",
  entityId: enrolled.credentialId,
  actor: "owner",
  reason: "WO #872: synthetic operator enrolled under recorded authority",
  after: { operatorId, credentialId: enrolled.credentialId, label: enrolled.label, origin: ORIGIN },
  metadata: { workOrder: "#872", parentOutcome: "#871", revocable: true },
})

console.log(`credentialId: ${enrolled.credentialId}`)
console.log(`private key:  ${KEY_FILE} (mode 0600, never transmitted)`)
console.log(`revoke with:  POST /api/device/credentials/${enrolled.credentialId}/revoke`)
await pool.end()
