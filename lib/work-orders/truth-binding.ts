/**
 * Truth binding: what a work order is actually working on.
 *
 * `work_order` could not say. It has no projectId, no resource reference and no revision — only
 * `allowedFiles[]` / `forbiddenFiles[]`, which are path strings with no repository, no branch and
 * no SHA. A contract could not express "canonical TerraFusion Project X, repo Y, at SHA Z", so an
 * executor could do genuinely correct work against genuinely the wrong tree and nothing in the
 * record contradicted it. That is a schema gap, not an agent-discipline problem.
 *
 * Two rules make it load-bearing rather than decorative:
 *
 *  1. Binding happens at ACTIVATION, not at acceptance. Binding first at acceptance is too late —
 *     an executor can spend days on the wrong checkout and discover the failed premise only when
 *     it tries to certify. `approved → active` is refused without a binding.
 *
 *  2. Observed identity ≠ bound identity is a FAILED PREMISE, not a partial pass. Every mechanic
 *     can work perfectly against the wrong thing; `PARTIAL` would quietly bless that. A different
 *     repo, branch, worktree, port or runtime is never "close enough".
 *
 * Revision movement — upstream advance, deliberate rebase, or a successor this contract produced —
 * is recorded as an explicit lineage event and never assumed.
 *
 * Everything here is pure so the rules can be tested without a database.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/** How a bound resource participates in the outcome. */
export const BOUND_RESOURCE_ROLES = ["source", "runtime", "data", "reference"] as const
export type BoundResourceRole = (typeof BOUND_RESOURCE_ROLES)[number]

/**
 * Lineage events.
 *  - `bound`     the base binding captured at activation. Exactly one per resource, first.
 *  - `rebound`   the bound revision moved for a reason outside this contract (upstream advance,
 *                deliberate rebase). The premise changed; it was not violated.
 *  - `successor` a revision this contract itself produced.
 */
export const BINDING_EVENTS = ["bound", "rebound", "successor"] as const
export type BindingEvent = (typeof BINDING_EVENTS)[number]

/** Disposition of one acceptance ATTEMPT — not, in general, the fate of the work order. */
export const ACCEPTANCE_DISPOSITIONS = [
  "PASS",
  "FAIL",
  "PARTIAL",
  "PREMISE_FAILED",
] as const
export type AcceptanceDisposition = (typeof ACCEPTANCE_DISPOSITIONS)[number]

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface BoundResourceLike {
  resourceKey: string
  resourceType: string
  canonicalIdentity: string
  role: BoundResourceRole
  /** Snapshot of project_resource.ratifiedAt at binding time. Null means owner-unconfirmed. */
  ratifiedAt: Date | null
}

export interface BindingEventLike {
  resourceKey: string
  event: BindingEvent
  sha: string
  reason?: string | null
  at: Date
}

export interface TruthBindingLike {
  projectId: number
  resources: readonly BoundResourceLike[]
  lineage: readonly BindingEventLike[]
  /** The resource the running application must be served from. */
  runtimeResourceKey?: string | null
}

/* ------------------------------------------------------------------ */
/* Rule 1 — a contract cannot leave `approved` unbound                 */
/* ------------------------------------------------------------------ */

export interface BindingReadiness {
  ready: boolean
  missing: string[]
}

/**
 * Whether a binding is complete enough to activate against.
 *
 * Deliberately strict about `source`: a contract that will change code but cannot say which
 * repository at which revision is the exact contract that produced a celebrated proof against a
 * stale branch on an invented port.
 */
export function checkBindingReadiness(
  binding: TruthBindingLike | null | undefined,
): BindingReadiness {
  const missing: string[] = []
  if (!binding) return { ready: false, missing: ["No truth binding — bind before activation"] }

  if (!Number.isInteger(binding.projectId) || binding.projectId <= 0) {
    missing.push("No canonical Project bound")
  }
  if (binding.resources.length === 0) {
    missing.push("No canonical resources bound")
  }

  for (const r of binding.resources) {
    if (!r.canonicalIdentity?.trim()) {
      missing.push(`Resource ${r.resourceKey} has no canonical identity`)
    }
    // A revision only means something for resources that HAVE revisions.
    if (r.role === "source" && !baseRevision(binding.lineage, r.resourceKey)) {
      missing.push(`Resource ${r.resourceKey} has no bound revision`)
    }
  }

  if (binding.runtimeResourceKey) {
    const known = binding.resources.some((r) => r.resourceKey === binding.runtimeResourceKey)
    if (!known) missing.push(`Runtime ${binding.runtimeResourceKey} is not a bound resource`)
  }

  return { ready: missing.length === 0, missing }
}

