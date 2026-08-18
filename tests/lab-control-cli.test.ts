import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { afterEach, beforeAll, describe, expect, test } from "vitest"

const repoRoot = path.resolve(__dirname, "..")
const scriptRoot = path.join(repoRoot, "scripts", "lab-control")
const pwsh = process.platform === "win32" ? "pwsh.exe" : "pwsh"
const tempRoots: string[] = []
const nowUtc = "2026-08-08T12:00:00Z"

/**
 * How long one CLI invocation may take.
 *
 * Every test here cold-starts pwsh, which makes this the slowest suite in the repository. The
 * previous 15s literal sat close enough to the real cost that a loaded CI runner could exceed it,
 * and a spawnSync timeout returns empty stdout rather than raising -- so the suite failed with
 * "expected '' to contain 'HERMES'", which reads as a logic break in code the branch never touched.
 * That is #833: one commit both passing and failing, with nothing to tell the two apart.
 *
 * The budget is now generous and named, and assertCompleted turns exceeding it into a failure that
 * says so. A red suite has to mean something specific, or agents learn to merge through red.
 */
const SPAWN_BUDGET_MS = Number(process.env.LAB_CONTROL_TEST_BUDGET_MS ?? 60_000)

/**
 * Fail loudly when a CLI invocation did not actually finish.
 *
 * spawnSync reports a timeout by setting `error` and returning empty output, so without this the
 * suite asserts on stdout that was never produced and blames the assertion. Naming the real cause is
 * the whole point: a flake nobody can attribute is one that gets merged through.
 */
function assertCompleted(result: ReturnType<typeof spawnSync>, label: string) {
  if (result.error) {
    throw new Error(
      `${label} did not complete within ${SPAWN_BUDGET_MS}ms (${result.error.message}). This is an ` +
        `execution-budget failure, not an assertion failure; raise LAB_CONTROL_TEST_BUDGET_MS if the ` +
        `host is genuinely this slow.`,
    )
  }
  if (result.signal) {
    throw new Error(`${label} was killed by ${result.signal} before it could produce output.`)
  }
  return result
}

type FixtureMode =
  | "healthy"
  | "auth-blocked"
  | "incomplete"
  | "receipt-fresh"
  | "receipt-failed"
  | "receipt-stale"
  | "receipt-missing"
  | "receipt-malformed"
  | "receipt-wrong-schema"
  | "receipt-wrong-schema-case"
  | "receipt-future-completion"
  | "receipt-missing-direction"
  | "receipt-zero-file-count"
  | "receipt-invalid-manifest-hash"
  | "receipt-hash-mismatch"
  | "receipt-run-id-mismatch"
  | "receipt-direction-run-id-mismatch"
  | "receipt-duplicate-run-id"
  | "receipt-direction-duplicate-run-id"
  | "receipt-task-evidence-duplicate-run-id"
  | "receipt-task-before-window"
  | "receipt-task-observed-after-completion"
  | "receipt-task-after-window"
  | "receipt-only"
  | "receipt-hermes-death"
  | "receipt-task-state-incomplete"
  | "receipt-completed-at-start"
  | "receipt-task-evidence-completed-at-receipt"
  | "receipt-task-evidence-out-of-order"
  | "receipt-invalid-base64"
  | "receipt-invalid-timestamp"

type Receipt = {
  schema_version: number
  task_name: string
  run_id: string
  started_at: string
  completed_at: string
  result: string
  verification: string
  directions: Array<{
    run_id: string
    direction: string
    source: string
    destination: string
    file_count: number
    manifest_sha256: string
    verification: string
  }>
}

type TaskEvidence = {
  schema_version: number
  task_name: string
  run_id: string
  started_at: string
  receipt_completed_at: string
  completed_at: string
  state: string
  result: string
  verification: string
  atlas_receipt_sha256: string
}

