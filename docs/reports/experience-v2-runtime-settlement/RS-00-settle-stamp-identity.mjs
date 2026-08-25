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
 *
 * TWO CONSEQUENCES OF THAT BOUNDARY, both of which this driver got wrong once and now states as
 * contracts, because `RUNTIME-SETTLEMENT-001` retains this file as the artifact the continuation
 * runs again on `ATLAS_REACHABLE` -- the next run is the one that matters.
 *
 *   1. NO SESSION IS NOT EVERY SESSION. The route scopes its grant lookup to the session user
 *      (`route.ts:104-112`, `criterion 8`). Having no session is a reason to REFUSE, not a reason
 *      to widen the query to every operator's grants. The actor must therefore be NAMED
 *      (`--actor=<userId>`), the same `"userId"` predicate is applied, and the naming is recorded
 *      as an assertion rather than an authentication. Unnamed refuses:
 *      `AUTHORITY_UNVERIFIABLE_NO_ACTOR`.
 *
 *   2. AUTHORITY PASSING IS NOT THE MUTATION HAPPENING. `PROCEEDED` is not a verdict this file can
 *      emit. The verdict is derived from what LEG 7 actually executed and from a SEPARATE
 *      post-state observation of the node -- never from the authority result. A settlement driver
 *      that can report success without executing is the shape of the 2026-08-18 backup failure,
 *      one subsystem over.
 */
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import os from "node:os"

/**
 * The repository root is DISCOVERED, not counted in `..` hops.
 *
 * This file ran from `.settlement/`, one level below a checkout root, and is RETAINED at
 * `docs/reports/experience-v2-runtime-settlement/`, three levels below it. Any fixed hop count is
 * correct in exactly one of those places and wrong in the other, and the wrong one fails at the
 * loader import before the settlement can begin. Walking up to the directory that actually holds
 * `scripts/repo-alias-loader.mjs` is correct in both.
 *
 * It matters twice. The second use is silent rather than fatal: `WILLIAMOS_PROJECT_ROOT` is the
 * variable `#1002` introduced (`lib/system/system-object-source.ts`) precisely so the deployed root
 * is not guessed, and a mis-set root would resolve system objects against a documentation
 * directory without complaining.
 */
