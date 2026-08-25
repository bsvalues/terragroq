/**
 * Read the authority registry over the governed transport and prove what is in it.
 *
 * This exists to answer two questions that must not be answered by assertion:
 *
 *   1. Did recording one grant change anything else? The 28 grants observed before this lane touched
 *      ATLAS are enumerated column-for-column and digested, so "unchanged" is a hash comparison
 *      rather than a claim. The digest covers every column that carries meaning -- including
 *      `status`, `expiresAt`, `revokedAt` and `contentHash` -- because a grant silently expiring or
 *      being revoked is exactly the kind of change a row count would hide.
 *
 *   2. What does the ROUTE see? `app/api/system/node/stamp-identity/route.ts:104-112` narrows in SQL
 *      to `"scope" = $1 AND "userId" = $2` and then lets `lib/governance/authority.ts` `grantCovers`
 *      decide. Both halves are reproduced here verbatim -- the same predicate, the same canonical
 *      checker, imported rather than restated. A read-back that used a friendlier query would prove
 *      that a row exists, which is not the same as proving the route will accept it.
 *
 * READ-ONLY. It issues SELECTs and nothing else. It cannot create, amend, expire or revoke a grant,
 * and it takes the connection string from a file rather than building one, so it cannot be pointed
 * at a different database by argument.
 */
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import crypto from "node:crypto"
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
register("./repo-alias-loader.mjs", pathToFileURL(path.join(root, "scripts") + "/"))

const argv = process.argv.slice(2)
const envFile = argv.find((a) => !a.startsWith("--"))
if (!envFile) throw new Error("usage: OR-00-authority-readback.mjs <path to .env> [--actor=<userId>] [--scope=<scope>]")
const actorUserId = (argv.find((a) => a.startsWith("--actor="))?.slice("--actor=".length) ?? "").trim() || null
const scope = argv.find((a) => a.startsWith("--scope="))?.slice("--scope=".length) ?? "#995"

const databaseUrl = (fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")) ?? "")
  .slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "").trim()
if (!databaseUrl) throw new Error(`no DATABASE_URL in ${envFile}`)
process.env.DATABASE_URL = databaseUrl
process.env.WILLIAMOS_PROJECT_ROOT = root

const { pool } = await import("@/lib/db")
const { grantCovers } = await import("@/lib/governance/authority")

// The same columns, in the same order, as the pre-mutation baseline. Changing this list changes the
// digest and silently invalidates the comparison, which is why it is written out once here.
// Every column is aliased. Three of them are COALESCE expressions and PostgreSQL names all three
// `coalesce`; node-pg builds a plain object from those names, so unaliased they would collapse onto
// one key and the digest would be computed over the wrong text while still looking like a digest.
// psql renders one newline-terminated record per row; the digest has to be taken over the same
// bytes as the baseline, so the terminator is explicit rather than implied by a join.
const LF = "\u000a"

const ENUMERATION_COLUMNS = [
  "id", "ref", "work_order_id", "granted_by", "granted_to", "authority_level", "grant_scope",
  "allowed_actions", "blocked_actions", "status", "expires_at", "revoked_at", "content_hash",
  "created_at", "user_id",
]
const ENUMERATION = `
  SELECT id                                     AS id,
         ref                                    AS ref,
         COALESCE("workOrderId"::text,'')       AS work_order_id,
         "grantedBy"                            AS granted_by,
         "grantedTo"                            AS granted_to,
         "authorityLevel"                       AS authority_level,
         COALESCE(scope,'')                     AS grant_scope,
         array_to_string("allowedActions",',,') AS allowed_actions,
         array_to_string("blockedActions",',,') AS blocked_actions,
         status                                 AS status,
         COALESCE("expiresAt"::text,'')         AS expires_at,
         COALESCE("revokedAt"::text,'')         AS revoked_at,
         COALESCE("contentHash",'')             AS content_hash,
         "createdAt"::text                      AS created_at,
         "userId"                               AS user_id
    FROM authority_grant ORDER BY id`

// route.ts:104-112, predicate for predicate.
const ROUTE_QUERY = `
  SELECT "id", "ref", "status", "authorityLevel", "allowedActions", "blockedActions",
         "expiresAt", "revokedAt", "revokeReason", "userId", "scope", "grantedTo", "reason"
    FROM authority_grant
   WHERE "scope" = $1 AND "userId" = $2
   ORDER BY "id" DESC LIMIT 20`

const report = {
  tool: "OR-00-authority-readback",
  readAt: new Date().toISOString(),
  host: os.hostname(),
  worktree: root,
  databaseUrl: databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@"),
  actorUserId,
  actorIdentification: actorUserId ? "ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED" : "NONE",
  scope,
}

try {
  const rows = (await pool.query(ENUMERATION)).rows
  // psql -At -F '|' renders exactly this: pipe-joined values, newline-terminated. Reproducing that
  // rendering is what makes the digest comparable with the baseline taken before any change.
  const rendered = rows
    .map((r) => ENUMERATION_COLUMNS.map((c) => (r[c] === null ? "" : String(r[c]))).join("|"))
    .map((line) => line + LF)
    .join("")
  report.enumeration = {
    columns: ENUMERATION_COLUMNS,
    count: rows.length,
    sha256: crypto.createHash("sha256").update(rendered).digest("hex"),
    refs: rows.map((r) => r.ref),
    statuses: rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {}),
    scopes: [...new Set(rows.map((r) => r.grant_scope))].filter(Boolean).sort(),
  }

  if (actorUserId) {
    const candidates = (await pool.query(ROUTE_QUERY, [scope, actorUserId])).rows
    report.routeLookup = {
      predicate: 'route.ts:104-112 -- "scope" = $1 AND "userId" = $2',
      checker: "lib/governance/authority.ts grantCovers (canonical), not a SQL predicate",
      requiredAuthority: "A3_WRITE_SHARED",
      operation: "node.stamp-identity",
      rowsReturned: candidates.length,
      verdicts: candidates.map((row) => {
        const grant = {
          ...row,
          allowedActions: row.allowedActions ?? [],
          blockedActions: row.blockedActions ?? [],
          expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
          revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
        }
        const coverage = grantCovers(grant, "A3_WRITE_SHARED", "node.stamp-identity")
        return {
          id: row.id, ref: row.ref, status: row.status, authorityLevel: row.authorityLevel,
          grantedTo: row.grantedTo, allowedActions: grant.allowedActions, blockedActions: grant.blockedActions,
          expiresAt: row.expiresAt, revokedAt: row.revokedAt, userId: row.userId,
          covers: coverage.ok, reason: coverage.reason,
        }
      }),
    }
    report.routeLookup.accepted = report.routeLookup.verdicts.some((v) => v.covers)
  }
  report.result = "READ_OK"
} catch (error) {
  report.result = "REGISTRY_UNREADABLE"
  report.error = { message: String(error?.message ?? error), code: error?.code ?? null }
}

console.log(JSON.stringify(report, null, 2))
try { await pool.end() } catch { /* never connected */ }
