// The deterministic /goal classifier. Given a raw operator command it returns a
// full classification: lane, mode, risk, required authority, matched mistake
// patterns, a verdict, and the recommended next move. No I/O, no randomness —
// the same input always yields the same output so classification is auditable.

import {
  DEFAULT_AUTHORITY,
  LANE_MAX_AUTHORITY,
  authorityRank,
  type AuthorityId,
  type LaneId,
  type ModeId,
  type RiskLevel,
  type Verdict,
  RISK_LEVELS,
  lane as findLane,
} from "./taxonomy"
import { matchMistakePatterns, type MistakeMatch } from "./mistake-patterns"

export interface Classification {
  command: string
  lane: LaneId
  mode: ModeId
  risk: RiskLevel
  authority: AuthorityId
  verdict: Verdict
  rationale: string
  recommendedMove: string
  requiresApproval: boolean
  mistakePatterns: MistakeMatch[]
}

/* ------------------------------------------------------------------ */
/* Signal tables (ordered — first strong match wins for lane)          */
/* ------------------------------------------------------------------ */

const LANE_SIGNALS: { lane: LaneId; rx: RegExp }[] = [
  { lane: "release", rx: /\b(commit|push|tag|deploy|release|merge to main|ship)\b/ },
  { lane: "auth", rx: /\b(auth|login|password|secret|token|session|permission|access control|credential)\b/ },
  { lane: "schema", rx: /\b(schema|migration|migrate|table|column|index|alter table|drop table)\b/ },
  { lane: "integration", rx: /\b(integration|webhook|third[- ]party|external api|stripe|shopify|api key)\b/ },
  { lane: "write_model", rx: /\b(create|update|insert|save|delete|server action|mutate|write)\b/ },
  { lane: "read_model", rx: /\b(report|dashboard|read|query|list|show|view|verify|inspect|audit)\b/ },
  { lane: "ui", rx: /\b(page|component|button|form|style|css|layout|ui|screen|nav)\b/ },
  { lane: "docs", rx: /\b(doc|docs|documentation|spec|playbook|plan|readme|note|comment)\b/ },
]

const MODE_SIGNALS: { mode: ModeId; rx: RegExp }[] = [
  { mode: "operate", rx: /\b(commit|push|tag|deploy|release)\b/ },
  { mode: "verify", rx: /\b(verify|validate|check|test|confirm|prove)\b/ },
  { mode: "review", rx: /\b(review|assess|audit|evaluate)\b/ },
  { mode: "plan", rx: /\b(plan|design|propose|approach|figure out|how should)\b/ },
  { mode: "draft", rx: /\b(draft|outline|write up|sketch|scaffold)\b/ },
  { mode: "implement", rx: /\b(implement|build|add|create|fix|change|update|refactor|make)\b/ },
  { mode: "inspect", rx: /\b(inspect|look|read|show|explore|understand|investigate|what (is|are|does))\b/ },
]

/* ------------------------------------------------------------------ */
/* Classifier                                                          */
/* ------------------------------------------------------------------ */

function detectLane(text: string): LaneId {
  for (const s of LANE_SIGNALS) if (s.rx.test(text)) return s.lane
  return "read_model" // safest default: assume read-only intent
}

function detectMode(text: string): ModeId {
  for (const s of MODE_SIGNALS) if (s.rx.test(text)) return s.mode
  return "inspect" // safest default
}

// Required authority is the max of (lane ceiling implied by mode) and any
// elevation forced by mistake-pattern signals.
function deriveAuthority(lane: LaneId, mode: ModeId): AuthorityId {
  // Inspect/plan/verify never need more than read-only regardless of lane.
  if (mode === "inspect" || mode === "plan" || mode === "verify" || mode === "review") {
    return DEFAULT_AUTHORITY
  }
  if (mode === "draft") return "A1_DRAFT"
  if (mode === "operate") {
    return lane === "release" ? "A9_RELEASE" : "A7_COMMIT"
  }
  // implement: authority is bounded by the lane's ceiling.
  return LANE_MAX_AUTHORITY[lane]
}

function escalateRisk(base: RiskLevel, by: number): RiskLevel {
  const idx = Math.min(RISK_LEVELS.length - 1, RISK_LEVELS.indexOf(base) + by)
  return RISK_LEVELS[idx]
}

export function classifyGoal(command: string): Classification {
  const text = command.toLowerCase().trim()
  const laneId = detectLane(text)
  const modeId = detectMode(text)
  const laneDef = findLane(laneId)!
  const mistakePatterns = matchMistakePatterns(command)

  const authority = deriveAuthority(laneId, modeId)

  // Risk starts at the lane baseline, escalates per blocking mistake pattern and
  // per authority rank above write-shared.
  const blocking = mistakePatterns.filter((m) => m.severity === "block").length
  const warns = mistakePatterns.filter((m) => m.severity === "warn").length
  let risk = laneDef.baseRisk as RiskLevel
  if (blocking > 0) risk = "critical"
  else if (warns > 0) risk = escalateRisk(risk, 1)
  if (authorityRank(authority) >= 5) risk = escalateRisk(risk, 1)

  // Verdict: refuse on any blocking pattern; require approval above A1; else allow.
  let verdict: Verdict = "allow"
  if (blocking > 0) verdict = "refuse"
  else if (authorityRank(authority) > authorityRank("A1_DRAFT")) verdict = "requires_approval"

  const requiresApproval = verdict === "requires_approval"

  const rationale = buildRationale(laneDef.label, modeId, authority, verdict, mistakePatterns)
  const recommendedMove = buildRecommendedMove(verdict, modeId, mistakePatterns)

  return {
    command,
    lane: laneId,
    mode: modeId,
    risk,
    authority,
    verdict,
    rationale,
    recommendedMove,
    requiresApproval,
    mistakePatterns,
  }
}

function buildRationale(
  laneLabel: string,
  mode: ModeId,
  authority: AuthorityId,
  verdict: Verdict,
  mistakes: MistakeMatch[],
): string {
  const parts = [`Classified as ${laneLabel} work in ${mode} mode, requiring ${authority}.`]
  if (mistakes.length > 0) {
    parts.push(`Matched ${mistakes.length} mistake pattern(s): ${mistakes.map((m) => m.id).join(", ")}.`)
  }
  if (verdict === "refuse") parts.push("A blocking pattern was matched — the goal is refused as stated.")
  else if (verdict === "requires_approval") parts.push("Authority above draft level — explicit operator approval required.")
  else parts.push("Within read/draft authority — safe to proceed under the console's read-only posture.")
  return parts.join(" ")
}

function buildRecommendedMove(verdict: Verdict, mode: ModeId, mistakes: MistakeMatch[]): string {
  if (verdict === "refuse") {
    const block = mistakes.find((m) => m.severity === "block")
    return block ? `Refuse as stated. ${block.guidance}` : "Refuse as stated and reformulate the goal more narrowly."
  }
  if (verdict === "requires_approval") {
    return "Convert to a draft work order, then request explicit operator approval before any execution."
  }
  if (mode === "inspect" || mode === "verify" || mode === "review") {
    return "Run the read-only loop to gather current truth and report findings."
  }
  return "Convert to a draft work order to capture scope, allowed files, and validators."
}
