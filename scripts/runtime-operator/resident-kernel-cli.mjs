import { register } from "node:module"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

/**
 * The resident continuation entry point (#WO-0027, GRANT-0013).
 *
 * A scheduled task on HERMES invokes this entry point on an interval. One invocation now keeps the
 * existing WilliamOS kernel moving across COMPLETED child boundaries until it reaches a real wait,
 * owner boundary, failure/backoff, or an empty queue. The checkpoint still carries continuity between
 * invocations. WilliamOS state on ATLAS is the trigger; GitHub is projection. The kill switch is the
 * activation file -- delete it and the next cycle refuses with AUTHORITY_ACTIVATION_WALL.
 *
 * This deliberately does not reuse operational-kernel-cli.mjs, which wires the terminally quarantined
 * issue #357 adapter and its checked-in registry. That quarantine is left exactly as it is.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
register("../repo-alias-loader.mjs", pathToFileURL(`${here}${path.sep}`))

const { runOperationalKernelCycle } = await import("./operational-kernel.mjs")
const { createWilliamOSAdapters } = await import("./williamos-adapters.mjs")
const { runResidentKernelDrain } = await import("./resident-kernel-drain.mjs")
const { classifyResidentKernelFailure, formatResidentKernelFailure } = await import("./resident-kernel-diagnostics.mjs")

const repositoryPath = path.resolve(here, "..", "..")
const root = path.resolve(process.env.WILLIAMOS_KERNEL_ROOT ?? path.join(process.env.USERPROFILE, ".williamos", "runtime-operator"))

const adapters = createWilliamOSAdapters({ root, repositoryPath })

try {
  const result = await runResidentKernelDrain({
    root,
    adapters,
    runCycle: runOperationalKernelCycle,
  })
  const report = {
    state: result.state,
    workOrderId: result.workOrderId ?? null,
    pr: result.pr ?? null,
    nextWorkOrderId: result.nextWorkOrderId ?? null,
    ownerDecisionRequired: result.ownerDecisionRequired ?? false,
    residentCycles: result.residentCycles ?? 1,
    completedCount: result.completedCount ?? 0,
    lastCompletedWorkOrderId: result.lastCompletedWorkOrderId ?? null,
  }
  process.stdout.write(`RESIDENT_KERNEL_STATUS=${JSON.stringify(report)}\n`)
  if (result.ownerDecisionRequired) process.exitCode = 2
} catch (error) {
  // A bare wall token is not evidence. This keeps the typed outer class AND a sanitized cause, so
  // an unreachable database reads as plumbing rather than as a refusal the kernel never made.
  const verdict = classifyResidentKernelFailure(error)
  process.stderr.write(`${formatResidentKernelFailure(verdict)}\n`)
  process.exitCode = /AUTHORITY_ACTIVATION_WALL|RUNTIME_READINESS_WALL/.test(verdict.wall) ? 2 : 1
} finally {
  // The pg pool holds the event loop open; a resident drain must actually end at a real wait/idle state.
  process.exit(process.exitCode ?? 0)
}
