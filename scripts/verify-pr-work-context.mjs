import { execFileSync } from "node:child_process"
import { createPublicKey } from "node:crypto"
import fs from "node:fs"

import {
  DELIVERY_SEAL_BLOCK,
  parseDeclaredDeliverySeals,
  reviewPullRequestReceipt,
} from "../lib/governance/pr-receipt.ts"
import { inspectGitDelivery } from "../lib/governance/git-delivery.ts"

const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {}
const pr = event.pull_request ?? {}
const base = pr.base?.ref ?? "main"
const root = process.cwd()

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const lines = (out) => out.split("\n").map((line) => line.trim()).filter(Boolean)

function fail(failure, detail, recovery) {
  console.error(`\n${failure}: ${detail}`)
  console.error(`\nRecovery: ${recovery}`)
  console.error(`\nGitHub verifies WilliamOS delivery; it does not mint work authority or accept client-authored receipts.\n`)
  process.exit(1)
}

function configuredPublicKeys() {
  const raw = process.env.WILLIAMOS_DELIVERY_SEAL_PUBLIC_KEYS_JSON?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).map(([keyId, encoded]) => {
      if (typeof encoded !== "string" || !encoded) throw new Error("invalid public key")
      const key = createPublicKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "spki" })
      if (key.asymmetricKeyType !== "ed25519") throw new Error("public key is not Ed25519")
      return [keyId, key]
    }))
  } catch {
    return {}
  }
}

git("fetch", "--quiet", "origin", base)
const headSha = git("rev-parse", "HEAD").toLowerCase()
const changedFiles = lines(git("diff", "--name-only", `origin/${base}...HEAD`))
const seals = parseDeclaredDeliverySeals(pr.body)
const patchDigests = {}
let repository

for (const seal of seals) {
  try {
    const measured = await inspectGitDelivery(
      root,
      seal.payload.delivery.baseSha,
      headSha,
      seal.payload.delivery.paths,
      { allowMultiple: true },
    )
    repository ??= measured.repository
    patchDigests[[...measured.paths].sort().join("\0")] = measured.patchDigest
  } catch (error) {
    fail(
      "FAILED_RECEIPT_MISMATCH",
      `the exact sealed assignment patch could not be measured: ${error?.message ?? error}`,
      "Deliver the unchanged output of the existing Space assignment, or ask WilliamOS to seal the current exact output.",
    )
  }
}

const verdict = reviewPullRequestReceipt({
  body: pr.body,
  changedFiles,
  headSha,
  repository,
  patchDigests,
  publicKeys: configuredPublicKeys(),
})
if (!verdict.ok) fail(verdict.failure, verdict.detail, verdict.recovery)

console.log(`${DELIVERY_SEAL_BLOCK} verified for exact head ${headSha.slice(0, 10)}.`)
console.log(`${changedFiles.length} changed file(s), all covered by WilliamOS-issued Space assignments.`)
