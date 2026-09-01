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
const RESTORE_SCRIPT = path.join(process.cwd(), "scripts", "restore-hermes-runtime.ps1")

const startText = fs.readFileSync(START_SCRIPT, "utf8")
const deployText = fs.readFileSync(DEPLOY_SCRIPT, "utf8")
const restoreText = fs.readFileSync(RESTORE_SCRIPT, "utf8")

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

  it("neutralises PowerShell 5.1's native-stderr trap around the resolver call", () => {
    // Windows PowerShell 5.1 wraps ANY native stderr in a NativeCommandError, and under `Stop` that
    // terminates the script. The resolver writes its SUCCESS evidence to stderr, so with `Stop` in
    // force the cockpit refused to boot on every attempt while resolution was working perfectly --
    // observed, not theorised: LastTaskResult 1, empty boot log, and a diagnostic naming .8.
    const code = executableOnly(startText)
    expect(code).toMatch(/\$ErrorActionPreference\s*=\s*"Continue"/)
    expect(code).toMatch(/\$previousPreference/)
    // The verdict must come from the exit code, never from whether stderr was written to.
    expect(code).toMatch(/\$resolverExit\s*=\s*\$LASTEXITCODE/)
    expect(code).not.toMatch(/&\s*\$node\s+@resolverArgs\s+2>&1/)
  })

  it("only applies the runtime variables it resolves or reads explicitly", () => {
    const assignments = executableOnly(startText).match(/\$env:[A-Za-z_][A-Za-z0-9_]*\s*=/g) ?? []
    const names = new Set(assignments.map((a) => a.replace(/\s*=$/, "").replace("$env:", "")))
    // WILLIAMOS_TERRAFUSION_ROOT joined this set in #1015. Its ABSENCE was the defect: the application
    // reads the declared TerraFusion target root, `.env.local` declared it, and
    // nothing applied it -- so the deployed bundle became "the workspace" and every governed save
    // was refused with FAILED_STALE_MAIN while the cockpit answered 200.
    expect(names).toEqual(new Set([
      "NODE_ENV",
      "HOSTNAME",
      "PORT",
      "DATABASE_URL",
      "WILLIAMOS_TERRAFUSION_ROOT",
      "WILLIAMOS_TERRAFUSION_SPACE_IDENTITY",
      "WILLIAMOS_PROJECT_ROOT",
    ]))
  })
})

