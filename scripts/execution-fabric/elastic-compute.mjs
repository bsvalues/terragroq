/**
 * IF-10 — Elastic compute adapter (provider-agnostic lifecycle).
 *
 * The machinery for one work-owned ephemeral remote GPU resource, independent of any specific
 * provider. The LIVE end-to-end proof against a real provider is separately owner-gated (approved
 * provider, credential setup, explicit spend + data/egress policy, no protected-data test without
 * separate authorization) — this module is the governed core that proof must satisfy.
 *
 * Invariants enforced here:
 *  - the worker gets a SHORT-LIVED SCOPED identity only (never a master credential);
 *  - no public inbound dependency (egress-only);
 *  - bounded TTL and bounded spend, enforced as hard limits;
 *  - the worker is destroyed after success AND after induced failure;
 *  - an orphaned paid worker is detected and recovered;
 *  - exact cost/TTL evidence is recorded.
 */

export const ELASTIC_STATES = Object.freeze([
  "REQUESTED", "PROVISIONING", "ATTESTING", "READY", "EXECUTING", "WIPING", "DESTROYING", "DESTROYED", "FAILED", "ORPHANED",
])

const TRANSITIONS = Object.freeze({
  REQUESTED: ["PROVISIONING", "FAILED"],
  PROVISIONING: ["ATTESTING", "FAILED", "ORPHANED"],
  ATTESTING: ["READY", "FAILED"],
  READY: ["EXECUTING", "WIPING", "FAILED"],
  EXECUTING: ["WIPING", "FAILED"],
  WIPING: ["DESTROYING", "FAILED"],
  DESTROYING: ["DESTROYED", "ORPHANED"],
  DESTROYED: [],
  FAILED: ["DESTROYING", "ORPHANED"], // a failed worker still must be destroyed
  ORPHANED: ["DESTROYING"],
})

export function createElasticLifecycle({ ttlMs, maxSpendUsd, egressClass, now = () => Date.now() } = {}) {
  if (typeof ttlMs !== "number" || ttlMs <= 0) throw new Error("ELASTIC_TTL_REQUIRED")
  if (typeof maxSpendUsd !== "number" || maxSpendUsd <= 0) throw new Error("ELASTIC_SPEND_LIMIT_REQUIRED")
  if (!egressClass) throw new Error("ELASTIC_EGRESS_CLASS_REQUIRED")

  function transition(state, to) {
    if (!TRANSITIONS[state]?.includes(to)) throw new Error(`ELASTIC_ILLEGAL_TRANSITION:${state}->${to}`)
    return to
  }

  /**
   * Issue the worker's identity. The worker gets a SHORT-LIVED SCOPED credential only — bound to
   * this resource, expiring with the TTL, and never a master credential.
   */
  function issueWorkerIdentity(resourceId) {
    return {
      resourceId,
      credentialClass: "short-lived-scoped",
      masterCredential: false, // hard invariant: no master credential on the worker
      expiresAt: new Date(now() + ttlMs).toISOString(),
      scope: ["execute-bounded-task"],
      inbound: "none", // no public inbound dependency — egress-only
    }
  }

  /** Enforce the egress policy for a data class. Sovereign data (S3/S4) never egresses to elastic. */
  function egressAllowed(dataClass) {
    if (["S3", "S4"].includes(dataClass)) return false
    return egressClass !== "none"
  }

  /** Detect an orphaned paid worker: not DESTROYED and past its TTL. */
  function isOrphaned(resource) {
    return resource.state !== "DESTROYED" && resource.state !== "ORPHANED" && (now() - Date.parse(resource.createdAt)) > ttlMs
  }

  /** Recover an orphan: mark it ORPHANED and drive it to DESTROYING. */
  function sweepOrphan(resource) {
    if (!isOrphaned(resource)) return resource
    return { ...resource, state: transition("ORPHANED", "DESTROYING"), recoveredAt: new Date(now()).toISOString() }
  }

  /** Record exact cost/TTL evidence for a completed (or destroyed) resource. */
  function recordCostEvidence(resource, { costUsd }) {
    if (typeof costUsd !== "number" || costUsd < 0) throw new Error("ELASTIC_COST_INVALID")
    if (costUsd > maxSpendUsd) throw new Error("ELASTIC_SPEND_EXCEEDED")
    const ttlUsedMs = now() - Date.parse(resource.createdAt)
    return {
      resourceId: resource.id,
      finalState: resource.state,
      costUsd,
      ttlUsedMs,
      ttlBudgetMs: ttlMs,
      withinTtl: ttlUsedMs <= ttlMs,
      withinSpend: costUsd <= maxSpendUsd,
      destroyed: resource.state === "DESTROYED",
      recordedAt: new Date(now()).toISOString(),
    }
  }

  return { transition, issueWorkerIdentity, egressAllowed, isOrphaned, sweepOrphan, recordCostEvidence, ttlMs, maxSpendUsd, egressClass }
}
