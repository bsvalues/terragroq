/**
 * Record the one authority grant the owner approved on 2026-08-25, through the canonical path.
 *
 * "CANONICAL PATH, NEVER AD-HOC SQL" is the constraint, and this file takes it literally: it calls
 * `createAuthorityGrantWithResult` from `app/actions/authority.ts` and writes no SQL of its own.
 * That matters because the grant registry is not one table. A hand-written INSERT would produce a
 * row and would NOT produce the `GRANT-nnnn` ref allocated under the advisory lock, the content
 * hash, the `AUTHORITY_GRANTED` governance event, the `authority.granted` register entry, or the
 * Tier-2 filesystem ledger export that A2+ grants get. A grant missing those looks identical in a
 * `SELECT *` and is invisible to every audit surface built on them.
 *
 * WHAT THIS FILE CANNOT DO. The grant is a constant here, not an argument. There is no `--scope`,
 * no `--level`, no `--actions`. It records exactly one shape and refuses everything else, because a
 * general-purpose grant minter is precisely the tool that must not exist in a repository whose whole
 * authority story is that approval is not authority.
 *
 * IT ALSO REFUSES TO RUN TWICE. Before creating anything it applies the route's own lookup. If a
 * grant already covers, it reports that grant and exits without creating a second one. Re-running an
 * evidence script should not quietly double the lab's standing permissions.
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

const argv = process.argv.slice(2)
const envFile = argv.find((a) => !a.startsWith("--"))
const actorUserId = (argv.find((a) => a.startsWith("--actor="))?.slice("--actor=".length) ?? "").trim()
const confirmed = argv.includes("--record")
if (!envFile || !actorUserId) {
  throw new Error(
    "usage: OR-01-record-grant.mjs <path to .env> --actor=<userId> [--record]\n"
    + "  without --record it reports what it WOULD record and reads the registry, changing nothing.",
  )
}

const databaseUrl = (fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")) ?? "")
  .slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "").trim()
if (!databaseUrl) throw new Error("no DATABASE_URL in " + envFile)
process.env.DATABASE_URL = databaseUrl
process.env.WILLIAMOS_PROJECT_ROOT = root
// Consumed by OR-01-session-shim.mjs, which refuses when it is empty.
process.env.WILLIAMOS_GRANT_ACTOR_USER_ID = actorUserId

// Order matters: hooks run in reverse registration order, so the substitution whitelist is consulted
// first and everything it does not name falls through to the repository's own "@/" alias loader.
register("./repo-alias-loader.mjs", pathToFileURL(path.join(root, "scripts") + "/"))
register("./OR-01-loader.mjs", pathToFileURL(import.meta.dirname + "/"))

/* --------------------------------------------------------------------------------------------- */
/* THE GRANT. Every field below is the owner's 2026-08-25 decision transcribed, and each one is the */
/* narrowest value the machinery accepts while still letting the route it authorises run.           */
/* --------------------------------------------------------------------------------------------- */
const SCOPE = "#995"
const OPERATION = "node.stamp-identity"
const TARGET_NODE = "node:hermes-node"
// A3_WRITE_SHARED is not a choice: `route.ts` requires it by constant, and `grantCovers` compares
// RANKS, so anything lower is refused and anything higher grants more than was asked for.
const AUTHORITY_LEVEL = "A3_WRITE_SHARED"
const GRANTED_TO = "claude"
// Two hours. Long enough for the terminal proof and the observations around it, short enough that
// forgetting to revoke it is not the same as granting it forever. The grant is revoked immediately
// after the proof regardless; the expiry is what holds if that revocation never happens.
const EXPIRES_IN_HOURS = 2

// `grantCovers` permits an action when the action string CONTAINS one of these, so this is the
// tightest possible allowance: the operation itself and nothing that merely resembles it.
const ALLOWED_ACTIONS = [OPERATION]

// Blocks beat allowances in `grantCovers`, and each is tested as a substring of the action being
// attempted. None is a substring of `node.stamp-identity`, so none narrows this grant below the one
// operation it exists for -- they bound what it could ever later be re-read as covering.
const BLOCKED_ACTIONS = [
  "production mutation", "TerraFusion", "Property Workbench", "TerraPilot", "county/PACS",
  "protected data", "paid overage", "destructive action", "secret inspection", "authority expansion",
  "issue #357", "delete", "revoke", "merge", "release", "spend",
]

const REASON = [
  "Owner decision 2026-08-25: authorise exactly " + OPERATION + " under " + SCOPE + " for the",
  "canonical " + TARGET_NODE + ", and nothing wider. Recorded through app/actions/authority.ts",
  "createAuthorityGrantWithResult; no SQL was written by hand.",
  "TARGET IS NOT ENFORCED BY THIS ROW: authority_grant has no target column and grantCovers checks",
  "only level and action, so the node restriction above is a statement of intent. What actually",
  "confines the mutation to one machine is the route -- it takes the endpoint from the transport",
  "registry rather than from the request, and refuses any object absent from the canonical graph.",
  "CONT-EXPV2-GRANT-HAS-NO-TARGET-PREDICATE.",
  "Bounded to " + EXPIRES_IN_HOURS + " hours and revoked immediately after the terminal proof.",
].join(" ")

