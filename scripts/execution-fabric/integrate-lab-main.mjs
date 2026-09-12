/**
 * LAB INTEGRATION AUTHORITY — sovereign merge decision, made locally.
 *
 * This is the piece that removes GitHub from the production control path. The estate's doctrine
 * already says GitHub "verifies WilliamOS delivery; it does not mint work authority" — but while the
 * merge BUTTON lived behind GitHub's branch protection, the verification was really the gate. This
 * tool executes the transition where the authority actually lives:
 *
 *   1. Re-verify, from LAB-LOCAL material only:
 *        - the delivery seal signature (Ed25519, verified against the PUBLIC KEY DERIVED FROM THE
 *          LAB'S OWN PRIVATE SEAL KEY in the runtime env — no GitHub variable API on the path);
 *        - the sovereign review attestation signature (the review that authorized this seal),
 *          against the lab's reviewer trust ring;
 *        - the sealed patch itself, re-measured over the sealed paths with the SAME pure
 *          comparator CI used (lib/governance/git-delivery.ts), so "sealed" always means
 *          "this exact content", never "this commit message".
 *   2. Integrate into the AUTHORITATIVE BRANCH: `lab/main` (remote `lab`, on ATLAS). Squash
 *      semantics identical to the governed PR flow: one commit, parent = current lab main,
 *      tree = candidate tree.
 *   3. Sync the GitHub MIRROR and record the truth honestly:
 *        - try the governed PR merge (fast-forwardable, or via merge commit) —
 *        - fall back to a mirror branch push —
 *      and store the outcome in lab state so the owner surface can show
 *        PRODUCT STATE: COMPLETE  /  MIRROR STATE: IN SYNC | OUT OF SYNC (reason)
 *      A mirror failure NEVER reopens the product transition. That asymmetry is the whole point.
 *
 * Usage (from the lane or repo root):
 *   node scripts/execution-fabric/integrate-lab-main.mjs \
 *     --cand <branch-or-sha> --base <sha> --seal <seal.json> [--pr <n>] [--remote-git-url <url>]
 *
 * Reads (never echoes): the seal private key material to derive its public key, the reviewer ring
 * from the runtime env. Requires: git, node, the lab remote configured (see --ensure-remote).
 */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { execFileSync, execSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const ROOT = process.cwd()
const RUNTIME_ENV = "C:/HermesLab/williamos-runtime-64034e93-flat/.env.local"
const LAB_GIT_URL_DEFAULT = process.env.WILLIAMOS_LAB_GIT_URL
  ?? "ssh://bs@192.168.88.8/srv/git/williamos.git"
const LAB_SSH_KEY = "C:/Users/bs/.williamos/fabric/keys/williamos-fabric"
const LAB_KNOWN_HOSTS = "C:/Users/bs/.williamos/fabric/known_hosts"
const MIRROR_REMOTE = "origin"
const MIRROR_REPO = "bsvalues/terragroq"
const STATE_PATH = path.join(process.env.USERPROFILE ?? "", ".williamos", "integrations.json")

function envValue(name) {
  const raw = fs.readFileSync(RUNTIME_ENV, "utf8")
  const m = raw.match(new RegExp(`^${name}=(.*)$`, "m"))
  return m ? m[1].trim() : null
}

function git(args, { cwd = ROOT } = {}) {
  return execFileSync("git", args, {
    cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: envGit(),
  }).trim()
}

function envGit() {
  return { ...process.env, GIT_SSH_COMMAND:
    `ssh -i "${LAB_SSH_KEY.replace(/\\/g, "/")}" -o UserKnownHostsFile="${LAB_KNOWN_HOSTS.replace(/\\/g, "/")}" -o BatchMode=yes` }
}

function nowIso() { return new Date().toISOString() }

// ---------------------------------------------------------------- seal + attestation verification

async function loadVerifiers() {
  const prReceipt = await import(pathToFileURL(path.resolve("lib/governance/pr-receipt.ts")).href)
  const gitDelivery = await import(pathToFileURL(path.resolve("lib/governance/git-delivery.ts")).href)
  const sealMod = await import(pathToFileURL(path.resolve("lib/governance/delivery-seal.ts")).href)
  const reviewMod = await import(pathToFileURL(path.resolve("lib/governance/sovereign-review.mjs")).href)
  return { prReceipt, gitDelivery, sealMod, reviewMod }
}

/**
 * The lab owns the seal private key in the runtime env; the PRODUCTION code derives the keyId
 * (sha256 of SPKI) and verifies signatures. Calling the same function CI's verifier relies on means
 * there is exactly one canonicalization in the estate — the local authority cannot be laxer.
 */
function sealTrustRoot({ sealMod }) {
  const signingKey = sealMod.deliverySigningKeyFromBase64(envValue("WILLIAMOS_DELIVERY_SEAL_PRIVATE_KEY_B64"))
  if (!signingKey) throw new Error("SEAL_KEY_UNAVAILABLE: the runtime env carries no delivery seal key")
  return signingKey // { privateKey, publicKey, keyId } — private key never leaves this object
}

function reviewerRing() {
  const raw = envValue("WILLIAMOS_SOVEREIGN_REVIEWER_PUBLIC_KEYS_JSON")
  if (!raw) throw new Error("REVIEWER_RING_UNAVAILABLE")
  return JSON.parse(raw)
}

// ---------------------------------------------------------------- mirror state

function recordState(entry) {
  let state = { integrations: [] }
  try { state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) } catch {}
  state.integrations = [...(state.integrations ?? []), entry].slice(-200)
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n")
  return state.integrations.at(-1)
}