function receiptFixture(mode: FixtureMode) {
  const runId = "11111111-2222-3333-4444-555555555555"
  const receipt: Receipt = {
    schema_version: 1,
    task_name: "HermesCrossNodeBackupSync",
    run_id: runId,
    started_at: "2026-08-08T11:00:00.0000000Z",
    completed_at: "2026-08-08T11:00:25.0000000Z",
    result: "SUCCESS",
    verification: "SHA256_PASS",
    directions: [
      {
        run_id: runId,
        direction: "ATLAS_TO_HERMES",
        source: "atlas",
        destination: "hermes",
        file_count: 3,
        manifest_sha256: "a".repeat(64),
        verification: "SHA256_PASS",
      },
      {
        run_id: runId,
        direction: "HERMES_TO_ATLAS",
        source: "hermes",
        destination: "atlas",
        file_count: 5,
        manifest_sha256: "b".repeat(64),
        verification: "SHA256_PASS",
      },
    ],
  }
  let taskState = "Ready"
  let taskResult = "0"
  let taskLastUtc = receipt.started_at
  let malformedBase64: string | undefined
  let malformedJson: string | undefined

  switch (mode) {
    case "receipt-failed":
      taskResult = "1"
      break
    case "receipt-stale":
      receipt.started_at = "2026-08-07T04:59:40.0000000Z"
      receipt.completed_at = "2026-08-07T05:00:00.0000000Z"
      taskLastUtc = receipt.started_at
      break
    case "receipt-missing":
      break
    case "receipt-malformed":
      malformedJson = "{"
      break
    case "receipt-wrong-schema":
      receipt.schema_version = 2
      break
    case "receipt-wrong-schema-case": {
      const wrongCaseReceipt = { ...receipt, Schema_version: receipt.schema_version } as Record<string, unknown>
      delete wrongCaseReceipt.schema_version
      malformedJson = JSON.stringify(wrongCaseReceipt)
      break
    }
    case "receipt-future-completion":
      receipt.started_at = "2026-08-08T12:00:00.0000000Z"
      receipt.completed_at = "2026-08-08T12:05:01.0000000Z"
      taskLastUtc = receipt.started_at
      break
    case "receipt-missing-direction":
      receipt.directions.pop()
      break
    case "receipt-zero-file-count":
      receipt.directions[0].file_count = 0
      break
    case "receipt-invalid-manifest-hash":
      receipt.directions[0].manifest_sha256 = "NOT_A_SHA256"
      break
    case "receipt-direction-run-id-mismatch":
      receipt.directions[1].run_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
      break
    case "receipt-task-before-window":
      taskLastUtc = "2026-08-08T10:54:59.0000000Z"
      break
    case "receipt-task-observed-after-completion":
      taskLastUtc = "2026-08-08T11:00:59.0000000Z"
      break
    case "receipt-task-after-window":
      taskLastUtc = "2026-08-08T11:05:27.0000000Z"
      break
    case "receipt-task-state-incomplete":
      taskState = "Running"
      break
    case "receipt-completed-at-start":
      receipt.completed_at = receipt.started_at
      break
    case "receipt-invalid-base64":
      malformedBase64 = "%%%NOT_BASE64%%%"
      break
    case "receipt-invalid-timestamp":
      receipt.completed_at = "not-a-timestamp"
      break
  }

  let compactJson = malformedJson ?? JSON.stringify(receipt)
  if (mode === "receipt-duplicate-run-id") {
    compactJson = compactJson.replace(
      '"run_id":',
      '"run_id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","run_id":',
    )
  }
  if (mode === "receipt-direction-duplicate-run-id") {
    compactJson = compactJson.replace(
      '"directions":[{"run_id":',
      '"directions":[{"run_id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","run_id":',
    )
  }
  const bytes = Buffer.from(compactJson, "utf8")
  const receiptB64 = malformedBase64 ?? bytes.toString("base64")
  const atlasReceiptHash = createHash("sha256").update(bytes).digest("hex")
  const evidenceCompletedAt = mode === "receipt-stale"
    ? "2026-08-07T05:00:01.0000000Z"
    : mode === "receipt-future-completion"
      ? "2026-08-08T12:05:02.0000000Z"
      : "2026-08-08T11:00:26.0000000Z"
  const taskEvidence: TaskEvidence = {
    schema_version: 1,
    task_name: "HermesCrossNodeBackupSync",
    run_id: runId,
    started_at: receipt.started_at,
    receipt_completed_at: receipt.completed_at,
    completed_at: evidenceCompletedAt,
    state: "COMPLETED",
    result: "SUCCESS",
    verification: "SHA256_PASS",
    atlas_receipt_sha256: atlasReceiptHash,
  }
  if (mode === "receipt-run-id-mismatch") {
    taskEvidence.run_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  }
  if (mode === "receipt-hash-mismatch") {
    taskEvidence.atlas_receipt_sha256 = "c".repeat(64)
  }
  if (mode === "receipt-task-evidence-out-of-order") {
    taskEvidence.completed_at = "2026-08-08T11:00:24.0000000Z"
  }
  if (mode === "receipt-task-evidence-completed-at-receipt") {
    taskEvidence.completed_at = receipt.completed_at
  }
  let taskEvidenceJson = JSON.stringify(taskEvidence)
  if (mode === "receipt-task-evidence-duplicate-run-id") {
    taskEvidenceJson = taskEvidenceJson.replace(
      '"run_id":',
      '"run_id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","run_id":',
    )
  }
  const taskEvidenceBytes = Buffer.from(taskEvidenceJson, "utf8")
  let taskEvidenceB64 = taskEvidenceBytes.toString("base64")
  let hermesTaskEvidenceHash = createHash("sha256").update(taskEvidenceBytes).digest("hex")
  let atlasB64 = receiptB64
  let atlasHash = atlasReceiptHash
  if (mode === "receipt-missing") {
    atlasB64 = ""
    atlasHash = ""
    taskEvidenceB64 = ""
    hermesTaskEvidenceHash = ""
  } else if (mode === "receipt-only" || mode === "receipt-hermes-death") {
    taskEvidenceB64 = ""
    hermesTaskEvidenceHash = ""
  }
  return {
    receiptB64: atlasB64,
    atlasReceiptHash: atlasHash,
    taskEvidenceB64,
    hermesTaskEvidenceHash,
    taskState,
    taskResult,
    taskLastUtc,
  }
}

