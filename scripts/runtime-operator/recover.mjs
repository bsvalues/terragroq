import { commentOnIssue, githubContext, githubRequest, setIssueLabels } from "./github.mjs"
import { isLeaseExpired } from "./state.mjs"

const { owner, repo } = githubContext()
const issues = await githubRequest(`/repos/${owner}/${repo}/issues?state=open&labels=${encodeURIComponent("williamos:leased")}&per_page=100`)

for (const issue of issues.filter((candidate) => !candidate.pull_request)) {
  const comments = await githubRequest(`/repos/${owner}/${repo}/issues/${issue.number}/comments?per_page=100`)
  const checkpoint = [...comments].reverse().find((comment) => comment.body.includes("WILLIAMOS_RUNTIME_CHECKPOINT"))
  const match = checkpoint?.body.match(/WILLIAMOS_RUNTIME_CHECKPOINT\n([\s\S]*?)\nWILLIAMOS_RUNTIME_CHECKPOINT/)
  if (!match) continue
  const state = JSON.parse(match[1])
  if (!isLeaseExpired(state.at, new Date().toISOString(), 120)) continue
  await setIssueLabels(issue.number, ["williamos:ready"])
  await commentOnIssue(issue.number, `Runtime operator recovered expired lease \`${state.leaseId}\` and returned this Work Order to ready state.`)
}
