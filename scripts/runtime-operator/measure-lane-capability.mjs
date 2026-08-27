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
 *   node --no-warnings scripts/runtime-operator/measure-lane-capability.mjs --invalidate-stale-baseline-verdict
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
const TASK_TARGET_PATHS = ["scripts/runtime-operator/worker-lanes.mjs"]
const REQUIRED_VALIDATION = ["diff-check", "test"]
const TARGET_ACCELERATOR = Object.freeze({
  node: "HERMES",
  uuid: "GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2",
  processName: "D:\\HermesServices\\ollama\\v0.9.2\\ollama.exe",
})

const dryRun = process.argv.includes("--dry-run")
const invalidateStaleBaseline = process.argv.includes("--invalidate-stale-baseline-verdict")

const { buildWorkerPrompt } = await import("./worker-lanes.mjs")
const {
  buildStaleBaselineInvalidation,
  observeSameRunAccelerator,
  runMeasurementPrelude,
  runMeasuredAttempt,
} = await import("./lane-measurement.mjs")
const {
  createWilliamOSAdapters,
  dispatchHermesLocal,
  unmountedPolicyVolumes,
} = await import("./williamos-adapters.mjs")
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

const policy = JSON.parse(fs.readFileSync(path.join(REPOSITORY, HERMES_KERNEL_POLICY_RELATIVE), "utf8"))
const { execFile } = await import("node:child_process")
const { promisify } = await import("node:util")
const exec = promisify(execFile)
const git = (args, cwd = REPOSITORY) => exec("git", ["--no-replace-objects", ...args], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })

async function sampleAccelerators({ signal }) {
  const options = { encoding: "utf8", timeout: 3_000, windowsHide: true, signal }
  const observed = await exec("nvidia-smi", [
    "-i", TARGET_ACCELERATOR.uuid,
    "--query-gpu=uuid,name,memory.used,utilization.gpu",
    "--format=csv,noheader,nounits",
  ], options)
  const processes = await exec("nvidia-smi", [
    "--query-compute-apps=gpu_uuid,process_name,used_gpu_memory",
    "--format=csv,noheader,nounits",
  ], options)
  const applications = processes.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [uuid, processName, processVramMiB] = line.split(",").map((field) => field.trim())
    return { uuid, processName, processVramMiB: Number(processVramMiB) }
  })
  return observed.stdout.trim().split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [uuid, model, vramUsedMiB, utilizationPercent] = line.split(",").map((field) => field.trim())
    return applications.filter((application) => application.uuid === uuid).map((application) => ({
      uuid,
      model,
      vramUsedMiB: Number(vramUsedMiB),
      utilizationPercent: Number(utilizationPercent),
      processName: application.processName,
      processVramMiB: application.processVramMiB,
    }))
  })
}

// Invalidation is a guarded evidence correction, not a measurement attempt. It must run before the
// generic volume recorder so a missing drive cannot overwrite the settled record it was asked to
// inspect. Any failed prerequisite throws without calling record().
const prelude = await runMeasurementPrelude({
  invalidateStaleBaseline,
  invalidate: async () => {
    const capabilityFile = path.join(ROOT, "state", "lane-capability.json")
    let current
    try { current = JSON.parse(fs.readFileSync(capabilityFile, "utf8"))?.[LANE] }
    catch { throw new Error("LANE_CAPABILITY_INVALIDATION_STATE_WALL") }
    const baselineSha = policy?.placement?.baselineCommit
    const baselineWorkspace = policy?.placement?.baselineWorkspace
    const head = (await git(["rev-parse", "HEAD"], baselineWorkspace)).stdout.trim()
    const dirty = (await git(["status", "--porcelain"], baselineWorkspace)).stdout.trim()
    if (head !== baselineSha || dirty !== "") throw new Error("LANE_CAPABILITY_INVALIDATION_BASELINE_WALL")
    const missingTargetPaths = []
    for (const target of TASK_TARGET_PATHS) {
      try { await git(["cat-file", "-e", `${baselineSha}:${target}`], baselineWorkspace) }
      catch { missingTargetPaths.push(target) }
    }
    const invalidation = buildStaleBaselineInvalidation({ currentRecord: current, baselineSha, missingTargetPaths })
    record(invalidation.verdict, invalidation.evidence)
  },
  unmounted: unmountedPolicyVolumes(policy),
  recordVolumeUnavailable: (unmounted) => record(
    `BLOCKED_VOLUME_UNAVAILABLE`,
    `The provider policy pins paths on ${unmounted.map((entry) => entry.volume).join(", ")}, which is not mounted. ` +
      `This says nothing about the lane or the model.`,
  ),
})
if (prelude.stop) process.exit(0)

