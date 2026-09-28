import { getSession } from "@/lib/session"
import { OWNER_RUNNABLE_COMPUTE, projectComputeCapabilities } from "@/lib/environment/capability-inventory-surface"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import {
  OWNER_RUN_MAX_ROWS,
  OWNER_RUN_MIN_ROWS,
  admitOwnerRunWorkOrder,
  ownerRunSeed,
  ownerRunWorkloadFor,
  runOwnerDispatch,
  settleOwnerRunGrant,
} from "@/lib/environment/owner-run-dispatch"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// One bounded tabular workload on DAEDALUS measures single-digit minutes at threshold scale;
// an early platform abort would strand a lease mid-flight, so this route opts out. Written as a
// literal: Next.js route config must be a static value (a computed expression is refused with
// Unsupported node type "BinaryExpression" and fails the production build).
export const maxDuration = 1800

/**
 * The capability inventory, read live from the same modules dispatch enforces (see
 * lib/environment/capability-inventory-surface.ts for why no second registry exists).
 *
 * The GET is read-only and session-gated, in the same class as /api/environment/execution: it
 * can start, advance, settle, or approve nothing. It exists because the records that decide
 * where compute runs were invisible on the owner surface — a capability nobody can see is a
 * capability nobody can govern, and the estate has been burned by enforcement outrunning
 * visibility. (The owner-run POST below is the separate, strictly owner-gated write half.)
 */
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  try {
    const projection = await projectComputeCapabilities()
    return Response.json(projection)
  } catch (error) {
    // The failure is reported as itself. An inventory that silently returns empty would look
    // exactly like "no capabilities exist", which is the worst possible wrong answer here.
    return Response.json(
      { error: "CAPABILITY_SURFACE_UNAVAILABLE", detail: String(error instanceof Error ? error.message : error) },
      { status: 503 },
    )
  }
}

/**
 * The owner-facing execution half of the capability surface (POST), beside the read-only
 * inventory (GET). Same gate as every governance write in the class: session, then owner —
 * this starts compute on the estate's accelerator and spends the owner's authority, so it is
 * narrower than "any signed-in operator".
 *
 * What a request carries and what it can never carry: workload comes ONLY from the registry's
 * owner-runnable capability ids, row count ONLY from a bounded range, and the synthetic seed is
 * generated here — the caller cannot name a dataset, a table, a command, or a file. County and
 * other protected data has no path through this seam by construction (the reviewed worker
 * generates its own synthetic input at the compute node; see gpu-tabular-capability.mjs).
 *
 * Authorization per request is a governed one-shot: a fresh draft work order is admitted,
 * approved by this owner act (which is what mints the linked A2 grant), and the grant is
 * revoked plus the WO settled the moment the seam returns — including on refusal. The seam
 * runs with maxAttempts=1: one press, one bounded attempt; replays are idempotent against the
 * ledger by the seam's own digest guard.
 */

async function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) {
    return reply({ error: owner.failure, detail: owner.detail }, owner.failure === "NOT_OWNER" ? 403 : 409)
  }

  let body: { capabilityId?: unknown; parcels?: unknown }
  try {
    body = await request.json()
  } catch {
    return reply({ error: "BAD_REQUEST" }, 400)
  }

  const capabilityId = typeof body.capabilityId === "string" ? body.capabilityId : ""
  const workload = ownerRunWorkloadFor(capabilityId)
  if (!workload) {
    return reply({
      error: "CAPABILITY_NOT_OWNER_RUNNABLE",
      // The runnable list is read off the same map the gate consults — never restated here.
      detail: `${capabilityId || "(missing)"} is not an owner-runnable compute capability. Runnable: ${Object.keys(OWNER_RUNNABLE_COMPUTE).join(", ")}.`,
    }, 400)
  }
  // An ABSENT parcels defaults to the measurement floor; a PRESENT-but-malformed one (fraction,
  // string, unsafe integer, out of range) is refused. Defaulting a garbled value would run a job
  // the caller did not ask for — fail closed instead.
  if ("parcels" in body && (typeof body.parcels !== "number" || !Number.isSafeInteger(body.parcels))) {
    return reply({ error: "PARCELS_OUT_OF_BOUNDS", detail: `parcels must be an integer between ${OWNER_RUN_MIN_ROWS.toLocaleString()} and ${OWNER_RUN_MAX_ROWS.toLocaleString()}` }, 400)
  }
  const parcels = typeof body.parcels === "number" ? body.parcels : OWNER_RUN_MIN_ROWS
  if (parcels < OWNER_RUN_MIN_ROWS || parcels > OWNER_RUN_MAX_ROWS) {
    return reply({ error: "PARCELS_OUT_OF_BOUNDS", detail: `bounded to ${OWNER_RUN_MIN_ROWS.toLocaleString()}..${OWNER_RUN_MAX_ROWS.toLocaleString()} synthetic rows` }, 400)
  }

  const admission = await admitOwnerRunWorkOrder(workload, parcels)
  if (!admission.ok) return reply({ error: admission.error, detail: admission.detail, missing: admission.missing }, admission.error.endsWith("REFUSED") ? 409 : 503)

  let outcome: Record<string, unknown>
  try {
    outcome = await runOwnerDispatch({
      workOrderRef: admission.woRef,
      workOrderId: admission.woId,
      workload,
      synthetic: { parcels, seed: ownerRunSeed() },
      devicePolicy: "auto",
    })
  } catch (error) {
    // A throw (vs a typed refusal) still must settle the grant, and the settle's own outcome is
    // reported even here: "may still be live" is exactly what the caller must be told when
    // settlement is incomplete.
    const settle = await settleOwnerRunGrant(admission.woId, "owner-run dispatch threw; authorization settled")
    return reply({
      error: "DISPATCH_TRANSPORT_ERROR",
      detail: String(error instanceof Error ? error.message : error),
      workOrderRef: admission.woRef,
      authorization: { woId: admission.woId, settled: settle.ok === true, ...(settle.ok ? {} : { settleError: settle.error, settleDetail: settle.detail }) },
    }, 502)
  }

  const settle = await settleOwnerRunGrant(admission.woId,
    `owner-run dispatch settled with outcome ${String(outcome.outcome ?? outcome.status ?? "unknown")}`)

  return reply({
    ...outcome,
    workOrderRef: admission.woRef,
    syntheticDataOnly: true,
    authorization: { woId: admission.woId, settled: settle.ok === true, ...(settle.ok ? {} : { settleError: settle.error, settleDetail: settle.detail }) },
  })
}
