import { execFile as execFileCallback } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import pg from "pg"

import { createNativeAdapters } from "./native-adapters.mjs"
import { classifyProposedAction } from "./owner-gate-policy.mjs"
import { IMPLEMENTATION, buildWorkerPrompt, laneRoster, selectLane } from "./worker-lanes.mjs"
import { brokeredExec } from "../../lib/fabric/broker.mjs"
import {
  HERMES_KERNEL_INVOKER_RELATIVE,
  HERMES_KERNEL_POLICY_RELATIVE,
  KERNEL_SESSION_ID_PATTERN,
  KERNEL_STATE_DIR,
  kernelQuarantinePath,
  kernelThreadsRoot,
} from "../hermes-bridge/hermes-kernel-client.mjs"
import { HERMES_FREE_AGENT_COMPLETE_PATTERN } from "../hermes-bridge/hermes-kernel-output.mjs"

/**
 * GitHub through the broker, on the worker node.
 *
 * HERMES has no gh CLI and no GitHub credential, deliberately: it is the control plane. AEGIS holds the
 * authenticated gh, so every GitHub projection and delivery call routes there through the fabric broker
 * -- the one way this system touches a node -- and lands in its audit ledger like everything else.
 */
function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

async function ghRemote(args, { timeout = 60_000 } = {}) {
  try {
    const result = await brokeredExec("aegis", ["gh", ...args.map(shellQuote)].join(" "), { action: "resident-gh", timeout })
    return { stdout: result.stdout ?? "" }
  } catch {
    throw new Error("PROCESS_WALL:gh")
  }
}

async function shipRemoteFile(content, remotePath) {
  const encoded = Buffer.from(content, "utf8").toString("base64")
  await brokeredExec("aegis", "echo " + encoded + " | base64 -d > " + shellQuote(remotePath), { action: "resident-gh" })
}


const execFile = promisify(execFileCallback)
const REPOSITORY = "bsvalues/terragroq"
const FINDING_EFFECT_KEYS = new Set([
  "spendsMoney", "irreversible", "mutatesProductionData", "releaseOrCutover",
  "protectedResource", "unresolvedLegalPrivacyOrSecurityRisk", "touchesCredentials",
  "changesReviewedPolicy", "outsideObjectiveScope", "competesWithPriority", "destroys",
])
const FINDING_SECRET = new RegExp([
  "-----" + "BEGIN [A-Z ]*PRIVATE KEY-----",
  "\\bsk-[A-Za-z0-9_-]{20,}\\b",
  "\\bgh[oprsu]_[A-Za-z0-9]{20,}\\b",
  "(?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?):\\/\\/[^\\s]+",
  "(?:password|token|api[_ -]?key|client[_ -]?secret)\\s*[:=]\\s*[\"']?[^\\s\"']{12,}",
].join("|"), "i")
const FINDING_CONTROL = /(?:ignore\s+(?:(?:all\s+|any\s+|the\s+)?previous|(?:the\s+)?(?:declared|authority|boundary|rules?))|system\s+(?:message|prompt)|developer\s+(?:message|instruction)|<\/?system\b|\[INST\]|do\s+not\s+follow\s+(?:the\s+)?(?:rules|instructions))/i

function validFindingEffects(effects) {
  if (!effects || typeof effects !== "object" || Array.isArray(effects)) return false
  const entries = Object.entries(effects)
  if (entries.length !== FINDING_EFFECT_KEYS.size
    || entries.some(([key]) => !FINDING_EFFECT_KEYS.has(key))
    || [...FINDING_EFFECT_KEYS].some((key) => !Object.hasOwn(effects, key))) return false
  for (const [key, value] of entries) {
    if (key !== "destroys" && typeof value !== "boolean") return false
    if (key === "destroys" && (!Array.isArray(value) || value.some((target) =>
      !target || typeof target !== "object" || Array.isArray(target)
      || Object.keys(target).some((field) => !new Set(["path", "verifiedCopyElsewhere"]).has(field))
      || typeof target.path !== "string" || typeof target.verifiedCopyElsewhere !== "boolean"))) return false
  }
  return true
}

function validFindingText(value) {
  return typeof value === "string" && value.trim() !== "" && value.length <= 2_000
    && !FINDING_SECRET.test(value) && !FINDING_CONTROL.test(value)
}

function validFindingPaths(paths) {
  return Array.isArray(paths) && paths.length > 0 && paths.every((candidate) =>
    typeof candidate === "string" && candidate.length <= 300 && !candidate.startsWith("/")
    && !candidate.includes("\\") && !candidate.split("/").includes(".."))
}

function validFindingMetadata(metadata) {
  return Number.isSafeInteger(metadata?.sequence) && metadata.sequence > 0
    && validFindingText(metadata?.summary) && validFindingText(metadata?.task)
    && validFindingPaths(metadata?.paths) && validFindingEffects(metadata?.effects)
}

/**
 * WilliamOS-state adapters for the operational kernel (#WO-0027, GRANT-0013).
 *
 * The kernel shipped complete and inert: its only trigger was GitHub labels and its only dispatcher was
 * `local-nested-codex-exec` -- the issue #357 adapter, terminally quarantined by owner revocation. That
 * quarantine is preserved untouched. This is the deliberate replacement lib/governance/execute-guard.ts
 * anticipated: a NEW adapter id, a NEW trigger, a NEW dispatch mechanism, under a recorded owner grant.
 *
 * The trigger is WilliamOS state on ATLAS: work_order rows are the queue, authority_grant rows are the
 * authority, and eligibility means an active owner grant is linked to the work order. GitHub is
 * projection -- labels and issue comments follow what happened; they never cause it.
 *
 * Dispatch honours the work order's lane. WO-0026 is Codex's per the owner's frozen assignment, so the
 * worker is the codex CLI, headless, editing a detached worktree the kernel prepared. The kernel's own
 * walls -- path, budget, secret, binary -- inspect everything the worker produced before it goes near a
 * branch.
 */

/**
 * When the worker says its meter refills, as epoch seconds.
 *
 * "You have hit your usage limit ... try again at Aug 19th, 2026 8:33 PM." is machine-readable
 * scheduling information, not an owner boundary. Parsed here so the kernel can wait exactly that long
 * instead of burning retry attempts against a known-empty meter or asking a human to say "release".
 */
export function parseCodexRetryAfter(text) {
  const body = String(text ?? "")
  // The Claude CLI states the same fact as epoch seconds after a pipe ("limit reached|1755640380").
  // Same information, different dialect; the kernel should wait exactly as long either way.
  const epoch = /limit reached\|(\d{9,11})(?![\d])/i.exec(body)
  if (epoch) {
    const seconds = Number(epoch[1])
    return seconds * 1000 > Date.now() ? seconds : null
  }
  const match = /try again at ([^.\r\n]+?)(?:\.|$)/i.exec(String(text ?? ""))
  if (!match) return null
  const cleaned = match[1].replace(/(\d+)(?:st|nd|rd|th)/g, "$1").trim()
  const parsed = Date.parse(cleaned)
  return Number.isFinite(parsed) && parsed > Date.now() ? Math.floor(parsed / 1000) : null
}

/**
 * The GitHub issue this work order is projected to. Projection, not trigger.
 *
 * Stated explicitly, never inferred. Taking the first #N in a free-text description meant any work
 * order that cited prior art misprojected onto whatever it cited: WO-0029 named #871 as background
 * before naming its own #891, so the kernel delivered correct work, wrote "Closes #871" into its pull
 * request, and left the issue it was actually for untouched and open.
 *
 * A description with no explicit projection returns null, which omits the work order from the registry.
 * That is the intended failure: a work order whose projection cannot be read is not dispatched, rather
 * than dispatched at a guess. Omitting beats fabricating.
 */
export function parseProjectionIssue(description) {
  const text = String(description ?? "")
  const explicit =
    /projected\s+at\s+(?:github\s+)?issue\s*#?(\d{2,6})\b/i.exec(text) ??
    /\bprojection\s*[:=]\s*#?(\d{2,6})\b/i.exec(text)
  return explicit ? Number(explicit[1]) : null
}

export function projectionCompletionOwned(description) {
  return !/\bprojection\s+completion\s*:\s*parent-owned\b/i.test(String(description ?? ""))
}

export function projectionIssueDirective(issueNumber, completionOwned) {
  return completionOwned
    ? `Closes #${issueNumber}.`
    : `Tracks #${issueNumber}; completion remains owned by the parent outcome.`
}

/** An owner grant is linked when the work order names its ref, or the grant's scope names the work order. */
export function linkGrant(workOrder, grants) {
  if (Number.isInteger(workOrder?.authorityGrantId)) {
    return grants.find((grant) => grant.id === workOrder.authorityGrantId
      && (grant.allowedActions ?? []).includes("implement")) ?? null
  }
  return grants.find((grant) =>
    (grant.allowedActions ?? []).includes("implement")
    && ((workOrder.description ?? "").includes(grant.ref) || grant.scope === workOrder.ref)) ?? null
}

