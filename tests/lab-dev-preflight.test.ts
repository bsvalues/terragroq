import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, test } from "vitest"

const repoRoot = path.resolve(__dirname, "..")
const scriptPath = path.join(repoRoot, "scripts", "lab-dev", "lab-dev-preflight.ps1")
const pwsh = process.platform === "win32" ? "pwsh.exe" : "pwsh"
const roots: string[] = []

type Mode =
  | "healthy"
  | "wrong-repository"
  | "shared-checkout"
  | "dirty-source"
  | "stale-source"
  | "hermes-unreachable"
  | "hermes-ollama-missing"
  | "atlas-unreachable"
  | "atlas-compose-mismatch"
  | "database-isolation-missing"

function fixture(mode: Mode) {
  const root = mkdtempSync(path.join(tmpdir(), "lab-dev-preflight-"))
  roots.push(root)
  const bin = path.join(root, "fake-bin")
  const terrafusion = path.join(root, "terrafusion")
  const williamos = path.join(root, "williamos")
  const log = path.join(root, "ssh-args.log")
  mkdirSync(bin)
  writeFileSync(log, "")
  mkdirSync(terrafusion)
  mkdirSync(williamos)
  writeFileSync(path.join(terrafusion, "PATH_CANON_REGISTER.md"), "canonical marker\n")
  writeFileSync(path.join(williamos, "README.md"), mode === "database-isolation-missing" ? "Database pending\n" : "Neon Postgres\n")
  const runbooks = path.join(williamos, "docs", "runbooks")
  mkdirSync(runbooks, { recursive: true })
  writeFileSync(
    path.join(runbooks, "local-williamos-operator-runbook.md"),
    mode === "database-isolation-missing"
      ? "Database policy pending\n"
      : "Do not point WilliamOS `DATABASE_URL` at TerraFusion PostgreSQL.\n",
  )

  const git = path.join(bin, "fake-git.cmd")
  const ssh = path.join(bin, "fake-ssh.cmd")
  writeFileSync(git, `@echo off
set "all=%*"
set "repo=williamos"
echo %all% | findstr /I /C:"terrafusion" >nul && set "repo=terrafusion"
if /I "%all%"=="-C %TERRAFUSION_REPO_PATH% config --get remote.origin.url" goto remote
if /I "%all%"=="-C %WILLIAMOS_REPO_PATH% config --get remote.origin.url" goto remote
if /I "%all%"=="-C %TERRAFUSION_REPO_PATH% rev-parse --git-dir" goto gitdir
if /I "%all%"=="-C %WILLIAMOS_REPO_PATH% rev-parse --git-dir" goto gitdir
if /I "%all%"=="-C %TERRAFUSION_REPO_PATH% rev-parse --git-common-dir" goto common
if /I "%all%"=="-C %WILLIAMOS_REPO_PATH% rev-parse --git-common-dir" goto common
echo %all% | findstr /C:"status --porcelain" >nul && goto status
echo %all% | findstr /C:"branch --show-current" >nul && goto branch
echo %all% | findstr /C:"rev-parse refs/heads/main" >nul && goto mainref
echo %all% | findstr /C:"merge-base --is-ancestor refs/heads/main HEAD" >nul && goto ancestor
exit /b 9
:remote
if "%LAB_DEV_TEST_MODE%"=="wrong-repository" if "%repo%"=="terrafusion" echo https://github.com/bsvalues/not-terrafusion.git& exit /b 0
if "%repo%"=="terrafusion" echo git@github.com:bsvalues/terrafusion_os_1.0.git& exit /b 0
echo https://github.com/bsvalues/terragroq.git
exit /b 0
:gitdir
echo .git
exit /b 0
:common
if "%LAB_DEV_TEST_MODE%"=="shared-checkout" echo .git& exit /b 0
echo .git-common
exit /b 0
:status
if "%LAB_DEV_TEST_MODE%"=="dirty-source" echo  M file.txt
exit /b 0
:branch
echo main
exit /b 0
:mainref
echo deadbeef
exit /b 0
:ancestor
if "%LAB_DEV_TEST_MODE%"=="stale-source" exit /b 1
exit /b 0
`, "utf8")
  writeFileSync(ssh, `@echo off
echo %*>>"%LAB_DEV_TEST_SSH_LOG%"
set "target="
echo %* | findstr /I /C:"hermes" >nul && set "target=hermes"
echo %* | findstr /I /C:"atlas" >nul && set "target=atlas"
if "%LAB_DEV_TEST_MODE%"=="hermes-unreachable" if "%target%"=="hermes" exit /b 255
if "%LAB_DEV_TEST_MODE%"=="atlas-unreachable" if "%target%"=="atlas" exit /b 255
if "%target%"=="hermes" goto hermes
if "%target%"=="atlas" goto atlas
exit /b 9
:hermes
if "%LAB_DEV_TEST_MODE%"=="hermes-ollama-missing" (
  echo open-webui^|open-webui:latest^|running^|healthy^|3000
  echo portainer^|portainer/portainer-ce:latest^|running^|healthy^|9000
  exit /b 0
)
echo ollama^|ollama/ollama:latest^|running^|healthy^|11434
echo open-webui^|open-webui:latest^|running^|healthy^|3000
echo portainer^|portainer/portainer-ce:latest^|running^|healthy^|9000
exit /b 0
:atlas
echo tf-postgres^|postgres:16^|running^|healthy^|5432
echo tf-redis^|redis:7^|running^|healthy^|6379
echo tf-mongo^|mongo:7^|running^|healthy^|27017
echo portainer_agent^|portainer/agent:latest^|running^|healthy^|9001
if "%LAB_DEV_TEST_MODE%"=="atlas-compose-mismatch" echo COMPOSE_SERVICES=tf-postgres& exit /b 0
echo COMPOSE_SERVICES=portainer_agent,tf-mongo,tf-postgres,tf-redis
exit /b 0
`, "utf8")
  return { git, ssh, log, terrafusion, williamos }
}

