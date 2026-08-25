/**
 * Runtime settlement driver for `node.stamp-identity` (CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT).
 *
 * It walks the legs of `app/api/system/node/stamp-identity/route.ts` IN THE ROUTE'S OWN ORDER,
 * importing the route's real modules rather than restating them, and it stops exactly where the
 * route stops. Nothing here mints a grant, edits a registry, seeds a ledger, or invents a session.
 *
 * The one leg it cannot execute is the HTTP/session shell: `getSession` needs a Next request
 * context, and the artifact deployed on HERMES is built from an older commit that does not contain
 * this route at all. That boundary is recorded rather than papered over.
 */
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const root = path.resolve(import.meta.dirname, "..")
register("./repo-alias-loader.mjs", pathToFileURL(path.join(root, "scripts") + "/"))

const envFile = process.argv[2]
if (!envFile) throw new Error("usage: settle-stamp-identity.mjs <path to .env.local>")
const envRaw = fs.readFileSync(envFile, "utf8")
const databaseUrl = (envRaw.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")) ?? "")
  .slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "").trim()
if (!databaseUrl) throw new Error("no DATABASE_URL in " + envFile)
process.env.DATABASE_URL = databaseUrl
process.env.WILLIAMOS_PROJECT_ROOT = root

const redact = (u) => u.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@")

const report = {
  settlement: "CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT",
  action: "node.stamp-identity",
  startedAt: new Date().toISOString(),
  host: os.hostname(),
  node: process.version,
  worktree: root,
  databaseUrl: redact(databaseUrl),
  legs: {},
}

const leg = (name, value) => { report.legs[name] = value; return value }
const digest = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")

// ---------------------------------------------------------------------------
// LEG 0 -- canonical bytes. Every module exercised below is digest-pinned, so a
// later reader can prove this ran against merged main and not a local edit.
// ---------------------------------------------------------------------------
const CANONICAL = [
  "app/api/system/node/stamp-identity/route.ts",
  "lib/system/node-identity-stamp.ts",
  "lib/system/system-object-source.ts",
  "lib/system/system-object.ts",
  "lib/system/node-identity-contract.ts",
  "lib/intent/object-action-registry.ts",
  "lib/governance/authority.ts",
  "lib/fabric/broker.mjs",
  "lib/fabric/audit.mjs",
  "lib/fabric/transport.mjs",
  "config/execution-fabric/registry.seed.json",
  "config/execution-fabric/node-identity-contract.json",
]
leg("0_canonical_digests", Object.fromEntries(CANONICAL.map((f) => [f, digest(path.join(root, f))])))

// ---------------------------------------------------------------------------
// LEG 1 -- the HTTP/session shell. Stated, not assumed.
// ---------------------------------------------------------------------------
const deployedRoot = "C:\\HermesLab\\williamos-runtime-64034e93-flat"
leg("1_session", {
  executed: false,
  reason: "SESSION_SHELL_NOT_EXECUTABLE",
  detail:
    "getSession() reads next/headers, which requires a Next request context. The only WilliamOS "
    + "instance running on this node serves a standalone bundle built from an older commit, and the "
    + "stamp-identity route is not in it -- so there is no deployed surface that could be called.",
  deployedRoot,
  deployedReleaseSha: (() => {
    try { return fs.readFileSync(path.join(deployedRoot, ".williamos-release-sha"), "utf8").trim() } catch { return null }
  })(),
  routePresentInDeployedBundle: fs.existsSync(
    path.join(deployedRoot, ".next", "server", "app", "api", "system", "node", "stamp-identity"),
  ),
  note:
    "No session was minted. Fabricating an authentication artifact to satisfy an authentication "
    + "check is the same class of failure as minting a grant to satisfy an authority check.",
})

// ---------------------------------------------------------------------------
// LEG 2 -- AUTHORITY. The route's first real check, run for real.
//
// The route narrows candidates in SQL and lets `grantCovers` decide. Both halves
// are attempted here against the real registry with the real connection string.
// ---------------------------------------------------------------------------
const { grantCovers } = await import("@/lib/governance/authority")
const { pool } = await import("@/lib/db")

