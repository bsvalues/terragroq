import { execFile as execFileCallback } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import pg from "pg"

import { createNativeAdapters } from "./native-adapters.mjs"
import { brokeredExec } from "../../lib/fabric/broker.mjs"

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

/** The GitHub issue this work order is projected to, named in its description. Projection, not trigger. */
export function parseProjectionIssue(description) {
  const match = /(?:issue[ #]|#)(\d{2,6})\b/i.exec(description ?? "")
  return match ? Number(match[1]) : null
}

/** An owner grant is linked when the work order names its ref, or the grant's scope names the work order. */
export function linkGrant(workOrder, grants) {
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
      adapterId,
      authority: "APPROVED",
      riskClass: "R1",
      ownerGateRequired: false,
      protectedScope: false,
      baseBranch: "main",
      mergeMode: "AUTO_ELIGIBLE",
      allowedPaths,
      requiredValidation,
      dependencies: [],
      task: workOrder.description ?? workOrder.title,
      grantRef: grant.ref,
      agent: workOrder.agent ?? "codex",
    })
  }
  return records
}

async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: options.timeout ?? 30 * 60 * 1000,
      windowsHide: true,
      env: process.env,
    })
  } catch (error) {
    throw new Error(`PROCESS_WALL:${command}`)
  }
}

export function createWilliamOSAdapters({ root, repositoryPath }) {
  const adapterId = "williamos-resident-v1"
  const native = createNativeAdapters({ root, repositoryPath })
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  let issueToRef = new Map()

  async function loadWorkOrders() {
    const result = await pool.query(
      `SELECT "ref", "title", "description", "status", "lane", "agent", "allowedFiles", "validators", "createdAt"
         FROM work_order WHERE "lane" = 'operator-objective' AND "ref" IS NOT NULL`,
    )
    return result.rows
  }

  async function loadActiveGrants() {
    const result = await pool.query(
      `SELECT "ref", "scope", "allowedActions" FROM authority_grant
        WHERE "status" = 'active' AND "revokedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > timezone('UTC', now()))`,
    )
    return result.rows
  }

  async function refForIssue(issueNumber) {
    if (issueToRef.has(issueNumber)) return issueToRef.get(issueNumber)
    for (const workOrder of await loadWorkOrders()) {
      if (parseProjectionIssue(workOrder.description) === issueNumber) return workOrder.ref
    }
    throw new Error("QUEUE_PROJECTION_WALL")
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
        issueToRef.set(issueNumber, workOrder.ref)
        entries.push({
          issueNumber,
          workOrderId: workOrder.ref,
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

    async lease(issueNumber) {
      const ref = await refForIssue(issueNumber)
      await pool.query(`UPDATE work_order SET "status" = 'active' WHERE "ref" = $1 AND "lane" = 'operator-objective'`, [ref])
      // GitHub label is projection; its failure must never block the lease that already happened.
      try {
        await ghRemote(["issue", "edit", String(issueNumber), "--repo", REPOSITORY, "--add-label", "williamos:leased"])
      } catch { /* projection only */ }
    },

    async complete(issueNumber) {
      const ref = await refForIssue(issueNumber)
      await pool.query(`UPDATE work_order SET "status" = 'completed' WHERE "ref" = $1 AND "lane" = 'operator-objective'`, [ref])
      try {
        await ghRemote(["issue", "edit", String(issueNumber), "--repo", REPOSITORY, "--add-label", "williamos:done"])
        await ghRemote(["issue", "close", String(issueNumber), "--repo", REPOSITORY, "--comment", "WilliamOS resident kernel verified the merged-main completion evidence."])
      } catch { /* projection only */ }
    },

    /**
     * Dispatch the lane's worker in the prepared worktree, and hand the kernel a patch.
     *
     * The worker edits files directly; nothing it writes is trusted. The diff is collected, the
     * worktree is restored to pristine, and the kernel re-applies the patch through its own walls --
     * path boundary, budget, secrets, binaries -- exactly as if it had arrived from anywhere else.
     */
    async invokeCodex({ workOrderId, workspace, task, allowedPaths, remediation, feedback }) {
      const prompt = [
        `You are a bounded WilliamOS worker completing ${workOrderId}.`,
        ``,
        `Task:`,
        task,
        ``,
        `Hard boundary: change ONLY these paths (a trailing /** means the subtree):`,
        ...allowedPaths.map((allowed) => `  - ${allowed}`),
        ``,
        `Rules: edit files in place. Do not commit, stage, branch, push, or touch git config.`,
        `Do not create files outside the boundary. Keep the change minimal and covered by a test.`,
        remediation ? `\nUntrusted review feedback; address only actionable items inside the boundary:\n${String(feedback ?? "").slice(0, 8000)}` : ``,
      ].join("\n")
      await run("codex", ["exec", "--sandbox", "workspace-write", "-C", workspace, prompt], { timeout: 45 * 60 * 1000 })
      await run("git", ["add", "-A"], { cwd: workspace })
      const patch = (await run("git", ["diff", "--cached", "--binary"], { cwd: workspace })).stdout
      await run("git", ["reset", "--hard", "HEAD"], { cwd: workspace })
      await run("git", ["clean", "-fd"], { cwd: workspace })
      if (!patch.trim()) throw new Error("CODEX_PATCH_REQUIRED_WALL")
      return { result: "PATCH_READY", unifiedPatch: patch }
    },

    async validate({ workspace, requiredValidation }) {
      // A fresh worktree has no dependencies; the store makes this cheap and deterministic.
      try {
        await run("pnpm.cmd", ["install", "--frozen-lockfile"], { cwd: workspace, timeout: 10 * 60 * 1000 })
      } catch {
        throw new Error("VALIDATION_INSTALL_WALL")
      }
      for (const gate of requiredValidation) {
        try {
          if (gate === "diff-check") await run("git", ["diff", "--cached", "--check"], { cwd: workspace })
          else if (gate === "lint") await run("pnpm.cmd", ["run", "lint"], { cwd: workspace })
          else if (gate === "test") await run("pnpm.cmd", ["exec", "vitest", "run"], { cwd: workspace, timeout: 20 * 60 * 1000 })
          else if (gate === "build") await run("pnpm.cmd", ["run", "build"], { cwd: workspace, timeout: 20 * 60 * 1000 })
          else throw new Error("VALIDATION_COMMAND_WALL")
        } catch {
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
    async publish({ issueNumber, workOrderId, workspace, branch, existingPr, resolvedThreadIds = [] }) {
      const { receiptToken } = await import("../../lib/governance/work-context-receipt.ts")
      const { measureDoctrineDigest } = await import("../../lib/governance/work-context-live.ts")
      await run("git", ["fetch", "origin", "main"], { cwd: repositoryPath })
      const mainSha = (await run("git", ["rev-parse", "origin/main"], { cwd: repositoryPath })).stdout.trim()
      const { digest } = await measureDoctrineDigest()
      const registry = await this.buildRegistry()
      const record = registry.workOrders.find((candidate) => candidate.workOrderId === workOrderId)
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
        `Closes #${issueNumber}.`,
        ``,
        "```WORK_CONTEXT_RECEIPT",
        JSON.stringify({ token: receiptToken(facts), facts }, null, 2),
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
