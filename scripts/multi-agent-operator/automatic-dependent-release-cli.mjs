#!/usr/bin/env node
import { runCanonicalAutomaticDependentRelease } from "./automatic-dependent-release.mjs"

if (process.argv.length > 2) {
  console.log(JSON.stringify({
    ok: false,
    code: "DEPENDENT_RELEASE_CLI_ARGUMENT_WALL",
    providerDispatched: false,
    githubApiCalled: false,
    branchCreated: false,
    pullRequestCreated: false,
    authorityGranted: false,
  }))
  process.exit(2)
}

const result = runCanonicalAutomaticDependentRelease()
console.log(JSON.stringify({
  ok: true,
  status: result.status,
  resultHash: result.resultHash,
  providerDispatched: result.providerDispatched,
  githubApiCalled: result.githubApiCalled,
  branchCreated: result.branchCreated,
  pullRequestCreated: result.pullRequestCreated,
  authorityGranted: result.authorityGranted,
}))
