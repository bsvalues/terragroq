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
import { execFileSync, execSync, spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = process.cwd()
const RUNTIME_ENV = "C:/HermesLab/williamos-runtime-64034e93-flat/.env.local"
const LAB_GIT_URL_DEFAULT = process.env.WILLIAMOS_LAB_GIT_URL
  ?? "ssh://bs@192.168.88.8/srv/git/williamos.git"
const LAB_SSH_KEY = "C:/Users/bs/.williamos/fabric/keys/williamos-fabric"
const LAB_KNOWN_HOSTS = "C:/Users/bs/.williamos/fabric/known_hosts"
const MIRROR_REMOTE = "origin"
const MIRROR_REPO = "bsvalues/terragroq"
// The empty blob. It is ubiquitous (.gitkeep, placeholder files), so its presence anywhere in a
// merged tree cannot stand as evidence that a sealed path's content survived.
const GIT_EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
const STATE_PATH = path.join(process.env.USERPROFILE ?? "", ".williamos", "integrations.json")

function envValue(name) {
  // Resolution order: process environment, then the lab runtime env file. Machines without either
  // (e.g. CI runners) get null -> the typed SEAL_KEY_UNAVAILABLE / REVIEWER_RING_UNAVAILABLE
  // refusals, never a raw ENOENT crash.
  if (process.env[name]) return process.env[name]
  let raw
  try { raw = fs.readFileSync(RUNTIME_ENV, "utf8") } catch { return null }
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

// ---------------------------------------------------------------- integration merge semantics

/**
 * Content for the single integration commit that advances lab main.
 *
 * The candidate describes a change against its SEALED BASE, not against the current tip of main.
 * Another sealed integration can land between that base and this run (observed live: the #1231
 * integration branched from 15667803 while main already held #1229 at 9f10645b, and adopting the
 * candidate TREE wholesale silently reverted #1229's scripts). So the integration content must be
 * a real three-way merge — base -> main, base -> candidate — and every outcome is checked before
 * any ref moves:
 *
 *   - `FAST_FORWARD`: main is an ancestor of the candidate, so the candidate tree already carries
 *     everything on main; the tree is adopted as-is.
 *   - `THREE_WAY_MERGE`: `git merge-tree --write-tree --merge-base=<base>` — no working tree, no
 *     index, deterministic. A conflict is a typed refusal (`INTEGRATION_MERGE_CONFLICT`), never a
 *     silent side-pick.
 *   - Belt-and-braces after the merge: every path main changed outside the sealed set must survive
 *     byte-identical (`INTEGRATION_WOULD_REVERT`), and every sealed path must carry the
 *     candidate's exact blob (`INTEGRATION_SEALED_CONTENT_LOST`).
 */
export function integrationTree({ baseSha, candSha, labMainBefore, sealedPaths, cwd = ROOT }) {
  const run = (args) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: envGit() })
  // Existence probe that fails CLOSED: a path that resolves is present; a path that does not,
  // under a rev that DOES resolve, is absent; a rev that does not resolve at all is garbage —
  // comparing garbage as "(absent)" would silently disable the guard.
  const blob = (rev, p) => {
    const r = run(["rev-parse", "--verify", "--quiet", `${rev}:${p}`])
    if (r.status === 0) return r.stdout.trim().toLowerCase()
    const revOk = run(["rev-parse", "--verify", "--quiet", `${rev}^{tree}`])
    if (revOk.status === 0) return "(absent)"
    throw new Error(`INTEGRATION_PROBE_FAILED ${String(rev).slice(0, 10)}:${p} rev_unresolvable`)
  }
  // Sealed paths are the contract; reject malformed spellings here too, not only upstream,
  // because a vacuous entry silently disables its own content check.
  const sealed = new Set((sealedPaths ?? []).map((p) => {
    if (typeof p !== "string" || p.length === 0 || p.includes("\\") || p.includes("\0") || p !== p.trim()
      || p.startsWith("./") || p.startsWith("/") || /\s/.test(p)) {
      throw new Error(`INTEGRATION_SEALED_PATH_INVALID ${JSON.stringify(p)}`)
    }
    return p
  }))
  if (sealed.size === 0) throw new Error("INTEGRATION_SEALED_PATHS_EMPTY")
  if (run(["merge-base", "--is-ancestor", baseSha, candSha]).status !== 0) {
    throw new Error(`BASE_NOT_CANDIDATE_ANCESTOR base=${baseSha.slice(0, 10)} cand=${candSha.slice(0, 10)}`)
  }
  if (run(["merge-base", "--is-ancestor", labMainBefore, candSha]).status === 0) {
    // FAST_FORWARD by construction carries main: main is an ancestor of the candidate, so every
    // main path already sits in the candidate tree. Both post-merge guards would be vacuous here,
    // which is safe ONLY under this ancestry precondition — keep the two legs of this function in
    // sync if the branch order ever changes.
    return { tree: git(["rev-parse", `${candSha}^{tree}`], { cwd}).toLowerCase(), mode: "FAST_FORWARD" }
  }
  // The declared sealed base must BE the fork point. Trusting an older declared base lets a path
  // whose content equals base slip past the revert guard (the merge would then quietly prefer the
  // candidate's stale lineage over main's newer work — the exact harm class this function exists
  // to prevent).
  // Hardening (follow-up 5): a disjoint-history candidate (orphan lineage, or a lab main rebuilt
  // outside this repository) makes merge-base exit non-zero with "fatal: no merge base". That is a
  // reachable operator mistake and must refuse TYPED — raw execFileSync text is not an authority
  // reason, and nothing may fall back to comparing unrelated histories.
  let natural
  try {
    natural = git(["merge-base", labMainBefore, candSha], { cwd }).toLowerCase()
  } catch (error) {
    // `git merge-base` exits 1 with NO diagnostic at all when the histories share no common
    // ancestor (observed on this estate's git), while a probe that genuinely cannot answer (bad
    // revision, missing object) carries git's own fatal text. Only the former is "unrelated".
    const stderr = String(error?.stderr ?? "").trim()
    const message = String(error?.message ?? "").trim()
    const unresolvable = /not a valid object name|bad revision|unknown revision|ambiguous argument/i.test(stderr || message)
    if (!unresolvable && (stderr === "" || /no merge base/i.test(stderr))) {
      throw new Error(`INTEGRATION_BASE_UNRELATED lab_main=${labMainBefore.slice(0, 10)} cand=${candSha.slice(0, 10)}: no common ancestor between lab main and the candidate`)
    }
    throw new Error(`INTEGRATION_BASE_PROBE_FAILED ${(stderr || message).replace(/\s+/g, " ").slice(0, 160)}`)
  }
  if (natural !== baseSha.toLowerCase()) {
    throw new Error(`INTEGRATION_BASE_NOT_MERGE_BASE declared=${baseSha.slice(0, 10)} natural=${natural.slice(0, 10)}`)
  }
  const merged = run(["merge-tree", "--write-tree", `--merge-base=${baseSha}`, labMainBefore, candSha])
  const firstLine = String(merged.stdout ?? "").split(/\r?\n/)[0]?.trim().toLowerCase() ?? ""
  const looksLikeTree = /^[0-9a-f]{40}$/.test(firstLine)
  if (merged.status !== 0 || !looksLikeTree) {
    // merge-tree exit codes: 0 clean, 1 conflicted, 128 (and anything else) infrastructure.
    // Report them apart — an operator remediates those differently, and a typed reason is only
    // useful if it is true.
    if (merged.status === 1 && looksLikeTree) {
      const conflicts = String(merged.stdout ?? "").split(/\r?\n/).slice(1, 9).filter(Boolean).join(" | ")
      throw new Error(`INTEGRATION_MERGE_CONFLICT ${conflicts || "conflicting change against current lab main"}`)
    }
    throw new Error(`INTEGRATION_MERGE_INFRA_FAILURE status=${merged.status ?? "null"} ${String(merged.stderr ?? "").trim().slice(0, 160)}`)
  }
  const tree = firstLine
  // -z: NUL-separated, never C-quoted, so a non-ASCII path cannot turn the guard vacuous.
  const mainChanged = String(run(["-c", "core.quotePath=false", "diff", "--name-only", "-z", "--no-renames", baseSha, labMainBefore]).stdout ?? "")
    .split("\0").filter(Boolean)
  // Lineage of the candidate's OWN sealed content: a clean rename resolution (main moved a file
  // the candidate edited) legitimately replaces main's content with the candidate's sealed blob.
  const sealedCandidateBlobs = new Set([...sealed].map((q) => blob(candSha, q)).filter((b) => b !== "(absent)"))
  for (const p of mainChanged) {
    if (sealed.has(p)) continue
    const inTree = blob(tree, p)
    if (inTree === blob(labMainBefore, p)) continue
    if (sealedCandidateBlobs.has(inTree)) continue // rename/modify resolved by merge-tree, carrying sealed content
    throw new Error(`INTEGRATION_WOULD_REVERT ${p}`)
  }
  // All blobs that landed in the merged tree, for rename-aware sealed-content checks.
  let treeBlobs = null
  const treeHasBlob = (oid) => {
    treeBlobs ??= new Set(String(run(["ls-tree", "-r", "-z", tree]).stdout ?? "").split("\0")
      .map((e) => (/^\d+ \w+ ([0-9a-f]{40})\t/.exec(e)?.[1] ?? "").toLowerCase()).filter(Boolean))
    return treeBlobs.has(oid)
  }
  for (const p of sealed) {
    const cb = blob(candSha, p)
    const tb = blob(tree, p)
    // A sealed path must refer to real content somewhere: absent in BOTH the base and the
    // candidate, it checks nothing (an entry that can never fail is a vacuous contract).
    // Present in the base but absent in the candidate is a deliberate deletion — legal, and the
    // tree must agree it is gone.
    if (cb === "(absent)" && blob(baseSha, p) === "(absent)") {
      throw new Error(`INTEGRATION_SEALED_PATH_EMPTY ${p}`)
    }
    if (cb !== tb) {
      // Declared allowance (owner-acknowledged follow-up 1, pinned by tests in both directions):
      // merge-tree may resolve main's rename of a sealed path, in which case the candidate's sealed
      // blob legitimately lives at the new location. The allowance is content-equality based and
      // deliberately NOT rename-aware; it is withheld for the empty blob, because .gitkeep-style
      // emptiness exists everywhere and "these bytes exist somewhere" would then prove nothing.
      if (tb === "(absent)" && cb !== "(absent)" && cb !== GIT_EMPTY_BLOB && treeHasBlob(cb)) continue
      throw new Error(`INTEGRATION_SEALED_CONTENT_LOST ${p}`)
    }
  }
  return { tree, mode: "THREE_WAY_MERGE" }
}

