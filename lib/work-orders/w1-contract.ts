/**
 * W1 — the truthful, persistent, usable WilliamOS editable workspace (#1015), expressed as one
 * outcome contract instead of five construction permits.
 *
 * Under the old shape this was heading toward WO-1041 "adjust ResizeObserver", WO-1042 "reset
 * geometry", WO-1043 "test persistence", WO-1044 "inspect project binding", WO-1045 "change root
 * resolver" — five permits, four handoffs, and an owner acting as the router between them. Here it
 * is one envelope: the geometry defect, the corrupted persisted layout, and the Project-binding
 * work are all ordinary implementation, and the one genuinely protected surface becomes a routed
 * dependency rather than a stoppage.
 *
 * Nothing in this file talks to a database or a network. It is the contract and its acceptance
 * sequence as data, so both can be reviewed and tested before anything is live.
 */

import {
  ANY_RESOURCE,
  validateEnvelopeEntry,
  type EnvelopeEntry,
} from "@/lib/work-orders/authority-surface"
import {
  step,
  verifyAcceptance,
  verifyGeometryIntact,
  type AcceptanceReport,
  type AcceptanceStep,
  type GeometryConstraints,
  type WindowGeometry,
} from "@/lib/work-orders/acceptance-verifier"
import type { ObservedBinding, TruthBindingLike } from "@/lib/work-orders/truth-binding"

/* ------------------------------------------------------------------ */
/* Resource keys                                                       */
/* ------------------------------------------------------------------ */

export const W1_SOURCE_RESOURCE = "williamos-primary-repo"
export const W1_RUNTIME_RESOURCE = "williamos-workspace-runtime"

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

export const W1_OUTCOME = `Deliver the truthful, persistent, usable WilliamOS editable workspace defined by #1015. \
Continue autonomously inside the authority envelope until independently verifiable deployed \
acceptance passes; route authority and capability dependencies without stopping independent progress.`

/**
 * The envelope. `source:write` and `delivery:merge` on the bound repository make the diagnosed
 * defects ordinary work. `runtime_config:propose` — deliberately not `write` — is what turns a
 * protected deployment surface into a routed dependency instead of a wall.
 */
export const W1_ENVELOPE: readonly EnvelopeEntry[] = [
  { resourceKey: W1_SOURCE_RESOURCE, surfaceClass: "source", capability: "write" },
  { resourceKey: W1_SOURCE_RESOURCE, surfaceClass: "artifact", capability: "write" },
  { resourceKey: W1_SOURCE_RESOURCE, surfaceClass: "delivery", capability: "merge" },
  { resourceKey: W1_RUNTIME_RESOURCE, surfaceClass: "runtime_control", capability: "observe" },
  { resourceKey: W1_RUNTIME_RESOURCE, surfaceClass: "runtime_config", capability: "propose" },
  { resourceKey: ANY_RESOURCE, surfaceClass: "data", capability: "none" },
  { resourceKey: ANY_RESOURCE, surfaceClass: "secrets", capability: "none" },
  { resourceKey: ANY_RESOURCE, surfaceClass: "external", capability: "none" },
]

/** Protected subtrees. Reservations narrow an envelope; they never constitute one. */
export const W1_RESERVATIONS = ["deploy/**"] as const

/**
 * The defects that are ordinary implementation work inside this contract. Listed so the record
 * shows they were in scope from the start, rather than looking like scope that crept.
 */
export const W1_IN_SCOPE_DEFECTS = [
  "components/workspace-shell/window-frame.tsx ResizeObserver reads contentRect and writes it back as border-box geometry",
  "persisted Space geometry already corrupted to below its CSS minimums",
  "workspace root resolved from a process global rather than the bound Project",
  "/api/loom/files carries no Project or Space identity",
  "the running application is a single global environment URL rather than a Project-derived runtime",
] as const

/** Operations that must be raised as routed dependencies rather than attempted or waited on. */
export const W1_EXPECTED_DEPENDENCIES = [
  {
    operation: "modify protected deployment configuration under deploy/**",
    requiredResource: W1_RUNTIME_RESOURCE,
    requiredClass: "runtime_config" as const,
    requiredCapability: "write",
    blocksAcceptance: true,
  },
] as const

export function validateW1Envelope(): { valid: boolean; problems: string[] } {
  const problems = W1_ENVELOPE.flatMap((e) => validateEnvelopeEntry(e).problems)
  return { valid: problems.length === 0, problems }
}

/* ------------------------------------------------------------------ */
/* Observations                                                        */
/* ------------------------------------------------------------------ */

/** Everything the collector must observe for W1. All of it is machine-observable. */
export interface W1Observations {
  /** The Project the Space actually reports being bound to. */
  spaceProjectId: number | null
  /** The remote of the checkout actually being served. */
  servedRepoRemote: string | null
  /** HEAD of that checkout, observed independently of anything the implementer said. */
  servedHeadSha: string | null
  /** The runtime resource actually serving, and the Project it was admitted from. */
  runtimeResourceKey: string | null
  runtimeAdmittedFromProjectId: number | null

  /** A real file from the bound repository: its path and content before and after the save. */
  mutatedFilePath: string | null
  /** Whether that path resolves inside the checkout that was served, not some other tree. */
  mutatedFileInsideBoundCheckout: boolean
  contentBeforeSave: string | null
  contentAfterSave: string | null
  /** Whether the running application reflected the change. */
  runningProductReflectsChange: boolean

