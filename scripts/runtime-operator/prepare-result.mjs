import fs from "node:fs"

import { parseCodexResult } from "./prompt.mjs"

const envelope = JSON.parse(fs.readFileSync("runtime-request/envelope.json", "utf8"))
const raw = fs.readFileSync("runtime-result/result.json", "utf8")
const result = parseCodexResult(raw, envelope)
fs.writeFileSync("runtime-result/parsed.json", JSON.stringify(result, null, 2))
if (result.result === "PATCH_READY") fs.writeFileSync("runtime-result/change.patch", result.unifiedPatch)

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${result.result}\n`)
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `work_order_id=${envelope.workOrderId}\n`)
}
