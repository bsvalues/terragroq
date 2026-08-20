/**
 * One-shot capability measurement for a worker lane (#905, GRANT-0017).
 *
 * Selection refuses an unmeasured lane, and measurement requires the lane to run: that circle is why
 * `hermes-local` could be integrated and still never be measured. This instrument breaks it from
 * outside, deliberately and once.
 *
 * It is NOT a selection bypass. It never calls `selectLane`, it is never invoked by the kernel, and
 * nothing it does can promote a lane on its own -- it writes a verdict, and `measuredCapabilities`
 * grants `implementation` only for `PROVEN` with cited evidence. A run that produces no patch, or a
 * patch the walls refuse, is recorded as the failure it was.
 *
 * The lane is given the real thing: the same bounded worker prompt, the same work-context receipt, the
 * same patch walls, the same base commit. Nothing is loosened to help it pass, because a measurement
 * taken against a lowered bar measures the bar.
 *
 *   node --no-warnings scripts/runtime-operator/measure-lane-capability.mjs [--dry-run]
 */
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { register } from "node:module"
register("../repo-alias-loader.mjs", new URL("./", import.meta.url))

const REPOSITORY = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const ROOT = path.join(os.homedir(), ".williamos", "runtime-operator")
const LANE = "hermes-local"

/**
 * The bounded task. Small, real, and inside the reservation the measurement declares.
 *
 * Chosen so the verdict turns on implementation rather than on comprehension of this codebase: a pure
 * function with a stated contract and a test. If a 4B model cannot do this, it cannot do the work the
 * lane exists for; if it can, that is evidence and not a promise.
 */
const TASK = [
  "Add a pure helper `summariseLaneVerdict(record)` to scripts/runtime-operator/worker-lanes.mjs and export it.",
  "",
  "Contract:",
  "  - given { implementation: 'PROVEN', evidence: 'text' } it returns the string 'PROVEN: text'",
  "  - given { implementation: 'MEASURED_INCAPABLE', evidence: 'text' } it returns 'MEASURED_INCAPABLE: text'",
  "  - given a record whose evidence is missing or blank, it returns the verdict alone with no colon",
  "  - given null or undefined it returns 'UNMEASURED'",
  "",
  "Add tests for all four cases in tests/runtime-operator-lane-verdict.test.ts using vitest,",
  "importing from '../scripts/runtime-operator/worker-lanes.mjs'.",
  "Do not change any existing function.",
].join("\n")

const ALLOWED_PATHS = ["scripts/runtime-operator/worker-lanes.mjs", "tests/**"]

const dryRun = process.argv.includes("--dry-run")

const { buildWorkerPrompt } = await import("./worker-lanes.mjs")
const { classifyDispatchFailure } = await import("./lane-measurement.mjs")
const { dispatchHermesLocal, unmountedPolicyVolumes } = await import("./williamos-adapters.mjs")
const { inspectWorkspaceChanges } = await import("./native-adapters.mjs")
const { HERMES_KERNEL_POLICY_RELATIVE } = await import("../hermes-bridge/hermes-kernel-client.mjs")

function record(verdict, evidence) {
  const file = path.join(ROOT, "state", "lane-capability.json")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({ [LANE]: { implementation: verdict, measuredAt: new Date().toISOString(), evidence } }, null, 2) + "\n",
    "utf8",
  )
  console.log(`VERDICT ${verdict}`)
  console.log(evidence)
}

// A blocker is named at the boundary where it occurs, never inferred from a downstream symptom.
const policy = JSON.parse(fs.readFileSync(path.join(REPOSITORY, HERMES_KERNEL_POLICY_RELATIVE), "utf8"))
const unmounted = unmountedPolicyVolumes(policy)
if (unmounted.length > 0) {
  record(
    `BLOCKED_VOLUME_UNAVAILABLE`,
    `The provider policy pins paths on ${unmounted.map((entry) => entry.volume).join(", ")}, which is not mounted. ` +
      `This says nothing about the lane or the model.`,
  )
  process.exit(0)
}

