import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import pg from "pg"

const databaseUrl = process.env.DATABASE_URL
const userId = process.env.WILLIAMOS_RUNTIME_USER_ID
const tokenFile = process.env.WILLIAMOS_RUNTIME_DEVICE_TOKEN_FILE

if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED")
if (!userId) throw new Error("WILLIAMOS_RUNTIME_USER_ID_REQUIRED")
if (!tokenFile || !path.isAbsolute(tokenFile)) throw new Error("WILLIAMOS_RUNTIME_DEVICE_TOKEN_FILE_REQUIRED")
if (fs.existsSync(tokenFile)) throw new Error("RUNTIME_DEVICE_TOKEN_FILE_EXISTS")

const { publicKey } = crypto.generateKeyPairSync("ed25519")
const publicKeyDer = publicKey.export({ type: "spki", format: "der" })
const credentialId = crypto.randomUUID()
const sessionId = crypto.randomUUID()
const rawToken = `wds_${crypto.randomBytes(32).toString("base64url")}`
const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex")
const fingerprint = crypto.createHash("sha256").update(publicKeyDer).digest("hex")
const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
const temporary = `${tokenFile}.${process.pid}.tmp`

fs.mkdirSync(path.dirname(tokenFile), { recursive: true })
fs.writeFileSync(temporary, `${rawToken}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 })
try { fs.chmodSync(temporary, 0o600) } catch { /* Windows ACLs are deployment-owned */ }

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 })
const client = await pool.connect()
try {
  await client.query("BEGIN")
  const owner = await client.query(`SELECT id FROM "user" WHERE id = $1`, [userId])
  if (!owner.rows[0]) throw new Error("RUNTIME_DEVICE_USER_NOT_FOUND")
  await client.query(
    `INSERT INTO device_credential
      (id, "userId", label, kind, "publicKeySpki", "publicKeyFingerprintSha256")
     VALUES ($1,$2,'WilliamOS Environment runtime','runtime',$3,$4)`,
    [credentialId, userId, publicKeyDer.toString("base64"), fingerprint],
  )
  await client.query(
    `INSERT INTO device_session (id, "userId", "credentialId", "tokenHash", "expiresAt")
     VALUES ($1,$2,$3,$4,$5)`,
    [sessionId, userId, credentialId, tokenHash, expiresAt],
  )
  await client.query(
    `INSERT INTO device_auth_event
      (id, "userId", "credentialId", "sessionId", "eventType", metadata)
     VALUES ($1,$2,$3,$4,'runtime_device_provisioned',$5::jsonb)`,
    [crypto.randomUUID(), userId, credentialId, sessionId, JSON.stringify({ purpose: "environment-runtime", expiresAt })],
  )
  await client.query("COMMIT")
  fs.renameSync(temporary, tokenFile)
  process.stdout.write(`Provisioned runtime credential ${credentialId}; token written to ${tokenFile}\n`)
} catch (error) {
  await client.query("ROLLBACK")
  try { fs.unlinkSync(temporary) } catch { /* exact temporary may already be absent */ }
  throw error
} finally {
  client.release()
  await pool.end()
}
