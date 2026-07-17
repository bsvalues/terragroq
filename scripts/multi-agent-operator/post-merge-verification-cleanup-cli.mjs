#!/usr/bin/env node
import { runCanonicalPostMergeVerificationCleanup } from "./post-merge-verification-cleanup.mjs"

if (process.argv.length > 2) {
  console.log(JSON.stringify({
    ok: false,
    code: "POST_MERGE_CLI_ARGUMENT_WALL",
    githubApiCalled: false,
    cleanupPerformed: false,
    unsafeCleanupPerformed: false,
    productionWritePerformed: false,
    authorityGranted: false,
  }))
  process.exit(2)
}

const result = runCanonicalPostMergeVerificationCleanup()
console.log(JSON.stringify({
  ok: true,
  status: result.status,
  resultHash: result.resultHash,
  githubApiCalled: result.githubApiCalled,
  cleanupPerformed: result.cleanupPerformed,
  unsafeCleanupPerformed: result.unsafeCleanupPerformed,
  productionWritePerformed: result.productionWritePerformed,
  authorityGranted: result.authorityGranted,
}))
