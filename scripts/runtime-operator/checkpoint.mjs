import fs from "node:fs"

import { buildCheckpoint } from "./state.mjs"
import { commentOnIssue, setIssueLabels } from "./github.mjs"

const issueNumber = Number(process.env.ISSUE_NUMBER)
const leaseId = process.env.LEASE_ID
const state = process.env.CHECKPOINT_STATE
const detail = process.env.CHECKPOINT_DETAIL ?? ""
if (!issueNumber || !leaseId || !state) throw new Error("ISSUE_NUMBER, LEASE_ID, and CHECKPOINT_STATE are required")

const checkpoint = buildCheckpoint({ leaseId, state, detail, at: new Date().toISOString() })
const labels = state === "MERGED" || state === "COMPLETED"
  ? ["williamos:done"]
  : state === "BLOCKED"
    ? ["williamos:blocked"]
    : state === "PR_OPEN"
      ? ["williamos:monitoring"]
      : ["williamos:leased"]
await setIssueLabels(issueNumber, labels)
await commentOnIssue(issueNumber, `<!-- WILLIAMOS_RUNTIME_CHECKPOINT\n${JSON.stringify(checkpoint)}\nWILLIAMOS_RUNTIME_CHECKPOINT -->`)

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${state}\n\n${detail}\n`)