function makeFakeSsh(mode: FixtureMode) {
  const receipt = receiptFixture(mode)
  const root = mkdtempSync(path.join(tmpdir(), "lab-control-test-"))
  tempRoots.push(root)
  const bin = path.join(root, "fake ssh bin")
  mkdirSync(bin)
  const fakeSsh = path.join(bin, process.platform === "win32" ? "fake-ssh.cmd" : "fake-ssh")
  const log = path.join(root, "ssh-args.log")
  const windowsFixture = `@echo off
echo %*>>"%LAB_CONTROL_TEST_LOG%"
set "LAB_CONTROL_TEST_TARGET="
:find_target
if "%~1"=="" goto target_ready
if /I "%~1"=="hermes" (
  set "LAB_CONTROL_TEST_TARGET=hermes"
  goto target_ready
)
if /I "%~1"=="atlas" (
  set "LAB_CONTROL_TEST_TARGET=atlas"
  goto target_ready
)
shift
goto find_target
:target_ready
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
  exit /b 0
)
if /I "%LAB_CONTROL_TEST_TARGET%"=="hermes" if "%LAB_CONTROL_TEST_MODE%"=="receipt-hermes-death" goto hermes_death
if /I "%LAB_CONTROL_TEST_TARGET%"=="hermes" goto hermes_ok
goto atlas_ok
:hermes_death
1>&2 echo Connection timed out.
exit /b 255
:hermes_ok
echo hostname=HERMES
echo os=Windows 10 Pro
echo uptime=3 days
echo docker=27.5.1
echo ollama=AVAILABLE
echo gpu=NVIDIA GeForce RTX 3050
echo disk=321 GB free of 930 GB
echo cross_sync_task_state=%LAB_CONTROL_TEST_TASK_STATE%
echo cross_sync_task_result=%LAB_CONTROL_TEST_TASK_RESULT%
echo cross_sync_task_last_utc=%LAB_CONTROL_TEST_TASK_LAST_UTC%
echo cross_sync_task_evidence_b64=%LAB_CONTROL_TEST_TASK_EVIDENCE_B64%
echo cross_sync_task_evidence_sha256=%LAB_CONTROL_TEST_TASK_EVIDENCE_SHA256%
exit /b 0
:atlas_ok
echo hostname=atlas
echo os=Ubuntu 24.04.3 LTS
echo uptime=up 8 days
echo docker=27.5.1
echo postgres_evidence=PG_ISREADY_ACCEPTING
echo redis_evidence=REDIS_AUTH_REQUIRED_REACHABLE
echo mongo_evidence=MONGO_PING_OK
echo disk=744G free of 915G
echo backup=2026-08-07T08:15:00-07:00 atlas-nightly
echo cross_sync_receipt_b64=%LAB_CONTROL_TEST_RECEIPT_B64%
echo cross_sync_receipt_sha256=%LAB_CONTROL_TEST_ATLAS_RECEIPT_SHA256%
exit /b 0
`
  const posixFixture = `#!/bin/sh
printf '%s\\n' "$*" >> "$LAB_CONTROL_TEST_LOG"
target=''
for arg in "$@"; do
  case "$arg" in
    hermes|atlas) target="$arg"; break ;;
  esac
done
if [ "\${LAB_CONTROL_TEST_MODE-}" = 'auth-blocked' ]; then
  printf '%s\\n' 'Permission denied (publickey,password,keyboard-interactive).' >&2
  exit 255
fi
if [ "\${LAB_CONTROL_TEST_MODE-}" = 'incomplete' ]; then
  printf '%s\\n' \
    'hostname=reachable-host' \
    'os=known' \
    'uptime=known' \
    'docker=UNKNOWN' \
    'ollama=UNAVAILABLE' \
    'gpu=NOT_FOUND' \
    'disk=10 GB free of 100 GB' \
    'postgres_evidence=TCP_LISTENER_ONLY' \
    'redis_evidence=UNKNOWN' \
    'mongo_evidence=NOT_OBSERVED' \
    'backup=UNKNOWN'
  exit 0
fi
if [ "$target" = 'hermes' ]; then
  if [ "\${LAB_CONTROL_TEST_MODE-}" = 'receipt-hermes-death' ]; then
    printf '%s\\n' 'Connection timed out.' >&2
    exit 255
  fi
  printf '%s\\n' \
    'hostname=HERMES' \
    'os=Windows 10 Pro' \
    'uptime=3 days' \
    'docker=27.5.1' \
    'ollama=AVAILABLE' \
    'gpu=NVIDIA GeForce RTX 3050' \
    'disk=321 GB free of 930 GB'
  printf 'cross_sync_task_state=%s\\n' "\${LAB_CONTROL_TEST_TASK_STATE-}"
  printf 'cross_sync_task_result=%s\\n' "\${LAB_CONTROL_TEST_TASK_RESULT-}"
  printf 'cross_sync_task_last_utc=%s\\n' "\${LAB_CONTROL_TEST_TASK_LAST_UTC-}"
  printf 'cross_sync_task_evidence_b64=%s\\n' "\${LAB_CONTROL_TEST_TASK_EVIDENCE_B64-}"
  printf 'cross_sync_task_evidence_sha256=%s\\n' "\${LAB_CONTROL_TEST_TASK_EVIDENCE_SHA256-}"
  exit 0
fi
printf '%s\\n' \
  'hostname=atlas' \
  'os=Ubuntu 24.04.3 LTS' \
  'uptime=up 8 days' \
  'docker=27.5.1' \
  'postgres_evidence=PG_ISREADY_ACCEPTING' \
  'redis_evidence=REDIS_AUTH_REQUIRED_REACHABLE' \
  'mongo_evidence=MONGO_PING_OK' \
  'disk=744G free of 915G' \
  'backup=2026-08-07T08:15:00-07:00 atlas-nightly'
printf 'cross_sync_receipt_b64=%s\\n' "\${LAB_CONTROL_TEST_RECEIPT_B64-}"
printf 'cross_sync_receipt_sha256=%s\\n' "\${LAB_CONTROL_TEST_ATLAS_RECEIPT_SHA256-}"
exit 0
`
  writeFileSync(fakeSsh, process.platform === "win32" ? windowsFixture : posixFixture, "utf8")
  if (process.platform !== "win32") {
    chmodSync(fakeSsh, 0o755)
  }
  return { fakeSsh, log, root, receipt }
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
        LAB_CONTROL_NOW_UTC: nowUtc,
        LAB_CONTROL_TEST_TASK_STATE: fixture.receipt.taskState,
        LAB_CONTROL_TEST_TASK_RESULT: fixture.receipt.taskResult,
        LAB_CONTROL_TEST_TASK_LAST_UTC: fixture.receipt.taskLastUtc,
        LAB_CONTROL_TEST_RECEIPT_B64: fixture.receipt.receiptB64,
        LAB_CONTROL_TEST_ATLAS_RECEIPT_SHA256: fixture.receipt.atlasReceiptHash,
        LAB_CONTROL_TEST_TASK_EVIDENCE_B64: fixture.receipt.taskEvidenceB64,
        LAB_CONTROL_TEST_TASK_EVIDENCE_SHA256: fixture.receipt.hermesTaskEvidenceHash,
      },
      timeout: SPAWN_BUDGET_MS,
    },
  )
  return {
    ...result,
    sshArgs: readFileSync(fixture.log, "utf8"),
  }
}

