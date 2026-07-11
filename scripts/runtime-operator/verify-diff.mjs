import { execFileSync } from "node:child_process"
import fs from "node:fs"

import { validateChangedPaths } from "./policy.mjs"

const envelope = JSON.parse(fs.readFileSync("runtime-request/envelope.json", "utf8"))
const changed = execFileSync("git", ["diff", "--name-only", "--cached"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
const policy = validateChangedPaths(envelope, changed)
if (!policy.allowed) throw new Error(`Patch changed paths outside the Work Order allowlist: ${policy.violations.join(", ")}`)
if (changed.length === 0) throw new Error("Patch produced no changed files")
console.log(JSON.stringify({ workOrderId: envelope.workOrderId, changed }))