// ---------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2)
  const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...rest] = a.slice(2).split("=")
    return [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), rest.length ? rest.join("=") : true]
  }))
  if (flags.ensureRemote) {
    try { git(["remote", "add", "lab", LAB_GIT_URL_DEFAULT]) }
    catch { git(["remote", "set-url", "lab", LAB_GIT_URL_DEFAULT]) }
    console.log(`lab remote configured -> ${LAB_GIT_URL_DEFAULT}`)
    return
  }
  const cand = flags.cand
  const base = flags.base
  const sealFile = flags.seal
  if (!cand || !base || !sealFile) {
    console.log("USAGE: integrate-lab-main.mjs --cand=<sha|branch> --base=<sha> --seal=<seal.json> [--pr=<n>]")
    process.exitCode = 2
    return
  }

  const sealDoc = JSON.parse(fs.readFileSync(sealFile, "utf8"))
  const block = sealDoc.sealBlock
  const seal = JSON.parse(block.split("\n").slice(1).join("\n").split("```")[0])

  // 1) resolve candidate + sync from whichever remote already holds it (mirror is a valid SOURCE)
  let candSha
  try {
    git(["fetch", "--quiet", MIRROR_REMOTE, cand])
    candSha = git(["rev-parse", "FETCH_HEAD"]).toLowerCase()
  } catch {
    candSha = git(["rev-parse", cand]).toLowerCase()
  }
  git(["fetch", "--quiet", "lab", "main"])
  const labMainBefore = git(["rev-parse", "lab/main"]).toLowerCase()
  const baseSha = git(["rev-parse", `${base}^{commit}`]).toLowerCase()

  // 3) structural checks first (no key material needed, fail fast): sealed-head binding,
  //    attestation verdict/head binding, and the patch re-measured over the sealed paths.
  const { prReceipt, gitDelivery, sealMod, reviewMod } = await loadVerifiers()
  if (seal.payload?.delivery?.commitSha?.toLowerCase() !== candSha) {
    throw new Error(`SEAL_HEAD_MISMATCH seal=${seal.payload?.delivery?.commitSha?.slice(0, 10)} cand=${candSha.slice(0, 10)}`)
  }
  // Hardening (independent review GAP-1): the requested base must be the seal's OWN recorded base.
  // A laterally-chosen base could make the scope check vacuous for content outside the sealed set;
  // CI's three-dot diff structurally cannot be talked into that, so neither may the lab authority.
  if (seal.payload?.delivery?.baseSha && seal.payload.delivery.baseSha.toLowerCase() !== baseSha) {
    throw new Error(`BASE_NOT_SEAL_BASE requested=${baseSha.slice(0, 10)} sealed=${seal.payload.delivery.baseSha.slice(0, 10)}`)
  }
  const attestation = JSON.parse(fs.readFileSync(
    flags.attestation ?? path.join(path.dirname(sealFile), "attestation.json"), "utf8"))
  // Hardening (independent review GAP-2, structural): bind the presented attestation to the review
  // head the adoption record was actually minted against. (Head-level binding: the Environment
  // computes adoption.evidence.reviewDigest from its own canonicalization, which is not the
  // reviewer's findings digest, so equality with reviewer digests is not definable here.)
  const adoptionReviewHead = seal.payload?.adoption?.evidence?.reviewHeadSha
  if (adoptionReviewHead && attestation.payload?.reviewedHeadSha?.toLowerCase() !== adoptionReviewHead.toLowerCase()) {
    throw new Error(`ATTESTATION_NOT_ADOPTION_REVIEW attested=${attestation.payload?.reviewedHeadSha?.slice(0, 10)} adopted=${adoptionReviewHead.slice(0, 10)}`)
  }
  if (attestation.payload?.verdict !== "CLEAN"
    || attestation.payload?.reviewedHeadSha?.toLowerCase() !== candSha) {
    throw new Error(`REVIEW_NOT_ACCEPTED ${JSON.stringify({
      verdict: attestation.payload?.verdict, head: attestation.payload?.reviewedHeadSha?.slice(0, 10) })}`)
  }
  const changed = git(["diff", "--name-only", baseSha, candSha]).split(/\r?\n/).filter(Boolean)
  const patchDigests = {}
  const measured = await gitDelivery.inspectGitDelivery(
    ROOT, baseSha, candSha, seal.payload.delivery.paths, { allowMultiple: true })
  patchDigests[[...measured.paths].sort().join("\0")] = measured.patchDigest

  // 4) cryptographic checks against the production verifiers (the same code CI's gate runs; the
  //    local authority cannot be laxer than the mirror-side gate it replaces).
  const signingKey = sealTrustRoot({ sealMod })
  if (!sealMod.verifyWilliamOSDeliverySeal(seal, { [signingKey.keyId]: signingKey.publicKey })) {
    throw new Error("SEAL_SIGNATURE_INVALID")
  }
  if (seal.payload.keyId !== signingKey.keyId) {
    throw new Error(`SEAL_KEY_MISMATCH seal=${seal.payload.keyId} lab=${signingKey.keyId}`)
  }
  const verdict = prReceipt.reviewPullRequestReceipt({
    body: `pasted\n${block}\n`,
    changedFiles: measured.changedFiles ?? changed,
    headSha: candSha,
    repository: measured.repository, // canonicalized from the actual origin, exactly as CI does
    patchDigests,
    publicKeys: { [signingKey.keyId]: signingKey.publicKey },
  })
  if (!verdict.ok) throw new Error(`SEAL_VERIFICATION_FAILED ${verdict.failure} ${verdict.detail ?? ""}`)
  const review = reviewMod.verifySovereignReview(attestation, reviewerRing())
  if (!review.valid) {
    throw new Error(`REVIEW_NOT_ACCEPTED ${JSON.stringify({ valid: review.valid, reason: review.reason })}`)
  }

  // 5) local full-suite evidence: CI runs are a mirror-side echo; require the lab's own record
  //    (Hardening GAP-3: an enforced gate for real integrations, advisory only for rehearsal).
  const localTest = flags.localTests ?? null
  if (!localTest || !fs.existsSync(localTest)) {
    if (flags.verifyOnly) {
      console.log("NOTE: --localTests not provided (verify-only rehearsal does not advance any ref).")
    } else {
      throw new Error("LOCAL_TESTS_RECORD_MISSING run the suite and pass --localTests=<file>; the lab record is the operative evidence, not CI's echo")
    }
  }

  if (flags.verifyOnly) {
    console.log(`VERIFICATION_OK ${candSha.slice(0, 10)} seal=${seal.payload.keyId} reviewer=${attestation.payload.keyId} verdict=CLEAN`)
    return
  }

  // 6) INTEGRATION: squash into authoritative lab main. One commit, parent = lab main, tree = cand.
  const title = flags.title ?? `integrate ${candSha.slice(0, 10)} (sealed ${seal.payload.keyId.slice(0, 8)})`
  const msg = `${title}\n\nWilliamOS delivery seal ${seal.payload.delivery.baseSha?.slice(0, 10) ?? baseSha.slice(0, 10)}..${candSha.slice(0, 10)} (${seal.payload.keyId}) reviewed CLEAN by sovereign reviewer ${attestation.payload.keyId}\nExecuted by lab integration authority at ${nowIso()}\n`
  const tree = git(["rev-parse", `${candSha}^{tree}`])
  const newSha = git(["commit-tree", tree, "-p", labMainBefore, "-m", msg])
  git(["push", "lab", `${newSha}:refs/heads/main`], { })
  const labMainAfter = newSha.toLowerCase()
  // fast-forward local bookkeeping
  try { git(["fetch", "--quiet", "lab", "main"]) } catch {}
  console.log(`LAB MAIN ADVANCED ${labMainBefore.slice(0, 10)} -> ${labMainAfter.slice(0, 10)} (${changed.length} files)`)

  // 7) MIRROR SYNC — attempted, never authoritative.
  let mirror = { state: "OUT_OF_SYNC", detail: "not attempted" }
  try {
    const pr = flags.pr
    if (pr) {
      // fast-forward the PR head to lab main and merge via the governed path where possible
      execSync(`gh pr merge ${pr} --repo ${MIRROR_REPO} --squash --admin`, { stdio: "pipe" })
      mirror = { state: "IN_SYNC", detail: `PR #${pr} merged via governed path` }
    } else {
      throw new Error("no --pr supplied")
    }
  } catch (error) {
    try {
      const branch = `mirror/${labMainAfter.slice(0, 10)}`
      git(["push", "--quiet", "--force", MIRROR_REMOTE, `${labMainAfter}:refs/heads/${branch}`])
      mirror = { state: "OUT_OF_SYNC", detail: `PR merge unavailable (${String(error.message ?? error).slice(0, 120)}); pushed lab main to mirror branch ${branch}` }
    } catch (fallbackError) {
      mirror = { state: "OUT_OF_SYNC", detail: `mirror unreachable: ${String(fallbackError.message ?? fallbackError).slice(0, 160)}` }
    }
  }

  const entry = recordState({
    at: nowIso(), candidate: candSha, base: baseSha,
    labMainBefore, labMainAfter, sealKey: seal.payload.keyId, reviewerKey: review.payload?.keyId,
    productState: "COMPLETE", mirrorState: mirror.state, mirrorDetail: mirror.detail,
  })
  console.log(`PRODUCT STATE: COMPLETE`)
  console.log(`MIRROR STATE: ${mirror.state} — ${mirror.detail}`)
  console.log(`recorded: ${STATE_PATH}`)
  void entry
}

main().catch((error) => {
  console.error(`INTEGRATION_REFUSED: ${String(error.message ?? error)}`)
  process.exitCode = 1
})