  /** Space geometry before the close, and after the reopen. */
  spaceIdBeforeReopen: string | null
  spaceIdAfterReopen: string | null
  geometryBeforeReopen: readonly WindowGeometry[]
  geometryAfterReopen: readonly WindowGeometry[]
  geometryConstraints: GeometryConstraints
}

/* ------------------------------------------------------------------ */
/* The acceptance sequence                                             */
/* ------------------------------------------------------------------ */

/**
 * open → real file from the bound repository → modify and save → the running application reflects
 * the change → close and reopen → the same Space returns with geometry intact.
 *
 * Identity, revision and runtime are NOT steps here. They are premise, checked before any of this
 * runs, because a green sequence against the wrong tree is worse than a red one.
 */
export const W1_ACCEPTANCE_STEPS: readonly AcceptanceStep<W1Observations>[] = [
  {
    name: "space is bound to the canonical Project",
    run: (o) =>
      step(
        "space is bound to the canonical Project",
        o.spaceProjectId != null,
        `spaceProjectId=${o.spaceProjectId ?? "none"}`,
        "The Space reports no Project — it is a workspace by configuration, not by construction",
      ),
  },
  {
    name: "opened file belongs to the bound repository",
    run: (o) =>
      step(
        "opened file belongs to the bound repository",
        Boolean(o.mutatedFilePath) && o.mutatedFileInsideBoundCheckout,
        `${o.mutatedFilePath ?? "(no file)"} inside=${o.mutatedFileInsideBoundCheckout}`,
        "The edited file did not resolve inside the checkout that was actually served",
      ),
  },
  {
    name: "save changed the file on disk",
    run: (o) =>
      step(
        "save changed the file on disk",
        o.contentBeforeSave != null &&
          o.contentAfterSave != null &&
          o.contentBeforeSave !== o.contentAfterSave,
        o.contentBeforeSave === o.contentAfterSave ? "unchanged" : "changed",
        "The editor reported a save that did not alter the file",
      ),
  },
  {
    name: "running application reflects the change",
    run: (o) =>
      step(
        "running application reflects the change",
        o.runningProductReflectsChange,
        String(o.runningProductReflectsChange),
        "The change did not reach the running product — an editor over a directory is not a workspace",
      ),
  },
  {
    name: "reopen returns the same Space",
    run: (o) =>
      step(
        "reopen returns the same Space",
        o.spaceIdBeforeReopen != null && o.spaceIdBeforeReopen === o.spaceIdAfterReopen,
        `${o.spaceIdBeforeReopen ?? "none"} → ${o.spaceIdAfterReopen ?? "none"}`,
        "A different Space came back, so persistence is not identity-stable",
      ),
  },
  {
    name: "window geometry survives reopen",
    run: (o) => {
      const verdict = verifyGeometryIntact(
        o.geometryBeforeReopen,
        o.geometryAfterReopen,
        o.geometryConstraints,
      )
      return step(
        "window geometry survives reopen",
        verdict.intact,
        verdict.intact
          ? `${o.geometryAfterReopen.length} window(s) intact`
          : verdict.problems.join("; "),
        verdict.problems[0],
      )
    },
  },
]

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** Express W1's observations as a binding observation, for the premise check. */
export function w1ObservedBinding(o: W1Observations): ObservedBinding {
  return {
    projectId: o.spaceProjectId,
    identities: o.servedRepoRemote ? { [W1_SOURCE_RESOURCE]: o.servedRepoRemote } : {},
    revisions: o.servedHeadSha ? { [W1_SOURCE_RESOURCE]: o.servedHeadSha } : {},
    runtimeResourceKey: o.runtimeResourceKey,
  }
}

/**
 * Verify W1 against its binding.
 *
 * A runtime serving from a different Project is a premise failure even when everything else works,
 * which is the case the deployed workspace actually hit: real editor mechanics, real saves, real
 * HMR — against a stale branch on an invented port.
 */
export function verifyW1(
  binding: TruthBindingLike,
  observations: W1Observations,
): AcceptanceReport {
  const observed = w1ObservedBinding(observations)

  // The runtime must derive from the bound Project. This is premise, not a step: a runtime admitted
  // from somewhere else is serving a different world, and every operation below would be measuring
  // that world instead.
  if (
    observations.runtimeAdmittedFromProjectId != null &&
    observations.runtimeAdmittedFromProjectId !== binding.projectId
  ) {
    return {
      disposition: "PREMISE_FAILED",
      certifies: false,
      reason:
        `Runtime was admitted from project ${observations.runtimeAdmittedFromProjectId}, ` +
        `but the contract is bound to project ${binding.projectId}`,
      divergences: [
        {
          resourceKey: W1_RUNTIME_RESOURCE,
          field: "runtime",
          expected: `project ${binding.projectId}`,
          observed: `project ${observations.runtimeAdmittedFromProjectId}`,
        },
      ],
      steps: [],
      unconfirmedResources: binding.resources
        .filter((r) => r.ratifiedAt == null)
        .map((r) => r.resourceKey),
    }
  }

  return verifyAcceptance({
    binding,
    observedBinding: observed,
    observations,
    steps: W1_ACCEPTANCE_STEPS,
  })
}