function findRepoRoot(from) {
  let dir = path.resolve(from)
  for (;;) {
    if (fs.existsSync(path.join(dir, "scripts", "repo-alias-loader.mjs"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(
        "REPO_ROOT_NOT_FOUND: no ancestor of " + from + " contains scripts/repo-alias-loader.mjs, "
        + "so the canonical modules this driver must import cannot be located. Run it from inside a "
        + "repository checkout.",
      )
    }
    dir = parent
  }
}
const root = findRepoRoot(import.meta.dirname)
register("./repo-alias-loader.mjs", pathToFileURL(path.join(root, "scripts") + "/"))

const argv = process.argv.slice(2)
const usage =
  "usage: RS-00-settle-stamp-identity.mjs <path to .env.local> [--actor=<userId>]\n"
  + "  --actor  the operator whose authority grants are consulted, applying the route's own\n"
  + "           `\"userId\"` predicate. Without it the authority leg refuses\n"
  + "           AUTHORITY_UNVERIFIABLE_NO_ACTOR; it never widens the lookup."
const envFile = argv.find((a) => !a.startsWith("--"))
if (!envFile) throw new Error(usage)
const actorArg = argv.find((a) => a.startsWith("--actor="))
const actorUserId =
  (actorArg ? actorArg.slice("--actor=".length) : process.env.WILLIAMOS_SETTLEMENT_ACTOR_USER_ID ?? "").trim()
  || null
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
  actorUserId,
  actorIdentification: actorUserId ? "ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED" : "NONE",
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
//
// THE SQL NARROWING IS THE ROUTE'S, PREDICATE FOR PREDICATE. `route.ts:104-112` filters
// `"scope" = $1 AND "userId" = $2`, and the comment above it (`route.ts:82-100`) names that second
// clause as `criterion 8` -- session-user scoping on every lookup -- written to stop exactly the
// drift of restating a weaker check beside a mutating path. This driver has no session to derive
// the user from (leg 1), so it takes the actor by name and applies the identical predicate. What it
// must never do is drop the predicate: a lookup scoped to nobody is a lookup scoped to everyone,
// and any operator's `#995` grant would then authorise a write to a machine this lab shares.
//
// Three registry states are distinguished, because collapsing them is how "we could not check"
// becomes "there is nothing to find":
//
//   AUTHORITY_UNREADABLE            the registry did not answer. Not permission, and not absence.
//   AUTHORITY_UNVERIFIABLE_NO_ACTOR the registry answered, and there is no actor to scope to.
//   AUTHORITY_NOT_GRANTED_*         the registry answered for THIS actor, and nothing covers.
// ---------------------------------------------------------------------------
const { grantCovers } = await import("@/lib/governance/authority")
const { pool } = await import("@/lib/db")

const GRANT_COLUMNS =
  `SELECT "id", "ref", "status", "authorityLevel", "allowedActions", "blockedActions",
          "expiresAt", "revokedAt", "revokeReason", "userId"
     FROM authority_grant
    WHERE "scope" = $1
      AND "userId" = $2
    ORDER BY "id" DESC LIMIT 20`

const authority = {
  requiredAuthority: "A3_WRITE_SHARED",
  operation: "node.stamp-identity",
  workOrderScope: "#995",
  checker: "lib/governance/authority.ts grantCovers (canonical), not a SQL predicate",
  scoping: 'route.ts:104-112 -- "scope" = $1 AND "userId" = $2 (criterion 8), applied verbatim',
  actorUserId,
  actorIdentification: actorUserId ? "ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED" : "NONE",
  registryReadable: null,
  userScoped: null,
  grantsFound: null,
  grantRef: null,
  selfMinted: false,
}

const registryError = (error) => ({
  message: String(error?.message ?? error),
  code: error?.code ?? null,
  address: error?.address ?? null,
  port: error?.port ?? null,
})

try {
  // Reachability is established before scoping, so an unreadable registry still reports as
  // unreadable rather than being masked by the missing-actor refusal. This is the leg that produced
  // the 2026-08-25 verdict and it must keep producing it while ATLAS is down.
  await pool.query("SELECT 1")
  authority.registryReadable = true
} catch (error) {
  // This is the route's own catch: "An unreadable grant registry is not permission."
  authority.registryReadable = false
  authority.result = "AUTHORITY_UNREADABLE"
  authority.error = registryError(error)
}

if (authority.registryReadable && !actorUserId) {
  authority.userScoped = false
  authority.result = "AUTHORITY_UNVERIFIABLE_NO_ACTOR"
  authority.detail =
    "The registry answered, and this driver has no authenticated session and was given no --actor, "
    + "so the route's `\"userId\"` predicate cannot be applied. Unable to scope is not scoped to "
    + "everyone: no grant was consulted and none was accepted."
} else if (authority.registryReadable) {
  try {
    const grants = await pool.query(GRANT_COLUMNS, ["#995", actorUserId])
    authority.userScoped = true
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
    // Belt and braces on the predicate: a row that came back for another operator would mean the
    // query is not the route's, and this driver refuses rather than reasoning about why.
    const foreign = authority.verdicts.filter((v) => v.userId !== actorUserId)
    if (foreign.length > 0) {
      authority.result = "AUTHORITY_SCOPE_VIOLATION"
      authority.detail = `${foreign.length} grant row(s) returned for an operator other than the named actor`
    } else {
      const covering = authority.verdicts.find((v) => v.ok)
      authority.grantRef = covering?.ref ?? null
      authority.result = covering
        ? "AUTHORITY_GRANTED"
        : (grants.rows.length === 0 ? "AUTHORITY_NOT_GRANTED_NO_ROWS" : "AUTHORITY_NOT_GRANTED_NO_COVERAGE")
    }
  } catch (error) {
    authority.result = "AUTHORITY_UNREADABLE"
    authority.error = registryError(error)
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
const {
  planIdentityStamp, observeCommand, stampCommand, verifyCommand,
  readPriorStamp, assertObservedIdentity, verifyPostState,
} = await import("@/lib/system/node-identity-stamp")
const { resolveBrokeredNode, brokeredExec } = await import("@/lib/fabric/broker.mjs")
const { requireLedger, auditFabricAction } = await import("@/lib/fabric/audit.mjs")
const { defaultFabricRoot } = await import("@/lib/fabric/transport.mjs")
const { appendGovernanceEvent } = await import("@/lib/governance/events")

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
//
// When authority PASSES, the route's own mutation sequence runs here: observe, assert that the
// endpoint answered as the selected node, stamp under `requireAudit`, then observe a SECOND time and
// record that observation durably. `executed` is set from what actually ran.
//
// The alternative -- record `executed: false` and call it settled -- is what this file did once, and
// it is the exact shape of the failure this repository has already paid for: a mechanism that
// reports success while doing nothing. `detail: "unreachable in this run"` was true of one run and
// was not a guard.
// ---------------------------------------------------------------------------
const OBSERVE_TIMEOUT_MS = 20_000
const STAMP_TIMEOUT_MS = 30_000
const mutation = {
  executed: false,
  refusedAt: null,
  refusal: null,
  nodeContacted: false,
  postState: null,
  postStateRecorded: null,
}

if (!authorised) {
  mutation.refusedAt = "authority"
  mutation.refusal = authority.result
  mutation.detail =
    "The route refuses here and executes nothing. This driver does the same. The node was not "
    + "observed, not written, and not read back; no stamp exists that did not exist before."
} else if (!endpoint || !planned.ok || !planned.plan) {
  mutation.refusedAt = "plan"
  mutation.refusal = planned.refusal ?? (endpoint ? "STAMP_REFUSED" : "ENDPOINT_UNKNOWN")
  mutation.detail = "authority passed; there is no plan to execute, so nothing was executed"
} else if (guards.routePreflight?.result !== "LEDGER_WRITABLE") {
  mutation.refusedAt = "evidence"
  mutation.refusal = "EVIDENCE_UNAVAILABLE"
  mutation.detail =
    "the ledger was not writable at the route's pre-contact preflight; an action that cannot be "
    + "recorded does not happen"
} else {
  const stamp = planned.plan
  const brokered = { fabricRoot: realFabricRoot, registry: source.transport }
  mutation.operation = stamp.operation
  mutation.nodeId = stamp.nodeId
  mutation.endpoint = endpoint
  try {
    mutation.nodeContacted = true
    const observed = await brokeredExec(endpoint, observeCommand(stamp.dialect), {
      ...brokered, timeout: OBSERVE_TIMEOUT_MS, action: `${stamp.operation}.observe`,
    })
    const prior = readPriorStamp(observed.stdout)
    mutation.prior = { priorDigest: prior.priorDigest ?? null, priorBytes: prior.priorBytes ?? null }

    const identity = assertObservedIdentity(source.contract, stamp, prior)
    if (!identity.ok) {
      mutation.refusedAt = "identity"
      mutation.refusal = identity.refusal
      mutation.detail = identity.detail
      mutation.note = "nothing was written; the endpoint did not answer as the selected node"
    } else {
      mutation.observedHostname = identity.observedHostname
      await brokeredExec(endpoint, stampCommand(stamp), {
        ...brokered, timeout: STAMP_TIMEOUT_MS, action: stamp.operation, requireAudit: true,
      })
      mutation.executed = true

      // A SECOND observation of the node. The write's own report is deliberately not read: the
      // post-state has to be a fact about the node, not a fact about the command that changed it.
      let post
      try {
        const verified = await brokeredExec(endpoint, verifyCommand(stamp.dialect), {
          ...brokered, timeout: OBSERVE_TIMEOUT_MS, action: `${stamp.operation}.verify`,
        })
        post = verifyPostState(stamp, verified.stdout, new Date().toISOString())
      } catch (error) {
        post = verifyPostState(stamp, "", new Date().toISOString())
        post = {
          ...post,
          reason: `the post-state could not be observed: ${String(error?.message).slice(0, 160)}`,
        }
      }
      mutation.postState = post

      try {
        await auditFabricAction(
          realFabricRoot, endpoint, `${stamp.operation}.post-state`, post.verified ? 0 : 1,
          `${stamp.nodeId} verified=${post.verified} observed=${post.observedDigest ?? "none"} bytes=${post.observedBytes ?? "none"}`,
          { required: true },
        )
        mutation.postStateRecorded = true
      } catch (error) {
        mutation.postStateRecorded = false
        mutation.postStateRecordError = String(error?.message).slice(0, 200)
      }

      // The route's durable governance event, carrying the actor the lookup was scoped to.
      // `appendGovernanceEvent` swallows its own write failures by design, so its return proves
      // nothing and is not read as evidence; the durable post-state above is what gates the verdict.
      await appendGovernanceEvent({
        userId: actorUserId,
        eventType: "EVIDENCE_RECORDED",
        entityType: "system_object_mutation",
        entityId: stamp.objectId,
        actor: "williamos",
        reason: `${stamp.operation} on ${stamp.nodeId} under ${authority.grantRef}`,
        before: { priorDigest: prior.priorDigest, priorBytes: prior.priorBytes },
        after: { ...post, verified: post.verified },
        metadata: {
          operation: stamp.operation, objectId: stamp.objectId, nodeId: stamp.nodeId, endpoint,
          grant: authority.grantRef, workOrder: "#995",
          observedHostname: identity.observedHostname, deletesNothing: true, postState: post,
          actorIdentification: "ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED",
        },
      })
      mutation.governanceEventAttempted = true
    }
  } catch (error) {
    mutation.refusedAt = mutation.executed ? "verify" : "node"
    mutation.refusal = mutation.executed ? "POST_STATE_UNOBSERVED" : "NODE_UNREACHABLE_OR_STAMP_FAILED"
    mutation.error = String(error?.message ?? error).slice(0, 200)
  }
}
leg("7_mutation", mutation)

// ---------------------------------------------------------------------------
// THE VERDICT LATTICE. Derived from LEG 7, never from LEG 2.
//
// `PROCEEDED` is gone and does not come back. Passing an authority check is a fact about a grant
// registry; settling a governed mutation is a fact about a node. Each state below names exactly how
// far the run actually got, so that no reader and no successor lane can read "authority passed" as
// "the stamp exists".
// ---------------------------------------------------------------------------
report.finishedAt = new Date().toISOString()
report.verdict = !authorised
  ? "BLOCKED_AT_AUTHORITY:" + authority.result
  : !mutation.executed
    ? "AUTHORISED_NOT_EXECUTED:" + (mutation.refusal ?? "UNKNOWN")
    : !mutation.postState?.verified
      ? "EXECUTED_POST_STATE_UNVERIFIED"
      : mutation.postStateRecorded !== true
        ? "EXECUTED_POST_STATE_UNRECORDED"
        : "SETTLED_MUTATION_EXECUTED"
report.verdictContract =
  "Only SETTLED_MUTATION_EXECUTED settles CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT, and it "
  + "requires all three of: the mutation executed, a SEPARATE post-state observation that verified, "
  + "and that observation recorded durably. Authority passing is none of those three."
report.settled = report.verdict === "SETTLED_MUTATION_EXECUTED"
console.log(JSON.stringify(report, null, 2))
try { await pool.end() } catch { /* the pool never connected */ }
