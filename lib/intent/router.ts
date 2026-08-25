import {
  DESTINATIONS,
  SIGNALS,
  type IntentDestination,
  type ObjectActionKind,
  type UniversalIntent,
} from "@/lib/intent/object-action-registry"
import { matchWorkbenchNavigationTarget } from "@/lib/intent/workbench-action-registry"
import { isIssue911ReliabilityOutcomeIntent } from "@/lib/workbench/registered-outcome-intent"

/**
 * Intent routing. A consumer of the registry now, not a second one.
 *
 * Revision 1 of the collision map called this "a consumer of the registry" and was wrong: it owned
 * `SIGNALS` (its own regex classification catalogue), `DESTINATIONS` (intent to `{href, action}`),
 * and the action-kind union itself, while consuming `matchWorkbenchNavigationTarget` for the
 * navigation case only. Two static catalogues, two owners, one concept -- §5.3.
 *
 * All three moved to `object-action-registry.ts` at Gate 2 and are imported here. What stays is the
 * routing DECISION: classify the input, refuse when more than one contract matches, and route
 * execution as a request rather than as an execution. That is a policy, not a catalogue.
 *
 * The no-authority guarantee this file shipped is unchanged and is now structural: `executionAuthorized`
 * and `authority.granted` are typed `false` in the registry's resolution type, so a caller cannot set
 * one without changing a type.
 */

export type { UniversalIntent, IntentDestination }

export type IntentRouteState = "routed" | "authority_required" | "clarification_required"

export type UniversalIntentRoute = {
  state: IntentRouteState
  intent: UniversalIntent | null
  destination: IntentDestination | null
  executionAuthorized: false
  authority: {
    required: boolean
    granted: false
  }
  reason: string
}

/** Re-exported so a caller can name a kind without reaching past this module into the registry. */
export type IntentActionKind = ObjectActionKind

function navigationDestination(input: string): IntentDestination | null {
  if (!hasNavigationSignal(input)) return null
  const target = matchWorkbenchNavigationTarget(input)
  return target ? { href: target.action.href, action: "navigate" } : null
}

function hasNavigationSignal(input: string): boolean {
  return /\b(?:open|show|visit|navigate to|go to)\b/i.test(input)
}

function withoutKnownNavigationPhrase(input: string): string {
  const target = matchWorkbenchNavigationTarget(input)
  if (!target) return input
  return input.replace(new RegExp(`\\b(?:open|show|visit|navigate\\s+to|go\\s+to)\\s+${target.phrase.replaceAll(" ", "\\s+")}\\b`, "i"), "")
}

function clarification(reason: string): UniversalIntentRoute {
  return {
    state: "clarification_required",
    intent: null,
    destination: null,
    executionAuthorized: false,
    authority: { required: false, granted: false },
    reason,
  }
}

export function routeUniversalIntent(rawInput: string): UniversalIntentRoute {
  const input = rawInput.trim()
  if (!input) return clarification("No intent was provided.")

  if (isIssue911ReliabilityOutcomeIntent(input)) {
    return {
      state: "routed",
      intent: "outcome",
      destination: DESTINATIONS.outcome,
      executionAuthorized: false,
      authority: { required: false, granted: false },
      reason: "A single deterministic intent contract matched.",
    }
  }

  const navigation = navigationDestination(input)
  const semanticInput = navigation ? withoutKnownNavigationPhrase(input) : input
  const matched: UniversalIntent[] = (Object.entries(SIGNALS) as [
    Exclude<UniversalIntent, "navigation">,
    readonly RegExp[],
  ][])
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(semanticInput)))
    .map(([intent]) => intent)

  if (hasNavigationSignal(input)) matched.push("navigation")

  if (matched.length !== 1) {
    return clarification(
      matched.length === 0
        ? "No deterministic intent contract matched."
        : "Multiple intent contracts matched; no action was selected.",
    )
  }

  const intent = matched[0]
  const destination = intent === "navigation" ? navigation : DESTINATIONS[intent]

  if (!destination) return clarification("The requested navigation target is not a known cockpit destination.")

  const requiresAuthority = intent === "execution"
  return {
    state: requiresAuthority ? "authority_required" : "routed",
    intent,
    destination,
    executionAuthorized: false,
    authority: { required: requiresAuthority, granted: false },
    reason: requiresAuthority
      ? "Execution is a routed request only and requires separately recorded authority."
      : "A single deterministic intent contract matched.",
  }
}
