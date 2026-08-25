// Read-only. Two questions, both needed to close this lane honestly:
//
//   1. Can any session-mint path reach the owner identity without the owner entering a credential?
//      Counts only -- no `session.token`, no `device_session.tokenHash`, no `account.password`.
//      Better Auth stores session tokens in PLAINTEXT, which is exactly why this query names the
//      columns it wants instead of selecting rows: a live token lifted out of this table would be
//      the owner's authentication artifact, and replaying it is the same class of act as minting a
//      grant to satisfy an authority check.
//
//   2. Does any standing authority permission exist for #995 at the end of this lane?
import path from "node:path"
import fs from "node:fs"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"

const [envFile, repoRoot, pgRoot, ownerUserId] = process.argv.slice(2)

const { readDatabaseUrlFromEnv, resolveAuthorityRegistryUrl } = await import(
  pathToFileURL(path.join(repoRoot, "lib", "fabric", "authority-registry-url.mjs")).href
)
const require = createRequire(path.join(pgRoot, "package.json"))
const { Client } = require("pg")

const source = readDatabaseUrlFromEnv(fs.readFileSync(envFile, "utf8"), envFile)
const { url } = await resolveAuthorityRegistryUrl(source)

const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 })
await client.connect()

const one = async (sql, params = []) => (await client.query(sql, params)).rows

const out = {}

out.ownerUser = await one(
  `select "id", "email" is not null as "hasEmail", "emailVerified"
     from "user" where "id" = $1`,
  [ownerUserId],
)

// Live browser sessions. `expiresAt` here is a plain timestamp column, compared in the DATABASE so
// this reading cannot pick up the client-side clock skew this lane just fixed elsewhere.
out.liveBrowserSessions = await one(
  `select count(*)::int as n from "session"
    where "userId" = $1 and "expiresAt" > timezone('UTC', now())`,
  [ownerUserId],
)

out.liveDeviceSessions = await one(
  `select count(*)::int as n from "device_session"
    where "userId" = $1 and "revokedAt" is null and "expiresAt" > timezone('UTC', now())`,
  [ownerUserId],
).catch(() => [{ n: null }])

out.pendingDeviceLinks = await one(
  `select count(*)::int as n from "device_link"
    where "userId" = $1 and "consumedAt" is null and "expiresAt" > now()`,
  [ownerUserId],
).catch(() => [{ n: null }])

// Credential accounts: whether a password sign-in is even possible for this identity.
out.credentialAccounts = await one(
  `select "providerId", count(*)::int as n from "account" where "userId" = $1 group by "providerId"`,
  [ownerUserId],
)

out.passkeys = await one(`select count(*)::int as n from "passkey" where "userId" = $1`, [ownerUserId])
  .catch(() => [{ n: null }])

// Authority state for #995, read the way the route reads it.
out.grantTotal = await one(`select count(*)::int as n from authority_grant`)
out.grants995 = await one(
  `select "id", "ref", "status", "authorityLevel", "allowedActions", "blockedActions",
          "expiresAt", "revokedAt", "revokeReason"
     from authority_grant where "scope" = $1 and "userId" = $2 order by "id" desc`,
  ["#995", ownerUserId],
)

await client.end()
console.log(JSON.stringify(out, null, 1))