const report = {
  tool: "OR-01-record-grant",
  startedAt: new Date().toISOString(),
  host: os.hostname(),
  worktree: root,
  databaseUrl: databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@"),
  actorUserId,
  actorIdentification: "ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED",
  mode: confirmed ? "RECORD" : "DRY_RUN",
  canonicalPath: "app/actions/authority.ts createAuthorityGrantWithResult",
  sqlWrittenByThisFile: "none",
  intended: {
    scope: SCOPE, authorityLevel: AUTHORITY_LEVEL, grantedTo: GRANTED_TO,
    allowedActions: ALLOWED_ACTIONS, blockedActions: BLOCKED_ACTIONS,
    expiresInHours: EXPIRES_IN_HOURS, workOrderId: null, targetNode: TARGET_NODE,
  },
}

const { pool } = await import("@/lib/db")
const { grantCovers } = await import("@/lib/governance/authority")
const { substituted } = await import("./OR-01-loader.mjs")
report.substitutedModules = substituted

// Digest-pin the canonical modules actually loaded, so a reader can prove this ran against merged
// main rather than a local edit that made the grant look narrower than it is.
report.canonicalDigests = Object.fromEntries(
  ["app/actions/authority.ts", "lib/governance/authority.ts", "lib/governance/artifacts.ts", "lib/db/schema.ts"]
    .map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex")]),
)

// route.ts:104-112, applied before creating anything and again afterwards.
const ROUTE_QUERY = [
  'SELECT "id", "ref", "status", "authorityLevel", "allowedActions", "blockedActions",',
  '       "expiresAt", "revokedAt", "revokeReason", "userId"',
  "  FROM authority_grant WHERE \"scope\" = $1 AND \"userId\" = $2",
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
      id: row.id, ref: row.ref, status: row.status, authorityLevel: row.authorityLevel,
      expiresAt: row.expiresAt, revokedAt: row.revokedAt,
      covers: coverage.ok, reason: coverage.reason,
    }
  })
}

const countGrants = async () =>
  Number((await pool.query("SELECT count(*) AS n FROM authority_grant")).rows[0].n)

try {
  report.before = { totalGrants: await countGrants(), routeLookup: await lookup() }
  const already = report.before.routeLookup.find((v) => v.covers)

  if (already) {
    report.result = "ALREADY_GRANTED"
    report.detail = already.ref + " already covers " + AUTHORITY_LEVEL + " for " + OPERATION
      + " under " + SCOPE + "; nothing was created."
  } else if (!confirmed) {
    report.result = "DRY_RUN_NOTHING_RECORDED"
    report.detail = "No grant covers, and --record was not passed. The registry was read, not written."
  } else {
    const { createAuthorityGrantWithResult } = await import("@/app/actions/authority")
    const { grant, replayed } = await createAuthorityGrantWithResult({
      grantedTo: GRANTED_TO,
      authorityLevel: AUTHORITY_LEVEL,
      scope: SCOPE,
      allowedActions: ALLOWED_ACTIONS,
      blockedActions: BLOCKED_ACTIONS,
      reason: REASON,
      expiresInHours: EXPIRES_IN_HOURS,
    })
    report.result = "RECORDED"
    report.replayed = replayed
    report.grant = {
      id: grant.id, ref: grant.ref, userId: grant.userId, grantedBy: grant.grantedBy,
      grantedTo: grant.grantedTo, authorityLevel: grant.authorityLevel, scope: grant.scope,
      allowedActions: grant.allowedActions, blockedActions: grant.blockedActions,
      status: grant.status, workOrderId: grant.workOrderId,
      expiresAt: grant.expiresAt, createdAt: grant.createdAt, contentHash: grant.contentHash,
    }
    const { revalidatePathCalls } = await import("./OR-01-next-cache-shim.mjs")
    report.nextCacheCalls = revalidatePathCalls

    // The evidence the canonical path produces beyond the row itself. Its presence is the whole
    // difference between this and an INSERT.
    report.sideEvidence = {
      governanceEvent: (await pool.query(
        [
          'SELECT "id","eventType","entityType","entityId","actor","afterHash" FROM governance_event',
          ' WHERE "userId"=$1 AND "entityType"=\'authority_grant\' AND "entityId"=$2',
          ' ORDER BY "id" DESC LIMIT 3',
        ].join("\n"), [actorUserId, String(grant.id)])).rows,
      registerEvent: (await pool.query(
        [
          'SELECT "id","type","register","refId","summary" FROM event_log',
          ' WHERE "userId"=$1 AND "register"=\'authority\' AND "refId"=$2 ORDER BY "id" DESC LIMIT 3',
        ].join("\n"), [actorUserId, grant.id])).rows,
      tier2Ledger: ["md", "json"].map((ext) => {
        const p = path.join(root, "docs", "devkit", "authority", grant.ref + "." + ext)
        return {
          path: path.relative(root, p),
          exists: fs.existsSync(p),
          sha256: fs.existsSync(p)
            ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")
            : null,
        }
      }),
    }
  }

  report.after = { totalGrants: await countGrants(), routeLookup: await lookup() }
  report.after.routeAccepts = report.after.routeLookup.some((v) => v.covers)
  report.after.grantsCreated = report.after.totalGrants - report.before.totalGrants
} catch (error) {
  report.result = "FAILED"
  report.error = { message: String(error?.message ?? error), code: error?.code ?? null }
}

report.finishedAt = new Date().toISOString()
console.log(JSON.stringify(report, null, 2))
try { await pool.end() } catch { /* never connected */ }
