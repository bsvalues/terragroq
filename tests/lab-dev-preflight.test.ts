import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  | "stale-remote-source"
  | "hermes-unreachable"
  | "hermes-ollama-missing"
  | "hermes-container-case"
  | "atlas-unreachable"
  | "atlas-compose-mismatch"
  | "atlas-compose-missing"
  | "atlas-compose-extra"
  | "atlas-compose-malformed"
  | "database-isolation-missing"
  | "database-isolation-incidental-neon"
  | "database-isolation-affirmative-instruction"
  | "atlas-extra-port"
  | "atlas-malformed-port"
  | "atlas-payload-extra-port"
  | "atlas-container-case"
  | "atlas-compose-case"

function fixture(mode: Mode, atlasOutput = "") {
  const root = mkdtempSync(path.join(tmpdir(), "lab-dev-preflight-"))
  roots.push(root)
  const bin = path.join(root, "fake-bin")
  const terrafusion = path.join(root, "terrafusion")
  const williamos = path.join(root, "williamos")
  const log = path.join(root, "ssh-args.log")
  const gitLog = path.join(root, "git-args.log")
  const atlasOutputPath = path.join(root, "atlas-output.txt")
  mkdirSync(bin)
  writeFileSync(log, "")
  writeFileSync(gitLog, "")
  writeFileSync(atlasOutputPath, atlasOutput)
  mkdirSync(terrafusion)
  mkdirSync(williamos)
  writeFileSync(path.join(terrafusion, "PATH_CANON_REGISTER.md"), "canonical marker\n")
  writeFileSync(
    path.join(williamos, "README.md"),
    mode === "database-isolation-missing"
      ? "Database pending\n"
      : mode === "database-isolation-incidental-neon"
        ? "Neon Postgres is mentioned incidentally.\n"
        : "| Database | Neon Postgres via Drizzle ORM |\n",
  )
  const runbooks = path.join(williamos, "docs", "runbooks")
  mkdirSync(runbooks, { recursive: true })
  writeFileSync(
    path.join(runbooks, "local-williamos-operator-runbook.md"),
    mode === "database-isolation-missing"
      ? "Database policy pending\n"
      : mode === "database-isolation-affirmative-instruction"
        ? "Point WilliamOS `DATABASE_URL` at TerraFusion PostgreSQL.\n"
        : "Do not:\n\n- point WilliamOS `DATABASE_URL` at TerraFusion PostgreSQL\n",
  )

  const git = path.join(bin, "fake-git.cmd")
  const ssh = path.join(bin, "fake-ssh.cmd")
  writeFileSync(git, `@echo off
echo %*>>"%LAB_DEV_TEST_GIT_LOG%"
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
echo %all% | findstr /C:"ls-remote" >nul && goto remote_main
echo %all% | findstr /C:"merge-base --is-ancestor refs/heads/main HEAD" >nul && goto ancestor
echo %all% | findstr /C:"merge-base --is-ancestor" >nul && goto live_ancestor
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
echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
exit /b 0
:remote_main
if "%LAB_DEV_TEST_MODE%"=="stale-remote-source" echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb refs/heads/main& exit /b 0
echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main
exit /b 0
:ancestor
if "%LAB_DEV_TEST_MODE%"=="stale-source" exit /b 1
exit /b 0
:live_ancestor
if "%LAB_DEV_TEST_MODE%"=="stale-source" exit /b 1
if "%LAB_DEV_TEST_MODE%"=="stale-remote-source" exit /b 1
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
if "%LAB_DEV_TEST_MODE%"=="hermes-container-case" (
  echo OLLAMA^|ollama/ollama:latest^|running^|healthy^|11434
  echo open-webui^|open-webui:latest^|running^|healthy^|3000
  echo portainer^|portainer/portainer-ce:latest^|running^|healthy^|9000
  exit /b 0
)
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
if "%LAB_DEV_TEST_MODE%"=="atlas-payload-extra-port" type "%LAB_DEV_TEST_ATLAS_OUTPUT%"& exit /b 0
if "%LAB_DEV_TEST_MODE%"=="atlas-extra-port" echo tf-postgres^|postgres:16^|running^|healthy^|5432,unexpected& goto atlas_rest
if "%LAB_DEV_TEST_MODE%"=="atlas-malformed-port" echo tf-postgres^|postgres:16^|running^|healthy^|5432,non-numeric& goto atlas_rest
if "%LAB_DEV_TEST_MODE%"=="atlas-container-case" echo TF-POSTGRES^|postgres:16^|running^|healthy^|5432& goto atlas_rest
echo tf-postgres^|postgres:16^|running^|healthy^|5432
:atlas_rest
echo tf-redis^|redis:7^|running^|healthy^|6379
echo tf-mongo^|mongo:7^|running^|healthy^|27017
echo portainer_agent^|portainer/agent:latest^|running^|healthy^|9001
if "%LAB_DEV_TEST_MODE%"=="atlas-compose-mismatch" echo COMPOSE_SERVICES=tf-postgres& exit /b 0
if "%LAB_DEV_TEST_MODE%"=="atlas-compose-missing" echo COMPOSE_SERVICES=mongo,postgres& exit /b 0
if "%LAB_DEV_TEST_MODE%"=="atlas-compose-extra" echo COMPOSE_SERVICES=mongo,postgres,redis,unexpected& exit /b 0
if "%LAB_DEV_TEST_MODE%"=="atlas-compose-malformed" echo COMPOSE_SERVICES=portainer_agent,tf-mongo,tf-postgres,tf-redis,& exit /b 0
if "%LAB_DEV_TEST_MODE%"=="atlas-compose-case" echo COMPOSE_SERVICES=Mongo,postgres,redis& exit /b 0
echo COMPOSE_SERVICES=mongo,postgres,redis
exit /b 0
`, "utf8")
  return { git, ssh, gitLog, log, root, atlasOutputPath, terrafusion, williamos }
}

