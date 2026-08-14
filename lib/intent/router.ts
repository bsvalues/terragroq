export type UniversalIntent =
  | "answer"
  | "research"
  | "council"
  | "outcome"
  | "execution"
  | "navigation"

export type IntentRouteState = "routed" | "authority_required" | "clarification_required"

export type IntentDestination = {
  href: string
  action: "respond" | "research" | "council_review" | "draft_outcome" | "request_execution" | "navigate"
}

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

const SIGNALS: Readonly<Record<Exclude<UniversalIntent, "navigation">, readonly RegExp[]>> = {
  answer: [/\banswer\b/i, /\bexplain\b/i, /\bsummar(?:ize|ise)\b/i, /\bwhat\b/i, /\bwhy\b/i, /\bhow\b/i],
  research: [/\bresearch\b/i, /\binvestigate\b/i, /\bfind out\b/i, /\bstudy\b/i],
  council: [/\bcouncil\b/i, /\bdeliberat(?:e|ion)\b/i, /\bmultiple perspectives\b/i],
  outcome: [/\boutcome\b/i, /\bgoal\b/i, /\bobjective\b/i],
  execution: [
    /\bexecute\b/i,
    /\brun\b/i,
    /\bdeploy\b/i,
    /\brestart\b/i,
    /\bmerge\b/i,
    /\bdelete\b/i,
    /\bapply\b/i,
    /\binstall\b/i,
  ],
}

const DESTINATIONS: Readonly<Record<Exclude<UniversalIntent, "navigation">, IntentDestination>> = {
  answer: { href: "/chat", action: "respond" },
  research: { href: "/brain-council", action: "research" },
  council: { href: "/brain-council", action: "council_review" },
  outcome: { href: "/goal-console", action: "draft_outcome" },
  execution: { href: "/work-orders", action: "request_execution" },
}

const NAVIGATION_TARGETS: Readonly<Record<string, string>> = {
  home: "/",
  projects: "/projects",
  activity: "/activity",
  system: "/runtime",
  runtime: "/runtime",
  chat: "/chat",
  "work orders": "/work-orders",
  "goal console": "/goal-console",
  "brain council": "/brain-council",
}

function navigationDestination(input: string): IntentDestination | null {
  if (!hasNavigationSignal(input)) return null

  const targets = Object.entries(NAVIGATION_TARGETS).filter(([label]) =>
    new RegExp(`\\b${label.replace(" ", "\\s+")}\\b`, "i").test(input),
  )

  if (targets.length !== 1) return null
  return { href: targets[0][1], action: "navigate" }
}

function hasNavigationSignal(input: string): boolean {
  return /\b(?:open|show|visit|navigate to|go to)\b/i.test(input)
}

function withoutKnownNavigationPhrase(input: string): string {
  const labels = Object.keys(NAVIGATION_TARGETS)
    .sort((left, right) => right.length - left.length)
    .map((label) => label.replace(" ", "\\s+"))
    .join("|")

  return input.replace(
    new RegExp(`\\b(?:open|show|visit|navigate\\s+to|go\\s+to)\\s+(?:${labels})\\b`, "i"),
    "",
  )
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
