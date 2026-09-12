/**
 * Capability inventory surface — the owner-visible view of the SAME registry that dispatch enforces.
 *
 * Why this exists (AC-12 acceptance, 2026-09-12): the five COMPUTE_CAPABILITY records govern real
 * GPU placements on DAEDALUS, and the dispatch seam consults them on every job, but nothing the
 * owner can see serialized them. The estate's own failure pattern is "measured ✅ enforcement ✅
 * visible nowhere ❌" — this closes that row. The doctrine is the inverse of the old defect: no
 * second registry, no status cache, no duplicated thresholds. The route loads the literal modules
 * dispatch loads (components/operator/multi-agent-capability-registry.ts, the reviewed adapter),
 * evaluates the SAME pure functions, and shows what they say, including the live device health and
 * the live evidence state. If the registry and this surface could ever disagree, the surface is
 * wrong by construction of this file — it contains no inventory of its own.
 */

import path from "node:path"
import { pathToFileURL } from "node:url"

import type {
  CapabilityStatus,
  ExecutionClass,
  MultiAgentCapabilityRecord,
} from "@/components/operator/multi-agent-capability-registry"

export type CapabilityEvidenceState =
  | { state: "VALID"; finishedAt: string | null; digest: string }
  | { state: string; detail: string | null; ageDays: number | null }

export type CapabilitySurfaceRow = {
  capabilityId: string
  label: string
  status: CapabilityStatus
  executionClass: ExecutionClass
  runtimeReality: string
  claim: string
  reasonCode: string
  dispatch: { allowed: boolean; reasonCode: string }
  evidenceState: CapabilityEvidenceState
  thresholdRows: number | null
  thresholdIsAtMeasurementFloor: boolean | null
  binding: { nodeId: string; device: string; observed: string | null; matchesReview: boolean | null; healthy: boolean; queriedAt: string; detail: string }
  placementProbe: { workload: string; rows: number; placement: string; reasonCode: string } | null
  restrictions: string[]
  evidenceRefs: string[]
}

export const COMPUTE_CAPABILITY_WORKLOADS: Readonly<Record<string, string>> = Object.freeze({
  "gpu-tabular-ml": "regression",
  "gpu-clustering": "clustering",
  "gpu-aggregation": "aggregation",
  "gpu-anomaly-screening": "outlier",
  "gpu-dimensional-reduction": "decomposition",
})

async function loadSameModulesAsDispatch(root = process.cwd()) {
  const [registry, adapter, dispatch] = await Promise.all([
    import(pathToFileURL(path.resolve(root, "components/operator/multi-agent-capability-registry.ts")).href),
    import(pathToFileURL(path.resolve(root, "scripts/execution-fabric/gpu-tabular-capability.mjs")).href),
    import(pathToFileURL(path.resolve(root, "scripts/execution-fabric/gpu-tabular-dispatch.mjs")).href),
  ])
  return { registry, adapter, dispatch }
}

/**
 * One probe of the live source of truth: registry records (identity, eligibility, reason), the
 * measured curve read through the reviewed loader (threshold + evidence state), the device probed
 * through the dispatch transport (health), and the representative placement computed through the
 * exact preflight dispatch runs. `probe` and `deps` are injectable for tests; production passes
 * nothing extra and every value comes from the real system.
 */
