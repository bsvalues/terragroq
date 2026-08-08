import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, test } from "vitest"

const repoRoot = path.resolve(__dirname, "..")
const scriptRoot = path.join(repoRoot, "scripts", "lab-control")
const pwsh = process.platform === "win32" ? "pwsh.exe" : "pwsh"
const tempRoots: string[] = []

type FixtureMode = "healthy" | "auth-blocked" | "incomplete"

function makeFakeSsh(mode: FixtureMode) {
  const root = mkdtempSync(path.join(tmpdir(), "lab-control-test-"))
  tempRoots.push(root)
  const bin = path.join(root, "fake ssh bin")
  mkdirSync(bin)
  const fakeSsh = path.join(bin, "fake-ssh.cmd")
  const log = path.join(root, "ssh-args.log")
  writeFileSync(
    fakeSsh,
    `@echo off
echo %*>>"%LAB_CONTROL_TEST_LOG%"
if "%LAB_CONTROL_TEST_MODE%"=="auth-blocked" (
  1>&2 echo Permission denied ^(publickey,password,keyboard-interactive^).
  exit /b 255
)
if "%LAB_CONTROL_TEST_MODE%"=="incomplete" (
  echo hostname=reachable-host
  echo os=known
  echo uptime=known
  echo docker=UNKNOWN
  echo ollama=UNAVAILABLE
  echo gpu=NOT_FOUND
  echo disk=10 GB free of 100 GB
  echo postgres_evidence=TCP_LISTENER_ONLY
  echo redis_evidence=UNKNOWN
  echo mongo_evidence=NOT_OBSERVED
  echo backup=UNKNOWN
  echo cross_sync=UNKNOWN
  exit /b 0
)
echo %*| %SystemRoot%\\System32\\findstr.exe /C:"hermes" >nul
if not errorlevel 1 (
  echo hostname=HERMES
  echo os=Windows 10 Pro
  echo uptime=3 days
  echo docker=27.5.1
  echo ollama=AVAILABLE
  echo gpu=NVIDIA GeForce RTX 3050
  echo disk=321 GB free of 930 GB
  exit /b 0
)
echo hostname=atlas
echo os=Ubuntu 24.04.3 LTS
echo uptime=up 8 days
echo docker=27.5.1
echo postgres_evidence=PG_ISREADY_ACCEPTING
echo redis_evidence=REDIS_AUTH_REQUIRED_REACHABLE
echo mongo_evidence=MONGO_PING_OK
echo disk=744G free of 915G
echo backup=2026-08-07T08:15:00-07:00 atlas-nightly
echo cross_sync=2026-08-07T08:30:00-07:00 atlas-to-hermes
exit /b 0
`,
    "utf8",
  )
  return { fakeSsh, log, root }
}

function runCommand(command: string, mode: FixtureMode = "healthy") {
  const fixture = makeFakeSsh(mode)
  const result = spawnSync(
    pwsh,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(scriptRoot, `${command}.ps1`)],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        LAB_CONTROL_SSH_EXECUTABLE: fixture.fakeSsh,
        LAB_CONTROL_TEST_LOG: fixture.log,
        LAB_CONTROL_TEST_MODE: mode,
      },
      timeout: 15_000,
    },
  )
  return {
    ...result,
    sshArgs: readFileSync(fixture.log, "utf8"),
  }
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true })
  }
})

