import {
  createWorkOrder,
  transitionWorkOrder,
  updateWorkOrderContract,
} from "@/app/actions/work-orders"
import { revokeAuthorityGrant } from "@/app/actions/authority"
import {
  OWNER_RUNNABLE_COMPUTE,
  loadSameModulesAsDispatch,
} from "@/lib/environment/capability-inventory-surface"
import { pool } from "@/lib/db"

/**
 * Owner-run dispatch — the execution half of the capability surface.
 *
 * Why this exists (the defect it closes): `gpu-tabular-dispatch.mjs` carries the reviewed,
 * lease-and-ledger-guarded `dispatchComputeJob`, and its live acceptance matrix passed —
 * from a script. No caller in `app/` or `components/` ever reached it, so the owner-facing
 * product could DISPLAY the DAEDALUS capability honestly while no owner journey could
 * actually invoke it. A capability nobody can invoke through the product is not
 * commissioned, no matter how honest its inventory board is.
 *
 * Division of responsibility, kept sharp:
 *   - this module owns the governed AUTHORIZATION SHAPE of an owner-run job: one draft work
 *     order, contract completed, and the draft -> proposed -> approved moves executed through
 *     the SAME server actions the work-orders register uses, so the approval act mints the
 *     grant, writes the authority artifact, and appends the governance events exactly as every
 *     other authorization in the estate does — no side channel, no hand-rolled grant insert;
 *   - `dispatchComputeJob` owns everything below the authorization: registry decision, adapter
 *     placement, health probe, leases, ledger, fabric SSH, evidence projection. This module
 *     never re-implements a line of that policy; it calls the seam and reports what the seam
 *     says. Placement refusals therefore arrive as the seam's own typed outcomes.
 *
 * The grant is bounded: A2_WRITE_OWN scoped to the seam's script directory (the
 * path-confinement vocabulary the reviewed trust gate reads), minted through the governed
 * transition WITH an explicit 24-hour expiry (the transition seam has always supported
 * grantExpiresAt; this lane threads it through the action rather than leaving the grant
 * unbounded), and REVOKED the moment one dispatch attempt returns — pass or fail. The grant's
 * working lifetime is exactly the job's lifetime; the expiry is the backstop for a settle that
 * never lands (process death mid-run), not the primary control.
 *
 * The contract's agent is `local` — the matrix's registered local-capacity agent, capped at
 * exactly A2_WRITE_OWN. Naming the seam as the agent was measured to be worse than wrong: the
 * matrix refuses unknown agents, so admission died before dispatch and the run control could
 * never reach the seam at all. The seam is the EXECUTOR named in the contract's description and
 * validators; the agent field names the accountable registered principal.
 */

/** The registered principal the matrix caps at exactly this lane's authority level. */
export const OWNER_RUN_AGENT = "local"
/** The lane's authority level: explicit operator approval required, grant minted on approval. */
export const OWNER_RUN_AUTHORITY_LEVEL = "A2_WRITE_OWN"
/** Backstop lifetime for the minted grant; the working control is revoke-on-settle. */
export const OWNER_RUN_GRANT_TTL_MS = 24 * 60 * 60 * 1000

export const OWNER_RUN_ALLOWED_PATH = "scripts/execution-fabric"

// The row bounds and the owner-runnable vocabulary live in the surface module (one source the
// inventory projection, the POST gate, and this module all read); re-exported here because the
// route and its tests import them from this module.
export { OWNER_RUN_MAX_ROWS, OWNER_RUN_MIN_ROWS } from "@/lib/environment/capability-inventory-surface"

/** The one source of the owner-runnable vocabulary is the surface map (no second map here). */
export function ownerRunWorkloadFor(capabilityId: string): string | null {
  return Object.prototype.hasOwnProperty.call(OWNER_RUNNABLE_COMPUTE, capabilityId)
    ? OWNER_RUNNABLE_COMPUTE[capabilityId]
    : null
}

export type OwnerRunAdmission =
  | Readonly<{ ok: true; woId: number; woRef: string }>
  | Readonly<{ ok: false; error: string; detail?: string; missing?: readonly string[] }>

/**
 * One owner-attributed, owner-approved work order, ready for the seam. Every step is a
 * sanctioned action; any refusal aborts the attempt before a dispatch exists to authorize.
 */