export async function projectComputeCapabilities({
  root = process.cwd(),
  probe = null as (() => Promise<Record<string, unknown>>) | null,
  deps = null as Awaited<ReturnType<typeof loadSameModulesAsDispatch>> | null,
  now = new Date(),
}: {
  root?: string
  probe?: (() => Promise<Record<string, unknown>>) | null
  deps?: Awaited<ReturnType<typeof loadSameModulesAsDispatch>> | null
  now?: Date
} = {}) {
  const { registry, adapter, dispatch } = deps ?? (await loadSameModulesAsDispatch(root))
  const health = probe
    ? await probe()
    : await dispatch.probeBinding({ computeNode: "daedalus", timeoutMs: 25_000 })
  const curvePath = path.resolve(root,
    "scripts/execution-fabric/gpu-tabular-bench/evidence/placement-curve.json")
  // Same expression the dispatch seam uses for its own evidence load (gpu-tabular-dispatch.mjs:52),
  // so an operator-set WILLIAMOS_GPU_TABULAR_EVIDENCE_TTL_DAYS moves the banner and the placement
  // rows together. The independent review named a banner-only default as drift; this closes it.
  const evidenceTtlDays = Number(process.env.WILLIAMOS_GPU_TABULAR_EVIDENCE_TTL_DAYS ?? 90)
  const evidence = adapter.loadPlacementEvidence(curvePath, { now, maxAgeDays: evidenceTtlDays })
  const identity = adapter.providerIdentity()

  const capabilities: CapabilitySurfaceRow[] = await Promise.all(
    (registry.MULTI_AGENT_CAPABILITY_INVENTORY as readonly MultiAgentCapabilityRecord[])
      .filter((entry) => entry.kind === "COMPUTE_CAPABILITY")
      .map(async (entry): Promise<CapabilitySurfaceRow> => {
        const decision = registry.evaluateCapabilityDispatch(entry)
        const workload = COMPUTE_CAPABILITY_WORKLOADS[entry.capabilityId] ?? null
        // Representative placement: the same preflight the real dispatch runs, with the same
        // registry gate and the same trust inputs. Authority is the real reviewed grant refs —
        // present iff dispatch would find them. Rows at the threshold boundary where meaningful.
        const threshold = evidence.ok && workload
          ? adapter.thresholdRowsFor(workload, evidence)
          : null
        const rowsForProbe = Number.isFinite(threshold) ? threshold + 1 : 60_000
        const placement = workload
          ? await dispatch.preflightPlacement(
            {
              workload,
              rows: rowsForProbe,
              workOrder: { allowedFiles: ["scripts/execution-fabric"] },
              grant: decision.allowed
                ? { allowedActions: ["scripts/execution-fabric"] }
                : null,
            },
            {
              registry, adapter, health,
              curvePath, now,
            },
          )
          : null
        return {
          capabilityId: entry.capabilityId,
          label: entry.label,
          status: entry.status,
          executionClass: entry.executionClass,
          runtimeReality: entry.runtimeReality,
          claim: entry.claim,
          reasonCode: entry.reasonCode,
          dispatch: {
            allowed: decision.allowed,
            reasonCode: decision.reasonCode,
          },
          evidenceState: !workload || !adapter.TABULAR_WORKLOAD_CLASSES?.[workload]?.thresholdKey
            // The curve's validity is evidence for ROW-GATED capabilities only: the adapter decides
            // screening and measured-refusal rows before it ever consults the curve, so stamping
            // those rows "evidence valid" would credit an artifact their decision does not read.
            // Their measured basis is the typed reason plus the registry's own evidence refs.
            ? { state: "DECISION_INDEPENDENT_OF_CURVE", detail: "not curve-gated; see reason and evidence refs", ageDays: null }
            : evidence.ok
              ? { state: "VALID", finishedAt: evidence.finishedAt, digest: evidence.digest }
              : { state: evidence.reasonCode, detail: evidence.detail ?? null, ageDays: evidence.ageDays ?? null },
          thresholdRows: Number.isFinite(threshold) ? threshold : null,
          thresholdIsAtMeasurementFloor: evidence.ok && workload
            ? (evidence.thresholds?.[workload]?.thresholdIsAtMeasurementFloor ?? null)
            : null,
          binding: {
            nodeId: identity.nodeId,
            // The reviewed binding is what dispatch gates on (adapter/providerIdentity), but the
            // LIVE observation must sit beside it: after a driver or RAPIDS upgrade the health
            // probe can still pass while the machine drifts from what was measured. A "live" label
            // hiding reviewed constants would be a stale banner wearing a timestamp.
            device: `${identity.device.model} · reviewed cuml ${identity.runtime.cuml}/CUDA ${identity.runtime.cudaRuntime}`,
            observed: health?.deviceQuerySucceeded
              ? `cuml ${health.cumlVersion ?? "?"} · cudf ${health.cudfVersion ?? "?"}`
              : null,
            matchesReview: health?.deviceQuerySucceeded === true
              ? health.cumlVersion === identity.runtime.cuml && health.cudfVersion === identity.runtime.cudf
              : null,
            healthy: health?.deviceHealthy === true,
            queriedAt: new Date().toISOString(),
            detail: health?.deviceQuerySucceeded
              ? "live probe through the dispatch transport"
              : health?.probeError ?? "probe did not succeed: reported unhealthy, never assumed",
          },
          placementProbe: placement
            ? {
              workload, rows: rowsForProbe,
              placement: placement.placement, reasonCode: placement.reasonCode,
            }
            : null,
          restrictions: [...entry.restrictions],
          evidenceRefs: [...entry.evidence],
        }
      }),
  )

  return {
    // The surface's own identity: which source produced it. Same file dispatch reads.
    source: "components/operator/multi-agent-capability-registry.ts (same module dispatch imports)",
    capabilities,
  } satisfies { source: string; capabilities: CapabilitySurfaceRow[] }
}