function invokePreflight(
  mode: Mode,
  testFixture: ReturnType<typeof fixture>,
  selectedScript = scriptPath,
  options: { terrafusionPath?: string | null } = {},
) {
  const invocationEnv: NodeJS.ProcessEnv = {
    ...process.env,
    LAB_DEV_GIT_EXECUTABLE: testFixture.git,
    LAB_DEV_SSH_EXECUTABLE: testFixture.ssh,
    LAB_DEV_NOW_UTC: "2026-08-08T12:00:00Z",
    LAB_DEV_TEST_MODE: mode,
    LAB_DEV_TEST_ATLAS_OUTPUT: testFixture.atlasOutputPath,
    LAB_DEV_TEST_GIT_LOG: testFixture.gitLog,
    LAB_DEV_TEST_SSH_LOG: testFixture.log,
    TERRAFUSION_REPO_PATH: options.terrafusionPath ?? testFixture.terrafusion,
    WILLIAMOS_REPO_PATH: testFixture.williamos,
  }
  if (options.terrafusionPath === null) delete invocationEnv.TERRAFUSION_REPO_PATH
  const result = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", selectedScript], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15_000,
    env: invocationEnv,
  })
  return {
    ...result,
    gitArgs: readFileSync(testFixture.gitLog, "utf8"),
    sshArgs: readFileSync(testFixture.log, "utf8"),
  }
}

function runPreflight(mode: Mode, atlasOutput = "") {
  return invokePreflight(mode, fixture(mode, atlasOutput))
}

function runPreflightWithManifest(mutate: (manifest: any) => void) {
  const testFixture = fixture("healthy")
  const isolatedRoot = path.join(testFixture.root, "isolated-repo")
  const isolatedScript = path.join(isolatedRoot, "scripts", "lab-dev", "lab-dev-preflight.ps1")
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "config", "lab-dev-topology.json"), "utf8"))
  mutate(manifest)
  mkdirSync(path.dirname(isolatedScript), { recursive: true })
  mkdirSync(path.join(isolatedRoot, "config"), { recursive: true })
  writeFileSync(isolatedScript, readFileSync(scriptPath, "utf8"))
  writeFileSync(path.join(isolatedRoot, "config", "lab-dev-topology.json"), JSON.stringify(manifest))
  return invokePreflight("healthy", testFixture, isolatedScript)
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

