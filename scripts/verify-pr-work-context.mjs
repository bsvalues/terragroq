import { execFileSync } from "node:child_process"
import fs from "node:fs"

import { reviewPullRequestReceipt, RECEIPT_BLOCK } from "../lib/governance/pr-receipt.ts"
import { measureDoctrineDigest } from "../lib/governance/work-context-live.ts"
import { parseDeclaredReceipt } from "../lib/governance/pr-receipt.ts"

/**
 * Reviewer-side enforcement of #831, acceptance criterion 8.
 *
 * A green suite is not a proven premise. The route gate already refuses unproven mutations made
 * through the application, but a lane that commits straight to a branch never touches it -- which is
 * how most work actually arrives. This is the half that sees those.
 *
 * It runs on the pull request, re-derives the token from the declared claims, measures the doctrine
 * itself rather than believing the claim, and checks the diff against the declared reservation. What
 * it cannot check is the authority grant: that lives in a database no runner can reach, and it is
 * enforced at issuance instead. Better to name the gap than imply a completeness this does not have.
 *
 * Every refusal prints a recovery route, because #831 is explicit that the gate must never convert a
 * model mistake into a new owner question.
 */

const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {}
const pr = event.pull_request ?? {}
const author = pr.user?.login ?? ""
const base = pr.base?.ref ?? "main"

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const lines = (out) => out.split("\n").map((line) => line.trim()).filter(Boolean)

function fail(verdict) {
  console.error(`\n${verdict.failure}: ${verdict.detail}`)
  console.error(`\nRecovery: ${verdict.recovery}`)
  console.error(
    `\nThis check enforces #831 acceptance criterion 8: a reviewer rejects a pull request with no valid` +
      ` ${RECEIPT_BLOCK} even when the tests are green.\n`,
  )
  process.exit(1)
}

// The owner is not a builder lane. #831 gates agent lanes before they mutate; applying it to the
// person the gate exists to protect would be the owner-babysitting the issue rules out.
const OWNER = "bsvalues"
if (author === OWNER) {
  console.log(`author is the owner (${author}); the builder-lane gate does not apply. Reporting only.`)
  const declared = parseDeclaredReceipt(pr.body)
  console.log(declared ? `a ${RECEIPT_BLOCK} is present anyway.` : `no ${RECEIPT_BLOCK} declared.`)
  process.exit(0)
}

git("fetch", "--quiet", "origin", base)
const changedFiles = lines(git("diff", "--name-only", `origin/${base}...HEAD`))

const declared = parseDeclaredReceipt(pr.body)
// The anchor is the main SHA the receipt was issued against. Files that moved on main since then are
// what decides staleness -- not the fact that main moved at all, which would kill every receipt on
// the next unrelated merge and make the gate something lanes route around.
let mainMovedFiles = []
if (declared?.facts?.mainSha) {
  try {
    mainMovedFiles = lines(git("diff", "--name-only", `${declared.facts.mainSha}..origin/${base}`))
  } catch {
    // An unresolvable anchor is not a pass. It means the receipt names a commit this repository does
    // not have, which is exactly the stale-or-fabricated case.
    fail({
      failure: "FAILED_STALE_MAIN",
      detail: `the receipt's anchor ${declared.facts.mainSha} is not a commit in this repository`,
      recovery: "Fetch current main, re-establish context against a real commit, and re-issue the receipt.",
    })
  }
}

const { digest } = await measureDoctrineDigest()
const verdict = reviewPullRequestReceipt({
  body: pr.body,
  changedFiles,
  mainMovedFiles,
  liveDoctrineDigest: digest,
})

if (!verdict.ok) fail(verdict)
console.log(`work context proven for ${declared.facts.workOrderRef} against ${declared.facts.mainSha.slice(0, 10)}.`)
console.log(`${changedFiles.length} changed file(s), all inside the declared reservation.`)
