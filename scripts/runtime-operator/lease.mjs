import fs from "node:fs"

import { evaluateWorkOrderPolicy, parseWorkOrderEnvelope } from "./policy.mjs"
import { buildCodexPrompt } from "./prompt.mjs"
import { buildCheckpoint, buildLease, chooseNextWorkOrder } from "./state.mjs"
import { commentOnIssue, ensureLabel, githubContext, githubRequest, setIssueLabels } from "./github.mjs"

function output(name, value) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

const LABELS = [
  ["williamos:ready", "1f883d", "Ready for the bounded runtime operator"],
  ["williamos:leased", "0969da", "Leased by a runtime operator run"],
  ["williamos:blocked", "d1242f", "Stopped at validation or authority wall"],
  ["williamos:done", "8250df", "Completed and merged by the runtime operator"],
  ["williamos:remediation", "fbca04", "Queued for bounded PR remediation"],
  ["williamos:monitoring", "5319e7", "Waiting for PR checks or review"],
]

for (const label of LABELS) await ensureLabel(...label)

const { owner, repo } = githubContext()
const issues = await githubRequest(`/repos/${owner}/${repo}/issues?state=open&labels=${encodeURIComponent("williamos:ready")}&per_page=100`)
const issue = chooseNextWorkOrder(issues.filter((candidate) => !candidate.pull_request))
if (!issue) {
  output("leased", "false")
  process.exit(0)
}

let envelope
try {
  envelope = parseWorkOrderEnvelope(issue.body ?? "")
} catch (error) {
  await setIssueLabels(issue.number, ["williamos:blocked"])
  await commentOnIssue(issue.number, `Runtime operator rejected the queue record: ${String(error.message ?? error)}`)
  output("leased", "false")
  process.exit(0)
}

const labels = issue.labels.map((label) => label.name)
let effectiveEnvelope = envelope
let remediationPr = ""
if (labels.includes("williamos:remediation")) {
  const pulls = await githubRequest(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`)
  const pull = pulls.find((candidate) => candidate.head.ref.endsWith(`-issue-${issue.number}`) && candidate.head.ref.startsWith("runtime/"))
  if (!pull) throw new Error(`No open runtime PR found for remediation issue #${issue.number}`)
  const comments = await githubRequest(`/repos/${owner}/${repo}/pulls/${pull.number}/comments?per_page=100`)
  const checks = await githubRequest(`/repos/${owner}/${repo}/commits/${pull.head.sha}/check-runs?per_page=100`)
  const reviewFeedback = comments.slice(-20).map((comment) => `- ${comment.path ?? "PR"}: ${comment.body.slice(0, 2_000)}`)
  const checkFeedback = checks.check_runs
    .filter((check) => !["success", "neutral", "skipped", null].includes(check.conclusion))
    .map((check) => `- Check ${check.name}: ${check.conclusion}; ${(check.output?.summary ?? check.output?.text ?? "no summary").slice(0, 2_000)}`)
  const feedback = [...reviewFeedback, ...checkFeedback].join("\n")
  effectiveEnvelope = {
    ...envelope,
    baseBranch: pull.head.ref,
    remediationOf: pull.number,
    task: `${envelope.task}\n\nRemediate the actionable review feedback on PR #${pull.number}:\n${feedback}`,
  }
  remediationPr = String(pull.number)
}

const policy = evaluateWorkOrderPolicy({
  envelope: effectiveEnvelope,
  actor: issue.user.login,
  repository: process.env.GITHUB_REPOSITORY,
  enabled: process.env.WILLIAMOS_RUNTIME_OPERATOR_ENABLED === "true",
})
if (!policy.allowed) {
  await setIssueLabels(issue.number, ["williamos:blocked"])
  await commentOnIssue(issue.number, `Runtime operator policy stop: \`${policy.reasonCode}\`.`)
  output("leased", "false")
  process.exit(0)
}

const lease = buildLease({
  issueNumber: issue.number,
  runId: process.env.GITHUB_RUN_ID,
  attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? "1"),
  now: new Date().toISOString(),
})
const checkpoint = buildCheckpoint({ leaseId: lease.leaseId, state: "LEASED", detail: envelope.workOrderId, at: lease.leasedAt })
await setIssueLabels(issue.number, ["williamos:leased"])
await commentOnIssue(issue.number, `<!-- WILLIAMOS_RUNTIME_CHECKPOINT\n${JSON.stringify(checkpoint)}\nWILLIAMOS_RUNTIME_CHECKPOINT -->`)

fs.mkdirSync("runtime-request", { recursive: true })
fs.writeFileSync("runtime-request/envelope.json", JSON.stringify(effectiveEnvelope, null, 2))
fs.writeFileSync("runtime-request/lease.json", JSON.stringify(lease, null, 2))
fs.writeFileSync("runtime-request/prompt.md", buildCodexPrompt(effectiveEnvelope))
output("leased", "true")
output("issue_number", String(issue.number))
output("lease_id", lease.leaseId)
output("work_order_id", envelope.workOrderId)
output("base_ref", effectiveEnvelope.baseBranch)
output("remediation_pr", remediationPr)
