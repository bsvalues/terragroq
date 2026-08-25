/**
 * The HERMES cockpit's start script as a CONTRACT, not as prose.
 *
 * `CONT-EXPV2-RESOLVER-NOT-WIRED`: `lib/fabric/authority-registry-url.mjs` existed to stop the lab's
 * authority oracle being addressed by a written-down IP, and had no production caller, so a normal
 * restart went on using the stale `192.168.88.5` in `.env.local`. The start script is that caller.
 *
 * The properties below are the ones whose absence would be invisible: a script that resolves the
 * address and then starts anyway when resolution fails is indistinguishable, from the outside, from
 * one that works -- the cockpit answers 200 on `/sign-in` either way while being unable to reach its
 * database. That is exactly how this survived two days unnoticed.
 *
 * Comments are stripped before the address assertion. The file necessarily quotes the addresses that
 * caused all of this, and an assertion that could not tell an explanation from a setting would either
 * fail on the explanation or force the explanation out.
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const START_SCRIPT = path.join(process.cwd(), "deploy", "hermes", "williamos-live", "start-williamos-live.ps1")
const DEPLOY_SCRIPT = path.join(process.cwd(), "scripts", "deploy-hermes-runtime.ps1")

const startText = fs.readFileSync(START_SCRIPT, "utf8")
const deployText = fs.readFileSync(DEPLOY_SCRIPT, "utf8")

/** Drop the comment-based help block and every `#` line comment, leaving only executable text. */
function executableOnly(text: string) {
  return text
    .replace(/<#[\s\S]*?#>/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n")
}

describe("the cockpit's start script is declared in the repository", () => {
  it("exists, so the node's supervised service is not defined only by a hand-typed file", () => {
    expect(fs.existsSync(START_SCRIPT)).toBe(true)
  })

  it("names no other machine by address in anything it executes", () => {
    // The address of ATLAS is a lookup now. A literal here is the fifth occurrence of
    // CONT-EXPV2-HARDCODED-ADDRESS-CLASS and would be correct only until the next lease change.
    //
    // Loopback and the unspecified address are exempt and the exemption is narrow on purpose: they
    // name THIS host's own socket, which is not a thing a registry can move. Every other literal is
    // a claim about where some other machine lives, which is the class of claim that keeps rotting.
    const local = new Set(["127.0.0.1", "0.0.0.0"])
    const literals = (executableOnly(startText).match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])
      .filter((address) => !local.has(address))
    expect(literals).toEqual([])
  })

  it("resolves DATABASE_URL through the canonical resolver CLI rather than restating it", () => {
    const code = executableOnly(startText)
    expect(code).toContain("resolve-authority-registry-url.mjs")
    expect(code).toMatch(/\$env:DATABASE_URL\s*=/)
  })

  it("refuses to start when resolution fails, instead of falling back to the file's address", () => {
    const code = executableOnly(startText)
    // A non-zero resolver exit must reach an `exit 1` and must NOT reach Start-Process.
    expect(code).toMatch(/\$resolverExit\s*-ne\s*0/)
    const refusalIndex = code.indexOf("AUTHORITY_HOST_UNRESOLVED")
    const startIndex = code.indexOf("Start-Process")
    expect(refusalIndex).toBeGreaterThan(-1)
    expect(startIndex).toBeGreaterThan(refusalIndex)
    expect(code).not.toMatch(/catch\s*\{\s*\}/)
  })

  it("never writes the resolved connection string anywhere durable", () => {
    const code = executableOnly(startText)
    // The resolver's `--out` mode writes a file containing the password; the boot path must not use
    // it, and the URL must never reach a log or the redirected stdout/stderr files.
    expect(code).not.toContain("--out=")
    expect(code).not.toMatch(/Write-Boot\s+"[^"]*\$resolvedUrl/)
    expect(code).not.toMatch(/Out-File[^\n]*\$resolvedUrl/)
    expect(code).not.toMatch(/Write-(Output|Host)[^\n]*\$resolvedUrl/)
  })

  it("only ever overrides the one variable it resolves", () => {
    const assignments = executableOnly(startText).match(/\$env:[A-Za-z_][A-Za-z0-9_]*\s*=/g) ?? []
    const names = new Set(assignments.map((a) => a.replace(/\s*=$/, "").replace("$env:", "")))
    expect(names).toEqual(new Set(["NODE_ENV", "HOSTNAME", "PORT", "DATABASE_URL"]))
  })
})

describe("the deploy places what the start script needs and can be undone", () => {
  it("copies the boot-time tooling Next's tracer does not include", () => {
    const code = executableOnly(deployText)
    // The whole fabric mjs directory, not a hand-listed pair: the resolver's import closure reaches
    // registry -> run-baseline -> audit/broker/transport, and a list would fail at boot, not here.
    expect(code).toContain('Join-Path $Source "lib\\fabric"')
    expect(code).toContain("scripts\\fabric\\resolve-authority-registry-url.mjs")
  })

  it("fails loudly if a boot-time tool is missing from the source tree", () => {
    expect(executableOnly(deployText)).toMatch(/throw "Missing boot-time resolution tool/)
  })

  it("proves the deployed boot path can resolve before it restarts the service", () => {
    const code = executableOnly(deployText)
    const checkIndex = code.indexOf("cannot resolve the authority registry")
    // lastIndexOf: the rollback instructions printed earlier also mention Start-ScheduledTask, and
    // the one that matters is the invocation that actually restarts the service.
    const startIndex = code.lastIndexOf("Start-ScheduledTask")
    expect(checkIndex).toBeGreaterThan(-1)
    expect(startIndex).toBeGreaterThan(checkIndex)
    // The check must exercise resolution with the password masked, never printed.
    expect(code).toMatch(/--redact/)
  })

  it("captures the outgoing build before the mirroring copy destroys it", () => {
    const code = executableOnly(deployText)
    const captureIndex = code.indexOf("rollback captured")
    const mirrorIndex = code.indexOf('robocopy (Join-Path $standalone ".next")')
    expect(captureIndex).toBeGreaterThan(-1)
    expect(mirrorIndex).toBeGreaterThan(captureIndex)
  })

  it("still refuses to ship a build it cannot tie to the current commit", () => {
    // Pre-existing #762 doctrine; asserted here so the rollback/tooling edits cannot quietly remove it.
    const code = executableOnly(deployText)
    expect(code).toMatch(/STALE BUILD/)
    expect(code).toMatch(/STALE ARTIFACT/)
  })

  it("still proves the runtime's .env.local survived the copy", () => {
    expect(executableOnly(deployText)).toMatch(/\$envNow -ne \$envGuard/)
  })
})