const MAX_TEST_COUNTER = 1_000_000

/**
 * Hardening (follow-up 3): the local full-suite record is the OPERATIVE evidence for a real
 * integration, so it is parsed, not merely stat-ed. A path that is a directory, an empty file, or
 * package.json used to satisfy the gate; so did a record with failing tests, and nothing bound the
 * record to the candidate it claims to prove. Fail-closed typed reasons, one per real defect:
 *   LOCAL_TESTS_RECORD_MISSING / _UNPARSEABLE / _NO_SUITES / _SUITE_UNRESOLVED / _NOT_PASSED /
 *   _RECORD_INCONSISTENT / _UNBOUND / _HEAD_MISMATCH
 * Success requires tests to have EXECUTED and passed: `failed===0` alone accepts an all-skipped
 * record (numPassedTests=0), which proves nothing, and the counters must be self-consistent so a
 * hand-written "18 passed / 99 total" cannot be recorded as audited evidence. At least one recorded
 * suite file must exist in this worktree, so a record lifted from another repository or a fabricated
 * suite name cannot stand in for this repository's evidence.
 * The record is vitest's JSON reporter output with a `headSha` stamped by the suite runner at the
 * exact candidate head (see the runbook's deploy/evidence recipe). Returns the audited evidence
 * that is written into the integration record — including the record's own path and head, so an
 * auditor can locate the exact bytes the digest attests.
 */