describe("OMEN lab-control CLI", () => {
  test("lab-status reports a concise healthy two-node view", () => {
    const result = runCommand("lab-status")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("HERMES")
    expect(result.stdout).toContain("reachable: YES")
    expect(result.stdout).toContain("Ollama: AVAILABLE")
    expect(result.stdout).toContain("GPU: NVIDIA GeForce RTX 3050")
    expect(result.stdout).toContain("ATLAS")
    expect(result.stdout).toContain("Postgres evidence: PG_ISREADY_ACCEPTING")
    expect(result.stdout).toContain("Redis evidence: REDIS_AUTH_REQUIRED_REACHABLE")
    expect(result.stdout).toContain("Mongo evidence: MONGO_PING_OK")
    expect(result.stdout).toContain("latest backup: 2026-08-07T08:15:00-07:00 atlas-nightly")
    expect(result.stdout).toContain("operator blocker: NONE")
  })

  test("lab-status classifies noninteractive authentication failures without claiming reachability", () => {
    const result = runCommand("lab-status", "auth-blocked")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("reachable: NO (SSH_AUTH_BLOCKED)")
    expect(result.stdout).toContain("operator blocker: SSH authentication is not configured")
    expect(result.stdout).not.toContain("password,keyboard-interactive")
  })

  test("lab-status exits nonzero when required service or continuity evidence is incomplete", () => {
    const result = runCommand("lab-status", "incomplete")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("reachable: YES")
    expect(result.stdout).toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
    expect(result.stdout).not.toContain("operator blocker: NONE")
  })

  test("remote commands preserve an SSH executable path with spaces and use target-specific encodings", () => {
    const result = runCommand("lab-status")
    const hermesEncoded = result.sshArgs.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1]
    const atlasEncoded = result.sshArgs.match(/printf %s ([A-Za-z0-9+/=]+) \| base64 -d \| sh/)?.[1]

    expect(result.status).toBe(0)
    expect(hermesEncoded).toBeTruthy()
    expect(Buffer.from(hermesEncoded!, "base64").toString("utf16le")).toContain("Get-CimInstance Win32_OperatingSystem")
    expect(Buffer.from(hermesEncoded!, "base64").toString("utf16le")).toContain("http://127.0.0.1:11434/api/version")
    expect(Buffer.from(hermesEncoded!, "base64").toString("utf16le")).toContain("HermesCrossNodeBackupSync")
    expect(atlasEncoded).toBeTruthy()
    const atlasCommand = Buffer.from(atlasEncoded!, "base64").toString("utf8")
    expect(atlasCommand).toContain("pg_isready")
    expect(atlasCommand).toContain("redis-cli")
    expect(atlasCommand).toContain("mongosh")
    expect(atlasCommand).toContain('docker exec "$container" pg_isready')
    expect(atlasCommand).toContain('docker exec "$container" redis-cli')
    expect(atlasCommand).toContain('docker exec "$container" mongosh')
  })

  test("Atlas probe globally sorts backup candidates before choosing the newest path, including spaces", () => {
    const result = runCommand("lab-atlas")
    const encoded = result.sshArgs.match(/printf %s ([A-Za-z0-9+/=]+) \| base64 -d \| sh/)?.[1]
    const atlasCommand = Buffer.from(encoded!, "base64").toString("utf8")

    expect(atlasCommand).toContain("/home/bs/backups")
    expect(atlasCommand).not.toContain("/var/backups")
    expect(atlasCommand).toContain("} | sort -nr | head -n 1)")
    expect(atlasCommand).toContain("date -d \"@${latest_epoch%.*}\" --iso-8601=seconds")
    expect(atlasCommand).not.toMatch(/candidate=.*head -n 1[\s\S]*latest=\"\$candidate\"/)
  })

  test.each(["lab-status", "lab-hermes", "lab-atlas", "lab-containers", "lab-backups"])(
    "%s uses noninteractive bounded SSH",
    (command) => {
      const result = runCommand(command)

      expect(result.status).toBe(0)
      expect(result.sshArgs).toContain("BatchMode=yes")
      expect(result.sshArgs).toContain("ConnectTimeout=5")
      expect(result.sshArgs).toContain("ConnectionAttempts=1")
    },
  )

  test("lab-containers encodes the Hermes PowerShell probe without outer-shell variable expansion", () => {
    const result = runCommand("lab-containers")
    const hermesEncoded = result.sshArgs.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1]

    expect(result.status).toBe(0)
    expect(hermesEncoded).toBeTruthy()
    const decoded = Buffer.from(hermesEncoded!, "base64").toString("utf16le")
    expect(decoded).toContain("$ErrorActionPreference='SilentlyContinue'")
    expect(decoded).toContain('docker ps --format "table {{.Names}}')
  })

  test("installer creates persistent command shims in an isolated destination without changing PATH", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "lab-control-install-"))
    tempRoots.push(parent)
    const root = path.join(parent, "Lab Control Bin")

    const result = spawnSync(
      pwsh,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        path.join(scriptRoot, "install-lab-control.ps1"),
        "-InstallRoot",
        root,
        "-SkipUserPath",
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: 15_000 },
    )

    expect(result.status).toBe(0)
    for (const command of ["lab-status", "lab-hermes", "lab-atlas", "lab-containers", "lab-backups"]) {
      expect(readFileSync(path.join(root, `${command}.cmd`), "utf8")).toContain(`${command}.ps1`)
    }
    expect(result.stdout).toContain("User PATH unchanged")
  })

  test("installer preflights every conflict before copying any managed file", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "lab-control-conflict-"))
    tempRoots.push(parent)
    const root = path.join(parent, "Lab Control Bin")
    mkdirSync(root)
    writeFileSync(path.join(root, "lab-status.ps1"), "user-modified", "utf8")

    const result = spawnSync(
      pwsh,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        path.join(scriptRoot, "install-lab-control.ps1"),
        "-InstallRoot",
        root,
        "-SkipUserPath",
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: 15_000 },
    )

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Refusing to overwrite modified managed file")
    expect(existsSync(path.join(root, "LabControl.psm1"))).toBe(false)
    expect(readFileSync(path.join(root, "lab-status.ps1"), "utf8")).toBe("user-modified")
  })
})
