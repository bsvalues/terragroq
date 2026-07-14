import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { createNativeAdapters } from "./native-adapters.mjs"
import { runOperationalKernelCycle } from "./operational-kernel.mjs"

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const here = path.dirname(fileURLToPath(import.meta.url))
const repositoryPath = path.resolve(option("--repository", path.join(here, "..", "..")))
const root = path.resolve(option("--root", path.join(process.env.USERPROFILE, ".williamos", "runtime-operator")))
const registryPath = path.resolve(option("--registry", path.join(repositoryPath, "runtime-operator", "native", "authority-registry.json")))
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
const adapters = createNativeAdapters({ root, repositoryPath, scriptsPath: path.join(repositoryPath, "scripts", "local") })

try {
  const result = await runOperationalKernelCycle({ root, registry, adapters })
  const report = {
    state: result.state,
    workOrderId: result.workOrderId ?? null,
    pr: result.pr ?? null,
    nextWorkOrderId: result.nextWorkOrderId ?? null,
    ownerDecisionRequired: result.ownerDecisionRequired ?? false,
  }
  process.stdout.write(`OPERATIONAL_KERNEL_STATUS=${JSON.stringify(report)}\n`)
  if (result.ownerDecisionRequired) process.exitCode = 2
} catch (error) {
  const message = String(error?.message ?? error)
  const wall = message.match(/[A-Z][A-Z0-9_]+_WALL/)?.[0] ?? "OPERATIONAL_KERNEL_WALL"
  process.stderr.write(`${wall}\n`)
  process.exitCode = /(?:AUTHORITY_(?:ACTIVATION|OWNER_GATE)_WALL|CODEX_AUTHORITY_WALL|GITHUB_AUTHORITY_WALL|RUNTIME_READINESS_WALL)/.test(wall) ? 2 : 1
}
