import { pool } from "@/lib/db"
import { auditFabricAction, requireLedger } from "@/lib/fabric/audit.mjs"
import { BrokerDenied, brokeredExec, resolveBrokeredNode } from "@/lib/fabric/broker.mjs"
import { defaultFabricRoot } from "@/lib/fabric/transport.mjs"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { resolveObjectAction } from "@/lib/intent/object-action-registry"
import {
  assertObservedIdentity,
  observeCommand,
  planIdentityStamp,
  readPriorStamp,
  stampCommand,
  verifyCommand,
  verifyPostState,
} from "@/lib/system/node-identity-stamp"
import { loadSystemObjectSource, SystemObjectSourceError } from "@/lib/system/system-object-source"
import type { NodeObject } from "@/lib/system/system-object"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * The first bounded journey, end to end on canonical seams (#987, #995 invariant 13).
 *
 *   stable object      `projectSystemObjects`, through `lib/system/system-object-source.ts`
 *   current world      the node is asked what it calls itself before anything is written
 *   contextual action  `resolveObjectAction`, which refuses ambiguity rather than ranking through it
 *   governed execution `brokeredExec` -- policy-resolved, host-key-pinned, dialect-aware, audited
 *   verified post-state a SECOND observation of the node, never the write's own report
 *   return location    carried back in the response and unchanged by this route
 *
 * WHAT THIS ROUTE CANNOT DO, structurally rather than by discipline. It cannot be told what to run:
 * the command is generated from a plan that is generated from the canonical record. It cannot be told
 * where to write: the path is a fixed literal per dialect. It cannot be told which machine to reach
 * beyond naming an object that must already exist in the canonical graph. A request body carrying
 * `path`, `command`, `node` or `content` changes nothing, and
 * `tests/system-node-identity-stamp` sends one to prove it.
 *
 * AUTHORITY IS NOT HERE. The registry records that this action requires it (`requiresAuthority`), and
 * the answer comes from the authority grant registry -- an active, unexpired, unrevoked grant, scoped
 * to this work order, naming this action, and belonging to the session user. Approval is not
 * authority, and an instruction in a conversation is not a grant.
 */
const STAMP_WORK_ORDER = "#995"
const STAMP_ACTION_ID = "system.node.stamp-identity"
const OBSERVE_TIMEOUT_MS = 20_000
const STAMP_TIMEOUT_MS = 30_000

function refuse(error: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user) return refuse("UNAUTHENTICATED", 401)

  let body: { input?: unknown; objectId?: unknown }
  try {
    body = await request.json()
  } catch {
    return refuse("BAD_REQUEST", 400)
  }
  const input = typeof body.input === "string" ? body.input.trim() : ""
  const objectId = typeof body.objectId === "string" ? body.objectId.trim() : ""
  if (Boolean(input) === Boolean(objectId)) {
    return refuse("SELECTION_REQUIRED", 400, {
      detail: "supply exactly one of `input` (operator text, resolved through the registry) or `objectId`",
    })
  }

  // Authority first, before the graph is read: an unauthorised caller learns nothing about which
  // objects exist. Scoped to the session user as well as to the work order and the action --
  // criterion 8, and the one place the shipped `resource/relocate` route does not scope.
  let grantRef: string | null = null
  try {
    const grants = await pool.query(
      `SELECT "ref" FROM authority_grant
        WHERE "status" = 'active'
          AND ("expiresAt" IS NULL OR "expiresAt" > timezone('UTC', now()))
          AND "revokedAt" IS NULL
          AND "scope" = $1
          AND $2 = ANY("allowedActions")
          AND "userId" = $3
        ORDER BY "id" DESC LIMIT 1`,
      [STAMP_WORK_ORDER, "node.stamp-identity", session.user.id],
    )
    grantRef = grants.rows[0]?.ref ?? null
  } catch {
    // An unreadable grant registry is not permission.
    return refuse("AUTHORITY_UNREADABLE", 503)
  }
  if (!grantRef) {
    return refuse("AUTHORITY_NOT_GRANTED", 409, {
      detail: `no active authority grant scoped to ${STAMP_WORK_ORDER} permits node.stamp-identity for this operator`,
      remedy: "Record an owner authority grant for this work order before retrying. Admission is not authorisation.",
    })
  }

  let source: Awaited<ReturnType<typeof loadSystemObjectSource>>
  try {
    source = await loadSystemObjectSource()
  } catch (error) {
    if (error instanceof SystemObjectSourceError) return refuse(error.code, 503, { detail: error.message })
    throw error
  }

  // The one object this action will act on. Both entry shapes converge here, and neither can name a
  // machine the canonical graph does not already hold.
  let object: NodeObject
  if (objectId) {
    const found = source.graph.objects.find((candidate) => candidate.objectId === objectId)
    if (!found) return refuse("OBJECT_UNKNOWN", 404, { objectId })
    if (found.kind !== "NODE") return refuse("NOT_A_NODE", 409, { objectId, kind: found.kind })
    object = found
  } else {
    const resolution = resolveObjectAction(input, { objects: source.graph.objects })
    if (resolution.state === "clarification_required") {
      // Ambiguity is refused, not ranked through. The candidates are reported so the operator can
      // choose; nothing is executed on the strength of a ranking.
      return refuse("CLARIFICATION_REQUIRED", 409, {
        detail: resolution.reason,
        candidates: resolution.candidates.map((candidate) => ({
          action: candidate.action.id,
          objectId: candidate.object?.objectId ?? null,
        })),
      })
    }
    if (resolution.action?.id !== STAMP_ACTION_ID) {
      return refuse("ACTION_MISMATCH", 409, {
        detail: `this route performs ${STAMP_ACTION_ID}; the input resolved to ${resolution.action?.id ?? "no action"}`,
      })
    }
    if (!resolution.object || resolution.object.kind !== "NODE") {
      return refuse("OBJECT_UNKNOWN", 404, { detail: "the input named no node in the current graph" })
    }
    object = resolution.object
  }

  const endpoint = source.endpointByNodeId[object.nodeId]
  if (!endpoint) {
    return refuse("ENDPOINT_UNKNOWN", 409, {
      detail: `no transport record binds to canonical node ${object.nodeId}`,
    })
  }

  // The broker's own resolution, so the record this plan reads is the record the broker will use.
  // Deriving the dialect from a second lookup could disagree with the one that actually executes.
  let record
  try {
    record = await resolveBrokeredNode(endpoint, { registry: source.transport })
  } catch (error) {
    if (error instanceof BrokerDenied) {
      return refuse("POLICY_DENY", 409, { detail: error.message, endpoint })
    }
    throw error
  }

  const plan = planIdentityStamp(object, record, { stampedAt: new Date().toISOString() })
  if (!plan.ok || !plan.plan) {
    return refuse(plan.refusal ?? "STAMP_REFUSED", 409, { detail: plan.detail, objectId: object.objectId })
  }
  const stamp = plan.plan

  const fabricRoot = defaultFabricRoot()
  // Proven writable before the node is contacted at all, not merely before it is changed. The broker
  // repeats this check for the write itself (`requireAudit`), and the repetition is deliberate: this
  // one makes an unrecordable action cost nothing, and that one makes it impossible.
  try {
    await requireLedger(fabricRoot)
  } catch (error) {
    return refuse("EVIDENCE_UNAVAILABLE", 503, {
      detail: (error as Error).message,
      note: "nothing was executed; an action that cannot be recorded does not happen",
    })
  }

  const brokered = { fabricRoot, registry: source.transport } as const

  let prior
  try {
    const { stdout } = await brokeredExec(endpoint, observeCommand(stamp.dialect), {
      ...brokered,
      timeout: OBSERVE_TIMEOUT_MS,
      action: `${stamp.operation}.observe`,
    })
    prior = readPriorStamp(stdout)
  } catch (error) {
    return refuse("NODE_UNREACHABLE", 502, { detail: String((error as Error).message).slice(0, 200), endpoint })
  }

  const identity = assertObservedIdentity(source.contract, stamp, prior)
  if (!identity.ok) {
    return refuse(identity.refusal, 409, {
      detail: identity.detail,
      note: "nothing was written; the endpoint did not answer as the selected node",
    })
  }

  try {
    // `requireAudit` re-proves the ledger immediately before the node is touched. This is the only
    // call in the route that changes anything.
    await brokeredExec(endpoint, stampCommand(stamp), {
      ...brokered,
      timeout: STAMP_TIMEOUT_MS,
      action: stamp.operation,
      requireAudit: true,
    })
  } catch (error) {
    const message = String((error as Error).message ?? "")
    if (message.includes("AUDIT_UNAVAILABLE")) {
      return refuse("EVIDENCE_UNAVAILABLE", 503, { detail: message.slice(0, 200) })
    }
    return refuse("STAMP_FAILED", 502, { detail: message.slice(0, 200), endpoint })
  }

  // A separate observation. The write reported its own digest and this route does not read it: the
  // post-state has to be a fact about the node, not a fact about the command that changed it.
  let post
  try {
    const { stdout } = await brokeredExec(endpoint, verifyCommand(stamp.dialect), {
      ...brokered,
      timeout: OBSERVE_TIMEOUT_MS,
      action: `${stamp.operation}.verify`,
    })
    post = verifyPostState(stamp, stdout, new Date().toISOString())
  } catch (error) {
    post = verifyPostState(stamp, "", new Date().toISOString())
    post = { ...post, reason: `the post-state could not be observed: ${String((error as Error).message).slice(0, 160)}` }
  }

  /**
   * The observed post-state goes into the DURABLE record, not only into the governance event.
   *
   * This was a real gap and it is worth naming rather than quietly closing. The ledger already
   * carried a line for the write and a line for the verify COMMAND -- but not for what the verify
   * observed. `appendGovernanceEvent` swallows its own write failures by explicit design
   * (`lib/governance/events.ts`), so leaving the post-state only there would have made invariant 12
   * -- "the action's evidence records what was observed after" -- depend on a best-effort write. An
   * action whose post-state evidence can silently vanish has a story about evidence, which is the
   * same failure class this gate's own prerequisite existed to close on the audit path.
   *
   * `required: true`, so an unwritable ledger here is a refusal rather than a skip. The mutation has
   * already happened by this point and cannot be undone, which is exactly why the response must say
   * so instead of reporting a clean success.
   */
  try {
    await auditFabricAction(
      fabricRoot,
      endpoint,
      `${stamp.operation}.post-state`,
      post.verified ? 0 : 1,
      `${stamp.nodeId} verified=${post.verified} observed=${post.observedDigest ?? "none"} bytes=${post.observedBytes ?? "none"}`,
      { required: true },
    )
  } catch (error) {
    return refuse("POST_STATE_UNRECORDED", 503, {
      detail: String((error as Error).message).slice(0, 200),
      postState: post,
      note: "the stamp was written and observed, and the observation could not be recorded durably",
    })
  }

  const evidence = {
    operation: stamp.operation,
    objectId: stamp.objectId,
    nodeId: stamp.nodeId,
    endpoint,
    grant: grantRef,
    workOrder: STAMP_WORK_ORDER,
    observedHostname: identity.observedHostname,
    deletesNothing: true,
  }
  await appendGovernanceEvent({
    userId: session.user.id,
    eventType: "EVIDENCE_RECORDED",
    entityType: "system_object_mutation",
    entityId: stamp.objectId,
    actor: "williamos",
    reason: `${stamp.operation} on ${stamp.nodeId} under ${grantRef}`,
    // `before` is the prior stamp's digest rather than its content: enough to show that something
    // changed, and carrying nothing that would need redacting later.
    before: { priorDigest: prior.priorDigest, priorBytes: prior.priorBytes },
    // What was OBSERVED afterwards, not what was requested. When verification failed this records the
    // failure, which is the point of recording it separately from the request.
    after: { ...post, verified: post.verified },
    metadata: { ...evidence, postState: post },
  })

  if (!post.verified) {
    return refuse("POST_STATE_UNVERIFIED", 502, {
      ...evidence,
      postState: post,
      note: "the write returned, and this route does not report success it could not observe",
    })
  }

  return Response.json(
    {
      ok: true,
      ...evidence,
      postState: post,
      returnTo: object.objectId,
      note: "one file written and read back; nothing was deleted and no other node was touched",
    },
    { headers: { "cache-control": "no-store" } },
  )
}