const workspace = path.join(ROOT, "state", "capability-measurement")
fs.rmSync(workspace, { recursive: true, force: true })

// The checkout is a governed delivery of the requested base. Its HEAD is authoritative for this
// measurement; origin/main may point at an older bundle ref on a host with no GitHub access.
const baseSha = (await git(["rev-parse", "HEAD"])).stdout.trim()
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
  const adapters = createWilliamOSAdapters({ root: ROOT, repositoryPath: REPOSITORY })
  const outcome = await runMeasuredAttempt({
    attempt: async () => {
      let acceleratorEvidence = null
      let measurementRunId = null
      const patchWorkspace = await dispatchHermesLocal({
        root: ROOT,
        repositoryPath: REPOSITORY,
        workOrderId: "capability-measurement-905",
        workspace,
        prompt,
        workContext: null,
        requiredBasePaths: TASK_TARGET_PATHS,
        observeInvocation: async ({ runId, invoke }) => {
          measurementRunId = runId
          const observed = await observeSameRunAccelerator({
            runId,
            node: os.hostname(),
            targetAccelerator: TARGET_ACCELERATOR,
            attempt: invoke,
            sampleAccelerators,
          })
          acceleratorEvidence = observed.acceleratorEvidence
          return observed.value
        },
        newId: () => crypto.randomUUID(),
      })
      // The provider edits its own owned worktree, and leaves the change unstaged and untracked.
      // Collection is part of the measured attempt, not an afterthought outside its failure boundary.
      const produced = patchWorkspace ?? workspace
      try { await git(["add", "-A"], produced) }
      catch { throw new Error("PATCH_COLLECTION_WALL") }
      const inspected = await inspectWorkspaceChanges(produced, ALLOWED_PATHS)
      return { inspected, patchWorkspace: produced, acceleratorEvidence, measurementRunId }
    },
    targetAccelerator: TARGET_ACCELERATOR,
    requiredValidation: REQUIRED_VALIDATION,
    validate: (request) => adapters.validate(request),
    recordFailure: ({ verdict, aboutTheModel, message }) => {
      record(
        verdict,
        `The lane produced no usable patch. Wall: ${message}. ` +
          (aboutTheModel
            ? `The provider ran and returned without a usable change. `
            : `This boundary says nothing about whether the model can implement. `) +
          `Task: the bounded pure-helper task with tests. ` +
          `Requested base: ${baseSha}. ` +
          `Model: williamos-qwen3-4b:64k (qwen3 4.0B, num_ctx 65536, temperature 0). Elapsed ${Math.round((Date.now() - started) / 1000)}s.`,
      )
    },
  })
  if (outcome.ok) {
    const elapsed = Math.round((Date.now() - started) / 1000)
    const { inspected, promotion } = outcome.value
    const accelerator = promotion.acceleratorEvidence
    record(
      promotion.verdict,
      `The lane produced a patch that passed the kernel's own walls unmodified: ` +
        `${inspected.changedPaths.length} file(s) (${inspected.changedPaths.join(", ")}), ${inspected.patchBytes} bytes, ` +
        `base ${baseSha.slice(0, 12)}, elapsed ${elapsed}s. ` +
        `Requested validation passed: ${promotion.requiredValidation.join(", ")}. ` +
        `Same-run accelerator evidence: run ${accelerator.runId}, ${accelerator.model} ${accelerator.uuid}, ` +
        `${accelerator.vramUsedMiB} MiB resident (${accelerator.processVramMiB} MiB in ${accelerator.processName}) and ` +
        `${accelerator.utilizationPercent}% utilisation sampled during ${accelerator.sampleStartedAt}..${accelerator.sampleCompletedAt} ` +
        `within ${accelerator.startedAt}..${accelerator.completedAt}. ` +
        `Model: williamos-qwen3-4b:64k (qwen3 4.0B, num_ctx 65536, temperature 0), no fallback. ` +
        `Task: add a pure helper with a stated contract plus vitest cases for all four branches.`,
    )
  }
} finally {
  try { await git(["worktree", "remove", "--force", workspace]) } catch { /* a stale scratch worktree is not the verdict */ }
}