const authority = {
  requiredAuthority: "A3_WRITE_SHARED",
  operation: "node.stamp-identity",
  workOrderScope: "#995",
  checker: "lib/governance/authority.ts grantCovers (canonical), not a SQL predicate",
  grantsFound: null,
  grantRef: null,
  selfMinted: false,
}
try {
  const grants = await pool.query(
    `SELECT "id", "ref", "status", "authorityLevel", "allowedActions", "blockedActions",
            "expiresAt", "revokedAt", "revokeReason", "userId"
       FROM authority_grant
      WHERE "scope" = $1
      ORDER BY "id" DESC LIMIT 20`,
    ["#995"],
  )
  authority.grantsFound = grants.rows.length
  authority.verdicts = grants.rows.map((row) => {
    const grant = {
      ...row,
      allowedActions: row.allowedActions ?? [],
      blockedActions: row.blockedActions ?? [],
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
    }
    const coverage = grantCovers(grant, "A3_WRITE_SHARED", "node.stamp-identity")
    return { id: row.id, ref: row.ref, userId: row.userId, ok: coverage.ok, reason: coverage.reason }
  })
  const covering = authority.verdicts.find((v) => v.ok)
  authority.grantRef = covering?.ref ?? null
  authority.result = covering
    ? "AUTHORITY_GRANTED"
    : (grants.rows.length === 0 ? "AUTHORITY_NOT_GRANTED_NO_ROWS" : "AUTHORITY_NOT_GRANTED_NO_COVERAGE")
} catch (error) {
  // This is the route's own catch: "An unreadable grant registry is not permission."
  authority.result = "AUTHORITY_UNREADABLE"
  authority.error = {
    message: String(error?.message ?? error),
    code: error?.code ?? null,
    address: error?.address ?? null,
    port: error?.port ?? null,
  }
}
leg("2_authority", authority)

const authorised = authority.result === "AUTHORITY_GRANTED"

// ---------------------------------------------------------------------------
// LEGS 3-6, NON-CONTACT. Everything below reads the canonical graph, resolves the
// broker's record and derives the exact bytes the action would write. None of it
// touches the node, and none of it runs if it would.
// ---------------------------------------------------------------------------
const { loadSystemObjectSource } = await import("@/lib/system/system-object-source")
const { resolveObjectAction } = await import("@/lib/intent/object-action-registry")
const { planIdentityStamp, observeCommand, stampCommand, verifyCommand } =
  await import("@/lib/system/node-identity-stamp")
const { resolveBrokeredNode, brokeredExec } = await import("@/lib/fabric/broker.mjs")
const { requireLedger, auditFabricAction } = await import("@/lib/fabric/audit.mjs")
const { defaultFabricRoot } = await import("@/lib/fabric/transport.mjs")

const source = await loadSystemObjectSource()
const nodes = source.graph.objects.filter((o) => o.kind === "NODE")
leg("3_object_graph", {
  fabricRoot: defaultFabricRoot(),
  nodeCount: nodes.length,
  nodes: nodes.map((n) => ({
    objectId: n.objectId, nodeId: n.nodeId, hostname: n.hostname, role: n.role,
    truthState: n.truthState, transportState: n.transport.state,
    endpoint: source.endpointByNodeId[n.nodeId] ?? null,
  })),
})

// Selection, through the registry rather than by hand.
const selectionInput = "stamp identity on hermes"
const resolution = resolveObjectAction(selectionInput, { objects: source.graph.objects })
leg("4_selection", {
  input: selectionInput,
  state: resolution.state,
  action: resolution.action?.id ?? null,
  objectId: resolution.object?.objectId ?? null,
  candidates: (resolution.candidates ?? []).map((c) => ({ action: c.action.id, objectId: c.object?.objectId ?? null })),
})

const target = source.graph.objects.find((o) => o.kind === "NODE" && o.nodeId === "hermes-node")
const endpoint = target ? source.endpointByNodeId[target.nodeId] : null
const record = endpoint ? await resolveBrokeredNode(endpoint, { registry: source.transport }) : null
const planned = target && record
  ? planIdentityStamp(target, record, { stampedAt: new Date().toISOString() })
  : { ok: false, refusal: "NO_TARGET", plan: null }
const commands = planned.plan
  ? {
      observe: observeCommand(planned.plan.dialect),
      stamp: stampCommand(planned.plan),
      verify: verifyCommand(planned.plan.dialect),
    }
  : null
leg("5_plan", {
  endpoint,
  brokerRecord: record,
  ok: planned.ok,
  refusal: planned.refusal ?? null,
  plan: planned.plan,
  commands,
  deletesNothing: commands
    ? !/\brm\b|Remove-Item|-Recurse|\bdel\b/i.test([commands.observe, commands.stamp, commands.verify].join(" "))
    : null,
})

// ---------------------------------------------------------------------------
// LEG 6 -- WHICH LEDGER GUARD ACTUALLY HOLDS.
//
// #1003 found a `--require-audit` flag inert against the broker on its own path.
// This route has TWO guards, and both are exercised here against real filesystem
// state. The broker guard is proven with an INJECTED exec spy, so proving it can
// never itself touch the node.
// ---------------------------------------------------------------------------
const realFabricRoot = defaultFabricRoot()
const ledgerPath = path.join(realFabricRoot, "audit.log")
const ledgerBefore = (await fsp.stat(ledgerPath).catch(() => null))?.size ?? null

