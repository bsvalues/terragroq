// Mistake Pattern Registry (MP-001…MP-010) — the recurring failure modes the
// playbook calls out. The classifier matches a goal's text against these so the
// operator is warned BEFORE work starts, not after. Pure data + a matcher.

export type Severity = "warn" | "block"

export interface MistakePattern {
  id: string
  title: string
  description: string
  // Lowercased substrings / regexes that suggest the goal is walking into this trap.
  signals: RegExp[]
  severity: Severity
  // What to do instead.
  guidance: string
}

export const MISTAKE_PATTERNS: MistakePattern[] = [
  {
    id: "MP-001",
    title: "Acting without a work order",
    description: "Executing changes before a scoped, approved work order exists.",
    signals: [/\b(just|quickly|real quick|go ahead and)\b.*\b(change|fix|update|add|delete)\b/],
    severity: "warn",
    guidance: "Draft a work order first. Classify scope, allowed files, and validators before touching code.",
  },
  {
    id: "MP-002",
    title: "Silent scope creep",
    description: "Expanding beyond the stated goal while 'already in there'.",
    signals: [/\b(also|while (i'?m|we'?re) (at it|in there)|and also|might as well)\b/],
    severity: "warn",
    guidance: "Keep the goal atomic. Spin extra ideas into their own goals/work orders.",
  },
  {
    id: "MP-003",
    title: "Destructive op without backup",
    description: "Deletes, drops, truncates, or non-additive migrations without a safeguard.",
    signals: [/\b(drop|truncate|delete all|wipe|reset|rm -rf|force push|--force)\b/],
    severity: "block",
    guidance: "Requires explicit operator approval. Prefer additive changes; test on a branch first.",
  },
  {
    id: "MP-004",
    title: "Touching auth or secrets casually",
    description: "Editing authentication, sessions, or secrets without elevated authority.",
    signals: [/\b(auth|password|secret|token|session|api key|credential)\b/],
    severity: "warn",
    guidance: "Routes to A6 authority. Confirm exactly what changes and why before proceeding.",
  },
  {
    id: "MP-005",
    title: "Release action mid-task",
    description: "Committing, pushing, tagging, or deploying as a side effect.",
    signals: [/\b(commit|push|tag|deploy|release|ship it|merge to main)\b/],
    severity: "warn",
    guidance: "Release is its own gated step (A7–A9). Never bundle it into implementation.",
  },
  {
    id: "MP-006",
    title: "Assuming instead of verifying",
    description: "Believing current state without reading it (stale assumptions).",
    signals: [/\b(should (already|still) (be|work)|i think it'?s|probably (fine|works)|assume)\b/],
    severity: "warn",
    guidance: "Read the Current Truth panel and re-verify before acting.",
  },
  {
    id: "MP-007",
    title: "Bypassing doctrine",
    description: "Proceeding despite a doctrine rule that forbids or gates the action.",
    signals: [/\b(ignore|override|bypass|skip)\b.*\b(rule|doctrine|check|guard|gate)\b/],
    severity: "block",
    guidance: "Doctrine is non-negotiable. If a rule blocks this, the goal is refused.",
  },
  {
    id: "MP-008",
    title: "Phase-6 / production rollout",
    description: "Starting a blocked phase or production rollout prematurely.",
    signals: [/\bphase\s*6\b/, /\bproduction (rollout|deploy|cutover)\b/],
    severity: "block",
    guidance: "Phase 6 is gated. Requires an explicit, separately authorized work order.",
  },
  {
    id: "MP-009",
    title: "No validators / acceptance criteria",
    description: "A change goal with no way to prove it worked.",
    signals: [/\b(no test|skip (the )?test|don'?t bother (testing|verifying))\b/],
    severity: "warn",
    guidance: "Define validators and stop conditions. Unverifiable work cannot be closed.",
  },
  {
    id: "MP-010",
    title: "Irreversible without confirmation",
    description: "One-way doors (data loss, external sends) taken without a confirm step.",
    signals: [/\b(send (the )?email|charge|refund|publish|make (it )?public|irreversible)\b/],
    severity: "warn",
    guidance: "Add an explicit confirmation gate before any one-way action.",
  },
]

export interface MistakeMatch {
  id: string
  title: string
  severity: Severity
  guidance: string
}

// Match a goal command against the registry. Deterministic, case-insensitive.
export function matchMistakePatterns(command: string): MistakeMatch[] {
  const text = command.toLowerCase()
  const matches: MistakeMatch[] = []
  for (const mp of MISTAKE_PATTERNS) {
    if (mp.signals.some((rx) => rx.test(text))) {
      matches.push({ id: mp.id, title: mp.title, severity: mp.severity, guidance: mp.guidance })
    }
  }
  return matches
}
