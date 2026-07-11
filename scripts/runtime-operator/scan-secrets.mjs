import fs from "node:fs"

const files = process.argv.slice(2)
if (files.length === 0) throw new Error("At least one file is required for secret scanning")

const patterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/i,
  /(?:password|token|api[_ -]?key|client[_ -]?secret)\s*[:=]\s*["']?[^\s"']{12,}/i,
]

const violations = []
for (const file of files) {
  const content = fs.readFileSync(file, "utf8")
  if (patterns.some((pattern) => pattern.test(content))) violations.push(file)
}

if (violations.length > 0) throw new Error(`Potential secret material found in: ${violations.join(", ")}`)
console.log(`Secret scan passed for ${files.length} file(s).`)
