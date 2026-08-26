/**
 * The deterministic acceptance verifier.
 *
 * Certification has to come from something other than the implementing agent's account of itself.
 * The cheap way to get that is to demand a second agent, and it is the wrong way: requiring another
 * worker to click Save in order to satisfy procedure is the handoff disease, not independence.
 * Independence is a property of the EVIDENCE. A verifier that observes the system — the remote of
 * the checkout being served, the SHA at HEAD, the bytes on disk, the geometry that came back after
 * a reopen — is independent by construction, and is the default path.
 *
 * Two things make this more than a test runner:
 *
 *  1. The premise is checked FIRST and short-circuits. Every operation in an acceptance sequence
 *     can pass against the wrong repository at the wrong revision; running them first and reporting
 *     "7/7 passed" is exactly how a stale-branch proof gets celebrated. If the observed binding
 *     diverges the run stops at `PREMISE_FAILED` and no operation result is reported as evidence
 *     of anything.
 *
 *  2. Observations are data, supplied by a collector. The verifier itself performs no I/O, so its
 *     judgement can be tested against observations that would be expensive or destructive to
 *     produce for real — a corrupted Space, a runtime serving the wrong Project, a checkout
 *     thirteen commits behind.
 */

import {
  checkPremise,
  dispositionFor,
  type AcceptanceDisposition,
  type ObservedBinding,
  type PremiseDivergence,
  type TruthBindingLike,
} from "@/lib/work-orders/truth-binding"

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

export interface AcceptanceStepResult {
  step: string
  passed: boolean
  /** What was actually observed, in a form a human can read in the record. */
  observed: string
  /** Why it failed, when it failed. */
  detail?: string
}

export interface AcceptanceReport {
  disposition: AcceptanceDisposition
  certifies: boolean
  reason: string
  /** Divergences between observed and bound truth. Non-empty implies PREMISE_FAILED. */
  divergences: PremiseDivergence[]
  /** Empty when the premise failed — operations are not evidence of anything on the wrong ground. */
  steps: AcceptanceStepResult[]
  unconfirmedResources: string[]
}

/** One acceptance operation: a name and a decision over the observations. */
export interface AcceptanceStep<O> {
  name: string
  run: (observations: O) => AcceptanceStepResult
}

export interface VerifyInput<O> {
  binding: TruthBindingLike
  /** What the collector actually saw, expressed in binding terms. */
  observedBinding: ObservedBinding
  /** Everything else the sequence needs to judge. */
  observations: O
  steps: readonly AcceptanceStep<O>[]
}

/* ------------------------------------------------------------------ */
/* Verify                                                              */
/* ------------------------------------------------------------------ */

/**
 * Run an acceptance sequence against a bound truth.
 *
 * The verifier is always independent — it reads the system, not a report — so `certifies` is
 * decided purely by the premise, the operations, and whether the bound resources are owner-ratified.
 */
export function verifyAcceptance<O>(input: VerifyInput<O>): AcceptanceReport {
  const premise = checkPremise(input.binding, input.observedBinding)

  // Short-circuit. Running the sequence anyway would produce a list of green steps that mean
  // nothing, and someone would quote them.
  if (!premise.ok) {
    const outcome = dispositionFor({ operationsPassed: false, premise })
    return {
      disposition: outcome.disposition,
      certifies: false,
      reason: outcome.reason,
      divergences: premise.divergences,
      steps: [],
      unconfirmedResources: premise.unconfirmed,
    }
  }

  const steps = input.steps.map((s) => {
    try {
      return s.run(input.observations)
    } catch (err) {
      return {
        step: s.name,
        passed: false,
        observed: "(threw)",
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  })

  const passedCount = steps.filter((s) => s.passed).length
  const operationsPassed = steps.length > 0 && passedCount === steps.length
  const partial = passedCount > 0 && passedCount < steps.length

  const outcome = dispositionFor({
    operationsPassed,
    partial,
    premise,
    verifierIsIndependent: true,
  })

  return {
    disposition: outcome.disposition,
    certifies: outcome.certifies,
    reason:
      outcome.disposition === "PASS"
        ? outcome.reason
        : `${outcome.reason}: ${steps
            .filter((s) => !s.passed)
            .map((s) => s.step)
            .join(", ")}`,
    divergences: [],
    steps,
    unconfirmedResources: premise.unconfirmed,
  }
}

/* ------------------------------------------------------------------ */
/* Step helpers                                                        */
/* ------------------------------------------------------------------ */

export function step(
  name: string,
  passed: boolean,
  observed: string,
  detail?: string,
): AcceptanceStepResult {
  return detail && !passed ? { step: name, passed, observed, detail } : { step: name, passed, observed }
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export interface WindowGeometry {
  id: string
  width: number
  height: number
}

export interface GeometryConstraints {
  minWidth: number
  minHeight: number
}

export interface GeometryVerdict {
  intact: boolean
  problems: string[]
}

/**
 * Whether window geometry survived a close/reopen cycle.
 *
 * This is written against a specific, diagnosed defect rather than a general notion of tidiness.
 * `window-frame.tsx` reads `entry.contentRect` from a `ResizeObserver` and writes it back as the
 * window's geometry. The window is `box-sizing: border-box` with a 1px border, so `contentRect` is
 * exactly 2px smaller than the rendered box, and the guard `Math.abs(delta) < 2` is off by one —
 * the delta is *exactly* 2, so it never absorbs it. Each cycle sheds 2px per axis and persists it,
 * until CSS minimums stop the shrink and the stored geometry sits 2px BELOW them.
 *
 * So the two signatures are: geometry that shrank across a reopen, and geometry persisted below
 * the minimums the CSS enforces. The second is the fingerprint — a value below the minimum cannot
 * have been produced by anything measuring the same box the constraints apply to.
 */
export function verifyGeometryIntact(
  before: readonly WindowGeometry[],
  after: readonly WindowGeometry[],
  constraints: GeometryConstraints,
): GeometryVerdict {
  const problems: string[] = []
  const byId = new Map(after.map((w) => [w.id, w]))

  for (const b of before) {
    const a = byId.get(b.id)
    if (!a) {
      problems.push(`Window ${b.id} did not return after reopen`)
      continue
    }
    if (a.width < b.width || a.height < b.height) {
      problems.push(
        `Window ${b.id} shrank across reopen: ${b.width}x${b.height} → ${a.width}x${a.height}`,
      )
    }
    if (a.width < constraints.minWidth || a.height < constraints.minHeight) {
      problems.push(
        `Window ${b.id} persisted below its CSS minimum: ${a.width}x${a.height} < ` +
          `${constraints.minWidth}x${constraints.minHeight} — the border-box measurement defect`,
      )
    }
  }

  return { intact: problems.length === 0, problems }
}
