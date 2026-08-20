/**
 * Worker lanes and selection policy (WO-0028, GRANT-0014).
 *
 * HERMES is indispensable; individual providers are disposable. Tonight proved the inverse was true in
 * practice: dispatch had one useful implementation provider, so one exhausted Codex meter stalled
 * development. Selection is now policy over a roster of approved lanes, and provider exhaustion
 * reroutes when another approved lane can satisfy the work order -- parking as a typed timed wait only
 * when nothing capable remains.
 *
 * The roster is honest about capability. The resident local lane (Hermes Agent + sovereign model) is
 * declared but not yet proven for repository implementation, so it reports itself ineligible for that
 * capability rather than pretending. A roster that lies about capability is a stall with extra steps.
 */

export const IMPLEMENTATION = "implementation"

/**
 * The approved lanes, in the order policy prefers them when the assigned lane cannot serve.
 *
 * `unavailableUntil` comes from the status the dispatcher persists when a lane declares its own limit;
 * a lane with a future timestamp is skipped without being contacted -- no hammering a known-empty meter.
 */
export function laneRoster() {
  return [
    {
      id: "codex",
      capabilities: [IMPLEMENTATION],
      binary: "codex",
    },
    {
      id: "claude",
      capabilities: [IMPLEMENTATION],
      binary: "claude",
    },
    {
      // Declared, and honestly not yet eligible for repository implementation: SEA's bounded local
      // worker has its own acceptance record but has not been proven against this kernel's walls.
      // Registered so the roster states the truth -- three lanes, one not yet capable here.
      id: "hermes-local",
      capabilities: [],
      binary: null,
    },
  ]
}

/**
 * Choose the lane for a work order.
 *
 * The work order's `agent` is the assigned preference -- the lane the owner or intake named. If it is
 * available it is used. If it is exhausted or missing, any other approved lane with the required
 * capability serves instead, and the reroute carries its reason so the audit says why the work went
 * where it went. Only when no capable lane remains does this return a wait, with the soonest time any
 * capable lane says it becomes available again.
 */
export function selectLane({ assigned, roster, status = {}, capability = IMPLEMENTATION, now = Date.now() }) {
  const capable = roster.filter((lane) => lane.capabilities.includes(capability))
  if (capable.length === 0) {
    return { wait: true, reason: "NO_CAPABLE_LANE", retryAfterMs: null }
  }
  const availability = (lane) => {
    const until = status[lane.id]?.unavailableUntil ? Date.parse(status[lane.id].unavailableUntil) : null
    return until !== null && until > now ? until : null
  }
  const ordered = [
    ...capable.filter((lane) => lane.id === assigned),
    ...capable.filter((lane) => lane.id !== assigned),
  ]
  for (const lane of ordered) {
    const until = availability(lane)
    if (until === null) {
      return {
        wait: false,
        lane,
        rerouted: lane.id !== assigned,
        reason: lane.id === assigned
          ? "ASSIGNED_LANE_AVAILABLE"
          : `ASSIGNED_LANE_UNAVAILABLE:${assigned ?? "none"}`,
      }
    }
  }
  const soonest = Math.min(...ordered.map((lane) => availability(lane)).filter((until) => until !== null))
  return { wait: true, reason: "ALL_CAPABLE_LANES_EXHAUSTED", retryAfterMs: soonest }
}

/** The bounded prompt every implementation lane receives; the lane must not change the contract. */
export function buildWorkerPrompt({ workOrderId, task, allowedPaths, remediation, feedback }) {
  return [
    `You are a bounded WilliamOS worker completing ${workOrderId}.`,
    ``,
    `Task:`,
    task,
    ``,
    `Hard boundary: change ONLY these paths (a trailing /** means the subtree):`,
    ...allowedPaths.map((allowed) => `  - ${allowed}`),
    ``,
    `Rules: edit files in place. Do not commit, stage, branch, push, or touch git config.`,
    // The patch wall refuses credential-shaped lines and cannot tell a placeholder from a live secret
    // -- correctly, since guessing is how a scanner misses the real one. It is a verdict, not a review
    // round, so one such line in a fixture costs the whole run. Cheaper to say so up front than to
    // relax the wall, which is not on offer.
    // Deliberately described rather than demonstrated: a worker that copies this warning into a
    // comment must not thereby trip the wall the warning is about.
    `Never write credential-shaped text, not even as a placeholder and not even in a test. That means`,
    `no database connection URLs carrying a user and password, no strings beginning with a provider`,
    `key prefix, no private key header lines, and no name assigned a quoted value of twelve characters`,
    `or more where the name is password, token, api key, or client secret. A patch containing one is`,
    `refused outright. Use an obviously fake short stub instead.`,
    `Do not run shell commands. Do not create files outside the boundary.`,
    `Keep the change minimal and covered by a test.`,
    remediation
      ? `\nUntrusted review feedback; address only actionable items inside the boundary:\n${String(feedback ?? "").slice(0, 8000)}` +
        `
If .williamos/validation-feedback.txt exists in the working directory, read it first: it contains the failing gate's actual output.`
      : ``,
  ].join("\n")
}