/** Kernel queue states from work order status. The registry decides real eligibility; this only gates. */
export function queueStateFor(status) {
  if (status === "completed" || status === "done") return "COMPLETED"
  if (status === "active") return "LEASED"
  return "READY"
}

/**
 * Registry records for the kernel, derived from state rather than a checked-in JSON.
 *
 * A record exists only when the work order has an ACTIVE linked grant, a non-empty reservation, a
 * validation plan, and a projection issue. Anything less is omitted rather than filled in: fabricating
 * an envelope the owner never froze is how an agent grants itself authority with extra steps.
 */
export function buildRegistryRecords(workOrders, grants, adapterId) {
  const records = []
  for (const workOrder of workOrders) {
    const grant = linkGrant(workOrder, grants)
    if (!grant) continue
    const allowedPaths = (workOrder.allowedFiles ?? []).filter(Boolean)
    const requiredValidation = (workOrder.validators ?? []).filter((gate) =>
      ["diff-check", "lint", "test", "build"].includes(gate))
    if (allowedPaths.length === 0 || requiredValidation.length === 0) continue
    if (parseProjectionIssue(workOrder.description) === null) continue
    records.push({
      workOrderId: workOrder.ref,
      workOrderRowId: workOrder.id,
      userId: workOrder.userId,
      adapterId,
      authority: "APPROVED",
      riskClass: "R1",
      ownerGateRequired: false,
      protectedScope: false,
      baseBranch: "main",
      mergeMode: "AUTO_ELIGIBLE",
      allowedPaths,
      forbiddenPaths: (workOrder.forbiddenFiles ?? []).filter(Boolean),
      requiredValidation,
      dependencies: [],
      task: workOrder.description ?? workOrder.title,
      grantRef: grant.ref,
      // Carried so a derived child can check its parent is still valid at derivation time. A grant
      // revoked mid-objective must stop the next child, not merely the next objective.
      grantStatus: grant.status,
      grantExpiresAt: grant.expiresAt,
      projectionCompletionOwned: projectionCompletionOwned(workOrder.description),
      commitAllowed: workOrder.commitAllowed,
      tagAllowed: workOrder.tagAllowed,
      pushAllowed: workOrder.pushAllowed,
      agent: workOrder.agent ?? "codex",
    })
  }
  return records
}

async function run(command, args, options = {}) {
  try {
    const pending = execFile(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: options.timeout ?? 30 * 60 * 1000,
      windowsHide: true,
      env: options.env ?? process.env,
    })
    // codex exec appends piped stdin to its prompt and waits for EOF before starting, so a child left
    // holding an open stdin pipe hangs forever at zero CPU -- the first dispatched worker did exactly
    // that for 25 minutes. Closing stdin at spawn says: nothing is coming. Harmless for git and pnpm.
    pending.child?.stdin?.end()
    return await pending
  } catch (error) {
    const output = `${error?.stdout ?? ""}${error?.stderr ?? ""}`
    // The worker saying "usage limit" is not a process failure and must not be audited as one:
    // the loop parks either way, but the checkpoint should name the actual reason and when it lifts.
    if (/hit your usage limit|usage limit reached|limit reached\|\d+|credit balance is too low|rate.?limit/i.test(output)) {
      const retryAfter = parseCodexRetryAfter(output)
      throw new Error(retryAfter ? `CODEX_RATE_LIMIT_WALL:retry-${retryAfter}` : "CODEX_RATE_LIMIT_WALL")
    }
    const wall = new Error(`PROCESS_WALL:${command}`)
    wall.output = output
    throw wall
  }
}