/* ------------------------------------------------------------------ */
/* Lineage                                                             */
/* ------------------------------------------------------------------ */

function orderedFor(
  lineage: readonly BindingEventLike[],
  resourceKey: string,
): BindingEventLike[] {
  return lineage
    .filter((e) => e.resourceKey === resourceKey)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
}

/** The revision captured at activation — the base of the lineage. */
export function baseRevision(
  lineage: readonly BindingEventLike[],
  resourceKey: string,
): string | null {
  return orderedFor(lineage, resourceKey).find((e) => e.event === "bound")?.sha ?? null
}

/** The revision the contract is legitimately on now: base plus every recorded movement. */
export function expectedRevision(
  lineage: readonly BindingEventLike[],
  resourceKey: string,
): string | null {
  const events = orderedFor(lineage, resourceKey)
  if (events.length === 0 || events[0].event !== "bound") return null
  return events[events.length - 1].sha
}

/** Every revision this contract has legitimately occupied, oldest first. */
export function revisionLineage(
  lineage: readonly BindingEventLike[],
  resourceKey: string,
): string[] {
  return orderedFor(lineage, resourceKey).map((e) => e.sha)
}

/** The successor revision this contract produced, if it produced one. */
export function successorRevision(
  lineage: readonly BindingEventLike[],
  resourceKey: string,
): string | null {
  const successors = orderedFor(lineage, resourceKey).filter((e) => e.event === "successor")
  return successors.length > 0 ? successors[successors.length - 1].sha : null
}

/** A lineage is well-formed when it starts at exactly one `bound` event and moves forward. */
export function validateLineage(
  lineage: readonly BindingEventLike[],
  resourceKey: string,
): { valid: boolean; problem?: string } {
  const events = orderedFor(lineage, resourceKey)
  if (events.length === 0) return { valid: false, problem: "No lineage recorded" }
  if (events[0].event !== "bound") {
    return { valid: false, problem: "Lineage does not start with a base binding" }
  }
  const extraBase = events.slice(1).filter((e) => e.event === "bound")
  if (extraBase.length > 0) {
    return { valid: false, problem: "More than one base binding recorded" }
  }
  return { valid: true }
}

/* ------------------------------------------------------------------ */
/* Rule 2 — observed vs bound                                          */
/* ------------------------------------------------------------------ */

export interface ObservedBinding {
  projectId?: number | null
  /** resourceKey → the canonical identity actually observed (remote URL, DSN, host…). */
  identities?: Record<string, string>
  /** resourceKey → the revision actually observed. */
  revisions?: Record<string, string>
  /** The resource the running application was actually served from. */
  runtimeResourceKey?: string | null
}

export interface PremiseDivergence {
  resourceKey: string
  field: "project" | "identity" | "revision" | "runtime"
  expected: string
  observed: string
}

export interface PremiseCheck {
  ok: boolean
  divergences: PremiseDivergence[]
  /** Bound resources the owner has never confirmed. Present does not fail; certifying does. */
  unconfirmed: string[]
}

/**
 * Compare what was observed against what was bound.
 *
 * A revision matches if it is anywhere in the recorded lineage: being on the base, on a recorded
 * rebind, or on the successor this contract produced are all legitimate places to be. Being
 * somewhere the lineage never mentions is not.
 */
