#!/usr/bin/env node
import { runCanonicalGitHubLifecycleConformance } from "./github-lifecycle-conformance.mjs"

if (process.argv.length > 2) {
  console.log(JSON.stringify({ ok: false, code: "GITHUB_LIFECYCLE_CLI_ARGUMENT_WALL", githubApiCalled: false, mergePerformed: false, authorityGranted: false }))
  process.exit(2)
}

const result = runCanonicalGitHubLifecycleConformance()
console.log(JSON.stringify({
  ok: true,
  status: result.status,
  resultHash: result.resultHash,
  githubApiCalled: result.githubApiCalled,
  mergePerformed: result.mergePerformed,
  authorityGranted: result.authorityGranted,
}))
