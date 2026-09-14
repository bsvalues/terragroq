import { existsSync } from "node:fs"
import { resolve, sep } from "node:path"

/**
 * A catalogued operation that spawns `node <relative-path>` only works when that path exists inside the
 * checkout. Most repositories the cockpit can bind to are not Node projects at all, so the child dies in
 * the module loader and the operator is shown a stack trace instead of a reason.
 *
 * Server-only on purpose: `lib/loom/operations.ts` is imported by a `"use client"` component, so the
 * catalogue itself cannot touch the filesystem.
 */

export type NodeOperationUnavailable = {
  code: "OPERATION_NOT_RUNNABLE_IN_REPOSITORY"
  detail: string
}

/**
 * Resolve the script a `node` operation would execute and report why it cannot run.
 *
 * Returns `null` when the operation can proceed. Anything not runnable is refused, so the surface says
 * "this repository has no test runner" rather than "Cannot find module".
 */
export function describeUnavailableNodeOperation(
  projectRoot: string,
  args: readonly string[],
): NodeOperationUnavailable | null {
  // The spawned script is the first argument (node <script> [...args]); catalogue entries keep any
  // subcommand after it. Node entry points are not always extension-qualified — Next.js ships
  // `node_modules/next/dist/bin/next` with no suffix — so the scan must not require one. A bare
  // subcommand such as `run` is not a path, so treat only a path-shaped first argument as the script.
  const candidate = args.find((arg) => arg.endsWith(".mjs") || arg.endsWith(".cjs") || arg.endsWith(".js"))
    ?? args.find((arg) => arg.includes("/"))
  if (!candidate) return null
  const script = candidate

  const absolute = resolve(projectRoot, script)
  // A path that escaped the checkout must never be executed, and is reported as a refusal rather than
  // resolved -- the catalogue is fixed, so this only ever fires on a malformed entry.
  if (!absolute.startsWith(resolve(projectRoot) + sep)) {
    return {
      code: "OPERATION_NOT_RUNNABLE_IN_REPOSITORY",
      detail: `The operation resolves ${script} outside the selected repository, so it was not run.`,
    }
  }

  if (existsSync(absolute)) return null

  const runner = script.split("/")[0] === "node_modules" ? script.split("/")[1] : script
  return {
    code: "OPERATION_NOT_RUNNABLE_IN_REPOSITORY",
    detail:
      `This repository has no ${runner} installed, so ${script} does not exist in `
      + `${projectRoot}. Install the repository's dependencies, or select a checkout that has them.`,
  }
}
