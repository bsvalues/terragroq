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
    // A non-zero resolver exit must reach an `exit 1` and must NOT reach the server invocation.
    expect(code).toMatch(/\$resolverExit\s*-ne\s*0/)
    const refusalIndex = code.indexOf("AUTHORITY_HOST_UNRESOLVED")
    const startIndex = code.indexOf("& $node $server")
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
    const code = executableOnly(startText)
    const assignments = code.match(/\$env:[A-Za-z_][A-Za-z0-9_]*\s*=/g) ?? []
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
      "WILLIAMOS_PROJECT_SPACE_IDENTITY",
    ]))
    expect(code).toMatch(/Set-Item\s+-Path\s+"Env:\$\(\$mount\.Environment\)"\s+-Value\s+\$mount\.ResolvedRoot/)
  })
})

describe("the cockpit is given a proven governed workspace, or it does not start (#1015)", () => {
  const code = executableOnly(startText)

  it("applies the declared workspace instead of letting process.cwd() win", () => {
    expect(code).toMatch(/\$env:WILLIAMOS_TERRAFUSION_ROOT\s*=\s*\$resolvedProjectRoot/)
    // Applied BEFORE the server is launched, or it is not applied at all.
    expect(code.indexOf("$env:WILLIAMOS_TERRAFUSION_ROOT")).toBeLessThan(code.indexOf("& $node $server"))
  })

  it("exports the WilliamOS source root separately from the TerraFusion target", () => {
    expect(code).toMatch(/Get-DeclaredEnvValue\s+-File\s+\$envFile\s+-Key\s+"WILLIAMOS_PROJECT_ROOT"/)
    expect(code).toMatch(/\$env:WILLIAMOS_PROJECT_ROOT\s*=\s*\$declaredWilliamOsRoot/)
    expect(code).not.toMatch(/\$env:WILLIAMOS_PROJECT_ROOT\s*=\s*\$resolvedProjectRoot/)
    expect(code.indexOf("$env:WILLIAMOS_PROJECT_ROOT")).toBeLessThan(code.indexOf("& $node $server"))
  })

  it("exports the stable Space identity without replacing it with the current checkout", () => {
    expect(code).toMatch(/Get-DeclaredEnvValue\s+-File\s+\$envFile\s+-Key\s+"WILLIAMOS_TERRAFUSION_SPACE_IDENTITY"/)
    expect(code).toMatch(/\$env:WILLIAMOS_TERRAFUSION_SPACE_IDENTITY\s*=\s*\$declaredTerraFusionSpaceIdentity/)
    expect(code).not.toMatch(/\$env:WILLIAMOS_TERRAFUSION_SPACE_IDENTITY\s*=\s*\$resolvedProjectRoot/)
    expect(code.indexOf("$env:WILLIAMOS_TERRAFUSION_SPACE_IDENTITY")).toBeLessThan(code.indexOf("& $node $server"))
  })

  it("does not carry a written-down workspace path of its own", () => {
    // The same reasoning as the address literals: a path baked in here is correct the day it is
    // typed and silently wrong afterwards, and a wrong workspace still serves files happily. The
    // value is a declared deployment fact, read from .env.local or passed in.
    expect(code).toMatch(/Get-DeclaredEnvValue\s+-File\s+\$envFile\s+-Key\s+"WILLIAMOS_TERRAFUSION_ROOT"/)
    expect(code).not.toMatch(/\[string\]\$ProjectRoot\s*=\s*"/)
  })

  it("refuses every way the workspace can be wrong before invoking the server", () => {
    const startIndex = code.indexOf("& $node $server")
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

describe("the cockpit validates optional Core Seven secondary mounts before exporting them", () => {
  const code = executableOnly(startText)
  const expected = [
    ["WILLIAMOS_TERRAFUSION_SOVEREIGN_OS_ROOT", "bsvalues/terrafusion-os"],
    ["WILLIAMOS_TERRAFUSION_FORGE_ROOT", "bsvalues/terrafusion-forge"],
    ["WILLIAMOS_TERRAFUSION_ATLAS_ROOT", "bsvalues/terrafusion-atlas"],
    ["WILLIAMOS_TERRAFUSION_DAIS_ROOT", "bsvalues/terrafusion-dais"],
    ["WILLIAMOS_TERRAFUSION_DOSSIER_ROOT", "bsvalues/terrafusion-dossier"],
    ["WILLIAMOS_TERRAFUSION_GPT_ROOT", "bsvalues/terrafusion-gpt"],
  ] as const

  it("owns the exact six environment-to-repository mappings", () => {
    for (const [environment, repository] of expected) {
      expect(code).toContain(`Environment = "${environment}"; Repository = "${repository}"`)
    }
    expect(code.match(/Environment = "WILLIAMOS_TERRAFUSION_[A-Z_]+_ROOT"; Repository = "bsvalues\/terrafusion-[a-z-]+"/g))
      .toHaveLength(6)
  })

  it("allows an absent optional declaration without fabricating or exporting a mount", () => {
    const clearInherited = code.indexOf('Remove-Item -Path "Env:$($secondary.Environment)"')
    const readDeclaration = code.indexOf("Get-DeclaredEnvValue -File $envFile -Key $secondary.Environment")
    const retain = code.indexOf("$verifiedSecondaryRepositoryMounts +=")
    const exportMount = code.indexOf('Set-Item -Path "Env:$($mount.Environment)"')
    expect(clearInherited).toBeGreaterThan(-1)
    expect(clearInherited).toBeLessThan(readDeclaration)
    expect(readDeclaration).toBeLessThan(retain)
    expect(retain).toBeLessThan(exportMount)
    expect(code).toMatch(/Remove-Item\s+-Path\s+"Env:\$\(\$secondary\.Environment\)"\s+-ErrorAction\s+SilentlyContinue/)
    expect(code).toMatch(/Get-DeclaredEnvValue\s+-File\s+\$envFile\s+-Key\s+\$secondary\.Environment/)
    expect(code).toMatch(/if \(-not \$declaredSecondaryRoot\)\s*\{\s*continue\s*\}/)
    expect(code).not.toMatch(/WILLIAMOS_TERRAFUSION_(?:SOVEREIGN_OS|FORGE|ATLAS|DAIS|DOSSIER|GPT)_ROOT\s*=\s*["']/)
  })

  it("fails closed for every configured-root violation before Node starts", () => {
    const serverStart = code.indexOf("& $node $server")
    for (const refusal of [
      "SECONDARY_ROOT_MISSING",
      "SECONDARY_ROOT_IS_APP_ROOT",
      "SECONDARY_ROOT_NOT_GOVERNED_WORKSPACE",
      "SECONDARY_ROOT_NOT_WORKTREE_ROOT",
      "SECONDARY_ROOT_NO_ORIGIN_REMOTE",
      "SECONDARY_ROOT_REPOSITORY_MISMATCH",
    ]) {
      const at = code.indexOf(refusal)
      expect(at, `${refusal} must be reachable`).toBeGreaterThan(-1)
      expect(at, `${refusal} must refuse before the server starts`).toBeLessThan(serverStart)
    }
  })

  it("proves exact worktree root and canonical origin before retaining or exporting a mount", () => {
    const retain = code.indexOf("$verifiedSecondaryRepositoryMounts +=")
    const exportMount = code.indexOf('Set-Item -Path "Env:$($mount.Environment)"')
    const serverStart = code.indexOf("& $node $server")
    expect(code).toMatch(/\$secondaryTopLevel\s*=\s*Invoke-GitProbe[^\n]*"rev-parse",\s*"--show-toplevel"/)
    expect(code).toMatch(/\$normalizedSecondaryTopLevel\s+-ine\s+\$resolvedSecondaryRoot/)
    expect(code).toMatch(/\$secondaryOriginRemote\s*=\s*Invoke-GitProbe[^\n]*"remote",\s*"get-url",\s*"origin"/)
    expect(code).toMatch(/\$normalizedSecondaryOrigin\s+-ne\s+\$secondary\.Repository/)
    expect(retain).toBeGreaterThan(code.indexOf("SECONDARY_ROOT_REPOSITORY_MISMATCH"))
    expect(exportMount).toBeGreaterThan(retain)
    expect(exportMount).toBeLessThan(serverStart)
  })

  it("documents all six optional declarations without changing the required OS 1.0 declaration", () => {
    const example = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8")
    expect(example).toContain('WILLIAMOS_TERRAFUSION_ROOT="/absolute/path/to/terrafusion_os_1.0"')
    for (const [environment] of expected) expect(example).toMatch(new RegExp(`^${environment}=`, "m"))
  })
})

describe("the deploy places what the start script needs and can be undone", () => {
  it("copies the boot-time tooling Next's tracer does not include", () => {
    const code = executableOnly(deployText)
    // The whole fabric mjs directory, not a hand-listed pair: the resolver's import closure reaches
    // registry -> run-baseline -> audit/broker/transport, and a list would fail at boot, not here.
    expect(code).toContain('Join-Path $Source "lib\\fabric"')
    expect(code).toContain("scripts\\fabric\\resolve-authority-registry-url.mjs")
    expect(code).toMatch(/Get-ChildItem[^\n]*\$fabricTarget[^\n]*"\*\.mjs"[\s\S]*Remove-Item -Force/)
    expect(code).toMatch(/robocopy \$fabricSource \$fabricTarget "\*\.mjs" \/E/)
  })

  it("keeps Node inside the scheduled task process tree so stopping the task closes port 3100", () => {
    const code = executableOnly(startText)
    expect(code).toMatch(/&\s*\$node\s+\$server\s+1>>\s*\$stdoutLog\s+2>>\s*\$stderrLog/)
    expect(code).toMatch(/\$serverExit\s*=\s*1/)
    expect(code).toMatch(/\$nodeInvocationSucceeded\s*=\s*\$\?/)
    expect(code).toMatch(/\$nodeExit\s*=\s*\$LASTEXITCODE/)
    expect(code.indexOf("$nodeInvocationSucceeded = $?"))
      .toBeLessThan(code.indexOf("$nodeExit = $LASTEXITCODE"))
    expect(code).toMatch(/exit\s+\$serverExit/)
    expect(code).not.toContain("Start-Process")
  })

  it("mirrors public assets so stale files from the outgoing generation cannot survive", () => {
    const code = executableOnly(deployText)
    expect(code).toMatch(/robocopy \(Join-Path \$Source "public"\) \(Join-Path \$Runtime "public"\) \/MIR/)
    expect(code).toMatch(/elseif \(Test-Path -LiteralPath \(Join-Path \$Runtime "public"\) -PathType Container\)[\s\S]*Remove-Item -LiteralPath \(Join-Path \$Runtime "public"\) -Recurse -Force/)
  })

  it("installs the repository-owned WilliamOS Live task definition before restart", () => {
    const code = executableOnly(deployText)
    expect(code).toContain("deploy\\hermes\\williamos-live\\start-williamos-live.ps1")
    expect(code).toContain("C:\\ProgramData\\WilliamOS\\start-williamos-live.ps1")
    expect(code).toMatch(/Copy-Item\s+-LiteralPath\s+\$liveStartSource\s+-Destination\s+\$LiveStartTarget/)
    expect(code.indexOf("$liveStartSource")).toBeLessThan(code.lastIndexOf("Start-ScheduledTask"))
  })

  it("proves the scheduled task invokes the selected launcher before any deployment mutation", () => {
    const code = executableOnly(deployText)
    const assertion = code.lastIndexOf("Assert-LiveTaskUsesLauncher")
    const rollback = code.indexOf("rollback captured")
    const stop = code.indexOf("Stop-ScheduledTask")
    expect(code).toContain("Get-ScheduledTask -TaskName $TaskName")
    expect(code).toContain('[IO.Path]::GetFileName($actions[0].Execute) -ine "powershell.exe"')
    expect(code).toContain("[regex]::Matches($actions[0].Arguments")
    expect(code).toContain("$fileArguments.Count -ne 1")
    expect(code).toContain("[IO.Path]::GetFullPath($selectedArgument)")
    expect(code).toContain("$actualLauncher -ine $expectedLauncher")
    expect(code).toContain("refusing a deploy that would install unused boot semantics")
    expect(assertion).toBeGreaterThan(-1)
    expect(assertion).toBeLessThan(rollback)
    expect(assertion).toBeLessThan(stop)
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

  it("captures every loose file and directory it can overwrite in the rollback", () => {
    const code = executableOnly(deployText)
    for (const file of ["server.js", "package.json", "lib\\generated\\build-provenance.json", "scripts\\hermes-https-proxy.mjs", "scripts\\fabric\\resolve-authority-registry-url.mjs"]) {
      expect(code).toContain(file)
    }
    for (const directory of ['".next"', '"public"', '"lib\\fabric"', '"node_modules"']) {
      expect(code).toContain(directory)
    }
    expect(code).toMatch(/if \(\$WithDependencies\) \{ \$rollbackDirectories \+= "node_modules" \}/)
    expect(code).toContain("restore-hermes-runtime.ps1")
  })

  it("records absent rollback inputs so restore can remove files introduced by deploy", () => {
    const code = executableOnly(deployText)
    const restore = executableOnly(restoreText)
    expect(code).toContain("rollback-manifest.json")
    expect(code).toContain("wasPresent")
    expect(code).toContain("withDependencies")
    expect(code).toContain("directories")
    expect(restore).toContain("expectedRollbackFiles")
    expect(restore).toContain("expectedRollbackDirectories")
    expect(restore).toContain("Compare-Object")
    expect(restore).toMatch(/foreach \(\$entry in \$manifest\.directories\)[\s\S]*Remove-Item -LiteralPath \$target -Recurse -Force/)
    expect(restore).toMatch(/foreach \(\$entry in \$manifest\.files\)[\s\S]*Remove-Item -LiteralPath \$target -Force/)
    expect(code).toContain("liveStartWasPresent")
    expect(code).toContain("external\\start-williamos-live.ps1")
    expect(restore).toContain("Rollback manifest does not name the exact WilliamOS Live start definition")
    expect(restore).toMatch(/Copy-Item\s+-LiteralPath\s+\$liveStartRollbackFile\s+-Destination\s+\$LiveStartTarget/)
    expect(restore).toMatch(/Remove-Item\s+-LiteralPath\s+\$LiveStartTarget/)
  })

  it("prints a restore command with every path serialized as PowerShell data", () => {
    const code = executableOnly(deployText)
    const restoreCommand = code.split(/\r?\n/).find((line) => line.includes("to restore:")) ?? ""
    expect(code).toMatch(/function ConvertTo-PowerShellLiteral[\s\S]*\.Replace\("'",\s*"''"\)/)
    expect(code).toMatch(/ConvertTo-PowerShellLiteral \$LiveStartTarget/)
    expect(restoreCommand).toContain("-LiveStartTarget $liveStartTargetLiteral")
    expect(code).toMatch(/ConvertTo-PowerShellLiteral \(\[string\]\$Port\)/)
    expect(code).toMatch(/ConvertTo-PowerShellLiteral \(\[string\]\$HttpsPort\)/)
    expect(restoreCommand).toContain("-Port $portLiteral")
    expect(restoreCommand).toContain("-HttpsPort $httpsPortLiteral")
    expect(restoreCommand).not.toContain('$LiveStartTarget`"')
  })

  it("refuses noncanonical port overrides before verification or deployment mutation", () => {
    const code = executableOnly(deployText)
    const refusalIndex = code.indexOf("port overrides are not supported")
    expect(code).toMatch(/\$Port\s+-ne\s+3100\s+-or\s+\$HttpsPort\s+-ne\s+3443/)
    expect(refusalIndex).toBeGreaterThan(-1)
    expect(refusalIndex).toBeLessThan(code.indexOf('if ($VerifyOnly)'))
    expect(refusalIndex).toBeLessThan(code.indexOf("Stop-ScheduledTask"))

    const restore = executableOnly(restoreText)
    const restoreRefusalIndex = restore.indexOf("port overrides are not supported")
    expect(restore).toMatch(/\$Port\s+-ne\s+3100\s+-or\s+\$HttpsPort\s+-ne\s+3443/)
    expect(restoreRefusalIndex).toBeGreaterThan(-1)
    expect(restoreRefusalIndex).toBeLessThan(restore.indexOf("Rollback directory does not exist"))
    expect(restoreRefusalIndex).toBeLessThan(restore.indexOf("Stop-ScheduledTask"))
  })

  it("refuses rollback-skip mode before overwriting an existing external launcher", () => {
    const code = executableOnly(deployText)
    const refusalIndex = code.indexOf("SkipRollbackCapture cannot overwrite")
    const stopIndex = code.indexOf("Stop-ScheduledTask")
    const copyIndex = code.indexOf("Copy-Item -LiteralPath $liveStartSource -Destination $LiveStartTarget")
    expect(code).toMatch(/\$SkipRollbackCapture\s+-and\s+\(Test-Path -LiteralPath \$LiveStartTarget -PathType Leaf\)/)
    expect(refusalIndex).toBeGreaterThan(-1)
    expect(refusalIndex).toBeLessThan(stopIndex)
    expect(refusalIndex).toBeLessThan(copyIndex)
  })

  it("proves the external launcher is writable before stopping production", () => {
    const code = executableOnly(deployText)
    const assertion = code.lastIndexOf("Assert-LiveLauncherWritable")
    const stopIndex = code.indexOf("Stop-ScheduledTask")
    expect(code).toContain("[IO.File]::Open($LiveStartTarget")
    expect(code).toContain("Run the deployment from an elevated administrator shell; refusing before stopping production")
    expect(assertion).toBeGreaterThan(-1)
    expect(assertion).toBeLessThan(stopIndex)
  })

  it("proves rollback can restore or remove the external launcher before stopping production", () => {
    const restore = executableOnly(restoreText)
    const assertion = restore.lastIndexOf("Assert-LauncherMutationAccess")
    const stopIndex = restore.indexOf("Stop-ScheduledTask")
    expect(restore).toContain("[IO.File]::Open($TargetPath")
    expect(restore).toContain("$deleteAccess")
    expect(restore).toContain("Run rollback from an elevated administrator shell; refusing before stopping production")
    expect(assertion).toBeGreaterThan(-1)
    expect(assertion).toBeLessThan(stopIndex)
  })

  it("refuses to stop unrelated processes on either product port", () => {
    const code = executableOnly(deployText)
    const restore = executableOnly(restoreText)
    expect(code).toContain("Stop-ExpectedListener")
    expect(code).toContain('ExpectedCommandPath (Join-Path $Runtime "server.js")')
    expect(code).toContain('ExpectedCommandPath (Join-Path $Runtime "scripts\\hermes-https-proxy.mjs")')
    expect(restore).toContain('ExpectedCommandPath (Join-Path $Runtime "server.js")')
    expect(restore).toContain('ExpectedCommandPath (Join-Path $Runtime "scripts\\hermes-https-proxy.mjs")')
    expect(code).toContain("[regex]::Matches($process.CommandLine")
    expect(restore).toContain("[regex]::Matches($process.CommandLine")
    expect(code).toContain('[IO.Path]::GetFileName($tokens[0]) -ieq "node.exe"')
    expect(restore).toContain('[IO.Path]::GetFileName($tokens[0]) -ieq "node.exe"')
    expect(code).toContain("[IO.Path]::GetFullPath($tokens[1])")
    expect(restore).toContain("[IO.Path]::GetFullPath($tokens[1])")
    expect(code).toContain("-ieq $expectedPath")
    expect(restore).toContain("-ieq $expectedPath")
    expect(code).not.toContain("CommandLine.IndexOf($ExpectedCommandPath")
    expect(restore).not.toContain("CommandLine.IndexOf($ExpectedCommandPath")
    expect(code).toContain("owned by an unrelated process")
  })
})