export async function admitOwnerRunWorkOrder(
  workload: string,
  rows: number,
): Promise<OwnerRunAdmission> {
  const created = await createWorkOrder({
    title: `Owner-run ${workload} on the commissioned compute capability (synthetic)`,
    goal: "Prove the owner journey end to end: a real capability request from WilliamOS dispatches through the Fabric to the reviewed compute node and returns a result the product can show. Synthetic data only.",
    description: `Owner-initiated bounded compute: workload ${workload}, synthetic parcels ${rows}. Execution is the reviewed seam; this record carries the authorization and the returned evidence.`,
    lane: "owner-run-compute",
  })
  const woId = Number(created?.id)
  if (!Number.isSafeInteger(woId)) return { ok: false, error: "OWNER_RUN_WO_CREATE_FAILED" }

  await updateWorkOrderContract(woId, {
    scope: "one bounded synthetic tabular workload through the reviewed dispatch seam",
    authorityLevel: OWNER_RUN_AUTHORITY_LEVEL,
    agent: OWNER_RUN_AGENT,
    allowedFiles: OWNER_RUN_ALLOWED_PATH,
    forbiddenFiles: `${OWNER_RUN_ALLOWED_PATH}/gpu-tabular-bench/evidence, docs/governance, app, components, lib, tests`,
    acceptanceCriteria: `dispatch outcome is SUCCEEDED or a typed refusal; an evidence_record exists on this work order when SUCCEEDED; synthetic input only, generated at the compute node by the reviewed worker`,
    validators: "seam:gpu-tabular-dispatch ledger+lease guards; product:evidence_record projected on this WO",
    stopConditions: "REFUSED, FAILED, CANCELLED, or DISPATCH_INCOMPLETE stop this WO; no retry is authorized by this record",
  })

  const proposed = await transitionWorkOrder(woId, "proposed")
  if (!proposed.ok) {
    return { ok: false, error: "OWNER_RUN_WO_PROPOSE_REFUSED", detail: proposed.reason }
  }
  // grantAuthority=true is the explicit operator approval act the lifecycle demands for A2
  // (requiresExplicitApproval: rank > A1). It flows into the governed transition, which mints
  // the linked grant from the contract fields and writes the authority artifact.
  const approved = await transitionWorkOrder(woId, "approved", {
    grantAuthority: true,
    // The backstop the docstring promises, threaded through the action: without this the grant
    // is minted with expiresAt = null, which isGrantActive reads as never-expiring — a crash
    // before settle would leave an active A2 grant against the seam forever.
    grantExpiresAt: new Date(Date.now() + OWNER_RUN_GRANT_TTL_MS),
  })
  if (!approved.ok) {
    return {
      ok: false,
      error: "OWNER_RUN_WO_APPROVE_REFUSED",
      detail: approved.reason,
      missing: approved.missing,
    }
  }
  return { ok: true, woId, woRef: String(created.ref) }
}

/** Read the WO's live grant id (the pointer the governed transition wrote) — read-only. */
export async function loadWorkOrderGrantId(woId: number): Promise<number | null> {
  const result = await pool.query<{ authorityGrantId: number | null }>(
    `SELECT "authorityGrantId" FROM work_order WHERE id = $1 LIMIT 1`,
    [woId],
  )
  const id = Number(result.rows[0]?.authorityGrantId)
  return Number.isSafeInteger(id) ? id : null
}

/**
 * Settle the authorization the job consumed: revoke the grant, then close the work order.
 * Both are the estate's sanctioned actions (the same pair the ledger reconciliation uses).
 * A settle failure is reported, never swallowed — an active A2 grant with no job running
 * behind it is exactly the state governance must see. `aborted` is the honest terminal for a
 * single bounded job either way: it ran once, the record closes; success lives on in its
 * evidence, not in an open WO.
 */
export async function settleOwnerRunGrant(
  woId: number,
  reason: string,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; error: string; detail: string }>> {
  const failures: string[] = []
  const failed = (error: unknown) => String(error instanceof Error ? error.message : error)

  // Ordered and independent: a revoke that throws must NOT skip the work-order settle, or the
  // estate is left with an open WO nothing will ever close (the defect the second review round
  // measured — revokeAuthorityGrant throws for an already-inactive grant, which is a benign
  // race, not a reason to abandon the record).
  let grantId: number | null = null
  try {
    grantId = await loadWorkOrderGrantId(woId)
  } catch (error) {
    failures.push(`grant lookup: ${failed(error)}`)
  }
  if (grantId !== null) {
    try {
      await revokeAuthorityGrant(grantId, reason)
    } catch (error) {
      failures.push(`grant revoke: ${failed(error)}`)
    }
  }
  try {
    const closed = await transitionWorkOrder(woId, "aborted")
    if (!closed.ok) failures.push(`work order settle: ${closed.reason}`)
  } catch (error) {
    failures.push(`work order settle: ${failed(error)}`)
  }

  return failures.length === 0
    ? { ok: true }
    : { ok: false, error: "OWNER_RUN_SETTLE_INCOMPLETE", detail: failures.join("; ") }
}

/**
 * Run one dispatch through the literal modules the surface (and therefore dispatch) enforces —
 * registry, adapter, and seam loaded via the same `loadSameModulesAsDispatch` the board reads,
 * so the button and the inventory cannot govern against different sources. The seam owns
 * placement; this call only assembles its documented deps. `runQuery` is the app DB pool:
 * exactly the contract `projectEvidenceToWorkOrder` and the loaders use ($1 placeholders).
 */
export async function runOwnerDispatch(
  submission: Readonly<{ workOrderRef: string; workload: string; synthetic: { parcels: number; seed: number }; devicePolicy?: string }>,
): Promise<Record<string, unknown>> {
  const { registry, adapter, dispatch } = await loadSameModulesAsDispatch()
  const bindings = await dispatch.loadLedgerBindings()
  const leaseMod = await dispatch.loadLeaseBindings()
  return dispatch.dispatchComputeJob(
    { ...submission },
    {
      registry,
      adapter,
      bindings,
      leaseMod,
      maxAttempts: 1,
      runQuery: (text: string, params?: unknown[]) =>
        pool.query(text, params as never[]),
      loadWorkOrder: async (ref: string) => {
        const result = await pool.query(
          `SELECT id, ref, status, "userId", "allowedFiles", evidence FROM work_order WHERE ref = $1 LIMIT 1`,
          [ref],
        )
        return result.rows[0] ?? null
      },
      loadActiveGrant: async (workOrderId: number) => {
        const result = await pool.query(
          `SELECT id, ref, status, "allowedActions", "expiresAt" FROM authority_grant
            WHERE "workOrderId" = $1 AND status = 'active'
              AND ("expiresAt" IS NULL OR "expiresAt" > timezone('UTC', now()))
            ORDER BY id LIMIT 1`,
          [workOrderId],
        )
        return result.rows[0] ?? null
      },
    },
  )
}

/** Fresh synthetic seed per attempt: two presses are two jobs unless the ledger replays the digest. */
export function ownerRunSeed(): number {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  const raw = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  return raw % 2 ** 30 + 1
}