export function localTestEvidence(file, candSha, opts = {}) {
  const cwd = opts.cwd ?? ROOT
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error("LOCAL_TESTS_RECORD_MISSING run the suite and pass --localTests=<file>; the lab record is the operative evidence, not CI's echo")
  }
  const raw = fs.readFileSync(file, "utf8")
  let record
  try { record = JSON.parse(raw) } catch { throw new Error(`LOCAL_TESTS_RECORD_UNPARSEABLE ${path.basename(String(file))}: not JSON`) }
  const counter = (name) => {
    const value = record?.[name]
    if (value === undefined) return null
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TEST_COUNTER) {
      throw new Error(`LOCAL_TESTS_RECORD_UNPARSEABLE ${name}=${String(value).slice(0, 24)} is not a plausible test count`)
    }
    return value
  }
  const total = counter("numTotalTests"), failed = counter("numFailedTests"), passed = counter("numPassedTests")
  if (total === null || failed === null || passed === null) {
    throw new Error("LOCAL_TESTS_RECORD_UNPARSEABLE missing vitest summary fields (numTotalTests/numFailedTests/numPassedTests)")
  }
  const pending = counter("numPendingTests") ?? 0
  const todo = counter("numTodoTests") ?? 0
  if (total <= 0) throw new Error("LOCAL_TESTS_RECORD_UNPARSEABLE the record ran zero tests")
  if (failed !== 0) throw new Error(`LOCAL_TESTS_NOT_PASSED failed=${failed} of ${total}`)
  if (passed < 1) throw new Error(`LOCAL_TESTS_NOT_PASSED no test executed and passed (passed=0 of ${total})`)
  if (passed + failed !== total - pending - todo) {
    throw new Error(`LOCAL_TESTS_RECORD_INCONSISTENT passed+failed=${passed + failed} but total-pending-todo=${total - pending - todo}`)
  }
  const names = Array.isArray(record.testResults) ? record.testResults.map((t) => String(t?.name ?? "")).filter(Boolean) : []
  if (names.length === 0) throw new Error("LOCAL_TESTS_NO_SUITES the record names no test files")
  // The binding is CONTAINMENT, not bare existence: a record whose only "suite" is an existing
  // foreign path (C:/Windows/win.ini) must refuse. Names resolve inside this worktree only, and
  // the audited suiteFiles come from the rooted entries, never from rejected ones.
  const rooted = names.filter((n) => {
    const abs = path.resolve(ROOT, n)
    const rootDir = path.resolve(ROOT)
    if (abs !== rootDir && !abs.startsWith(rootDir + path.sep)) return false
    try { return fs.statSync(abs).isFile() } catch { return false }
  })
  if (rooted.length === 0) {
    throw new Error("LOCAL_TESTS_SUITE_UNRESOLVED none of the recorded suite files resolves to a real file inside this worktree; the record is not evidence for this repository")
  }
  const distinct = [...new Set(rooted.map((n) => path.basename(n)))]
  const recordedHead = String(record.headSha ?? "").toLowerCase()
  const candidate = String(candSha ?? "").toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(recordedHead)) {
    throw new Error("LOCAL_TESTS_UNBOUND the record carries no full headSha; run the suite at the exact candidate head and stamp it (the runbook recipe does this)")
  }
  if (recordedHead !== candidate) {
    throw new Error(`LOCAL_TESTS_HEAD_MISMATCH record=${recordedHead.slice(0, 10)} cand=${candidate.slice(0, 10)}`)
  }
  // Mechanical closure of reviewer thread 2 (stale-report re-stamping): the stamp alone is a
  // self-declared string, so the WORKTREE must independently agree that it sits at the candidate
  // (git rev-parse HEAD), and the record's suite inventory must cover every TEST file the
  // candidate actually changed (git diff of candidate vs its merge-base with lab main, when the
  // caller supplies changedTests). A stale report re-stamped to a new head fails one of these two
  // unless the new commits touched no tests and the checkout was refreshed — the honest case.
  const worktreeHead = String(opts.worktreeHead ?? "").toLowerCase()
  if (worktreeHead && worktreeHead !== candidate) {
    throw new Error(`LOCAL_TESTS_WORKTREE_HEAD_MISMATCH checkout=${worktreeHead.slice(0, 10)} cand=${candidate.slice(0, 10)}: run the suite at the exact candidate, do not integrate evidence from another checkout`)
  }
  const changedTests = Array.isArray(opts.changedTests) ? opts.changedTests : null
  if (changedTests && changedTests.length > 0) {
    const recorded = new Set(rooted.map((n) => path.relative(path.resolve(cwd), path.resolve(cwd, n)).split(path.sep).join("/")))
    const missing = changedTests.filter((t) => !recorded.has(t.split(path.sep).join("/")))
    if (missing.length > 0) {
      throw new Error(`LOCAL_TESTS_CHANGED_TESTS_UNCOVERED the candidate changed ${changedTests.length} test file(s) but the record does not cover: ${missing.slice(0, 5).join(", ")}`)
    }
  }
  return {
    digest: `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`,
    total, passed, failed, pending, todo, suites: distinct.length,
    suiteFiles: distinct.slice(0, 8), record: path.resolve(String(file)), headSha: recordedHead,
  }
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
  // Verification needs NO remote access: candidate/base/lab resolution is over local objects, and
  // the checks below are structural + cryptographic. lab/main is resolved only for integration.
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
  //    (Hardening GAP-3 + follow-up 3: parsed, success-checked, suite-identified, head-bound,
  //    worktree-confirmed and test-inventory-covering for real integrations; advisory only for
  //    rehearsal).
  let localEvidence = null
  try {
    let worktreeHead = ""
    try { worktreeHead = git(["rev-parse", "HEAD"]) } catch { worktreeHead = "" }
    let changedTests = []
    try {
      changedTests = git(["diff", "--name-only", `${baseSha}..${candSha}`], { encoding: "utf8" })
        .split(/\r?\n/).filter((f) => f && (/\.test\.[cm]?[tj]sx?$/.test(f) || f.startsWith("tests/")))
    } catch { changedTests = [] }
    localEvidence = localTestEvidence(flags.localTests ?? null, candSha, { worktreeHead, changedTests })
  } catch (error) {
    if (flags.verifyOnly) {
      console.log(`NOTE: ${String(error.message ?? error).slice(0, 160)} (verify-only rehearsal does not advance any ref).`)
    } else {
      throw error
    }
  }

  if (flags.verifyOnly) {
    console.log(`VERIFICATION_OK ${candSha.slice(0, 10)} seal=${seal.payload.keyId} reviewer=${attestation.payload.keyId} verdict=CLEAN`)
    return
  }

  // 6) INTEGRATION: one commit advancing authoritative lab main. Content is computed from the
  //    candidate's SEALED BASE against the CURRENT main (three-way), never the candidate tree
  //    wholesale — a second sealed integration may have landed since the candidate branched
  //    (#1231 branched from 15667803 while main held #1229 at 9f10645b; tree-wholesale reverted
  //    #1229). Conflicts and would-be reverts refuse typed; nothing moves unless it is exact.
  git(["fetch", "--quiet", "lab", "main"])
  const labMainBefore = git(["rev-parse", "lab/main"]).toLowerCase()
  const title = flags.title ?? `integrate ${candSha.slice(0, 10)} (sealed ${seal.payload.keyId.slice(0, 8)})`
  const msg = `${title}\n\nWilliamOS delivery seal ${seal.payload.delivery.baseSha?.slice(0, 10) ?? baseSha.slice(0, 10)}..${candSha.slice(0, 10)} (${seal.payload.keyId}) reviewed CLEAN by sovereign reviewer ${attestation.payload.keyId}\nExecuted by lab integration authority at ${nowIso()}\n`
  const integrated = integrationTree({
    baseSha, candSha, labMainBefore, sealedPaths: measured.paths,
  })
  const newSha = git(["commit-tree", integrated.tree, "-p", labMainBefore, "-m", msg])
  git(["push", "lab", `${newSha}:refs/heads/main`], { })
  const labMainAfter = newSha.toLowerCase()
  // fast-forward local bookkeeping
  try { git(["fetch", "--quiet", "lab", "main"]) } catch {}
  console.log(`LAB MAIN ADVANCED ${labMainBefore.slice(0, 10)} -> ${labMainAfter.slice(0, 10)} (${changed.length} files, ${integrated.mode})`)

  // 7) MIRROR SYNC — attempted, never authoritative.
  // Hardening (follow-up 4, extended after the adversarial review): the governed merge is BOUND to
  // the sealed head (numeric PR, verified remote identity, --match-head-commit), convergence is
  // proven by fetching the mirror and comparing trees, every failure mode reports what actually
  // happened (a merge that succeeded is never reported as "merge unavailable"), and the documented
  // mirror/<sha> fallback still runs when the governed merge cannot be bound.
  let mirror = { state: "OUT_OF_SYNC", detail: "not attempted" }
  const rawPr = flags.pr
  // Strict decimal parse: Number() accepts 0x10 -> 16, so an operator typo could target a
  // different PR. Digits only, nothing else.
  const mirrorPr = typeof rawPr === "string" && /^[1-9][0-9]*$/.test(rawPr.trim()) ? Number(rawPr.trim()) : null
  let remoteUrl = ""
  try { remoteUrl = git(["remote", "get-url", MIRROR_REMOTE]) } catch { remoteUrl = "" }
  // Full URL form binding: host AND repo. A path-suffix test would accept
  // https://evil.example/bsvalues/terragroq.git and let a foreign origin fake IN_SYNC.
  const MIRROR_URL_FORM = /^(https?:\/\/(www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)bsvalues\/terragroq(\.git)?$/i
  if (!MIRROR_URL_FORM.test(remoteUrl.trim())) {
    // The convergence proof compares "the mirror's main tree" against the lab main tree; if
    // MIRROR_REMOTE does not actually point at MIRROR_REPO, that comparison is circular. The
    // binding gates EVERY mirror-side action, including the documented fallback push.
    mirror = { state: "OUT_OF_SYNC", detail: `MIRROR_REMOTE_MISMATCH ${MIRROR_REMOTE} -> ${remoteUrl.trim().slice(0, 80) || "(unset)"} is not ${MIRROR_REPO} (no mirror-side action attempted)` }
  } else {
    // Reviewer thread (P2) closure: the documented mirror/<sha> fallback runs whenever the
    // governed PR merge is unavailable — bad/absent --pr, a head that does not bind, or a failed
    // merge — so a successful lab integration is always exposed on the mirror when transport works.
    const fallbackPush = (reason) => {
      try {
        const branch = `mirror/${labMainAfter.slice(0, 10)}`
        git(["push", "--quiet", "--force", MIRROR_REMOTE, `${labMainAfter}:refs/heads/${branch}`])
        mirror = { state: "OUT_OF_SYNC", detail: `${reason}; pushed lab main to mirror branch ${branch}` }
      } catch (fallbackError) {
        mirror = { state: "OUT_OF_SYNC", detail: `${reason}; mirror unreachable: ${String(fallbackError.message ?? fallbackError).slice(0, 140)}` }
      }
    }
    if (mirrorPr === null) {
      fallbackPush(`MIRROR_PR_INVALID ${JSON.stringify(String(rawPr ?? ""))}: --pr must be a positive pull-request number`)
    } else {
      let mirrorHead = null
      try {
        const meta = JSON.parse(execSync(`gh api repos/${MIRROR_REPO}/pulls/${mirrorPr}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }))
        mirrorHead = String(meta?.head?.sha ?? "").toLowerCase()
      } catch (error) {
        mirror = { state: "OUT_OF_SYNC", detail: `mirror unreachable: ${String(error.message ?? error).slice(0, 160)}` }
      }
      if (mirrorHead !== null) {
        const headBound = mirrorHead === candSha
        let mergeError = null
        if (headBound) {
          try {
            // --match-head-commit closes the read→merge window: GitHub refuses if the head moved.
            execSync(`gh pr merge ${mirrorPr} --repo ${MIRROR_REPO} --squash --admin --match-head-commit ${candSha}`, { stdio: "pipe" })
          } catch (error) { mergeError = error }
        }
        if (headBound && !mergeError) {
          try {
            git(["fetch", "--quiet", MIRROR_REMOTE, "main"])
            const mirrorTree = git(["rev-parse", "FETCH_HEAD^{tree}"]).toLowerCase()
            const labTree = git(["rev-parse", `${labMainAfter}^{tree}`]).toLowerCase()
            mirror = mirrorTree === labTree
              ? { state: "IN_SYNC", detail: `PR #${mirrorPr} merged via governed path at sealed head ${candSha.slice(0, 10)}; mirror tree ${mirrorTree.slice(0, 10)} verified equal to lab main tree` }
              : { state: "OUT_OF_SYNC", detail: `MIRROR_TREE_MISMATCH mirror=${mirrorTree.slice(0, 10)} lab=${labTree.slice(0, 10)}` }
          } catch (error) {
            // The merge DID happen; this is a verification failure, not a merge failure, and a
            // branch-push fallback here would misreport the state.
            mirror = { state: "OUT_OF_SYNC", detail: `MIRROR_VERIFY_FAILED_AFTER_MERGE PR #${mirrorPr} merged but the mirror tree could not be verified: ${String(error.message ?? error).slice(0, 120)}` }
          }
        } else {
          fallbackPush(mergeError
            ? `PR merge unavailable (${String(mergeError.message ?? mergeError).slice(0, 120)})`
            : `MIRROR_HEAD_MISMATCH pr#${mirrorPr} head=${mirrorHead.slice(0, 10)} cand=${candSha.slice(0, 10)}: merge refused rather than merging an unbound head`)
        }
      }
    }
  }

  const entry = recordState({
    at: nowIso(), candidate: candSha, base: baseSha,
    labMainBefore, labMainAfter, sealKey: seal.payload.keyId, reviewerKey: review.payload?.keyId,
    localTests: localEvidence ? {
      digest: localEvidence.digest, total: localEvidence.total, passed: localEvidence.passed,
      pending: localEvidence.pending, suites: localEvidence.suites, suiteFiles: localEvidence.suiteFiles,
      record: localEvidence.record, headSha: localEvidence.headSha,
    } : null,
    productState: "COMPLETE", mirrorState: mirror.state, mirrorDetail: mirror.detail,
  })
  console.log(`PRODUCT STATE: COMPLETE`)
  console.log(`MIRROR STATE: ${mirror.state} — ${mirror.detail}`)
  console.log(`recorded: ${STATE_PATH}`)
  void entry
}

// Run only as a CLI. Tests import `integrationTree` to exercise the merge semantics directly.
// fileURLToPath (not URL.pathname): percent-encodings and Windows drive letters must compare
// exactly, or a space in the checkout path would silently suppress main() and exit 0 as a
// false success. An import for tests never matches; a real CLI invocation always does.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`INTEGRATION_REFUSED: ${String(error.message ?? error)}`)
    process.exitCode = 1
  })
}