const workspace = path.join(ROOT, "state", "capability-measurement")
fs.rmSync(workspace, { recursive: true, force: true })

const { execFile } = await import("node:child_process")
const { promisify } = await import("node:util")
const exec = promisify(execFile)
const git = (args, cwd = REPOSITORY) => exec("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })

await git(["fetch", "origin", "main"])
const baseSha = (await git(["rev-parse", "origin/main"])).stdout.trim()
// A previous attempt that died mid-run leaves its worktree registered but gone, and git then refuses
// the name forever. Prune first: a stale registration is bookkeeping, not a verdict about the lane.
await git(["worktree", "prune"])
await git(["worktree", "add", "--force", "--detach", workspace, baseSha])
console.log(`workspace ${workspace} at ${baseSha.slice(0, 12)}`)

try {
  const prompt = buildWorkerPrompt({
    workOrderId: "CAPABILITY-MEASUREMENT-905",
    task: TASK,
    allowedPaths: ALLOWED_PATHS,
    remediation: false,
  })

  if (dryRun) {
    console.log("--- prompt the lane would receive ---")
    console.log(prompt)
    process.exit(0)
  }

  const started = Date.now()
  let patchWorkspace
  try {
    patchWorkspace = await dispatchHermesLocal({
      root: ROOT,
      repositoryPath: REPOSITORY,
      workOrderId: "capability-measurement-905",
      workspace,
      prompt,
      workContext: null,
      newId: () => crypto.randomUUID(),
    })
  } catch (error) {
    const message = String(error?.message ?? error)
    // MEASURED_INCAPABLE is a claim about a model, and it may only be made when the model actually ran.
    // A crashed invoker or an unreachable provider is an infrastructure boundary wearing a wall's name,
    // and reading it as incapability is inference from a downstream symptom -- the exact error this
    // measurement exists to avoid. The first run of this instrument made it: the invoker died because
    // the inference upstream was unreachable, and the verdict blamed a 4B model that was never asked
    // a question.
    const { verdict, aboutTheModel } = classifyDispatchFailure(message)
    record(
      verdict,
      `The lane produced no patch. Wall: ${message}. ` +
        (aboutTheModel
          ? `The provider ran and returned without a usable change. `
          : `This is an infrastructure boundary and says nothing about whether the model can implement. `) +
        `Task: the bounded pure-helper task with tests. ` +
        `Model: williamos-qwen3-4b:64k (qwen3 4.0B, num_ctx 65536, temperature 0). Elapsed ${Math.round((Date.now() - started) / 1000)}s.`,
    )
    process.exit(0)
  }

  // The provider edits its own owned worktree, and leaves the change unstaged and untracked. Inspecting
  // with git diff --cached against an unstaged tree reports PATCH_EMPTY_WALL for a lane that just wrote
  // a correct function -- which this instrument did, once, before this line existed.
  const produced = patchWorkspace ?? workspace
  await git(["add", "-A"], produced)
  const inspected = await inspectWorkspaceChanges(produced, ALLOWED_PATHS)
  const elapsed = Math.round((Date.now() - started) / 1000)
  record(
    "PROVEN",
    `The lane produced a patch that passed the kernel's own walls unmodified: ` +
      `${inspected.changedPaths.length} file(s) (${inspected.changedPaths.join(", ")}), ${inspected.patchBytes} bytes, ` +
      `base ${baseSha.slice(0, 12)}, elapsed ${elapsed}s. ` +
      `Model: williamos-qwen3-4b:64k (qwen3 4.0B, num_ctx 65536, temperature 0), no fallback. ` +
      `Task: add a pure helper with a stated contract plus vitest cases for all four branches.`,
  )
} finally {
  try { await git(["worktree", "remove", "--force", workspace]) } catch { /* a stale scratch worktree is not the verdict */ }
}
