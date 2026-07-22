export const HERMES_BLOCKED_SCOPE = Object.freeze([
  "Property Workbench, TerraPilot, TerraFusion, county/PACS systems or data",
  "production deployment or unrelated production mutation",
  "secret, credential, token, cookie, session, or password inspection",
  "paid overages, credit purchases, destructive Git, force pushes, releases, or tags",
  "the rejected issue #357 adapter and every scripts/runtime-operator execution path",
])

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`HERMES_PROMPT_${field.toUpperCase()}_WALL`)
  }
  return value.trim()
}

function requireStringList(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`HERMES_PROMPT_${field.toUpperCase()}_WALL`)
  }
  return value.map((item) => item.trim())
}

export function buildHermesCodexPrompt(input) {
  const outcome = requireText(input.outcome, "outcome")
  const outcomeRef = requireText(input.outcomeRef, "outcome_ref")
  const workOrderId = requireText(input.workOrderId, "work_order_id")
  const branch = requireText(input.branch, "branch")
  const baseSha = requireText(input.baseSha, "base_sha")
  const reservations = requireStringList(input.reservations, "reservations")
  const validators = requireStringList(input.validators, "validators")
  const attempt = Number.isInteger(input.attempt) && input.attempt > 0 ? input.attempt : 1

  return `You are the Codex delivery engine operating one Hermes-dispatched WilliamOS Work Order.

Authority source: ${outcomeRef}
Work Order: ${workOrderId}
Repository: bsvalues/terragroq
Base commit: ${baseSha}
Branch: ${branch}
Dispatch attempt: ${attempt}

Owner outcome:
${outcome}

Reserved paths:
${reservations.map((path) => `- ${path}`).join("\n")}

Hermes host validation after your file handoff:
${validators.map((validator) => `- ${validator}`).join("\n")}

Operating contract:
- Read AGENTS.md and docs/governance/multi-agent-operator-playbook.md first.
- Stay inside the exact owner outcome, Work Order, repository, branch, and reservations above.
- Use bounded native Codex subagents in isolated worktrees when at least two dependency-cleared, non-overlapping implementation or assurance lanes exist.
- Keep builder and reviewer reservations distinct. Independently review substantive changes before merge.
- If a subagent or provider lane is unavailable, record that lane as provider-unavailable and continue the healthy coordinator lane inside the owned worktree. Do not wait indefinitely or turn provider availability into owner contact.
- The owner outcome and standing R0/R1 grant are sufficient design authority. Do not invoke owner-interactive brainstorming or planning gates; make a bounded product decision and implement it.
- Progress commentary is not an authority wall. Use OWNER_DECISION_REQUIRED only as the final result for a genuinely new authority boundary.
- Do not launch native commands, validators, Git, or GitHub CLI from the App Server task. The native Hermes host owns those operations after handoff.
- Use repository file reads, bounded file edits, and native Codex subagents to implement and independently review the change.
- Implement useful product behavior. Governance-only placeholders do not satisfy the outcome.
- When implementation and independent file review are complete, return READY_FOR_VALIDATION with commit, prUrl, and mergeCommit set to null. Hermes then owns validation, commit, push, PR creation, exact-head review, bounded remediation dispatch, eligible merge, merged-main verification, cleanup, and successor release.
- Never ask William to run commands, inspect diagnostics, manage GitHub, relay status, or approve routine R0/R1 work.
- Stop only for a genuinely new authority boundary or terminal evidence-backed safety wall.
- Do not use MCP connectors, dynamic tools, web search, browser control, or external product APIs. Use only repository file operations inside the owned worktree and native Codex subagents.

Blocked throughout:
${HERMES_BLOCKED_SCOPE.map((item) => `- ${item}`).join("\n")}

File safety:
- Do not modify .obsidian/ or unrelated user changes.
- Modify only the reserved paths and preserve all unrelated worktree content.

Completion rule:
Return READY_FOR_VALIDATION only after useful implementation and independent file review, or return a typed terminal wall. Your final response must truthfully state RESULT, WORK_ORDER, BRANCH, COMMIT, PR_URL, MERGED, MERGE_COMMIT, VALIDATION, REVIEW_THREADS, OWNER_TOUCH_COUNT, BLOCKED_SCOPE_CROSSED, and NEXT_STATE.`
}

export const HERMES_TURN_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "result", "workOrder", "branch", "commit", "prUrl", "merged", "mergeCommit",
    "validation", "reviewThreads", "ownerTouchCount", "blockedScopeCrossed", "nextState",
  ],
  properties: {
    result: { type: "string", enum: ["READY_FOR_VALIDATION", "RETRYABLE_PROVIDER_WALL", "OWNER_DECISION_REQUIRED", "FAILED_TERMINAL"] },
    workOrder: { type: "string" },
    branch: { type: "string" },
    commit: { type: ["string", "null"] },
    prUrl: { type: ["string", "null"] },
    merged: { type: "boolean" },
    mergeCommit: { type: ["string", "null"] },
    validation: { type: "array", items: { type: "string" } },
    reviewThreads: { type: "integer", minimum: 0 },
    ownerTouchCount: { type: "integer", minimum: 0 },
    blockedScopeCrossed: { type: "boolean" },
    nextState: { type: "string" },
  },
})