describe("the cockpit is given a proven governed workspace, or it does not start (#1015)", () => {
  const code = executableOnly(startText)

  it("applies the declared workspace instead of letting process.cwd() win", () => {
    expect(code).toMatch(/\$env:WILLIAMOS_TERRAFUSION_ROOT\s*=\s*\$resolvedProjectRoot/)
    // Applied BEFORE the server is launched, or it is not applied at all.
    expect(code.indexOf("$env:WILLIAMOS_TERRAFUSION_ROOT")).toBeLessThan(code.indexOf("Start-Process"))
  })

  it("exports the WilliamOS source root separately from the TerraFusion target", () => {
    expect(code).toMatch(/Get-DeclaredEnvValue\s+-File\s+\$envFile\s+-Key\s+"WILLIAMOS_PROJECT_ROOT"/)
    expect(code).toMatch(/\$env:WILLIAMOS_PROJECT_ROOT\s*=\s*\$declaredWilliamOsRoot/)
    expect(code).not.toMatch(/\$env:WILLIAMOS_PROJECT_ROOT\s*=\s*\$resolvedProjectRoot/)
    expect(code.indexOf("$env:WILLIAMOS_PROJECT_ROOT")).toBeLessThan(code.indexOf("Start-Process"))
  })

  it("exports the stable Space identity without replacing it with the current checkout", () => {
    expect(code).toMatch(/Get-DeclaredEnvValue\s+-File\s+\$envFile\s+-Key\s+"WILLIAMOS_TERRAFUSION_SPACE_IDENTITY"/)
    expect(code).toMatch(/\$env:WILLIAMOS_TERRAFUSION_SPACE_IDENTITY\s*=\s*\$declaredTerraFusionSpaceIdentity/)
    expect(code).not.toMatch(/\$env:WILLIAMOS_TERRAFUSION_SPACE_IDENTITY\s*=\s*\$resolvedProjectRoot/)
    expect(code.indexOf("$env:WILLIAMOS_TERRAFUSION_SPACE_IDENTITY")).toBeLessThan(code.indexOf("Start-Process"))
  })

  it("does not carry a written-down workspace path of its own", () => {
    // The same reasoning as the address literals: a path baked in here is correct the day it is
    // typed and silently wrong afterwards, and a wrong workspace still serves files happily. The
    // value is a declared deployment fact, read from .env.local or passed in.
    expect(code).toMatch(/Get-DeclaredEnvValue\s+-File\s+\$envFile\s+-Key\s+"WILLIAMOS_TERRAFUSION_ROOT"/)
    expect(code).not.toMatch(/\[string\]\$ProjectRoot\s*=\s*"/)
  })

  it("refuses every way the workspace can be wrong, before Start-Process", () => {
    const startIndex = code.indexOf("Start-Process")
    for (const refusal of [
      "PROJECT_ROOT_UNDECLARED",
      "PROJECT_ROOT_MISSING",
      "PROJECT_ROOT_IS_APP_ROOT",
      "PROJECT_ROOT_NOT_GOVERNED_WORKSPACE",
      "PROJECT_ROOT_NOT_WORKTREE_ROOT",
      "PROJECT_ROOT_NO_ORIGIN_REMOTE",
      "PROJECT_ROOT_REPOSITORY_MISMATCH",
    ]) {
      const at = code.indexOf(refusal)
      expect(at, `${refusal} must be reachable`).toBeGreaterThan(-1)
      expect(at, `${refusal} must refuse before the server starts`).toBeLessThan(startIndex)
    }
    expect(code).toMatch(/function Deny-Boot[\s\S]*exit 1/)
  })

  it("refuses the exact defect it was written for: the bundle as the workspace", () => {
    expect(code).toMatch(/\$resolvedProjectRoot\s*-ieq\s*\$resolvedAppRoot/)
  })

  it("proves the premises a governed save actually depends on", () => {
    // FAILED_STALE_MAIN comes from `git fetch origin main` in the project root. So the boot proves a
    // work tree, that the root IS the work tree's root, and that an origin remote exists -- rather
    // than letting the owner discover it as a 409 on their first save.
    expect(code).toMatch(/rev-parse",\s*"--show-toplevel/)
    expect(code).toMatch(/remote",\s*"get-url",\s*"origin/)
  })

  it("neutralises the native-stderr trap around the git probes too", () => {
    // Same PowerShell 5.1 trap as the resolver call: git writes to stderr routinely, and under
    // `Stop` that would terminate the boot on a perfectly good workspace.
    expect(code).toMatch(/function Invoke-GitProbe[\s\S]*\$ErrorActionPreference\s*=\s*"Continue"/)
    expect(code).toMatch(/ExitCode\s*=\s*\$LASTEXITCODE/)
  })

  it("reads one key from .env.local without echoing the file that holds the credential", () => {
    expect(code).not.toMatch(/Write-(Output|Host|Boot)[^\n]*Get-Content[^\n]*\$envFile/)
    expect(code).toMatch(/function Get-DeclaredEnvValue/)
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

  it("installs the repository-owned WilliamOS Live task definition before restart", () => {
    const code = executableOnly(deployText)
    expect(code).toContain("deploy\\hermes\\williamos-live\\start-williamos-live.ps1")
    expect(code).toContain("C:\\ProgramData\\WilliamOS\\start-williamos-live.ps1")
    expect(code).toMatch(/Copy-Item\s+-LiteralPath\s+\$liveStartSource\s+-Destination\s+\$LiveStartTarget/)
    expect(code.indexOf("$liveStartSource")).toBeLessThan(code.lastIndexOf("Start-ScheduledTask"))
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
    // And it must survive the same native-stderr trap, judging by exit code rather than by stderr.
    expect(code).toMatch(/\$resolveExit\s*=\s*\$LASTEXITCODE/)
    expect(code).not.toMatch(/--redact 2>&1/)
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

  it("deploys and verifies the loose provenance record inspected by operators", () => {
    const code = executableOnly(deployText)
    expect(code).toContain("lib\\generated\\build-provenance.json")
    expect(code).toMatch(/Copy-Item\s+\$provenanceSource\s+\$provenanceTarget/)
    expect(code).toMatch(/\$deployedLooseSha\s+-ne\s+\$builtSha/)
  })

  it("treats the HTTPS proxy as part of the exact deployment and restarts its supervisor", () => {
    const code = executableOnly(deployText)
    expect(code).toContain("scripts\\hermes-https-proxy.mjs")
    expect(code).toMatch(/Stop-ScheduledTask\s+-TaskName\s+\$HttpsTaskName/)
    expect(code).toMatch(/Start-ScheduledTask\s+-TaskName\s+\$HttpsTaskName/)
    expect(code).toContain("Test-HttpsCockpit")
  })

  it("makes verify-only prove both product origins and agreement between both provenance surfaces", () => {
    const code = executableOnly(deployText)
    const verify = code.slice(code.indexOf('if ($VerifyOnly)'))
    expect(verify).toContain("Test-Cockpit")
    expect(verify).toContain("Test-HttpsCockpit")
    expect(verify).toMatch(/\$runningSha\s+-ne\s+\$looseSha/)
  })

  it("captures every loose file it overwrites in the rollback", () => {
    const code = executableOnly(deployText)
    for (const file of ["server.js", "package.json", "lib\\generated\\build-provenance.json", "scripts\\hermes-https-proxy.mjs"]) {
      expect(code).toContain(file)
    }
    expect(code).toContain("restore-hermes-runtime.ps1")
  })

  it("records absent rollback inputs so restore can remove files introduced by deploy", () => {
    const code = executableOnly(deployText)
    const restore = executableOnly(restoreText)
    expect(code).toContain("rollback-manifest.json")
    expect(code).toContain("wasPresent")
    expect(code).toContain("nextPresent")
    expect(restore).toContain("expectedRollbackFiles")
    expect(restore).toContain("Compare-Object")
    expect(restore).toMatch(/elseif\s*\(Test-Path -LiteralPath \$target\)[\s\S]*Remove-Item -LiteralPath \$target/)
    expect(code).toContain("liveStartWasPresent")
    expect(code).toContain("external\\start-williamos-live.ps1")
    expect(restore).toContain("Rollback manifest does not name the exact WilliamOS Live start definition")
    expect(restore).toMatch(/Copy-Item\s+-LiteralPath\s+\$liveStartRollbackFile\s+-Destination\s+\$LiveStartTarget/)
    expect(restore).toMatch(/Remove-Item\s+-LiteralPath\s+\$LiveStartTarget/)
  })

  it("refuses to stop unrelated processes on either product port", () => {
    const code = executableOnly(deployText)
    expect(code).toContain("Stop-ExpectedListener")
    expect(code).toContain('ExpectedCommandFragment "server.js"')
    expect(code).toContain('ExpectedCommandFragment "hermes-https-proxy.mjs"')
    expect(code).toContain("owned by an unrelated process")
  })
})