function executeAtlasPayload(payload: string, dockerPsOutput: string) {
  const root = mkdtempSync(path.join(tmpdir(), "lab-dev-atlas-payload-"))
  roots.push(root)
  const docker = path.join(root, "docker")
  writeFileSync(docker, `#!/bin/sh
if [ "$1" = "ps" ]; then
  printf '%s\\n' "$LAB_DEV_DOCKER_PS_OUTPUT"
  exit 0
fi
if [ "$1" = "compose" ]; then
  printf '%s\\n' mongo postgres redis
  exit 0
fi
exit 9
`)
  chmodSync(docker, 0o755)

  if (process.platform === "win32") {
    const wslRoot = root.replace(/^([A-Za-z]):\\/, (_, drive: string) => `/mnt/${drive.toLowerCase()}/`).replaceAll("\\", "/")
    return spawnSync(
      "wsl.exe",
      ["-e", "env", "-i", `PATH=${wslRoot}:/usr/bin:/bin`, `LAB_DEV_DOCKER_PS_OUTPUT=${dockerPsOutput}`, "sh", "-s"],
      { encoding: "utf8", input: payload, timeout: 15_000 },
    )
  }
  return spawnSync("sh", ["-s"], {
    encoding: "utf8",
    input: payload,
    timeout: 15_000,
    env: { PATH: `${root}:/usr/bin:/bin`, LAB_DEV_DOCKER_PS_OUTPUT: dockerPsOutput },
  })
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe("OMEN Stage 5 development preflight", () => {
  const invalidManifestCases: Array<[string, (manifest: any) => void]> = [
    ["type-wrong schema version", (manifest) => { manifest.schemaVersion = "1" }],
    ["wrong work order", (manifest) => { manifest.workOrderId = "WO-OTHER" }],
    ["wrong TerraFusion repository", (manifest) => { manifest.sources.terrafusion.repository = "bsvalues/other" }],
    ["wrong TerraFusion branch", (manifest) => { manifest.sources.terrafusion.branch = "develop" }],
    ["wrong TerraFusion marker", (manifest) => { manifest.sources.terrafusion.canonicalMarker = "OTHER.md" }],
    ["wrong WilliamOS repository", (manifest) => { manifest.sources.williamos.repository = "bsvalues/other" }],
    ["wrong WilliamOS branch", (manifest) => { manifest.sources.williamos.branch = "develop" }],
    ["wrong Hermes alias", (manifest) => { manifest.nodes.hermes.sshAlias = "other" }],
    ["wrong Hermes required map", (manifest) => { manifest.nodes.hermes.requiredContainers.ollama = 11435 }],
    ["case-variant Hermes required map key", (manifest) => {
      manifest.nodes.hermes.requiredContainers.OLLAMA = manifest.nodes.hermes.requiredContainers.ollama
      delete manifest.nodes.hermes.requiredContainers.ollama
    }],
    ["type-wrong Hermes advertised map", (manifest) => { manifest.nodes.hermes.advertisedContainers.portainer = "9000" }],
    ["wrong Atlas alias", (manifest) => { manifest.nodes["atlas-node"].sshAlias = "other" }],
    ["alternate Compose path", (manifest) => { manifest.nodes["atlas-node"].composeFile = "/tmp/terrafusion-data.yml" }],
    ["Compose path shell syntax", (manifest) => { manifest.nodes["atlas-node"].composeFile = "/home/bs/terrafusion/terrafusion-data.yml'; uname -a; '" }],
    ["Compose path control character", (manifest) => { manifest.nodes["atlas-node"].composeFile = "/home/bs/terrafusion/terrafusion-data.yml\nuname -a" }],
    ["extra Compose service", (manifest) => { manifest.nodes["atlas-node"].composeServices.push("other") }],
    ["wrong Atlas advertised map", (manifest) => { delete manifest.nodes["atlas-node"].advertisedContainers.portainer_agent }],
    ["missing database authority", (manifest) => { delete manifest.sources.williamos.databaseAuthority }],
    ["type-wrong database authority", (manifest) => { manifest.sources.williamos.databaseAuthority = false }],
    ["opposite database authority", (manifest) => { manifest.sources.williamos.databaseAuthority = "ATLAS_SHARED" }],
    ["missing policy", (manifest) => { delete manifest.policies.databaseQueriesAllowed }],
    ["type-wrong policy", (manifest) => { manifest.policies.forgeInspectionAllowed = "false" }],
    ["Atlas database policy enabled", (manifest) => { manifest.policies.williamosUsesAtlasDatabase = true }],
    ["database queries enabled", (manifest) => { manifest.policies.databaseQueriesAllowed = true }],
    ["Forge inspection enabled", (manifest) => { manifest.policies.forgeInspectionAllowed = true }],
  ]

  test.each(invalidManifestCases)("rejects %s before SSH", (_name, mutate) => {
    const result = runPreflightWithManifest(mutate)

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("BLOCKER=PRECHECK_CONFIGURATION_INVALID")
    expect(result.gitArgs).toBe("")
    expect(result.sshArgs).toBe("")
  }, 20_000)

  test.each([
    ["missing", null],
    ["blank", "   "],
  ] as const)("rejects %s TERRAFUSION_REPO_PATH before Git or SSH", (_name, terrafusionPath) => {
    const testFixture = fixture("healthy")
    const result = invokePreflight("healthy", testFixture, scriptPath, { terrafusionPath })

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("BLOCKER=PRECHECK_CONFIGURATION_INVALID")
    expect(result.stdout).not.toMatch(/[A-Z]:\\Users\\/i)
    expect(result.gitArgs).toBe("")
    expect(result.sshArgs).toBe("")
  })

  test("documents TerraFusion path selection without a machine-specific default", () => {
    const readme = readFileSync(path.join(repoRoot, "scripts", "lab-dev", "README.md"), "utf8")

    expect(readme).toContain("TERRAFUSION_REPO_PATH")
    expect(readme).not.toMatch(/[A-Z]:\\Users\\/i)
  })

  test("declares the independent Atlas Compose service contract", () => {
    const topology = JSON.parse(readFileSync(path.join(repoRoot, "config", "lab-dev-topology.json"), "utf8"))

    expect(topology.nodes["atlas-node"].composeServices).toEqual(["mongo", "postgres", "redis"])
  })

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
    "stale-remote-source",
    "hermes-unreachable",
    "hermes-ollama-missing",
    "hermes-container-case",
    "atlas-unreachable",
    "atlas-compose-mismatch",
    "atlas-compose-missing",
    "atlas-compose-extra",
    "atlas-compose-malformed",
    "database-isolation-missing",
    "database-isolation-incidental-neon",
    "database-isolation-affirmative-instruction",
    "atlas-extra-port",
    "atlas-malformed-port",
    "atlas-container-case",
    "atlas-compose-case",
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

  test("the exact Atlas payload preserves every published host port and fails closed on extras", () => {
    const payload = decodedPayloads(runPreflight("healthy").sshArgs).atlas
    const dockerPsOutput = [
      "tf-postgres|postgres:16|running|Up 1 hour (healthy)|0.0.0.0:5432->5432/tcp, 0.0.0.0:15432->5432/tcp",
      "tf-redis|redis:7|running|Up 1 hour (healthy)|0.0.0.0:6379->6379/tcp",
      "tf-mongo|mongo:7|running|Up 1 hour (healthy)|0.0.0.0:27017->27017/tcp",
      "portainer_agent|portainer/agent:latest|running|Up 1 hour (healthy)|0.0.0.0:9001->9001/tcp",
    ].join("\n")
    const transformed = executeAtlasPayload(payload, dockerPsOutput)

    expect(transformed.status).toBe(0)
    expect(transformed.stdout).toContain("tf-postgres|postgres:16|running|healthy|5432,15432")
    expect(runPreflight("atlas-payload-extra-port", transformed.stdout).status).toBe(2)
  }, 30_000)
})