export function checkPremise(
  binding: TruthBindingLike,
  observed: ObservedBinding,
): PremiseCheck {
  const divergences: PremiseDivergence[] = []

  if (observed.projectId != null && observed.projectId !== binding.projectId) {
    divergences.push({
      resourceKey: "*",
      field: "project",
      expected: String(binding.projectId),
      observed: String(observed.projectId),
    })
  }

  for (const r of binding.resources) {
    const seenIdentity = observed.identities?.[r.resourceKey]
    if (seenIdentity != null && !identityMatches(r.canonicalIdentity, seenIdentity)) {
      divergences.push({
        resourceKey: r.resourceKey,
        field: "identity",
        expected: r.canonicalIdentity,
        observed: seenIdentity,
      })
    }

    const seenRevision = observed.revisions?.[r.resourceKey]
    if (seenRevision != null) {
      const known = revisionLineage(binding.lineage, r.resourceKey)
      if (!known.some((sha) => revisionMatches(sha, seenRevision))) {
        divergences.push({
          resourceKey: r.resourceKey,
          field: "revision",
          expected: expectedRevision(binding.lineage, r.resourceKey) ?? "(unbound)",
          observed: seenRevision,
        })
      }
    }
  }

  if (
    observed.runtimeResourceKey != null &&
    binding.runtimeResourceKey != null &&
    observed.runtimeResourceKey !== binding.runtimeResourceKey
  ) {
    divergences.push({
      resourceKey: binding.runtimeResourceKey,
      field: "runtime",
      expected: binding.runtimeResourceKey,
      observed: observed.runtimeResourceKey,
    })
  }

  return {
    ok: divergences.length === 0,
    divergences,
    unconfirmed: binding.resources.filter((r) => r.ratifiedAt == null).map((r) => r.resourceKey),
  }
}

/** Repository identities differ cosmetically far more often than they differ meaningfully. */
export function identityMatches(expected: string, observed: string): boolean {
  return normaliseIdentity(expected) === normaliseIdentity(observed)
}

function normaliseIdentity(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^git\+/, "")
    .replace(/^ssh:\/\/git@/, "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
}

/** An abbreviated SHA is the same revision as the full one it prefixes. */
export function revisionMatches(expected: string, observed: string): boolean {
  const a = expected.trim().toLowerCase()
  const b = observed.trim().toLowerCase()
  if (!a || !b) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  // Guard against a stray character or two matching by accident.
  if (short.length < 7) return short === long
  return long.startsWith(short)
}

/* ------------------------------------------------------------------ */
/* Disposition                                                         */
/* ------------------------------------------------------------------ */

export interface AttemptInput {
  /** Did the acceptance operations themselves pass? */
  operationsPassed: boolean
  /** Did SOME acceptance paths pass while others did not? */
  partial?: boolean
  premise: PremiseCheck
  /** Whether this verifier is allowed to certify at all (Section 5). */
  verifierIsIndependent?: boolean
}

export interface AttemptOutcome {
  disposition: AcceptanceDisposition
  /** May this attempt close the work order? */
  certifies: boolean
  reason: string
}

/**
 * Turn an acceptance attempt into a disposition.
 *
 * The premise is checked FIRST and on its own. "Every mechanic worked, against the wrong thing" is
 * neither an ordinary FAIL nor a PARTIAL, and reporting it as either is how a stale-branch proof
 * gets celebrated.
 */
export function dispositionFor(input: AttemptInput): AttemptOutcome {
  if (!input.premise.ok) {
    const d = input.premise.divergences[0]
    return {
      disposition: "PREMISE_FAILED",
      certifies: false,
      reason: d
        ? `Bound ${d.field} is ${d.expected}, observed ${d.observed}`
        : "Observed binding does not match the bound truth",
    }
  }

  if (!input.operationsPassed) {
    return input.partial
      ? { disposition: "PARTIAL", certifies: false, reason: "Some acceptance paths did not pass" }
      : { disposition: "FAIL", certifies: false, reason: "Outcome observed false" }
  }

  if (input.premise.unconfirmed.length > 0) {
    // The resource record itself is an agent's draft that the owner has never confirmed. The work
    // may well be right; the ground it stands on is not yet owner-ratified, so it cannot certify.
    return {
      disposition: "PARTIAL",
      certifies: false,
      reason: `Bound resources are unconfirmed: ${input.premise.unconfirmed.join(", ")}`,
    }
  }

  if (input.verifierIsIndependent === false) {
    return {
      disposition: "PARTIAL",
      certifies: false,
      reason: "Implementing agent cannot certify its own outcome",
    }
  }

  return { disposition: "PASS", certifies: true, reason: "Outcome observed true against bound truth" }
}

/**
 * Whether a `PREMISE_FAILED` attempt should end the contract.
 *
 * Normally it must not: the work rebinds and continues. It is terminal only when the outcome
 * itself has become impossible — the bound resource is gone, or the outcome no longer describes
 * anything real.
 */
export function premiseFailureIsTerminal(opts: {
  boundResourceMissing?: boolean
  outcomeNoLongerValid?: boolean
}): boolean {
  return Boolean(opts.boundResourceMissing || opts.outcomeNoLongerValid)
}
