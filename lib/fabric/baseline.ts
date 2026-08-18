/**
 * The acceptance gate for the management plane, expressed as data rather than as a ritual.
 *
 * The owner's day-one gate is that the plane can actually manage every node: not that it answers a
 * ping, but that it can run a command, see container state, start and stop a service, and move a file
 * both directions with the bytes verified on arrival. Anything less looks like management and is not.
 *
 * It lived as a script someone had to run and then report on, which made the gate's status a claim
 * rather than something the operator could check. These steps are the same six, named so a failure
 * says which capability is missing instead of only that "the baseline failed".
 */

export type BaselineStepId =
  | "reach"
  | "containers"
  | "start"
  | "push"
  | "pull"
  | "stop"

export interface BaselineStep {
  id: BaselineStepId
  label: string
  /** What a failure here actually means for the plane. */
  meaning: string
}

export const BASELINE_STEPS: readonly BaselineStep[] = [
  { id: "reach", label: "Run a command", meaning: "The plane cannot execute anything on this node." },
  { id: "containers", label: "See running workloads", meaning: "The plane is blind to what this node is running." },
  { id: "start", label: "Start a workload", meaning: "The plane can look but cannot act." },
  { id: "push", label: "Send a file (verified)", meaning: "The plane cannot deliver code or config here." },
  { id: "pull", label: "Retrieve a file (verified)", meaning: "The plane cannot collect evidence from this node." },
  { id: "stop", label: "Stop it and clean up", meaning: "The plane can start work it cannot end -- the worst of the three." },
] as const

/**
 * How a node runs work, which decides how the gate proves lifecycle control over it.
 *
 * The steps proved "the plane can start and stop something here" by running a container, because
 * every server node happens to run containers. That silently made a container runtime a requirement
 * of being managed -- so the cockpit laptop, which by design is not a service host, failed a gate for
 * lacking software it was never supposed to need. The capability under test is lifecycle control, not
 * Docker.
 */
export type NodeWorkloads = "containers" | "processes"

export const PROBE_CONTAINER = "fabric-baseline-probe"

export interface BaselineResult {
  node: string
  step: BaselineStepId
  ok: boolean
  detail?: string
  ms: number
}

/** A node passes only if every step passed; a partial pass is a fail with a named cause. */
export function nodePassed(results: BaselineResult[]): boolean {
  return BASELINE_STEPS.every((step) => results.some((r) => r.step === step.id && r.ok))
}

export function firstFailure(results: BaselineResult[]): BaselineResult | null {
  for (const step of BASELINE_STEPS) {
    const found = results.find((r) => r.step === step.id)
    if (!found) return { node: results[0]?.node ?? "?", step: step.id, ok: false, detail: "not attempted", ms: 0 }
    if (!found.ok) return found
  }
  return null
}