const guards = { realFabricRoot, ledgerPath, ledgerBytesBefore: ledgerBefore }

// Guard A: the route's pre-contact preflight (route.ts -- `await requireLedger(fabricRoot)`).
try {
  await requireLedger(realFabricRoot)
  guards.routePreflight = { held: true, result: "LEDGER_WRITABLE" }
} catch (error) {
  guards.routePreflight = { held: true, result: "EVIDENCE_UNAVAILABLE", detail: String(error?.message) }
}
guards.ledgerBytesAfterPreflight = (await fsp.stat(ledgerPath).catch(() => null))?.size ?? null
guards.preflightWroteNothing = guards.ledgerBytesBefore === guards.ledgerBytesAfterPreflight

// Guard A, negative controls: absent root, and an `audit.log` that is a directory.
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "expv2-ledger-guard-"))
const absentRoot = path.join(tmp, "not-a-fabric-root")
const dirLedgerRoot = path.join(tmp, "ledger-is-a-directory")
await fsp.mkdir(path.join(dirLedgerRoot, "audit.log"), { recursive: true })
for (const pair of [["absentRoot", absentRoot], ["ledgerIsADirectory", dirLedgerRoot]]) {
  try {
    await requireLedger(pair[1])
    guards[pair[0]] = { refused: false, note: "GUARD DID NOT HOLD" }
  } catch (error) {
    guards[pair[0]] = { refused: true, message: String(error?.message) }
  }
}

// Guard B: the broker's own `requireAudit`, proven to fire BEFORE the node is touched.
// `exec` is injected, so the spy is the only thing that could ever have run.
let spyCalls = 0
const spy = async () => { spyCalls += 1; return { stdout: "SPY", stderr: "" } }
const harmless = observeCommand("windows")

spyCalls = 0
let brokerGuard
try {
  await brokeredExec("hermes", harmless, {
    fabricRoot: absentRoot, registry: source.transport, exec: spy,
    action: "settlement.guard-probe", requireAudit: true,
  })
  brokerGuard = { refused: false, execCallsBeforeRefusal: spyCalls, note: "GUARD DID NOT HOLD" }
} catch (error) {
  brokerGuard = { refused: true, message: String(error?.message), execCallsBeforeRefusal: spyCalls }
}
guards.brokerRequireAudit = brokerGuard

// The inverse control: without `requireAudit`, the same unwritable root does NOT stop
// execution -- which proves the refusal above came from the guard and not from the root.
spyCalls = 0
try {
  await brokeredExec("hermes", harmless, {
    fabricRoot: absentRoot, registry: source.transport, exec: spy,
    action: "settlement.guard-control", requireAudit: false,
  })
  guards.brokerWithoutRequireAudit = { proceeded: true, execCalls: spyCalls }
} catch (error) {
  guards.brokerWithoutRequireAudit = { proceeded: false, message: String(error?.message), execCalls: spyCalls }
}

// And the post-state recorder's own `required: true`, against an unwritable root.
try {
  await auditFabricAction(absentRoot, "hermes", "settlement.post-state-probe", 0, "probe", { required: true })
  guards.postStateRequired = { refused: false, note: "GUARD DID NOT HOLD" }
} catch (error) {
  guards.postStateRequired = { refused: true, message: String(error?.message) }
}
await fsp.rm(tmp, { recursive: true, force: true })
guards.ledgerBytesAtEnd = (await fsp.stat(ledgerPath).catch(() => null))?.size ?? null
leg("6_ledger_guards", guards)

// ---------------------------------------------------------------------------
// LEG 7 -- THE MUTATION. Gated on leg 2, and on nothing else.
// ---------------------------------------------------------------------------
if (!authorised) {
  leg("7_mutation", {
    executed: false,
    refusedAt: "authority",
    refusal: authority.result,
    detail:
      "The route refuses here and executes nothing. This driver does the same. The node was not "
      + "observed, not written, and not read back; no stamp exists that did not exist before.",
    nodeContacted: false,
  })
} else {
  leg("7_mutation", { executed: false, refusedAt: null, detail: "unreachable in this run" })
}

report.finishedAt = new Date().toISOString()
report.verdict = authorised ? "PROCEEDED" : "BLOCKED_AT_AUTHORITY:" + authority.result
console.log(JSON.stringify(report, null, 2))
try { await pool.end() } catch { /* the pool never connected */ }
