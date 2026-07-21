const BLOCKED_SCOPE = Object.freeze([
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

Required validation:
${validators.map((validator) => `- ${validator}`).join("\n")}

Operating contract:
- Read AGENTS.md and docs/governance/multi-agent-operator-playbook.md first.
- Stay inside the exact owner outcome, Work Order, repository, branch, and reservations above.
- Use bounded native Codex subagents in isolated worktrees when at least two dependency-cleared, non-overlapping implementation or assurance lanes exist.
- Keep builder and reviewer reservations distinct. Independently review substantive changes before merge.
- Request GitHub Codex review in a PR comment that includes the exact 40-character head SHA, so a clean-review reaction is tied to the reviewed commit.
- Implement useful product behavior. Governance-only placeholders do not satisfy the outcome.
- Own investigation, implementation, tests, commits, push, pull request, CI/review monitoring, and bounded remediation.
- Stop at a green, independently reviewed PR with zero unresolved threads. Hermes owns the reservation check, eligible merge, merged-main verification, cleanup, and successor release.
- Never ask William to run commands, inspect diagnostics, manage GitHub, relay status, or approve routine R0/R1 work.
- Stop only for a genuinely new authority boundary or terminal evidence-backed safety wall.
- Do not use MCP connectors, dynamic tools, web search, browser control, or external product APIs. Use only the owned worktree, repository commands, GitHub CLI, validators, and native Codex subagents.

Blocked throughout:
${BLOCKED_SCOPE.map((item) => `- ${item}`).join("\n")}

Git safety:
- Never use force push, reset --hard, checkout --, clean -fd, or broad destructive cleanup.
- Do not modify or stage .obsidian/ or unrelated user changes.
- Stage only owned paths and verify the exact diff before every commit.

Completion rule:
Return only when the Work Order PR is green and reviewed with zero unresolved threads, or after a typed terminal wall. Your final response must truthfully state RESULT, WORK_ORDER, BRANCH, COMMIT, PR_URL, MERGED, MERGE_COMMIT, VALIDATION, REVIEW_THREADS, OWNER_TOUCH_COUNT, BLOCKED_SCOPE_CROSSED, and NEXT_STATE.`
}

export const HERMES_TURN_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "result", "workOrder", "branch", "commit", "prUrl", "merged", "mergeCommit",
    "validation", "reviewThreads", "ownerTouchCount", "blockedScopeCrossed", "nextState",
  ],
  properties: {
    result: { type: "string", enum: ["READY_FOR_MERGE", "OWNER_DECISION_REQUIRED", "FAILED_TERMINAL"] },
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