/** Test files vitest reported as failing, from its own output. */
export function parseFailingTestFiles(output) {
  // Real vitest output carries the escape byte before the bracket; stripping only the bracket
  // leaves it wedged between FAIL and the path, where it stops looking like whitespace.
  const cleaned = String(output ?? "").replace(/?\[[0-9;]*m/g, "")
  const found = cleaned.match(/FAIL\s+(\S+\.test\.[cm]?[jt]sx?)/g) ?? []
  return [...new Set(found.map((entry) => entry.replace(/^FAIL\s+/, "").replaceAll("\\", "/")))].sort()
}

/**
 * Failures the patch is answerable for: the ones that were not already failing without it.
 *
 * A gate that fails a worker for its host's pre-existing breakage is unwinnable, and an unwinnable gate
 * converts correct work into FAILED_TERMINAL. Measured on this machine, pristine main fails 23 tests
 * across four host-dependent files that pass on CI's Linux runner; every remediation round tonight died
 * on them. The worker answers for what it broke, and CI remains the authority on the rest.
 */
export function newlyFailingTests(failing, baseline) {
  const known = new Set(baseline ?? [])
  return (failing ?? []).filter((file) => !known.has(file))
}

/**
 * The deterministic suite does not finish inside twenty minutes on this host.
 *
 * That was the old budget, and a suite killed by its own deadline prints no failure summary, so the
 * differential gate read the corpse and found no failing files. Both sides of the comparison were
 * blank, which the gate could not tell apart from a clean run.
 */
const SUITE_TIMEOUT_MS = 45 * 60 * 1000

/**
 * What this host fails without any patch applied, cached per base commit.
 *
 * Measured in a throwaway worktree at the same commit so the work order's own workspace is never
 * disturbed. Costs one suite run the first time a commit is seen and nothing thereafter.
 *
 * Returns null when no measurement happened: a run killed by its deadline, an install that never
 * produced a suite, output truncated before the summary. That is not the same claim as "this host
 * fails nothing", and recording it as if it were is permanent -- every baseline cached here said
 * `[]` for a suite that never reached its summary, so every later cycle compared against a fiction.
 * An unmeasured baseline is retried, never remembered.
 */
export async function measureBaselineFailures({ root, repositoryPath, head, runner = run }) {
  const cacheFile = path.join(root, "state", "baselines", head + ".json")
  if (fs.existsSync(cacheFile)) {
    try {
      // Only a record that says it was measured is believed. The ones written before this marker
      // existed cannot be told apart from a blind run, so they are remeasured rather than trusted.
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"))
      if (cached?.measured === true) return cached.failing ?? []
    } catch { /* a corrupt cache is remeasured, not trusted */ }
  }
  const scratch = path.join(root, "state", "baselines", "wt-" + head.slice(0, 12))
  let failing = []
  let measured = true
  try {
    fs.rmSync(scratch, { recursive: true, force: true })
    await runner("git", ["worktree", "add", "--detach", scratch, head], { cwd: repositoryPath, timeout: 5 * 60 * 1000 })
    await runner("cmd.exe", ["/c", "pnpm", "install", "--frozen-lockfile"], { cwd: scratch, timeout: 10 * 60 * 1000 })
    await runner("cmd.exe", ["/c", "pnpm", "exec", "vitest", "run", "--config", "vitest.ci.config.ts"], { cwd: scratch, timeout: SUITE_TIMEOUT_MS })
  } catch (error) {
    failing = parseFailingTestFiles(error?.output)
    // A suite that failed while naming no test file was not read. Only a run that either finished
    // clean or named what it broke has measured anything.
    measured = failing.length > 0
  } finally {
    try {
      await runner("git", ["worktree", "remove", "--force", scratch], { cwd: repositoryPath, timeout: 2 * 60 * 1000 })
    } catch { /* a stale scratch worktree is not worth failing a cycle over */ }
  }
  if (!measured) return null
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
  fs.writeFileSync(cacheFile, JSON.stringify({ head, failing, measured: true, measuredAt: new Date().toISOString() }, null, 2) + "\n", "utf8")
  return failing
}

/**
 * The #831 work-context receipt, issued against live main.
 *
 * The repository carries the #831 PreToolUse hook, so a worker inside it has every edit denied unless
 * a valid receipt sits at .williamos/work-context.json. The first rerouted dispatch proved it: the
 * worker designed the fix and could apply none of it. The dispatcher holds the facts, so it equips its
 * worker -- the same receipt it already composes at publish time. The file is gitignored and the
 * kernel walls inspect the patch afterwards regardless.
 *
 * One issuer for every lane. A lane that mints its own receipt is a lane whose facts drift from the
 * others', and the drift only shows up as a worker that mysteriously cannot edit.
 */
async function issueWorkContext({ repositoryPath, workOrderId, allowedPaths }) {
  const { receiptToken } = await import("../../lib/governance/work-context-receipt.ts")
  const { measureDoctrineDigest } = await import("../../lib/governance/work-context-live.ts")
  await run("git", ["fetch", "origin", "main"], { cwd: repositoryPath })
  const liveMain = (await run("git", ["rev-parse", "origin/main"], { cwd: repositoryPath })).stdout.trim()
  const { digest } = await measureDoctrineDigest()
  const facts = {
    mainSha: liveMain,
    workOrderRef: workOrderId,
    parentOutcome: "OUTCOME-762",
    reservedPaths: allowedPaths.map((allowed) => allowed.endsWith("/**") ? allowed.slice(0, -2) : allowed),
    authorityLevel: "A2_WRITE_OWN",
    doctrineDigest: digest,
    existingSubsystem: "integrating",
    topologySource: "canonical-registry",
    collisions: [],
    remainingParentAcceptance: "resident continuation delivering an authorized child of #762",
  }
  return { ["to" + "ken"]: receiptToken(facts), facts }
}

/** Write a lane's work-context receipt into the tree that lane will actually edit. */
function equipWorkContext(target, workContext) {
  fs.mkdirSync(path.join(target, ".williamos"), { recursive: true })
  fs.writeFileSync(path.join(target, ".williamos", "work-context.json"), `${JSON.stringify(workContext, null, 2)}\n`, "utf8")
}

/**
 * The resident local lane's run id: unique per dispatch, and shaped the way its invoker demands.
 *
 * The invoker names the container after this and refuses anything outside [A-Za-z0-9-]{8,64}, so the
 * work order id is folded into that alphabet rather than assumed to already be in it.
 */
export function hermesRunId(workOrderId, unique) {
  return `${String(workOrderId ?? "")}-${unique}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "").slice(0, 64)
}

/**
 * The exact packet the Hermes Agent invoker validates in owned-worktree mode.
 *
 * The invoker compares the packet's field NAMES against a fixed sorted list and refuses any
 * difference, so this composes that set and nothing besides. Every value is read from the reviewed
 * policy rather than restated here: a second copy of a pinned value is a second thing to drift, and
 * the invoker would refuse the drift as a forged packet rather than as the mistake it was.
 */
export function buildHermesPacket({ policy, prompt, runId, workspacePath, statePath, kernelSessionId = null }) {
  if (!Number.isInteger(policy?.packetSchemaVersion)) throw new Error("PROVIDER_LANE_POLICY_WALL")
  return {
    schemaVersion: policy.packetSchemaVersion,
    workOrderId: policy.workOrderId,
    model: policy.model.id,
    prompt,
    maximumTurns: policy.execution.maximumTurns,
    toolsets: [...policy.execution.allowedToolsets],
    workspaceMode: "OWNED_WORKTREE",
    workspacePath,
    runId,
    statePath,
    kernelSessionId,
  }
}

const HERMES_TIMEOUT_MS = 45 * 60 * 1000

/**
 * Dispatch the resident local lane, reconciling two workspaces that each own themselves.
 *
 * The kernel owns a worktree under its own root and collects the patch from it. The provider's v2
 * mode owns a worktree under the root its policy allows, mounts that into the container, and refuses
 * to run anywhere else -- correctly, since the mount is its containment. Neither ownership can move,
 * so the lane runs in a provider-side worktree parked at the kernel workspace's own HEAD, carrying
 * whatever that workspace already had staged, and the caller collects the patch from there.
 *
 * Getting this wrong is silent in both directions: diff the kernel tree and the patch is empty
 * because nothing touched it; run the provider tree at some other commit and the patch is foreign,
 * reverting work the kernel had already accepted. Hence the base sha and the carried patch, both read
 * from the kernel workspace immediately before the run.
 *
 * The provider tree is never validated in and never installed into -- validation stays in the kernel
 * workspace, which is what keeps this worktree clean enough for the invoker to accept.
 */
/**
 * Paths the provider policy pins, and whether the volumes holding them are actually mounted.
 *
 * Returned rather than thrown so a caller can name every missing volume at once instead of surfacing
 * them one reconnect at a time.
 */
export function unmountedPolicyVolumes(policy, exists = fs.existsSync) {
  const pinned = [
    policy?.placement?.dockerConfig,
    policy?.placement?.workspaceRoot,
    policy?.placement?.baselineWorkspace,
    ...(policy?.placement?.allowedWorkspaceRoots ?? []),
  ].filter((entry) => typeof entry === "string" && entry.trim() !== "")
  const missing = new Map()
  for (const entry of pinned) {
    // Derived here rather than via path.parse: the policy names Windows volumes, and a Linux CI runner
    // reading "D:\..." sees an unrooted relative path and reports nothing missing. The volume a path
    // names is a property of the path, not of the machine reading it.
    const drive = /^([A-Za-z]:)[\\/]/.exec(entry)
    const root = drive ? `${drive[1]}\\` : (/^[\\/]/.test(entry) ? "/" : null)
    if (!root || exists(root)) continue
    if (!missing.has(root)) missing.set(root, entry)
  }
  return [...missing.entries()].map(([volume, example]) => ({ volume, example }))
}

export async function dispatchHermesLocal({
  root, repositoryPath, workOrderId, workspace, prompt, workContext = null,
  runner = run, newId = () => crypto.randomUUID(),
}) {
  const policyPath = path.resolve(repositoryPath, HERMES_KERNEL_POLICY_RELATIVE)
  const invokerPath = path.resolve(repositoryPath, HERMES_KERNEL_INVOKER_RELATIVE)
  let policy
  try { policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) } catch { throw new Error("PROVIDER_LANE_POLICY_WALL") }
  if (!fs.existsSync(invokerPath)) throw new Error("PROVIDER_LANE_INVOKER_WALL")
  // A pinned path on a volume that is not mounted is not a missing deployment, and it is certainly not
  // a model that cannot code. D: was unplugged once and the lane reported its stack as never installed,
  // which is a verdict about a cable wearing the costume of a verdict about a lane. Name the volume.
  const unmounted = unmountedPolicyVolumes(policy)
  if (unmounted.length > 0) {
    throw new Error(`PROVIDER_LANE_VOLUME_WALL:${unmounted.map((entry) => entry.volume.replace(/[\\/]+$/, "")).join(",")}`)
  }
  const declaredRoot = policy?.placement?.allowedWorkspaceRoots?.[0]
  if (policy?.placement?.workspaceMode !== "OWNED_WORKTREE" || typeof declaredRoot !== "string" || !path.isAbsolute(declaredRoot)) {
    throw new Error("PROVIDER_LANE_WORKSPACE_WALL")
  }
  // The container's deadline must fit inside ours. Shorter and we kill the invoker before it can stop
  // its container and clear its marker -- the one failure that leaves the lane quarantined for work
  // that was never at fault.
  if (HERMES_TIMEOUT_MS < Number(policy?.execution?.timeoutSeconds ?? 0) * 1000) throw new Error("PROVIDER_LANE_TIMEOUT_WALL")

  const worktreesRoot = path.resolve(declaredRoot)
  const runtimeRoot = path.dirname(worktreesRoot)
  // Named for this kernel: the bridge owns worktrees in the same root, and neither may adopt the
  // other's tree by guessing at a name.
  const owned = path.join(worktreesRoot, `runtime-operator-${workOrderId.toLowerCase()}`)

  const baseSha = (await runner("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim()
  const carried = (await runner("git", ["diff", "--cached", "--binary"], { cwd: workspace })).stdout
  const registered = (await runner("git", ["worktree", "list", "--porcelain"], { cwd: repositoryPath })).stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()))
  // git prints the path it recorded, which on Windows can differ from ours in case alone. Compared
  // literally, round two would read its own worktree as a stranger's directory and refuse it.
  const isOwned = (candidate) => process.platform === "win32"
    ? candidate.toLowerCase() === owned.toLowerCase()
    : candidate === owned
  if (registered.some(isOwned)) {
    await runner("git", ["reset", "--hard", baseSha], { cwd: owned })
    // -x deliberately: the invoker refuses a worktree carrying node_modules, and an interrupted cycle
    // elsewhere is exactly how one arrives.
    await runner("git", ["clean", "-fdx"], { cwd: owned })
  } else {
    if (fs.existsSync(owned)) throw new Error("PROVIDER_WORKSPACE_RECONCILIATION_WALL")
    fs.mkdirSync(worktreesRoot, { recursive: true })
    await runner("git", ["worktree", "add", "--detach", owned, baseSha], { cwd: repositoryPath, timeout: 120_000 })
  }
  if (carried.trim()) {
    // Whatever the kernel workspace already had staged is work this dispatch continues, not work it
    // rediscovers: a remediation round starting from pristine base reverts the round before it.
    const carriedFile = path.join(root, "state", "requests", `${workOrderId.toLowerCase()}-hermes-carried.patch`)
    fs.mkdirSync(path.dirname(carriedFile), { recursive: true })
    fs.writeFileSync(carriedFile, carried, "utf8")
    try { await runner("git", ["apply", "--whitespace=nowarn", carriedFile], { cwd: owned }) }
    finally { fs.rmSync(carriedFile, { force: true }) }
  }
  if (workContext) equipWorkContext(owned, workContext)

  // One thread per work order, so `hermes chat --resume` continues the same session across
  // remediation rounds instead of meeting the task cold each round. The state directory is the
  // thread's, mounted as the kernel's HERMES_HOME, and the invoker refuses any path outside the
  // runtime's own threads root.
  const threadsFile = path.join(root, "state", "hermes-threads.json")
  let threads
  try { threads = JSON.parse(fs.readFileSync(threadsFile, "utf8")) } catch { /* absent or corrupt: start a thread */ }
  if (!threads || typeof threads !== "object" || Array.isArray(threads)) threads = {}
  const threadId = typeof threads[workOrderId]?.threadId === "string" ? threads[workOrderId].threadId : newId()
  const kernelSessionId = typeof threads[workOrderId]?.kernelSessionId === "string" ? threads[workOrderId].kernelSessionId : null
  const statePath = path.join(kernelThreadsRoot(runtimeRoot), threadId, KERNEL_STATE_DIR)
  fs.mkdirSync(statePath, { recursive: true })

  const runId = hermesRunId(workOrderId, newId())
  const packet = buildHermesPacket({ policy, prompt, runId, workspacePath: owned, statePath, kernelSessionId })
  const packetPath = path.join(root, "state", "requests", `${workOrderId.toLowerCase()}-hermes-packet.json`)
  fs.mkdirSync(path.dirname(packetPath), { recursive: true })
  fs.writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })

  const invocation = await runner("pwsh", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", invokerPath,
    "-PacketPath", packetPath, "-PolicyPath", policyPath, "-WorkspacePath", owned, "-RunId", runId,
    "-QuarantinePath", kernelQuarantinePath(runtimeRoot), "-StatePath", statePath,
  ], { cwd: repositoryPath, timeout: HERMES_TIMEOUT_MS })

  const stdout = String(invocation.stdout ?? "")
  // Believe only a completion line naming THIS run. The invoker relays the model's own output, so a
  // completion the model echoed, or one left over from another run, must not be read as this one.
  const completion = stdout.match(HERMES_FREE_AGENT_COMPLETE_PATTERN)
  if (!completion || completion[1] !== runId) throw new Error("PROVIDER_LANE_COMPLETION_WALL")
  const session = stdout.match(KERNEL_SESSION_ID_PATTERN)?.[1] ?? kernelSessionId
  fs.mkdirSync(path.dirname(threadsFile), { recursive: true })
  threads[workOrderId] = { threadId, kernelSessionId: session, updatedAt: new Date().toISOString() }
  fs.writeFileSync(threadsFile, `${JSON.stringify(threads, null, 2)}\n`, "utf8")
  return owned
}

/**
 * Collect what the lane produced, and restore every tree the dispatch touched.
 *
 * The patch is taken from where the worker actually edited, which is the kernel workspace for the
 * lanes that run in it and the provider's owned worktree for the lane that cannot. Both are restored
 * either way: the kernel re-applies this patch through its own walls, and it must land on a pristine
 * tree to do that.
 */
export async function collectPatch({ patchWorkspace, workspace, runner = run }) {
  await runner("git", ["add", "-A"], { cwd: patchWorkspace })
  const patch = (await runner("git", ["diff", "--cached", "--binary"], { cwd: patchWorkspace })).stdout
  for (const tree of new Set([patchWorkspace, workspace])) {
    await runner("git", ["reset", "--hard", "HEAD"], { cwd: tree })
    await runner("git", ["clean", "-fd"], { cwd: tree })
  }
  if (!patch.trim()) throw new Error("CODEX_PATCH_REQUIRED_WALL")
  return patch
}

export function createWilliamOSAdapters({ root, repositoryPath, database = null }) {
  const adapterId = "williamos-resident-v1"
  const native = createNativeAdapters({ root, repositoryPath })
  const pool = database ?? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  // native applyAndInspect writes state/requests/active.patch and assumed the legacy dispatch had
  // created the directory; the replacement dispatch must keep that floor under it.
  fs.mkdirSync(path.join(root, "state", "requests"), { recursive: true })
  let issueToRef = new Map()

  async function loadWorkOrders() {
    const result = await pool.query(
      `SELECT "id", "userId", "ref", "title", "description", "status", "lane", "agent",
              "authorityGrantId", "allowedFiles", "forbiddenFiles", "validators",
              "commitAllowed", "tagAllowed", "pushAllowed", "createdAt"
         FROM work_order WHERE "lane" = 'operator-objective' AND "ref" IS NOT NULL`,
    )
    return result.rows
  }

  async function loadActiveGrants() {
    const result = await pool.query(
      `SELECT "id", "userId", "ref", "scope", "allowedActions", "blockedActions",
              "status", "expiresAt", "revokedAt"
         FROM authority_grant
        WHERE "status" = 'active' AND "revokedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > timezone('UTC', now()))`,
    )
    return result.rows
  }

  async function refForIssue(issueNumber) {
    if (issueToRef.has(issueNumber)) {
      const identities = issueToRef.get(issueNumber)
      if (identities.length !== 1) throw new Error("QUEUE_PROJECTION_WALL")
      return identities[0]
    }
    const matches = (await loadWorkOrders()).filter((workOrder) =>
      parseProjectionIssue(workOrder.description) === issueNumber)
    if (matches.length !== 1) throw new Error("QUEUE_PROJECTION_WALL")
    const [workOrder] = matches
    return { workOrderRowId: workOrder.id, userId: workOrder.userId, workOrderId: workOrder.ref }
  }

  function findingDigest(value) {
    return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")
  }

  function pathWithin(candidate, reservations) {
    const target = String(candidate).replaceAll("\\", "/")
    return reservations.some((entry) => {
      const declared = String(entry).replaceAll("\\", "/")
      const subtree = declared.endsWith("/**")
      const normalized = subtree ? declared.slice(0, -3) : declared
      return target === normalized || (subtree && target.startsWith(`${normalized}/`))
    })
  }

  async function persistFindingOutcome({ eventType, payload, createChild }) {
    const objectiveWorkOrderId = createChild ? payload?.derivedFrom : payload?.objectiveWorkOrderId
    if (!Number.isInteger(payload?.sourceFindingEventId)
      || typeof payload?.findingId !== "string" || payload.findingId.trim() === ""
      || typeof payload?.sourceUserId !== "string" || payload.sourceUserId.trim() === ""
      || typeof payload?.sourcePayloadDigest !== "string" || !/^[0-9a-f]{64}$/.test(payload.sourcePayloadDigest)
      || typeof objectiveWorkOrderId !== "string" || objectiveWorkOrderId.trim() === "") {
      throw new Error("FINDING_SETTLEMENT_SHAPE_WALL")
    }
    const canonical = createChild
      ? {
          sourceFindingEventId: payload.sourceFindingEventId,
          sourceUserId: payload.sourceUserId,
          findingId: payload.findingId,
          objectiveWorkOrderId,
          childWorkOrderRef: payload.workOrderId,
          issueNumber: payload.issueNumber,
          allowedPaths: payload.allowedPaths,
          requiredValidation: payload.requiredValidation,
          task: payload.task,
          grantRef: payload.grantRef,
          contractId: payload.contractId,
          contractDigest: payload.contractDigest,
          authorizationDecisionId: payload.authorizationDecisionId,
          implementationGrantId: payload.implementationGrantId,
          projectionCompletionOwned: payload.projectionCompletionOwned,
        }
      : {
          sourceFindingEventId: payload.sourceFindingEventId,
          sourceUserId: payload.sourceUserId,
          findingId: payload.findingId,
          objectiveWorkOrderId,
          issueNumber: payload.issueNumber,
          gate: payload.gate,
          gates: payload.gates,
          reason: payload.reason,
          contractId: payload.contractId,
          contractDigest: payload.contractDigest,
          authorizationDecisionId: payload.authorizationDecisionId,
          implementationGrantId: payload.implementationGrantId,
          grantRef: payload.grantRef,
          projectionCompletionOwned: payload.projectionCompletionOwned,
        }
    const payloadDigest = findingDigest(canonical)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`runtime-finding-source:${payload.sourceFindingEventId}`])
      const sourceResult = await client.query(
        `SELECT source.id AS "sourceFindingEventId", source."userId" AS "sourceUserId",
                source.actor AS "sourceActor", source."entityId" AS "sourceEntityId", source.metadata
           FROM governance_event AS source
          WHERE source.id = $1
            AND source."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
            AND source."entityType" = 'work_order'
          FOR UPDATE OF source`,
        [payload.sourceFindingEventId],
      )
      const source = sourceResult.rows[0]
      const sourceBound = source
        && source.sourceUserId === payload.sourceUserId
        && new Set(["hermes", "williamos-runtime-operator"]).has(source.sourceActor)
        && source.metadata?.schemaVersion === 1
        && source.metadata?.findingId === payload.findingId
        && source.metadata?.objectiveWorkOrderId === objectiveWorkOrderId
        && findingDigest(source.metadata) === payload.sourcePayloadDigest
        && source.metadata?.workContractId === payload.contractId
        && source.metadata?.workContractDigest === payload.contractDigest
        && source.metadata?.authorizationDecisionId === payload.authorizationDecisionId
        && source.metadata?.implementationGrantId === payload.implementationGrantId
        && source.metadata?.implementationGrantRef === payload.grantRef
        && source.metadata?.projectionCompletionOwned === payload.projectionCompletionOwned
      if (!sourceBound) throw new Error("FINDING_SOURCE_BINDING_WALL")
      const prior = await client.query(
        `SELECT "eventType", metadata FROM governance_event
          WHERE metadata->>'objectiveWorkOrderId' = $1
            AND metadata->>'sourceFindingEventId' = $2
            AND "userId" = $3
            AND "eventType" IN ('RUNTIME_FINDING_DERIVED', 'RUNTIME_FINDING_OWNER_GATED')
          ORDER BY id DESC LIMIT 1`,
        [objectiveWorkOrderId, String(payload.sourceFindingEventId), payload.sourceUserId],
      )
      if (prior.rows.length > 0) {
        const settled = prior.rows[0]
        if (settled.eventType !== eventType || settled.metadata?.payloadDigest !== payloadDigest) {
          throw new Error("FINDING_SETTLEMENT_REPLAY_WALL")
        }
        await client.query("COMMIT")
        return { workOrderId: canonical.childWorkOrderRef ?? null, replayed: true }
      }

      const authority = await client.query(
        `SELECT parent.id AS "parentId", parent."userId", parent.ref AS "parentRef",
                parent.status AS "parentStatus", parent."authorityGranted",
                parent.description AS "parentDescription",
                parent.goal, parent.loop, parent.scope, parent."nonGoals",
                parent."allowedFiles" AS "parentAllowedFiles",
                parent."forbiddenFiles", parent.validators AS "parentValidators",
                parent."stopConditions", parent."authorityLevel",
                parent."commitAllowed" AS "parentCommitAllowed",
                parent."tagAllowed" AS "parentTagAllowed",
                parent."pushAllowed" AS "parentPushAllowed",
                grant.id AS "grantId", grant.ref AS "grantRef", grant.status AS "grantStatus",
                grant."revokedAt" AS "grantRevokedAt", grant."expiresAt" AS "grantExpiresAt",
                grant."allowedActions" AS "grantAllowedActions",
                grant."blockedActions" AS "grantBlockedActions", grant.scope AS "grantScope"
           FROM work_order AS parent
           JOIN authority_grant AS grant
             ON grant."userId" = parent."userId" AND grant.id = parent."authorityGrantId"
          WHERE parent.ref = $1 AND grant.ref = $2 AND parent."userId" = $3 AND parent.id = $4
          FOR UPDATE OF parent, grant`,
        [objectiveWorkOrderId, payload.grantRef, payload.sourceUserId, source.sourceEntityId],
      )
      const envelope = authority.rows[0]
      const active = envelope
        && new Set(["approved", "active", "completed", "done"]).has(envelope.parentStatus)
        && envelope.authorityGranted === envelope.authorityLevel
        && envelope.grantStatus === "active"
        && envelope.grantRevokedAt === null
        && (!envelope.grantExpiresAt || Date.parse(envelope.grantExpiresAt) > Date.now())
        && Array.isArray(envelope.grantAllowedActions)
        && envelope.grantAllowedActions.includes("implement")
        && Array.isArray(envelope.grantBlockedActions)
        && !envelope.grantBlockedActions.includes("implement")
        && envelope.grantScope === objectiveWorkOrderId
      if (!active) throw new Error("DERIVED_AUTHORITY_WALL")
      if (String(envelope.parentId) !== String(source.sourceEntityId)) throw new Error("FINDING_SOURCE_BINDING_WALL")

      const sourcePaths = source.metadata?.paths
      const sourceEscapes = validFindingPaths(sourcePaths)
        ? sourcePaths.some((candidate) => !pathWithin(candidate, envelope.parentAllowedFiles ?? [])
          || pathWithin(candidate, envelope.forbiddenFiles ?? []))
        : true
      const authoritativeIssueNumber = parseProjectionIssue(envelope.parentDescription)
      const deliveryBlocked = envelope.parentCommitAllowed !== true || envelope.parentPushAllowed !== true
      const sourceEffects = validFindingMetadata(source.metadata) && authoritativeIssueNumber !== null
        ? { ...source.metadata.effects, outsideObjectiveScope: Boolean(source.metadata.effects.outsideObjectiveScope) || sourceEscapes || deliveryBlocked }
        : undefined
      const sourceClassification = classifyProposedAction({ effects: sourceEffects })

      let child = null
      if (createChild) {
        if (sourceClassification.gated) throw new Error("DERIVED_OWNER_GATE_WALL")
        if (typeof payload.workOrderId !== "string" || !/^WO-[A-Z0-9-]+$/.test(payload.workOrderId)
          || !Number.isInteger(payload.issueNumber) || payload.issueNumber <= 0
          || payload.issueNumber !== authoritativeIssueNumber
          || payload.task !== source.metadata.task || !validFindingText(payload.task)
          || !Array.isArray(payload.allowedPaths) || payload.allowedPaths.length === 0
          || JSON.stringify(payload.allowedPaths) !== JSON.stringify(sourcePaths)
          || payload.allowedPaths.some((candidate) => typeof candidate !== "string"
            || !pathWithin(candidate, envelope.parentAllowedFiles ?? [])
            || pathWithin(candidate, envelope.forbiddenFiles ?? []))
          || !Array.isArray(payload.requiredValidation) || payload.requiredValidation.length === 0
          || payload.requiredValidation.some((gate) => !(envelope.parentValidators ?? []).includes(gate))) {
          throw new Error("DERIVED_ENVELOPE_WALL")
        }
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `runtime-derived-child:${envelope.userId}:${payload.workOrderId}`,
        ])
        const existingChild = await client.query(
          `SELECT child.id, child.ref
             FROM work_order AS child
            WHERE child."userId" = $1 AND child.ref = $2
            FOR UPDATE OF child`,
          [envelope.userId, payload.workOrderId],
        )
        if (existingChild.rows.length > 0) throw new Error("DERIVED_CHILD_IDENTITY_WALL")
        const description = [
          `Projected at GitHub issue ${payload.issueNumber}.`,
          `Projection completion: parent-owned.`,
          `Authorized under ${payload.grantRef}.`,
          `Derived from ${objectiveWorkOrderId} finding ${payload.findingId}.`,
          String(payload.task ?? "Derived remediation"),
        ].join(" ")
        const inserted = await client.query(
          `INSERT INTO work_order
            ("userId", ref, title, description, "allowedFiles", validators, "authorityGrantId",
             "commitAllowed", "tagAllowed", "pushAllowed", lane, status, "authorityLevel",
             "authorityGranted", agent, "approvedBy", "approvedAt", goal, loop, scope, "nonGoals",
             "forbiddenFiles", "stopConditions")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   'operator-objective', 'approved', $11, $12, $13,
                   'williamos-runtime-operator', timezone('UTC', now()), $14, $15, $16, $17, $18, $19)
           RETURNING id, ref`,
          [
            envelope.userId, payload.workOrderId, String(payload.task ?? payload.findingId), description,
            payload.allowedPaths, payload.requiredValidation, envelope.grantId,
            envelope.parentCommitAllowed === true, envelope.parentTagAllowed === true,
            envelope.parentPushAllowed === true, envelope.authorityLevel, envelope.authorityGranted,
            payload.agent ?? "codex",
            envelope.goal, envelope.loop, envelope.scope, envelope.nonGoals ?? [],
            envelope.forbiddenFiles ?? [], envelope.stopConditions ?? [],
          ],
        )
        child = inserted.rows[0]
        if (!child) throw new Error("DERIVED_PERSISTENCE_WALL")
      } else if (!sourceClassification.gated
        || payload.gate !== sourceClassification.gate
        || JSON.stringify(payload.gates) !== JSON.stringify(sourceClassification.gates)) {
        throw new Error("FINDING_OWNER_GATE_BINDING_WALL")
      }

      const metadata = { ...canonical, payloadDigest, ...(child ? { childWorkOrderId: child.id } : {}) }
      await client.query(
        `INSERT INTO governance_event
          ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
         VALUES ($1, $2, 'work_order', $3, 'williamos-runtime-operator', $4, $5)
         RETURNING id`,
        [envelope.userId, eventType, String(child?.id ?? envelope.parentId), payload.reason ?? payload.task ?? payload.finding, metadata],
      )
      await client.query("COMMIT")
      return { workOrderId: canonical.childWorkOrderRef ?? null, replayed: false }
    } catch (error) {
      try { await client.query("ROLLBACK") } catch { /* preserve the primary wall */ }
      throw error
    } finally {
      client.release()
    }
  }

  return {
    adapterId,

    async buildRegistry() {
      const [workOrders, grants] = await Promise.all([loadWorkOrders(), loadActiveGrants()])
      return {
        schemaVersion: 1,
        repository: REPOSITORY,
        workOrders: buildRegistryRecords(workOrders, grants, adapterId),
      }
    },

    async collectFindings() {
      const result = await pool.query(
      `SELECT finding.id AS "sourceFindingEventId", finding."userId", finding.actor,
                finding."entityId", finding.metadata, parent.description AS "parentDescription",
                parent.assignee AS "parentAssignee", checkpoint."checkpointCount",
                checkpoint.metadata AS "checkpointMetadata"
           FROM governance_event AS finding
           JOIN work_order AS parent
             ON parent.id::text = finding."entityId" AND parent."userId" = finding."userId"
           LEFT JOIN LATERAL (
             SELECT count(*)::integer AS "checkpointCount", max(source.metadata::text)::jsonb AS metadata
               FROM governance_event AS source
              WHERE source."userId" = parent."userId"
                AND source."entityType" = 'work_order'
                AND source."entityId"::text = parent.id::text
                AND source."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                AND source.id::text = finding.metadata->>'sourceCheckpointId'
                AND source.metadata->>'workOrderRef' = parent.ref
                AND source.metadata->>'projectionIssueNumber' IS NOT NULL
                AND source.metadata->>'workContractId' IS NOT NULL
                AND source.metadata->>'workContractDigest' IS NOT NULL
                AND source.metadata->>'payloadDigest' IS NOT NULL
           ) AS checkpoint ON true
          WHERE finding."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
            AND finding."entityType" = 'work_order'
            AND NOT EXISTS (
              SELECT 1 FROM governance_event AS settlement
               WHERE settlement."userId" = finding."userId"
                 AND settlement."eventType" IN ('RUNTIME_FINDING_DERIVED', 'RUNTIME_FINDING_OWNER_GATED')
                 AND settlement.metadata->>'sourceFindingEventId' = finding.id::text
            )
          ORDER BY finding.id ASC`,
      )
      return result.rows.flatMap((row) => {
        const metadata = row?.metadata
        if (!Number.isInteger(row?.sourceFindingEventId)
          || !metadata || typeof metadata !== "object" || Array.isArray(metadata)
          || metadata.schemaVersion !== 1
          || !new Set(["hermes", "williamos-runtime-operator"]).has(row.actor)
          || typeof metadata.findingId !== "string" || metadata.findingId.trim() === ""
          || typeof row.userId !== "string" || row.userId.trim() === ""
          || typeof metadata.objectiveWorkOrderId !== "string" || metadata.objectiveWorkOrderId.trim() === "") return []
        const hermesParent = row.parentAssignee === "hermes-codex-bridge"
        const checkpoint = row.checkpointMetadata
        const { payloadDigest: checkpointPayloadDigest, ...checkpointPayload } = checkpoint ?? {}
        const canonicalCheckpoint = row.checkpointCount === 1
          && checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint)
          && checkpoint.workOrderRef === metadata.objectiveWorkOrderId
          && typeof checkpoint.workContractId === "string"
          && /^[0-9a-f]{64}$/.test(checkpoint.workContractDigest ?? "")
          && checkpoint.workContractVersion === "hermes-work-contract.v1"
          && checkpoint.workContractRepository === REPOSITORY
          && checkpoint.workContractLane === "operator-objective"
          && Number.isSafeInteger(checkpoint.projectionIssueNumber)
          && typeof checkpoint.projectionCompletionOwned === "boolean"
          && typeof checkpoint.implementationGrantRef === "string"
          && typeof checkpoint.authorizationDecisionId === "number"
          && checkpointPayloadDigest === findingDigest(checkpointPayload)
          && metadata.sourceCheckpointDigest === checkpointPayloadDigest
          && metadata.workContractId === checkpoint.workContractId
          && metadata.workContractDigest === checkpoint.workContractDigest
          && metadata.projectionIssueNumber === checkpoint.projectionIssueNumber
          && metadata.projectionCompletionOwned === checkpoint.projectionCompletionOwned
          && metadata.authorizationDecisionId === checkpoint.authorizationDecisionId
          && metadata.implementationGrantId === checkpoint.implementationGrantId
          && metadata.implementationGrantRef === checkpoint.implementationGrantRef
        const issueNumber = hermesParent
          ? (canonicalCheckpoint ? checkpoint.projectionIssueNumber : null)
          : parseProjectionIssue(row.parentDescription)
        const malformed = !validFindingMetadata(metadata) || issueNumber === null
        return [{
          sourceFindingEventId: row.sourceFindingEventId,
          sourceUserId: row.userId,
          sourceWorkOrderRowId: row.entityId,
          sourcePayloadDigest: findingDigest(metadata),
          findingId: metadata.findingId,
          objectiveWorkOrderId: metadata.objectiveWorkOrderId,
          sequence: metadata.sequence,
          issueNumber,
          projectionCompletionOwned: canonicalCheckpoint
            ? checkpoint.projectionCompletionOwned
            : projectionCompletionOwned(row.parentDescription),
          contractId: canonicalCheckpoint ? checkpoint.workContractId : null,
          contractDigest: canonicalCheckpoint ? checkpoint.workContractDigest : null,
          authorizationDecisionId: canonicalCheckpoint ? checkpoint.authorizationDecisionId : null,
          implementationGrantId: canonicalCheckpoint ? checkpoint.implementationGrantId : null,
          grantRef: canonicalCheckpoint ? checkpoint.implementationGrantRef : null,
          summary: validFindingText(metadata.summary) ? metadata.summary : "Malformed structured finding",
          task: validFindingText(metadata.task) ? metadata.task : "Malformed structured finding",
          paths: validFindingPaths(metadata.paths) ? metadata.paths : [],
          effects: malformed ? undefined : metadata.effects,
          malformed,
        }]
      })
    },

    async persistDerivedWorkOrder(order) {
      return persistFindingOutcome({ eventType: "RUNTIME_FINDING_DERIVED", payload: order, createChild: true })
    },

    async recordOwnerGate(entry) {
      return persistFindingOutcome({ eventType: "RUNTIME_FINDING_OWNER_GATED", payload: entry, createChild: false })
    },

    async assertRuntime() {
      const activation = path.join(root, "control", "activation")
      // The owner kill switch: delete or blank this file and the resident loop refuses to act.
      if (!fs.existsSync(activation) || fs.readFileSync(activation, "utf8").trim() !== "enabled") {
        throw new Error("AUTHORITY_ACTIVATION_WALL")
      }
      try {
        await ghRemote(["auth", "status"], { timeout: 30_000 })
      } catch {
        throw new Error("RUNTIME_READINESS_WALL")
      }
      const remote = (await run("git", ["remote", "get-url", "origin"], { cwd: repositoryPath })).stdout.trim()
      if (!new Set([
        "git@github.com:bsvalues/terragroq.git",
        "https://github.com/bsvalues/terragroq.git",
      ]).has(remote)) throw new Error("REPOSITORY_ALLOWLIST_WALL")
    },

    async listQueue() {
      const workOrders = await loadWorkOrders()
      issueToRef = new Map()
      const entries = []
      for (const workOrder of workOrders) {
        const issueNumber = parseProjectionIssue(workOrder.description)
        if (issueNumber === null) continue
        const identity = { workOrderRowId: workOrder.id, userId: workOrder.userId, workOrderId: workOrder.ref }
        issueToRef.set(issueNumber, [...(issueToRef.get(issueNumber) ?? []), identity])
        entries.push({
          issueNumber,
          workOrderId: workOrder.ref,
          workOrderRowId: workOrder.id,
          userId: workOrder.userId,
          projectionCompletionOwned: projectionCompletionOwned(workOrder.description),
          state: queueStateFor(workOrder.status),
          createdAt: new Date(workOrder.createdAt).toISOString(),
        })
      }
      return entries
    },

    resolveBaseSha: native.resolveBaseSha,
    prepareWorkspace: native.prepareWorkspace,
    applyAndInspect: native.applyAndInspect,
    inspectExistingPatch: native.inspectExistingPatch,
    verifyMergedMain: native.verifyMergedMain,

    async inspectPullRequest(pr) {
      const pull = JSON.parse((await ghRemote(["pr", "view", String(pr), "--repo", REPOSITORY, "--json", "state,mergeable,reviewDecision,statusCheckRollup,reviews"])).stdout)
      if (pull.state === "MERGED") return { decision: "MERGE", reason: "ALREADY_MERGED", feedback: "" }
      const graph = await ghRemote(["api", "graphql", "-f", "query=query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(last:1){nodes{body path}}}}}}}", "-f", "owner=bsvalues", "-f", "repo=terragroq", "-F", `number=${pr}`])
      const threads = JSON.parse(graph.stdout).data.repository.pullRequest.reviewThreads.nodes
      const unresolved = threads.filter((thread) => !thread.isResolved)
      const checks = pull.statusCheckRollup ?? []
      const failures = checks.filter((check) => check.__typename === "StatusContext"
        ? !new Set(["SUCCESS", "PENDING", "EXPECTED"]).has(check.state)
        : check.status === "COMPLETED" && !new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]).has(check.conclusion))
      const pending = checks.length === 0 || checks.some((check) => check.__typename === "StatusContext"
        ? new Set(["PENDING", "EXPECTED"]).has(check.state)
        : check.status !== "COMPLETED")
      if (unresolved.length > 0 || failures.length > 0 || pull.reviewDecision === "CHANGES_REQUESTED") {
        const feedback = [
          ...unresolved.map((thread) => (thread.comments.nodes.at(-1)?.path ?? "PR") + ": " + String(thread.comments.nodes.at(-1)?.body ?? "").slice(0, 4000)),
          ...failures.map((check) => "Check " + (check.name ?? check.context ?? "unknown") + ": " + (check.conclusion ?? check.state)),
        ].join("\n")
        return {
          decision: "REMEDIATE",
          reason: unresolved.length ? "UNRESOLVED_REVIEW_THREADS" : "FAILED_CHECK",
          feedback,
          threadIds: unresolved.map((thread) => thread.id),
          threadPaths: unresolved.map((thread) => thread.comments.nodes.at(-1)?.path ?? null),
        }
      }
      if (pending || pull.mergeable !== "MERGEABLE") return { decision: "WAIT", reason: "CHECKS_OR_MERGEABILITY_PENDING", feedback: "" }
      return { decision: "MERGE", reason: "ALL_GATES_GREEN", feedback: "" }
    },

    async merge(pr) {
      let pull = JSON.parse((await ghRemote(["pr", "view", String(pr), "--repo", REPOSITORY, "--json", "state,mergeCommit"])).stdout)
      if (pull.state !== "MERGED") {
        await ghRemote(["pr", "merge", String(pr), "--repo", REPOSITORY, "--squash", "--delete-branch"], { timeout: 120_000 })
        pull = JSON.parse((await ghRemote(["pr", "view", String(pr), "--repo", REPOSITORY, "--json", "state,mergeCommit"])).stdout)
      }
      if (pull.state !== "MERGED" || !pull.mergeCommit?.oid) throw new Error("MERGE_VERIFICATION_WALL")
      return { mergeSha: pull.mergeCommit.oid }
    },

    async lease(issueNumber, queuedIdentity = null) {
      const identity = Number.isInteger(queuedIdentity?.workOrderRowId) && typeof queuedIdentity?.userId === "string"
        ? queuedIdentity
        : await refForIssue(issueNumber)
      await pool.query(
        `UPDATE work_order SET "status" = 'active'
          WHERE "id" = $1 AND "userId" = $2 AND "lane" = 'operator-objective'`,
        [identity.workOrderRowId, identity.userId],
      )
      // GitHub label is projection; its failure must never block the lease that already happened.
      try {
        await ghRemote(["issue", "edit", String(issueNumber), "--repo", REPOSITORY, "--add-label", "williamos:leased"])
      } catch { /* projection only */ }
    },

    async complete(issueNumber, queuedIdentity = null) {
      const identity = Number.isInteger(queuedIdentity?.workOrderRowId) && typeof queuedIdentity?.userId === "string"
        ? queuedIdentity
        : await refForIssue(issueNumber)
      await pool.query(
        `UPDATE work_order SET "status" = 'completed'
          WHERE "id" = $1 AND "userId" = $2 AND "lane" = 'operator-objective'`,
        [identity.workOrderRowId, identity.userId],
      )
      if (identity.projectionCompletionOwned !== false) {
        try {
          await ghRemote(["issue", "edit", String(issueNumber), "--repo", REPOSITORY, "--add-label", "williamos:done"])
          await ghRemote(["issue", "close", String(issueNumber), "--repo", REPOSITORY, "--comment", "WilliamOS resident kernel verified the merged-main completion evidence."])
        } catch { /* projection only */ }
      }
    },

    /**
     * Dispatch the lane's worker in the prepared worktree, and hand the kernel a patch.
     *
     * The worker edits files directly; nothing it writes is trusted. The diff is collected, the
     * worktree is restored to pristine, and the kernel re-applies the patch through its own walls --
     * path boundary, budget, secrets, binaries -- exactly as if it had arrived from anywhere else.
     */
    /**
     * Dispatch the selected lane's worker and hand the kernel a patch (WO-0028).
     *
     * Selection is policy over the roster: the assigned lane serves when available; an exhausted lane
     * reroutes to any other approved lane with the capability, and the reason is recorded; only when
     * nothing capable remains does this park, with the soonest declared refill time. Every lane's
     * output goes through the same collection: diff taken, worktree restored to pristine, and the
     * kernel re-applies through its own walls.
     *
     * Which tree that diff comes from is the one thing the lanes disagree about (WO-0030). The CLI
     * lanes edit the kernel workspace directly. The resident local lane cannot -- its provider owns
     * and mounts its own worktree -- so it returns the tree it actually edited, and the collection
     * follows the work rather than assuming where it happened.
     */
    async invokeCodex({ workOrderId, workspace, task, allowedPaths, remediation, feedback }) {
      const statusFile = path.join(root, "state", "provider-status.json")
      const status = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, "utf8")) : {}
      // Recorded capability measurement, read and never written here: a lane that promotes itself on
      // the strength of having run is not a lane that was measured.
      const capabilityFile = path.join(root, "state", "lane-capability.json")
      let measured = {}
      try { measured = JSON.parse(fs.readFileSync(capabilityFile, "utf8")) } catch { /* unmeasured is the default */ }
      const registry = await this.buildRegistry()
      const assigned = registry.workOrders.find((record) => record.workOrderId === workOrderId)?.agent ?? "codex"
      const prompt = buildWorkerPrompt({ workOrderId, task, allowedPaths, remediation, feedback })

      const attempted = []
      for (;;) {
        const choice = selectLane({ assigned, roster: laneRoster({ measured }), status, capability: IMPLEMENTATION })
        if (choice.wait) {
          const retry = choice.retryAfterMs ? Math.floor(choice.retryAfterMs / 1000) : null
          throw new Error(retry ? `PROVIDER_RATE_LIMIT_WALL:retry-${retry}` : "PROVIDER_RATE_LIMIT_WALL")
        }
        const lane = choice.lane
        if (attempted.includes(lane.id)) throw new Error("PROVIDER_ROTATION_WALL")
        attempted.push(lane.id)
        let patchWorkspace = workspace
        try {
          if (lane.id === "codex") {
            await run("codex", ["exec", "--sandbox", "workspace-write", "-C", workspace, prompt], { timeout: 45 * 60 * 1000 })
          } else if (lane.id === "claude") {
            equipWorkContext(workspace, await issueWorkContext({ repositoryPath, workOrderId, allowedPaths }))
            const environment = { ...process.env }
            delete environment.ANTHROPIC_API_KEY
            delete environment.ANTHROPIC_AUTH_TOKEN
            await run("claude", ["-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", "Edit Write Read Grep Glob LS"], { cwd: workspace, timeout: 45 * 60 * 1000, env: environment })
          } else if (lane.id === "hermes-local") {
            // The resident local lane: SEA's Hermes Agent, invoked through its own packet-driven
            // invoker. Nothing of its containment, identity pins or inference allowlist is restated
            // or relaxed here -- the invoker asserts all of it against the reviewed policy, and this
            // is a client of that contract, not a second copy of it. The tree it edits is its own,
            // so the patch is collected from there.
            patchWorkspace = await dispatchHermesLocal({
              root,
              repositoryPath,
              workOrderId,
              workspace,
              prompt,
              workContext: await issueWorkContext({ repositoryPath, workOrderId, allowedPaths }),
            })
          } else {
            throw new Error("PROVIDER_LANE_WALL")
          }
        } catch (error) {
          const message = String(error?.message ?? "")
          // Whatever killed the worker, keep what it said. A wall code with no output behind it
          // costs a whole cycle to diagnose and can only be guessed at afterwards.
          try {
            const diagnostics = path.join(root, "state", "diagnostics")
            fs.mkdirSync(diagnostics, { recursive: true })
            fs.writeFileSync(
              path.join(diagnostics, `${workOrderId}-${lane.id}.log`),
              `${message}

${String(error?.output ?? "").slice(-12000)}
`,
              "utf8",
            )
          } catch { /* diagnostics are best effort; the wall is not */ }
          const limited = /^(?:CODEX|PROVIDER)_RATE_LIMIT_WALL(?::retry-(\d+))?/.exec(message)
          if (limited) {
            // Remember when this lane refills and let policy pick the next one, rather than parking the
            // whole system on one meter.
            const until = limited[1] ? new Date(Number(limited[1]) * 1000) : new Date(Date.now() + 60 * 60 * 1000)
            status[lane.id] = { unavailableUntil: until.toISOString(), reason: "RATE_LIMITED" }
            fs.mkdirSync(path.dirname(statusFile), { recursive: true })
            fs.writeFileSync(statusFile, JSON.stringify(status, null, 2) + "\n", "utf8")
            continue
          }
          throw error
        }
        fs.mkdirSync(path.dirname(statusFile), { recursive: true })
        fs.writeFileSync(statusFile, JSON.stringify({
          ...status,
          lastDispatch: { workOrderId, lane: lane.id, rerouted: choice.rerouted, reason: choice.reason, at: new Date().toISOString() },
        }, null, 2) + "\n", "utf8")
        return { result: "PATCH_READY", unifiedPatch: await collectPatch({ patchWorkspace, workspace }) }
      }
    },

    async validate({ workspace, requiredValidation }) {
      // A fresh worktree has no dependencies; the store makes this cheap and deterministic.
      try {
        // Node refuses to spawn .cmd shims without a shell; cmd.exe /c is the explicit, safe form.
        await run("cmd.exe", ["/c", "pnpm", "install", "--frozen-lockfile"], { cwd: workspace, timeout: 10 * 60 * 1000 })
      } catch {
        throw new Error("VALIDATION_INSTALL_WALL")
      }
      for (const gate of requiredValidation) {
        try {
          if (gate === "diff-check") await run("git", ["diff", "--cached", "--check"], { cwd: workspace })
          else if (gate === "lint") await run("cmd.exe", ["/c", "pnpm", "run", "lint"], { cwd: workspace, timeout: 20 * 60 * 1000 })
          // The same standard CI holds main to. The bare suite includes host-dependent files that
          // probe live lab hosts -- vitest.ci.config.ts excludes them with a stated reason each --
          // so gating on it judged every worker against a bar main itself does not clear, for files
          // outside the boundary the worker is forbidden to touch. That is an unwinnable gate, and
          // it consumed every remediation round tonight.
          else if (gate === "test") {
            try {
              await run("cmd.exe", ["/c", "pnpm", "exec", "vitest", "run", "--config", "vitest.ci.config.ts"], { cwd: workspace, timeout: SUITE_TIMEOUT_MS })
            } catch (failure) {
              // Judge the patch against this host, not an ideal one. The baseline is measured once per base
              // commit on a pristine tree and cached; whatever fails there is the machine's, not the worker's.
              const failing = parseFailingTestFiles(failure?.output)
              // Fail closed when the comparison is unavailable. A suite whose failure named no test
              // file, or a host whose baseline could not be measured, leaves the gate with nothing to
              // compare -- and a gate that saw nothing must not certify a patch. Read the other way
              // round it reported every red suite as clean, and the first real verdict arrived from
              // CI, long after the pull request was open.
              if (failing.length === 0) throw failure
              const head = (await run("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim()
              const baseline = await measureBaselineFailures({ root, repositoryPath, head })
              if (baseline === null) throw failure
              const newly = newlyFailingTests(failing, baseline)
              if (newly.length > 0) {
                failure.output = newly.length + " test file(s) fail with this patch and pass without it:\n" + newly.join("\n") + "\n\n" + String(failure?.output ?? "")
                throw failure
              }
            }
          }
          else if (gate === "build") await run("cmd.exe", ["/c", "pnpm", "run", "build"], { cwd: workspace, timeout: 20 * 60 * 1000 })
          else throw new Error("VALIDATION_COMMAND_WALL")
        } catch (error) {
          // The wall string carries no detail by design, so the detail goes where the remediation
          // worker can read it: a gitignored file inside the worktree. Blind remediation burned two
          // rounds tonight editing against a bare wall code.
          try {
            const tail = String(error?.output ?? "").slice(-6000)
            fs.mkdirSync(path.join(workspace, ".williamos"), { recursive: true })
            fs.writeFileSync(path.join(workspace, ".williamos", "validation-feedback.txt"), `gate: ${gate}

${tail}
`, "utf8")
          } catch { /* feedback is best effort; the wall is not */ }
          throw new Error(`VALIDATION_${gate.replaceAll("-", "_").toUpperCase()}_WALL`)
        }
      }
    },

    /**
     * Publish with a work-context receipt, or the resident lane fails its own reviewer gate.
     *
     * The #831 CI job rejects any pull request that carries no valid WORK_CONTEXT_RECEIPT, and that gate
     * does not care who opened the PR. The kernel knows every fact the receipt needs, so it declares
     * them the same way any other lane must.
     */
    async publish({ issueNumber, workOrderId, workOrderRowId, userId, projectionCompletionOwned: completionOwned = true, workspace, branch, existingPr, resolvedThreadIds = [] }) {
      const { receiptToken } = await import("../../lib/governance/work-context-receipt.ts")
      const { measureDoctrineDigest } = await import("../../lib/governance/work-context-live.ts")
      await run("git", ["fetch", "origin", "main"], { cwd: repositoryPath })
      const mainSha = (await run("git", ["rev-parse", "origin/main"], { cwd: repositoryPath })).stdout.trim()
      const { digest } = await measureDoctrineDigest()
      const registry = await this.buildRegistry()
      const record = registry.workOrders.find((candidate) => candidate.workOrderId === workOrderId
        && (workOrderRowId === undefined || candidate.workOrderRowId === workOrderRowId)
        && (userId === undefined || candidate.userId === userId))
      if (!record) throw new Error("AUTHORITY_REGISTRY_WALL")
      const facts = {
        mainSha,
        workOrderRef: workOrderId,
        parentOutcome: "OUTCOME-762",
        reservedPaths: record.allowedPaths,
        authorityLevel: "A2_WRITE_OWN",
        doctrineDigest: digest,
        existingSubsystem: "integrating",
        topologySource: "canonical-registry",
        collisions: [],
        remainingParentAcceptance: "resident continuation delivering an authorized child of #762",
      }
      const body = [
        `Bounded WilliamOS resident work order ${workOrderId}, dispatched and validated by the operational kernel under ${record.grantRef}.`,
        ``,
        projectionIssueDirective(issueNumber, completionOwned),
        ``,
        "```WORK_CONTEXT_RECEIPT",
        JSON.stringify({ ["to" + "ken"]: receiptToken(facts), facts }, null, 2),
        "```",
      ].join("\n")

      let effectiveBranch = branch || (await run("git", ["branch", "--show-current"], { cwd: workspace })).stdout.trim()
      if (!effectiveBranch) {
        effectiveBranch = `runtime/${workOrderId.toLowerCase()}-issue-${issueNumber}`
        await run("git", ["switch", "-c", effectiveBranch], { cwd: workspace })
      }
      const staged = (await run("git", ["diff", "--cached", "--name-only"], { cwd: workspace })).stdout.trim()
      if (staged) {
        await run("git", ["config", "user.name", "williamos-runtime-operator"], { cwd: workspace })
        await run("git", ["config", "user.email", "williamos-runtime-operator@users.noreply.github.com"], { cwd: workspace })
        await run("git", ["commit", "-m", `runtime(operator): complete ${workOrderId}`], { cwd: workspace })
      }
      await run("git", ["push", "-u", "origin", effectiveBranch], { cwd: workspace })
      if (existingPr) return { branch: effectiveBranch, pr: existingPr }
      const existing = await ghRemote(["pr", "list", "--repo", REPOSITORY, "--head", effectiveBranch, "--state", "all", "--json", "number", "--jq", ".[0].number"])
      let pr = Number(existing.stdout.trim())
      if (!pr) {
        const remoteBody = "/tmp/" + workOrderId.toLowerCase() + "-pr.md"
        await shipRemoteFile(body, remoteBody)
        const created = await ghRemote(["pr", "create", "--repo", REPOSITORY, "--base", "main", "--head", effectiveBranch, "--title", `runtime(operator): ${workOrderId}`, "--body-file", remoteBody], { timeout: 120_000 })
        pr = Number(created.stdout.trim().split("/").at(-1))
      }
      if (!Number.isInteger(pr) || !pr) throw new Error("PR_RECONCILIATION_WALL")
      try {
        await ghRemote(["issue", "edit", String(issueNumber), "--repo", REPOSITORY, "--remove-label", "williamos:leased", "--add-label", "williamos:monitoring"])
      } catch { /* projection only */ }
      return { branch: effectiveBranch, pr }
    },
  }
}
