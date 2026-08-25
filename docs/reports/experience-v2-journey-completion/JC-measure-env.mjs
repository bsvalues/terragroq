// Report the SHAPE of a DATABASE_URL without ever emitting the credential itself.
// Host, port, database and role are configuration; the password appears only as a truncated digest
// and a length, which is enough to tell two credentials apart and not enough to be one.
import fs from "node:fs"
import crypto from "node:crypto"

const out = []
for (const file of process.argv.slice(2)) {
  let raw
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (error) {
    out.push({ file, error: error.code ?? String(error) })
    continue
  }
  const match = raw.match(/^\s*DATABASE_URL\s*=\s*(.*)$/m)
  if (!match) {
    out.push({ file, error: "NO_DATABASE_URL" })
    continue
  }
  const value = match[1].trim().replace(/^["']|["']$/g, "")
  let url
  try {
    url = new URL(value)
  } catch {
    out.push({ file, error: "UNPARSEABLE" })
    continue
  }
  const password = decodeURIComponent(url.password)
  out.push({
    file,
    host: url.hostname,
    port: url.port,
    database: url.pathname.slice(1),
    role: url.username,
    search: url.search,
    passwordSha256_16: crypto.createHash("sha256").update(password).digest("hex").slice(0, 16),
    passwordLength: password.length,
    fileSha256_16: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16),
  })
}
console.log(JSON.stringify(out, null, 1))
