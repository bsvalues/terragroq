import crypto from "node:crypto"
import fs from "node:fs"

const file = "/audit/events.jsonl"
const event = process.argv[2] ?? "unknown"
const detail = process.argv[3] ?? ""
const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n") : []
let previousHash = "GENESIS"
if (lines.length) {
  try { previousHash = JSON.parse(lines.at(-1)).hash ?? "INVALID_PREVIOUS_RECORD" } catch { previousHash = "INVALID_PREVIOUS_RECORD" }
}
const record = { at: new Date().toISOString(), event, detail, previousHash }
const hash = crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex")
fs.appendFileSync(file, `${JSON.stringify({ ...record, hash })}\n`, { flag: "a" })
