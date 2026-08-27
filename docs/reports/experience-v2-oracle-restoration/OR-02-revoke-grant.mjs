/**
 * Close the #995 grant once the terminal proof has been taken.
 *
 * WHY THIS EXISTS. The owner's decision asked for "bounded lifetime or single-use semantics IF the
 * machinery supports them". `authority_grant` supports the first and has no notion of the second:
 * there is no use counter, no consumed flag, nothing that a successful authorisation decrements.
 * Revoking immediately after the one authorised use is how single-use is actually implemented here,
 * and doing it through `revokeAuthorityGrant` rather than an UPDATE is what makes it a governed act
 * with an `AUTHORITY_REVOKED` event and a register entry behind it.
 *
 * IT MATTERS MORE THAN THE EXPIRY DOES. `route.ts` reads `expiresAt` with the raw `pg` client rather
 * than through the schema's `utcWallTimestamp` type, so it interprets a stored UTC wall clock as
 * LOCAL time. On HERMES (UTC-7) a grant written to expire in two hours is one the route keeps
 * accepting for nine. That is recorded as `CONT-EXPV2-GRANT-EXPIRY-TZ-SKEW` and is NOT repaired
 * here -- fixing it edits a module the settlement driver digest-pins, mid-proof. So the expiry is
 * not the bound that closes this grant. This is.
 *
 * BOUNDED. It will only revoke a grant whose scope is exactly `#995`. It is not a general revoker.
 */
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

function findRepoRoot(from) {
  let dir = path.resolve(from)
  for (;;) {
    if (fs.existsSync(path.join(dir, "scripts", "repo-alias-loader.mjs"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error("REPO_ROOT_NOT_FOUND: run this from inside a repository checkout")
    dir = parent
  }
}
const root = findRepoRoot(import.meta.dirname)

const argv = process.argv.slice(2)
const envFile = argv.find((a) => !a.startsWith("--"))
const actorUserId = (argv.find((a) => a.startsWith("--actor="))?.slice("--actor=".length) ?? "").trim()
const ref = (argv.find((a) => a.startsWith("--ref="))?.slice("--ref=".length) ?? "").trim()
const confirmed = argv.includes("--revoke")
if (!envFile || !actorUserId || !ref) {
  throw new Error("usage: OR-02-revoke-grant.mjs <path to .env> --actor=<userId> --ref=<GRANT-nnnn> [--revoke]")
}

const databaseUrl = (fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")) ?? "")
  .slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "").trim()
if (!databaseUrl) throw new Error("no DATABASE_URL in " + envFile)
process.env.DATABASE_URL = databaseUrl
process.env.WILLIAMOS_PROJECT_ROOT = root
process.env.WILLIAMOS_GRANT_ACTOR_USER_ID = actorUserId

register("./repo-alias-loader.mjs", pathToFileURL(path.join(root, "scripts") + "/"))
register("./OR-01-loader.mjs", pathToFileURL(import.meta.dirname + "/"))

const SCOPE = "#995"
const OPERATION = "node.stamp-identity"
const AUTHORITY_LEVEL = "A3_WRITE_SHARED"
const REASON = "Single-use, exercised. The one authorised node.stamp-identity under #995 executed and "
  + "was verified by a separate post-state observation; this grant has done what the owner approved "
  + "it for. Revoked through app/actions/authority.ts revokeAuthorityGrant so that no standing "
  + "permission outlives the proof. Re-authorising is a new owner decision, not a re-run."

const report = {
  tool: "OR-02-revoke-grant",
  startedAt: new Date().toISOString(),
  host: os.hostname(),
  worktree: root,
  databaseUrl: databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@"),
  actorUserId,
  actorIdentification: "ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED",
  ref,
  mode: confirmed ? "REVOKE" : "DRY_RUN",
  canonicalPath: "app/actions/authority.ts revokeAuthorityGrant",
  sqlWrittenByThisFile: "none",
}

const { pool } = await import("@/lib/db")
const { grantCovers } = await import("@/lib/governance/authority")

const ROUTE_QUERY = [
  'SELECT "id", "ref", "status", "authorityLevel", "allowedActions", "blockedActions",',
  '       "expiresAt", "revokedAt", "revokeReason", "userId", "scope"',
  '  FROM authority_grant WHERE "scope" = $1 AND "userId" = $2',
  ' ORDER BY "id" DESC LIMIT 20',
].join("\n")

const lookup = async () => {
  const rows = (await pool.query(ROUTE_QUERY, [SCOPE, actorUserId])).rows
  return rows.map((row) => {
    const grant = {
      ...row,
      allowedActions: row.allowedActions ?? [],
      blockedActions: row.blockedActions ?? [],
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
    }
    const coverage = grantCovers(grant, AUTHORITY_LEVEL, OPERATION)
    return {
      id: row.id, ref: row.ref, status: row.status, revokedAt: row.revokedAt,
      revokeReason: row.revokeReason, covers: coverage.ok, reason: coverage.reason,
    }
  })
}

try {
  report.before = { routeLookup: await lookup() }
  report.before.routeAccepts = report.before.routeLookup.some((v) => v.covers)

  const target = (await pool.query(
    'SELECT "id", "ref", "scope", "status" FROM authority_grant WHERE "ref" = $1 AND "userId" = $2',
    [ref, actorUserId],
  )).rows[0]

  if (!target) {
    report.result = "GRANT_NOT_FOUND"
  } else if (target.scope !== SCOPE) {
    // The bound. This file revokes one scope and refuses to be repurposed into a general revoker.
    report.result = "REFUSED_OUT_OF_SCOPE"
    report.detail = ref + " is scoped " + String(target.scope) + ", not " + SCOPE + "; refusing."
  } else if (target.status !== "active") {
    report.result = "ALREADY_CLOSED"
    report.detail = ref + " status is already " + target.status + "; nothing was changed."
  } else if (!confirmed) {
    report.result = "DRY_RUN_NOTHING_REVOKED"
    report.detail = "--revoke was not passed. The registry was read, not written."
  } else {
    const { revokeAuthorityGrant } = await import("@/app/actions/authority")
    await revokeAuthorityGrant(target.id, REASON)
    report.result = "REVOKED"
    report.revokeReason = REASON
    report.sideEvidence = {
      governanceEvent: (await pool.query(
        [
          'SELECT "id","eventType","entityType","entityId","actor" FROM governance_event',
          ' WHERE "userId"=$1 AND "entityType"=\'authority_grant\' AND "entityId"=$2',
          "   AND \"eventType\"='AUTHORITY_REVOKED' ORDER BY \"id\" DESC LIMIT 2",
        ].join("\n"), [actorUserId, String(target.id)])).rows,
      registerEvent: (await pool.query(
        [
          'SELECT "id","type","register","refId","summary" FROM event_log',
          ' WHERE "userId"=$1 AND "type"=\'authority.revoked\' AND "refId"=$2 ORDER BY "id" DESC LIMIT 2',
        ].join("\n"), [actorUserId, target.id])).rows,
    }
  }

  report.after = { routeLookup: await lookup() }
  report.after.routeAccepts = report.after.routeLookup.some((v) => v.covers)
  report.after.totalGrants = Number((await pool.query("SELECT count(*) AS n FROM authority_grant")).rows[0].n)
} catch (error) {
  report.result = "FAILED"
  report.error = { message: String(error?.message ?? error), code: error?.code ?? null }
}

report.finishedAt = new Date().toISOString()
console.log(JSON.stringify(report, null, 2))
try { await pool.end() } catch { /* never connected */ }
