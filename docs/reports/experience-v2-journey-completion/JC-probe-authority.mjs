// Which wall does the DEPLOYED runtime's own configuration actually hit?
//
// OR-13 concluded the live runtime holds a credential that is not the role's. It measured
// `C:\HermesLab\williamos-runtime\.env.local`; the scheduled task "WilliamOS Live" serves
// `C:\HermesLab\williamos-runtime-64034e93-flat\server.js`, whose `.env.local` is a different file
// carrying a different credential. So the question is re-asked against the file the running process
// actually loads, and answered by connecting rather than by arithmetic.
//
// Two attempts, deliberately: the connection string EXACTLY as the runtime would load it, and the
// same string with only the host resolved through the canonical fabric registry. The pair separates
// "wrong address" from "wrong credential", which is precisely what a single failure cannot.
//
// Nothing here emits the password: every URL is printed through the canonical `redactUrl`.
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"

const [envFile, repoRoot, pgRoot] = process.argv.slice(2)

const resolverPath = path.join(repoRoot, "lib", "fabric", "authority-registry-url.mjs")
const { readDatabaseUrlFromEnv, resolveAuthorityRegistryUrl, redactUrl } = await import(
  pathToFileURL(resolverPath).href
)

const require = createRequire(path.join(pgRoot, "package.json"))
const { Client } = require("pg")

const results = []

async function attempt(label, url, meta) {
  const record = { attempt: label, redacted: redactUrl(url), ...meta }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000, query_timeout: 8000 })
  const started = Date.now()
  try {
    await client.connect()
    const who = await client.query("select current_user as role, current_database() as db")
    const grants = await client.query("select count(*)::int as n from authority_grant")
    record.ok = true
    record.role = who.rows[0].role
    record.database = who.rows[0].db
    record.grantCount = grants.rows[0].n
  } catch (error) {
    record.ok = false
    record.errorCode = error?.code ?? null
    record.errorMessage = String(error?.message ?? error).slice(0, 200)
  } finally {
    record.elapsedMs = Date.now() - started
    try {
      await client.end()
    } catch {
      /* the connection never opened; nothing to close */
    }
  }
  results.push(record)
}

const source = readDatabaseUrlFromEnv(fs.readFileSync(envFile, "utf8"), envFile)

await attempt("as-written-in-env", source, { host: new URL(source).hostname })

let resolved = null
try {
  resolved = await resolveAuthorityRegistryUrl(source)
} catch (error) {
  results.push({ attempt: "registry-resolve", ok: false, errorCode: error?.code ?? null, errorMessage: String(error?.message ?? error) })
}
if (resolved) {
  await attempt("registry-resolved", resolved.url, {
    host: resolved.host,
    previousHost: resolved.previousHost,
    changed: resolved.changed,
    registryFingerprint: resolved.fingerprint,
  })
}

console.log(JSON.stringify({ envFile, repoRoot, results }, null, 1))
