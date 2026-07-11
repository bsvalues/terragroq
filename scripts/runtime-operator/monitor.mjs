import { commentOnIssue, githubContext, githubRequest, setIssueLabels } from "./github.mjs"
import { evaluatePullRequestGate } from "./state.mjs"

const { owner, repo } = githubContext()
const pulls = await githubRequest(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`)

for (const pull of pulls.filter((candidate) => candidate.head.ref.startsWith("runtime/"))) {
  const issueMatch = pull.head.ref.match(/-issue-(\d+)$/)
  if (!issueMatch) continue
  const issueNumber = Number(issueMatch[1])
  const status = await githubRequest(`/repos/${owner}/${repo}/commits/${pull.head.sha}/status`)
  const checks = await githubRequest(`/repos/${owner}/${repo}/commits/${pull.head.sha}/check-runs?per_page=100`)
  const graph = await githubRequest("/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}",
      variables: { owner, repo, number: pull.number },
    }),
  })
  const unresolved = graph.data.repository.pullRequest.reviewThreads.nodes.filter((thread) => !thread.isResolved).length
  const gate = evaluatePullRequestGate({
    legacyStatuses: status.statuses,
    checkRuns: checks.check_runs,
    unresolvedThreads: unresolved,
  })

  if (gate.decision === "REMEDIATE") {
    const issue = await githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`)
    const issueLabels = issue.labels.map((label) => label.name)
    if (issueLabels.includes("williamos:leased") || issueLabels.includes("williamos:ready")) continue
    const comments = await githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`)
    const retries = comments.filter((comment) => /queued remediation attempt \d+ for PR/.test(comment.body)).length
    const nextRetry = retries + 1
    if (nextRetry > 3) {
      await setIssueLabels(issueNumber, ["williamos:blocked"])
      await commentOnIssue(issueNumber, `Runtime operator stopped after three remediation attempts on PR #${pull.number}.`)
      continue
    }
    await setIssueLabels(issueNumber, ["williamos:ready", "williamos:remediation"])
    await commentOnIssue(issueNumber, `Runtime operator queued remediation attempt ${nextRetry} for PR #${pull.number}: ${gate.reason}.`)
    continue
  }

  if (gate.decision === "WAIT") continue
  await githubRequest(`/repos/${owner}/${repo}/pulls/${pull.number}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: "squash" }),
  })
  await setIssueLabels(issueNumber, ["williamos:done"])
  await commentOnIssue(issueNumber, `Runtime operator merged PR #${pull.number} after green checks and zero unresolved review threads.`)
}