/**
 * Pay pwsh's cold start once, before any test is being timed.
 *
 * Otherwise the first test in the file absorbs process startup, module compilation and JIT on top of
 * its own work -- which is why #833 always struck the first test rather than a random one. Warming up
 * here does not make the suite faster; it makes every test cost the same, which is what determinism
 * means for a suite that shells out.
 */
beforeAll(() => {
  spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: SPAWN_BUDGET_MS,
  })
})

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

  test("fresh Atlas receipt and matching completed Hermes task evidence are the only green sync state", () => {
    const result = runCommand("lab-status", "receipt-fresh")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("latest cross-node sync: SYNC_OK")
    expect(result.stdout).toContain("operator blocker: NONE")
  })

  test("scheduled-task observation after evidence completion binds within the five-minute reporting grace", () => {
    const result = runCommand("lab-status", "receipt-task-observed-after-completion")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("latest cross-node sync: SYNC_OK")
    expect(result.stdout).toContain("operator blocker: NONE")
  })

  test.each([
    ["receipt-failed", "SYNC_FAILED"],
    ["receipt-stale", "SYNC_STALE"],
    ["receipt-missing", "SYNC_UNKNOWN"],
    ["receipt-malformed", "SYNC_FAILED"],
    ["receipt-missing-direction", "SYNC_FAILED"],
    ["receipt-hash-mismatch", "SYNC_FAILED"],
    ["receipt-run-id-mismatch", "SYNC_FAILED"],
    ["receipt-only", "SYNC_FAILED"],
  ] as const)("%s remains non-green as %s", (mode, state) => {
    const result = runCommand("lab-status", mode)

    expect(result.status).toBe(2)
    expect(result.stdout).toContain(`latest cross-node sync: ${state}`)
    expect(result.stdout).toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
    expect(result.stdout).not.toContain("operator blocker: NONE")
    expect(result.stdout).not.toContain("SYNC_NEVER_VERIFIED")
  })

  test("a receipt cannot hide Hermes becoming unreachable after Atlas publication", () => {
    const result = runCommand("lab-status", "receipt-hermes-death")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("HERMES")
    expect(result.stdout).toContain("reachable: NO (SSH_TIMEOUT)")
    expect(result.stdout).toContain("latest cross-node sync: SYNC_FAILED")
    expect(result.stdout).toContain("operator blocker: one or more lab nodes are unreachable")
    expect(result.stdout).not.toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
    expect(result.stdout).not.toContain("operator blocker: NONE")
  })

  test.each([
    "receipt-completed-at-start",
    "receipt-task-evidence-completed-at-receipt",
  ] as const)("%s rejects a zero-duration completion boundary", (mode) => {
    const result = runCommand("lab-status", mode)

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("latest cross-node sync: SYNC_FAILED validation=completion_before_start")
    expect(result.stdout).toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
  })

  test.each([
    "receipt-wrong-schema",
    "receipt-wrong-schema-case",
    "receipt-future-completion",
    "receipt-zero-file-count",
    "receipt-invalid-manifest-hash",
    "receipt-direction-run-id-mismatch",
    "receipt-duplicate-run-id",
    "receipt-direction-duplicate-run-id",
    "receipt-task-evidence-duplicate-run-id",
    "receipt-task-before-window",
    "receipt-task-after-window",
    "receipt-task-state-incomplete",
    "receipt-task-evidence-out-of-order",
    "receipt-invalid-base64",
    "receipt-invalid-timestamp",
  ] as const)("%s fails closed", (mode) => {
    const result = runCommand("lab-status", mode)

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("latest cross-node sync: SYNC_FAILED")
    expect(result.stdout).toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
  })

  test.each([
    ["receipt-fresh", "SYNC_OK", 0],
    ["receipt-failed", "SYNC_FAILED", 2],
    ["receipt-stale", "SYNC_STALE", 2],
    ["receipt-missing", "SYNC_UNKNOWN", 2],
    ["receipt-malformed", "SYNC_FAILED", 2],
    ["receipt-only", "SYNC_FAILED", 2],
  ] as const)("lab-backups shares %s classification as %s", (mode, state, status) => {
    const result = runCommand("lab-backups", mode)

    expect(result.status).toBe(status)
    expect(result.stdout).toContain(`latest cross-node sync: ${state}`)
  })

  test("remote commands preserve an SSH executable path with spaces and use target-specific encodings", () => {
    const result = runCommand("lab-status")
    const hermesEncoded = result.sshArgs.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1]
    const atlasEncoded = result.sshArgs.match(/printf %s ([A-Za-z0-9+/=]+) \| base64 -d \| sh/)?.[1]

    expect(result.status).toBe(0)
    expect(hermesEncoded).toBeTruthy()
    expect(Buffer.from(hermesEncoded!, "base64").toString("utf16le")).toContain("Get-CimInstance Win32_OperatingSystem")
    expect(Buffer.from(hermesEncoded!, "base64").toString("utf16le")).toContain("http://127.0.0.1:11434/api/version")
    const hermesCommand = Buffer.from(hermesEncoded!, "base64").toString("utf16le")
    expect(hermesCommand).toContain("HermesCrossNodeBackupSync")
    expect(hermesCommand).toContain("D:\\CrossNodeBackups\\crossnode-sync-task-evidence.json")
    expect(hermesCommand).not.toContain("D:\\CrossNodeBackups\\crossnode-sync-receipt.json")
    expect(hermesCommand).toContain("65536")
    expect(hermesCommand).toContain("[System.IO.FileAccess]::Read")
    expect(atlasEncoded).toBeTruthy()
    const atlasCommand = Buffer.from(atlasEncoded!, "base64").toString("utf8")
    expect(atlasCommand).toContain("pg_isready")
    expect(atlasCommand).toContain("redis-cli")
    expect(atlasCommand).toContain("mongosh")
    expect(atlasCommand).toContain('docker exec "$container" pg_isready')
    expect(atlasCommand).toContain('docker exec "$container" redis-cli')
    expect(atlasCommand).toContain('docker exec "$container" mongosh')
    expect(atlasCommand).toContain("/home/bs/from-hermes/crossnode-sync-receipt.json")
    expect(atlasCommand).toContain("65536")
    expect(atlasCommand).toContain("base64")
    expect(atlasCommand).toContain("stat -c %s")
    expect(atlasCommand.match(/head -c 65536/g)).toHaveLength(2)
    expect(atlasCommand).toContain("sha256sum")
    for (const command of [hermesCommand, atlasCommand]) {
      expect(command).not.toMatch(/\b(?:Set-Content|Out-File|Move-Item|Remove-Item|mv|rm)\b/i)
      expect(command).not.toMatch(/crossnode-sync-(?:receipt|task-evidence)\.json[^\r\n]*(?:>>?|\|\s*(?:Set-Content|Out-File))/i)
    }
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
      { cwd: repoRoot, encoding: "utf8", timeout: SPAWN_BUDGET_MS },
    )
    assertCompleted(result, "install-lab-control")

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
      { cwd: repoRoot, encoding: "utf8", timeout: SPAWN_BUDGET_MS },
    )
    assertCompleted(result, "install-lab-control")

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Refusing to overwrite modified managed file")
    expect(existsSync(path.join(root, "LabControl.psm1"))).toBe(false)
    expect(readFileSync(path.join(root, "lab-status.ps1"), "utf8")).toBe("user-modified")
  })

  test("installer WhatIf stops before reporting SkipUserPath installation success", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "lab-control-whatif-"))
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
        "-WhatIf",
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: SPAWN_BUDGET_MS },
    )
    assertCompleted(result, "install-lab-control")

    expect(result.status).toBe(0)
    expect(existsSync(root)).toBe(false)
    expect(result.stdout).toContain("What if:")
    expect(result.stdout).not.toContain("Installed lab-control commands")
    expect(result.stdout).not.toContain("User PATH unchanged")
  })
})
