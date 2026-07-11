import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("runtime operator secret scan", () => {
  it("accepts ordinary evidence and rejects credential-shaped content", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-operator-"))
    const safe = path.join(directory, "safe.txt")
    const unsafe = path.join(directory, "unsafe.txt")
    fs.writeFileSync(safe, "Static evidence only. No credential values are present.\n")
    fs.writeFileSync(unsafe, `api_key=${"sk-" + "a".repeat(32)}\n`)

    expect(() => execFileSync(process.execPath, ["scripts/runtime-operator/scan-secrets.mjs", safe])).not.toThrow()
    expect(() => execFileSync(process.execPath, ["scripts/runtime-operator/scan-secrets.mjs", unsafe])).toThrow()
  })

  it("accepts NUL-delimited filenames containing spaces", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "runtime operator "))
    const safe = path.join(directory, "evidence report.txt")
    fs.writeFileSync(safe, "Static evidence only.\n")

    expect(() => execFileSync(process.execPath, ["scripts/runtime-operator/scan-secrets.mjs", "--nul-stdin"], {
      input: `${safe}\0`,
    })).not.toThrow()
  })
})