function runPreflight(mode: Mode) {
  const testFixture = fixture(mode)
  const result = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      LAB_DEV_GIT_EXECUTABLE: testFixture.git,
      LAB_DEV_SSH_EXECUTABLE: testFixture.ssh,
      LAB_DEV_NOW_UTC: "2026-08-08T12:00:00Z",
      LAB_DEV_TEST_MODE: mode,
      LAB_DEV_TEST_SSH_LOG: testFixture.log,
      TERRAFUSION_REPO_PATH: testFixture.terrafusion,
      WILLIAMOS_REPO_PATH: testFixture.williamos,
    },
  })
  return {
    ...result,
    sshArgs: readFileSync(testFixture.log, "utf8"),
  }
}

function decodedPayloads(sshArgs: string) {
  const encodedPowerShell = sshArgs.match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)/)?.[1]
  const encodedPosix = sshArgs.match(/printf %s ([A-Za-z0-9+/=]+)/)?.[1]
  expect(encodedPowerShell).toBeDefined()
  expect(encodedPosix).toBeDefined()
  return {
    hermes: Buffer.from(encodedPowerShell!, "base64").toString("utf16le"),
    atlas: Buffer.from(encodedPosix!, "base64").toString("utf8"),
  }
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe("OMEN Stage 5 development preflight", () => {
  test("accepts only the fully evidenced disposable configuration flow", () => {
    const result = runPreflight("healthy")

    expect(result).toMatchObject({
      status: 0,
      stdout: expect.stringContaining("PRODUCT_FLOW=READY_FOR_DISPOSABLE_CONFIGURATION_PROOF"),
    })
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      "TERRAFUSION_SOURCE=READY",
      "WILLIAMOS_SOURCE=READY",
      "HERMES_COMPUTE=AVAILABLE",
      "ATLAS_STATE_ENDPOINTS=ADVERTISED",
      "WILLIAMOS_DB_ISOLATION=PRESERVED",
      "PRODUCT_FLOW=READY_FOR_DISPOSABLE_CONFIGURATION_PROOF",
    ])
  }, 20_000)

  test.each([
    "wrong-repository",
    "shared-checkout",
    "dirty-source",
    "stale-source",
    "hermes-unreachable",
    "hermes-ollama-missing",
    "atlas-unreachable",
    "atlas-compose-mismatch",
    "database-isolation-missing",
  ] as const)("fails closed for %s", (mode) => {
    expect(runPreflight(mode).status).toBe(2)
  })

  test("encodes metadata-only remote probes", () => {
    const payloads = decodedPayloads(runPreflight("healthy").sshArgs)
    const forbidden = /\b(?:psql|pg_isready|redis-cli|mongosh|curl|invoke-webrequest|docker\s+exec|docker\s+inspect[^\r\n]*\benv\b|\/forge|start|stop|restart|remove|delete|create|update)\b|(?<!-)>(?!>)|>>/i

    for (const payload of Object.values(payloads)) {
      expect(payload).toContain("docker")
      expect(payload).not.toMatch(forbidden)
    }
    expect(payloads.atlas).toContain("compose")
  })
})
