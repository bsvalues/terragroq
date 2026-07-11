import { githubContext, githubRequest } from "./github.mjs"

const pullNumber = Number(process.env.REMEDIATION_PR)
if (!pullNumber) throw new Error("REMEDIATION_PR is required")
const { owner, repo } = githubContext()
const query = await githubRequest("/graphql", {
  method: "POST",
  body: JSON.stringify({
    query: "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved}}}}}",
    variables: { owner, repo, number: pullNumber },
  }),
})

for (const thread of query.data.repository.pullRequest.reviewThreads.nodes.filter((candidate) => !candidate.isResolved)) {
  await githubRequest("/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}",
      variables: { id: thread.id },
    }),
  })
}
