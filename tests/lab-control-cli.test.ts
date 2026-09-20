import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { afterEach, beforeAll, describe, expect, test } from "vitest"

const repoRoot = path.resolve(__dirname, "..")
const scriptRoot = path.join(repoRoot, "scripts", "lab-control")
const topologyPath = path.join(repoRoot, "config", "lab-control", "lab-management-topology.v1.json")
const pwsh = process.platform === "win32" ? "pwsh.exe" : "pwsh"
const tempRoots: string[] = []
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const fixtureNowMs = Date.now()
const fixtureIso = (offsetMs: number) => new Date(fixtureNowMs + offsetMs).toISOString()

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
  | "aegis-auth-blocked"
  | "daedalus-timeout"
  | "daedalus-incomplete"
  | "daedalus-no-gpu"
  | "daedalus-gpu-none"
  | "daedalus-wrong-identity"
  | "daedalus-wrong-user"
  | "direct-host-key-mismatch"
  | "direct-host-key-comment-spoof"
  | "direct-host-key-secondary-mismatch"
  | "direct-host-key-revoked"
  | "command-hang"
  | "remote-permission-denied"
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
    started_at: fixtureIso(-HOUR_MS),
    completed_at: fixtureIso(-HOUR_MS + 25_000),
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
      receipt.started_at = fixtureIso(-(31 * HOUR_MS) - 20_000)
      receipt.completed_at = fixtureIso(-(31 * HOUR_MS))
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
      receipt.started_at = fixtureIso(0)
      receipt.completed_at = fixtureIso(10 * MINUTE_MS)
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
      taskLastUtc = fixtureIso(-HOUR_MS - (5 * MINUTE_MS) - 1_000)
      break
    case "receipt-task-observed-after-completion":
      taskLastUtc = fixtureIso(-HOUR_MS + 59_000)
      break
    case "receipt-task-after-window":
      taskLastUtc = fixtureIso(-HOUR_MS + 26_000 + (5 * MINUTE_MS) + 1_000)
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
    ? fixtureIso(-(31 * HOUR_MS) + 1_000)
    : mode === "receipt-future-completion"
      ? fixtureIso((10 * MINUTE_MS) + 1_000)
      : fixtureIso(-HOUR_MS + 26_000)
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
    taskEvidence.completed_at = fixtureIso(-HOUR_MS + 24_000)
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

function makeTopologyAwareFakeSsh(mode: FixtureMode) {
  const receipt = receiptFixture(mode)
  const root = mkdtempSync(path.join(tmpdir(), "lab-control-test-"))
  tempRoots.push(root)
  const bin = path.join(root, "fake ssh bin")
  mkdirSync(bin)
  const fakeSsh = path.join(bin, "fake-ssh.ps1")
  const fakeKeygen = path.join(bin, "fake-keygen.ps1")
  const log = path.join(root, "ssh-args.log")
  const fixture = `$joined = $args -join ' '
[IO.File]::AppendAllText($env:LAB_CONTROL_TEST_LOG, $joined + [Environment]::NewLine)
$logicalTarget = ''
foreach ($argument in $args) {
  if ($argument -cin @('hermes', 'atlas', 'aegis', 'daedalus')) {
    $logicalTarget = $argument.ToLowerInvariant()
    break
  }
}
if ($joined -match '-EncodedCommand\\s+([A-Za-z0-9+/=]+)') {
  try {
    $decoded = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
    if ($decoded -match 'LAB_CONTROL_RELAY_TARGET=(aegis|daedalus)') {
      $logicalTarget = $Matches[1]
    }
  } catch {}
}
if ([string]::IsNullOrWhiteSpace($logicalTarget) -or $logicalTarget -eq 'omen') {
  Write-Error 'Unknown or forbidden fake SSH target.' -ErrorAction Continue
  exit 64
}
if ($env:LAB_CONTROL_TEST_MODE -eq 'command-hang') {
  Start-Sleep -Seconds 5
  exit 0
}
if ($env:LAB_CONTROL_TEST_MODE -eq 'remote-permission-denied') {
  Write-Error 'permission denied while trying to connect to the Docker daemon socket' -ErrorAction Continue
  exit 1
}
if ($env:LAB_CONTROL_TEST_MODE -eq 'auth-blocked' -or
    ($env:LAB_CONTROL_TEST_MODE -eq 'aegis-auth-blocked' -and $logicalTarget -eq 'aegis')) {
  Write-Error 'Permission denied (publickey,password,keyboard-interactive).' -ErrorAction Continue
  exit 255
}
if ($env:LAB_CONTROL_TEST_MODE -eq 'daedalus-timeout' -and $logicalTarget -eq 'daedalus') {
  Write-Error 'Connection timed out.' -ErrorAction Continue
  exit 255
}
if ($env:LAB_CONTROL_TEST_MODE -eq 'receipt-hermes-death' -and $logicalTarget -eq 'hermes') {
  Write-Error 'Connection timed out.' -ErrorAction Continue
  exit 255
}
if ($env:LAB_CONTROL_TEST_MODE -eq 'incomplete') {
  $fixtureHostname = switch ($logicalTarget) {
    'hermes' { 'HERMES' }
    'atlas' { 'atlas' }
    'aegis' { 'aegis' }
    'daedalus' { 'daedalus-ThinkStation-P620' }
  }
  $fixtureUsername = if ($logicalTarget -eq 'daedalus') { 'daedalus' } else { 'bs' }
  @(
    ('hostname=' + $fixtureHostname), ('username=' + $fixtureUsername), 'os=known', 'uptime=known', 'docker=UNKNOWN', 'ollama=UNAVAILABLE',
    'gpu=NOT_FOUND', 'disk=10 GB free of 100 GB', 'postgres_evidence=TCP_LISTENER_ONLY',
    'redis_evidence=UNKNOWN', 'mongo_evidence=NOT_OBSERVED', 'backup=UNKNOWN'
  ) | Write-Output
  exit 0
}
switch ($logicalTarget) {
  'hermes' {
    @(
      'hostname=HERMES', 'username=bs', 'os=Windows 10 Pro', 'uptime=3 days', 'docker=27.5.1',
      'ollama=AVAILABLE', 'gpu=NVIDIA GeForce RTX 3050', 'disk=321 GB free of 930 GB',
      ('cross_sync_task_state=' + $env:LAB_CONTROL_TEST_TASK_STATE),
      ('cross_sync_task_result=' + $env:LAB_CONTROL_TEST_TASK_RESULT),
      ('cross_sync_task_last_utc=' + $env:LAB_CONTROL_TEST_TASK_LAST_UTC),
      ('cross_sync_task_evidence_b64=' + $env:LAB_CONTROL_TEST_TASK_EVIDENCE_B64),
      ('cross_sync_task_evidence_sha256=' + $env:LAB_CONTROL_TEST_TASK_EVIDENCE_SHA256)
    ) | Write-Output
  }
  'atlas' {
    @(
      'hostname=atlas', 'username=bs', 'os=Ubuntu 24.04.3 LTS', 'uptime=up 8 days', 'docker=27.5.1',
      'postgres_evidence=PG_ISREADY_ACCEPTING', 'redis_evidence=REDIS_AUTH_REQUIRED_REACHABLE',
      'mongo_evidence=MONGO_PING_OK', 'disk=744G free of 915G',
      'backup=2026-08-07T08:15:00-07:00 atlas-nightly',
      ('cross_sync_receipt_b64=' + $env:LAB_CONTROL_TEST_RECEIPT_B64),
      ('cross_sync_receipt_sha256=' + $env:LAB_CONTROL_TEST_ATLAS_RECEIPT_SHA256)
    ) | Write-Output
  }
  'aegis' {
    @(
      'hostname=aegis', 'username=bs', 'os=Ubuntu 24.04.4 LTS', 'uptime=up 18 days', 'docker=27.5.1',
      'gpu=NONE', 'disk=680G free of 915G', '<Objs version="1.1"><bad=progress</Objs>'
    ) | Write-Output
  }
  'daedalus' {
    if ($env:LAB_CONTROL_TEST_MODE -eq 'daedalus-wrong-identity') {
      @('hostname=not-daedalus', 'username=daedalus', 'os=Ubuntu 24.04.4 LTS', 'uptime=up 4 days', 'docker=27.5.1', 'gpu=NVIDIA GeForce RTX 3090', 'disk=1.4T free of 1.8T') | Write-Output
    } elseif ($env:LAB_CONTROL_TEST_MODE -eq 'daedalus-wrong-user') {
      @('hostname=daedalus-ThinkStation-P620', 'username=impostor', 'os=Ubuntu 24.04.4 LTS', 'uptime=up 4 days', 'docker=27.5.1', 'gpu=NVIDIA GeForce RTX 3090', 'disk=1.4T free of 1.8T') | Write-Output
    } elseif ($env:LAB_CONTROL_TEST_MODE -eq 'daedalus-incomplete') {
      @('hostname=daedalus-ThinkStation-P620', 'username=daedalus', 'os=Ubuntu 24.04.4 LTS', 'uptime=up 4 days', 'docker=27.5.1', 'gpu=NVIDIA GeForce RTX 3090', 'disk=UNKNOWN') | Write-Output
    } elseif ($env:LAB_CONTROL_TEST_MODE -eq 'daedalus-no-gpu') {
      @('hostname=daedalus-ThinkStation-P620', 'username=daedalus', 'os=Ubuntu 24.04.4 LTS', 'uptime=up 4 days', 'docker=27.5.1', 'gpu=UNKNOWN', 'disk=1.4T free of 1.8T') | Write-Output
    } elseif ($env:LAB_CONTROL_TEST_MODE -eq 'daedalus-gpu-none') {
      @('hostname=daedalus-ThinkStation-P620', 'username=daedalus', 'os=Ubuntu 24.04.4 LTS', 'uptime=up 4 days', 'docker=27.5.1', 'gpu=NONE', 'disk=1.4T free of 1.8T') | Write-Output
    } else {
      @('hostname=daedalus-ThinkStation-P620', 'username=daedalus', 'os=Ubuntu 24.04.4 LTS', 'uptime=up 4 days', 'docker=27.5.1', 'gpu=NVIDIA GeForce RTX 3090', 'disk=1.4T free of 1.8T') | Write-Output
    }
  }
}
exit 0
`
  writeFileSync(fakeSsh, fixture, "utf8")
  writeFileSync(fakeKeygen, `$stdin = @($input) -join "\n"
if ($args.Count -ge 2 -and $args[0] -eq '-F') {
  $lookup = $args[1]
  Write-Output ('# Host ' + $lookup + ' found')
  Write-Output ($lookup + ' ssh-ed25519 GOODKEY')
  if ($env:LAB_CONTROL_TEST_MODE -eq 'direct-host-key-revoked' -and $lookup -eq '192.168.88.8') {
    Write-Output ('@revoked ' + $lookup + ' ssh-ed25519 GOODKEY')
  }
  if ($env:LAB_CONTROL_TEST_MODE -eq 'direct-host-key-secondary-mismatch' -and $lookup -eq '192.168.88.8') {
    Write-Output ($lookup + ' ssh-ed25519 BADKEY')
  }
  return
}
$lookup = if ($stdin -match '^([^\\s]+)\\s+ssh-ed25519\\s+') { $Matches[1] } else { '' }
$fingerprint = switch ($lookup) {
  '100.97.194.84' { 'SHA256:Iz+tH9Nr8AqGCRWzf2CDFGfii0V72zfvuiSijDBIhF0' }
  '192.168.88.8' {
    if ($env:LAB_CONTROL_TEST_MODE -eq 'direct-host-key-mismatch' -or
        $env:LAB_CONTROL_TEST_MODE -eq 'direct-host-key-comment-spoof' -or
        $stdin -match 'BADKEY') {
      'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    } else {
      'SHA256:0QsMN3STmqBsozY2oea4GU32dDIyCKV0jCbWI8n4fYw'
    }
  }
  default { 'SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }
}
$comment = if ($env:LAB_CONTROL_TEST_MODE -eq 'direct-host-key-comment-spoof' -and $lookup -eq '192.168.88.8') {
  'comment-SHA256:0QsMN3STmqBsozY2oea4GU32dDIyCKV0jCbWI8n4fYw'
} else { 'fixture' }
Write-Output ('256 ' + $fingerprint + ' ' + $comment + ' (ED25519)')
`, "utf8")
  return { fakeSsh, fakeKeygen, log, root, receipt }
}

function createTestInstall(root: string, command: string, controlHostname: string) {
  const installRoot = path.join(root, "installed lab control")
  mkdirSync(installRoot)
  copyFileSync(path.join(scriptRoot, "LabControl.psm1"), path.join(installRoot, "LabControl.psm1"))
  copyFileSync(path.join(scriptRoot, `${command}.ps1`), path.join(installRoot, `${command}.ps1`))
  const topology = JSON.parse(readFileSync(topologyPath, "utf8"))
  for (const route of topology.managementRoutes) {
    route.evidence = {
      state: "VERIFIED",
      observedAt: new Date(Date.now() - MINUTE_MS).toISOString(),
      expiresAt: new Date(Date.now() + (6 * DAY_MS)).toISOString(),
    }
  }
  writeFileSync(
    path.join(installRoot, "lab-management-topology.v1.json"),
    `${JSON.stringify(topology, null, 2)}\n`,
    "utf8",
  )
  copyFileSync(
    path.join(repoRoot, "config", "lab-control", "lab-management-topology.v1.schema.json"),
    path.join(installRoot, "lab-management-topology.v1.schema.json"),
  )
  const identity = JSON.parse(
    readFileSync(path.join(repoRoot, "config", "execution-fabric", "node-identity-contract.json"), "utf8"),
  )
  identity.nodes.omen.hostnames = [controlHostname]
  writeFileSync(path.join(installRoot, "node-identity-contract.json"), `${JSON.stringify(identity, null, 2)}\n`, "utf8")
  return path.join(installRoot, `${command}.ps1`)
}

function runCommand(
  command: string,
  mode: FixtureMode = "healthy",
  envOverrides: NodeJS.ProcessEnv = {},
  controlHostname = hostname(),
) {
  const fixture = makeTopologyAwareFakeSsh(mode)
  const commandScript = createTestInstall(fixture.root, command, controlHostname)
  const result = spawnSync(
    pwsh,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", commandScript],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        LAB_CONTROL_SSH_EXECUTABLE: fixture.fakeSsh,
        LAB_CONTROL_SSH_KEYGEN_EXECUTABLE: fixture.fakeKeygen,
        LAB_CONTROL_TEST_LOG: fixture.log,
        LAB_CONTROL_TEST_MODE: mode,
        LAB_CONTROL_TOPOLOGY_PATH: "",
        LAB_CONTROL_NOW_UTC: "",
        LAB_CONTROL_TOPOLOGY_NOW_UTC: "",
        LAB_CONTROL_TEST_TASK_STATE: fixture.receipt.taskState,
        LAB_CONTROL_TEST_TASK_RESULT: fixture.receipt.taskResult,
        LAB_CONTROL_TEST_TASK_LAST_UTC: fixture.receipt.taskLastUtc,
        LAB_CONTROL_TEST_RECEIPT_B64: fixture.receipt.receiptB64,
        LAB_CONTROL_TEST_ATLAS_RECEIPT_SHA256: fixture.receipt.atlasReceiptHash,
        LAB_CONTROL_TEST_TASK_EVIDENCE_B64: fixture.receipt.taskEvidenceB64,
        LAB_CONTROL_TEST_TASK_EVIDENCE_SHA256: fixture.receipt.hermesTaskEvidenceHash,
        ...envOverrides,
      },
      timeout: SPAWN_BUDGET_MS,
    },
  )
  return {
    ...result,
    sshArgs: existsSync(fixture.log) ? readFileSync(fixture.log, "utf8") : "",
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
  test("lab-status reports the complete healthy five-node management plane", () => {
    const result = runCommand("lab-status")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("OMEN")
    expect(result.stdout).toContain("reachable: YES (LOCAL)")
    expect(result.stdout).toContain("HERMES")
    expect(result.stdout).toContain("reachable: YES")
    expect(result.stdout).toContain("Ollama: AVAILABLE")
    expect(result.stdout).toContain("GPU: NVIDIA GeForce RTX 3050")
    expect(result.stdout).toContain("ATLAS")
    expect(result.stdout).toContain("Postgres evidence: PG_ISREADY_ACCEPTING")
    expect(result.stdout).toContain("Redis evidence: REDIS_AUTH_REQUIRED_REACHABLE")
    expect(result.stdout).toContain("Mongo evidence: MONGO_PING_OK")
    expect(result.stdout).toContain("AEGIS")
    expect(result.stdout).toContain("DAEDALUS")
    expect(result.stdout).toContain("hostname: aegis")
    expect(result.stdout).toContain("username: bs")
    expect(result.stdout).toContain("OS: Ubuntu 24.04.4 LTS")
    expect(result.stdout).toContain("uptime: up 18 days")
    expect(result.stdout).toContain("GPU: NVIDIA GeForce RTX 3090")
    expect(result.stdout).toContain("latest backup: 2026-08-07T08:15:00-07:00 atlas-nightly")
    expect(result.stdout).toContain("operator blocker: NONE")
    expect(result.sshArgs).not.toMatch(/(?:^|\s)--\s+omen(?:\s|$)/m)
  })

  test("lab-status rejects a non-OMEN OS machine identity before starting SSH", () => {
    const result = runCommand("lab-status", "healthy", {}, `NOT-${hostname()}`)

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("OMEN")
    expect(result.stdout).toContain("LOCAL_IDENTITY_MISMATCH")
    expect(result.sshArgs).toBe("")
  })

  test("process-controlled COMPUTERNAME cannot spoof the OS machine identity gate", () => {
    const result = runCommand("lab-status", "healthy", { COMPUTERNAME: "NOT-THE-REAL-MACHINE" })

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(new RegExp(`hostname: ${hostname()}`, "i"))
    expect(result.stdout).toContain("operator blocker: NONE")
  })

  test("AEGIS and DAEDALUS use HERMES-owned relay credentials with a generic read-only probe", () => {
    const result = runCommand("lab-status")
    const outerCommands = Array.from(result.sshArgs.matchAll(/-EncodedCommand ([A-Za-z0-9+/=]+)/g))
      .map((match) => Buffer.from(match[1], "base64").toString("utf16le"))
    const relays = ["aegis", "daedalus"].map((target) => {
      const outer = outerCommands.find((command) => command.includes(`LAB_CONTROL_RELAY_TARGET=${target}`))
      expect(outer).toBeTruthy()
      const innerEncoded = outer!.match(/printf %s ([A-Za-z0-9+/=]+) \| base64 -d \| sh/)?.[1]
      expect(innerEncoded).toBeTruthy()
      return Buffer.from(innerEncoded!, "base64").toString("utf8")
    })

    expect(result.status).toBe(0)
    for (const command of relays) {
      expect(command).toContain("hostname")
      expect(command).toContain("/etc/os-release")
      expect(command).toContain("uptime -p")
      expect(command).toContain("docker info")
      expect(command).toContain("nvidia-smi")
      expect(command).toContain("df -hP /")
      expect(command).not.toMatch(/pg_isready|redis-cli|mongosh|crossnode-sync/i)
      expect(command).not.toMatch(/\b(?:sudo|systemctl|rm|mv)\b|docker\s+(?:start|stop|restart)/i)
      expect(command).not.toContain("\r")
    }
  })

  test("one required AEGIS authentication failure blocks the complete status", () => {
    const result = runCommand("lab-status", "aegis-auth-blocked")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("AEGIS")
    expect(result.stdout).toContain("reachable: NO (SSH_AUTH_BLOCKED)")
    expect(result.stdout).toContain("operator blocker: SSH authentication is not configured")
    expect(result.stdout).toContain("DAEDALUS")
    expect(result.stdout).not.toContain("password,keyboard-interactive")
  })

  test("one required DAEDALUS timeout is typed and blocks the complete status", () => {
    const result = runCommand("lab-status", "daedalus-timeout")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("DAEDALUS")
    expect(result.stdout).toContain("reachable: NO (SSH_TIMEOUT)")
    expect(result.stdout).toContain("operator blocker: one or more lab nodes are unreachable")
    expect(result.stdout).toContain("AEGIS")
  })

  test("reachable DAEDALUS with incomplete generic evidence fails closed", () => {
    const result = runCommand("lab-status", "daedalus-incomplete")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("DAEDALUS")
    expect(result.stdout).toContain("disk: UNKNOWN")
    expect(result.stdout).toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
  })

  test("the resident GPU worker cannot be healthy without GPU evidence", () => {
    const result = runCommand("lab-status", "daedalus-no-gpu")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("DAEDALUS")
    expect(result.stdout).toContain("GPU: UNKNOWN")
    expect(result.stdout).toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
  })

  test("the resident GPU worker rejects a NONE placeholder as non-evidence", () => {
    const result = runCommand("lab-status", "daedalus-gpu-none")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("DAEDALUS")
    expect(result.stdout).toContain("GPU: NONE")
    expect(result.stdout).toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
  })

  test("reachable SSH with the wrong DAEDALUS hostname fails identity closed", () => {
    const result = runCommand("lab-status", "daedalus-wrong-identity")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("DAEDALUS")
    expect(result.stdout).toContain("reachable: NO (SSH_IDENTITY_MISMATCH)")
    expect(result.stdout).not.toContain("operator blocker: NONE")
  })

  test("reachable SSH with the wrong DAEDALUS account fails identity closed", () => {
    const result = runCommand("lab-status", "daedalus-wrong-user")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("DAEDALUS")
    expect(result.stdout).toContain("reachable: NO (SSH_IDENTITY_MISMATCH)")
    expect(result.stdout).not.toContain("operator blocker: NONE")
  })

  test("a direct route whose managed host key disagrees with topology fails before SSH", () => {
    const result = runCommand("lab-atlas", "direct-host-key-mismatch")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("ATLAS: UNREACHABLE (SSH_HOST_KEY_BLOCKED)")
    expect(result.sshArgs).toBe("")
  })

  test.each(["direct-host-key-comment-spoof", "direct-host-key-secondary-mismatch", "direct-host-key-revoked"] as const)(
    "%s cannot satisfy the authoritative manifest fingerprint",
    (mode) => {
      const result = runCommand("lab-atlas", mode)

      expect(result.status).toBe(2)
      expect(result.stdout).toContain("ATLAS: UNREACHABLE (SSH_HOST_KEY_BLOCKED)")
      expect(result.sshArgs).toBe("")
    },
  )

  test("a responsive SSH process cannot exceed the command wall-clock budget", () => {
    const startedAt = Date.now()
    const result = runCommand("lab-hermes", "command-hang", { LAB_CONTROL_SSH_WALL_TIMEOUT_MS: "250" })

    expect(Date.now() - startedAt).toBeLessThan(4_000)
    expect(result.status).toBe(2)
    expect(result.stdout).toContain("HERMES: UNREACHABLE (SSH_COMMAND_TIMEOUT)")
  })

  test("an invalid SSH wall-clock setting is a configuration error, not a network failure", () => {
    const result = runCommand("lab-hermes", "healthy", { LAB_CONTROL_SSH_WALL_TIMEOUT_MS: "30001" })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("LAB_CONTROL_CONFIGURATION_INVALID")
    expect(result.stdout).not.toContain("SSH_UNREACHABLE")
    expect(result.sshArgs).toBe("")
  })

  test("a selected SSH executable containing percent expansion syntax fails before transport", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lab-control-percent-path-"))
    tempRoots.push(root)
    const unsafeExecutable = path.join(root, "fake%ssh.ps1")
    writeFileSync(unsafeExecutable, "exit 0\n", "utf8")

    const result = runCommand("lab-hermes", "healthy", { LAB_CONTROL_SSH_EXECUTABLE: unsafeExecutable })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("LAB_CONTROL_CONFIGURATION_INVALID")
    expect(result.sshArgs).toBe("")
  })

  test("every dynamic ProxyCommand token rejects percent expansion syntax", () => {
    const modulePath = path.join(scriptRoot, "LabControl.psm1").replaceAll("'", "''")
    const command = [
      `Import-Module '${modulePath}' -Force`,
      `& (Get-Module LabControl) { ConvertTo-LabProxyCommandToken -Value 'C:\\bin\\pw%sh.exe' }`,
    ].join("; ")
    const result = spawnSync(
      pwsh,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { cwd: repoRoot, encoding: "utf8", timeout: SPAWN_BUDGET_MS },
    )

    assertCompleted(result, "ProxyCommand token percent guard")
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("TOPOLOGY_INVALID")
  })

  test("remote command permission failures are not mislabeled as SSH authentication failures", () => {
    const result = runCommand("lab-containers", "remote-permission-denied")

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("FAILED (REMOTE_COMMAND_FAILED)")
    expect(result.stdout).not.toContain("SSH_AUTH_BLOCKED")
    expect(result.stdout).not.toContain("UNREACHABLE (REMOTE_COMMAND_FAILED)")
  })

  test("lab-status separates authenticated transport reachability from a failed probe", () => {
    const result = runCommand("lab-status", "remote-permission-denied")

    expect(result.status).toBe(2)
    for (const node of ["HERMES", "ATLAS", "AEGIS", "DAEDALUS"]) {
      expect(result.stdout).toMatch(new RegExp(`${node}[\\s\\S]*?reachable: YES[\\s\\S]*?probe: FAILED \\(REMOTE_COMMAND_FAILED\\)`))
    }
    expect(result.stdout).not.toContain("reachable: NO (REMOTE_COMMAND_FAILED)")
    expect(result.stdout).not.toContain("SSH_RELAY_UNAVAILABLE")
    expect(result.stdout).toContain("operator blocker: one or more required probes failed")
  })

  test.each([
    ["lab-aegis", "AEGIS", "hostname: aegis"],
    ["lab-daedalus", "DAEDALUS", "hostname: daedalus-ThinkStation-P620"],
  ] as const)("%s provides a detailed routed node view", (command, heading, identity) => {
    const result = runCommand(command)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`${heading}: REACHABLE`)
    expect(result.stdout).toContain(identity)
    expect(result.stdout).not.toMatch(/<objs\b/i)
    const routed = Array.from(result.sshArgs.matchAll(/-EncodedCommand ([A-Za-z0-9+/=]+)/g))
      .map((match) => Buffer.from(match[1], "base64").toString("utf16le"))
      .some((decoded) => decoded.includes(`LAB_CONTROL_RELAY_TARGET=${heading.toLowerCase()}`))
    expect(routed).toBe(true)
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
    expect(result.stdout).toContain("ATLAS")
    expect(result.stdout).toContain("reachable: NO (SSH_RELAY_UNAVAILABLE)")
    expect(result.stdout).toContain("AEGIS")
    expect(result.stdout).toContain("DAEDALUS")
    expect(result.stdout).toContain("latest cross-node sync: SYNC_UNKNOWN")
    expect(result.stdout).toContain("operator blocker: one or more lab nodes are unreachable")
    expect(result.stdout).not.toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
    expect(result.stdout).not.toContain("operator blocker: NONE")
    expect(result.sshArgs.trim().split(/\r?\n/)).toHaveLength(1)
    expect(result.sshArgs).not.toMatch(/(?:^|\s)--\s+atlas(?:\s|$)/)
    expect(result.sshArgs).not.toContain("LAB_CONTROL_RELAY_TARGET=")
  })

  test("a process environment override cannot backdate stale sync evidence", () => {
    const result = runCommand("lab-status", "receipt-stale", {
      LAB_CONTROL_NOW_UTC: fixtureIso(-(30 * HOUR_MS)),
    })

    expect(result.status).toBe(2)
    expect(result.stdout).toContain("latest cross-node sync: SYNC_STALE")
    expect(result.stdout).not.toContain("latest cross-node sync: SYNC_OK")
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
    expect(hermesCommand).toContain("[Environment]::MachineName")
    expect(hermesCommand).toContain("[Environment]::UserName")
    expect(hermesCommand).not.toContain("$env:COMPUTERNAME")
    expect(hermesCommand).not.toContain("$env:USERNAME")
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
    expect(atlasCommand).not.toContain("\r")
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

  test.each(["lab-status", "lab-hermes", "lab-atlas", "lab-aegis", "lab-daedalus", "lab-containers", "lab-backups"])(
    "%s uses noninteractive bounded SSH",
    (command) => {
      const result = runCommand(command)

      expect(result.status).toBe(0)
      expect(result.sshArgs).toContain("BatchMode=yes")
      expect(result.sshArgs).toContain("-n")
      expect(result.sshArgs).toContain("IdentitiesOnly=yes")
      expect(result.sshArgs).toContain("IdentityAgent=none")
      expect(result.sshArgs).toContain("StrictHostKeyChecking=yes")
      expect(result.sshArgs).toContain("HostKeyAlgorithms=ssh-ed25519")
      expect(result.sshArgs).toContain("KnownHostsCommand=none")
      expect(result.sshArgs).toContain("UpdateHostKeys=no")
      expect(result.sshArgs).toContain("PasswordAuthentication=no")
      expect(result.sshArgs).toContain("KbdInteractiveAuthentication=no")
      expect(result.sshArgs).toContain("ForwardAgent=no")
      expect(result.sshArgs).toContain("PermitLocalCommand=no")
      expect(result.sshArgs).toContain("ClearAllForwardings=yes")
      expect(result.sshArgs).toContain("ControlPath=none")
      expect(result.sshArgs).toContain("ConnectTimeout=5")
      expect(result.sshArgs).toContain("ConnectionAttempts=1")
    },
  )

  test("runtime SSH carries the canonical route endpoints instead of relying on mutable aliases", () => {
    const result = runCommand("lab-status")
    const commands = result.sshArgs.trim().split(/\r?\n/)
    const hermes = commands.find((line) => /(?:^|\s)--\s+hermes(?:\s|$)/.test(line))!
    const atlas = commands.find((line) => /(?:^|\s)--\s+atlas(?:\s|$)/.test(line))!
    const relays = commands
      .filter((line) => /-EncodedCommand [A-Za-z0-9+/=]+/.test(line))
      .map((line) => Buffer.from(line.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)![1], "base64").toString("utf16le"))

    expect(result.status).toBe(0)
    expect(hermes).toContain("Hostname=100.97.194.84")
    expect(hermes).toContain("User=bs")
    expect(hermes).toContain("Port=22")
    expect(hermes).toContain("ProxyCommand=none")
    expect(hermes).toContain("HostKeyAlgorithms=ssh-ed25519")
    expect(atlas).toContain("Hostname=192.168.88.8")
    expect(atlas).toContain("User=bs")
    expect(atlas).toContain("Port=22")
    expect(atlas).toMatch(/ProxyCommand="[^"]+" "-NoLogo" "-NoProfile" "-NonInteractive" "-File" "[^"]*fake-ssh\.ps1" "-F" "none" "-n"/)
    expect(atlas).toMatch(/ProxyCommand=[\s\S]*IdentityAgent=none[\s\S]*StrictHostKeyChecking=yes/)
    expect(atlas).toMatch(/ProxyCommand=[\s\S]*HostKeyAlgorithms=ssh-ed25519/)
    expect(atlas).toMatch(/ProxyCommand=[\s\S]*"UserKnownHostsFile=[^"]+"/)
    expect(atlas).toMatch(/ProxyCommand=[\s\S]*Hostname=100\.97\.194\.84[\s\S]*User=bs[\s\S]*Port=22/)
    expect(atlas).toMatch(/ProxyCommand=[\s\S]*"-W" "%h:%p" "--" "hermes"/)
    expect(atlas).not.toMatch(/ProxyCommand=ssh(?:\s|$)/)
    expect(atlas).not.toContain("ProxyJump=")
    const aegisRelay = relays.find((command) => command.includes("LAB_CONTROL_RELAY_TARGET=aegis"))!
    const daedalusRelay = relays.find((command) => command.includes("LAB_CONTROL_RELAY_TARGET=daedalus"))!
    expect(aegisRelay).toContain("$expectedHost = '192.168.88.7'")
    expect(aegisRelay).toContain("$expectedUser = 'bs'")
    expect(aegisRelay).toContain("$expectedPort = '22'")
    expect(aegisRelay).toContain("SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo")
    expect(daedalusRelay).toContain("$expectedHost = '192.168.88.6'")
    expect(daedalusRelay).toContain("$expectedUser = 'daedalus'")
    expect(daedalusRelay).toContain("$expectedPort = '2222'")
    expect(daedalusRelay).toContain("SHA256:njnjHfmzEA8Azl5xOcNICR4V3OU7+DvUO4JLHW4AAf4")
    for (const relay of [aegisRelay, daedalusRelay]) {
      expect(relay).toContain("ssh.exe -G ' + $relayAlias")
      expect(relay).toContain("Remove-Item -LiteralPath $configurationTemp")
      expect(relay).toContain("ssh-keygen.exe -F $hostKeyLookup")
      expect(relay).toContain("LAB_RELAY_FINGERPRINT_MISMATCH")
      expect(relay).toContain("HostKeyAlgorithms=ssh-ed25519")
      expect(relay).toContain("ProxyCommand=none")
      expect(relay).toContain("ProxyJump=none")
      expect(relay).toContain("KnownHostsCommand=none")
      expect(relay).toContain("ControlPath=none")
      expect(relay).toContain("PermitLocalCommand=no")
      expect(relay).not.toContain("IdentityFile=~/.ssh/id_ed25519")
      expect(relay).not.toContain("'-F', 'none'")
    }
  })

  test.each([
    ["valid", "192.168.88.7", "SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo", "fixture", false, 0, "hostname=aegis"],
    ["config mismatch", "192.168.88.99", "SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo", "fixture", false, 64, "LAB_RELAY_CONFIG_MISMATCH"],
    ["fingerprint mismatch", "192.168.88.7", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "fixture", false, 64, "LAB_RELAY_FINGERPRINT_MISMATCH"],
    ["fingerprint hidden in comment", "192.168.88.7", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo", false, 64, "LAB_RELAY_FINGERPRINT_MISMATCH"],
    ["revoked matching key", "192.168.88.7", "SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo", "fixture", true, 64, "LAB_RELAY_FINGERPRINT_MISMATCH"],
  ] as const)("resident relay behavior fails closed for %s", (_case, configuredHost, knownFingerprint, keyComment, revoked, expectedStatus, expectedText) => {
    const outer = runCommand("lab-aegis")
    const encoded = Array.from(outer.sshArgs.matchAll(/-EncodedCommand ([A-Za-z0-9+/=]+)/g))
      .map((match) => Buffer.from(match[1], "base64").toString("utf16le"))
      .find((command) => command.includes("LAB_CONTROL_RELAY_TARGET=aegis"))!
    const root = mkdtempSync(path.join(tmpdir(), "lab-relay-behavior-"))
    tempRoots.push(root)
    const bin = path.join(root, "bin")
    mkdirSync(bin)
    const knownHostsDirectory = path.join(root, "managed trust")
    mkdirSync(knownHostsDirectory)
    const knownHosts = path.join(knownHostsDirectory, "known hosts")
    writeFileSync(knownHosts, "fixture\n", "utf8")
    const relayLog = path.join(root, "relay-ssh-args.log")
    const fakeSshPath = path.join(bin, "fake-ssh.cmd")
    const fakeKeygenPath = path.join(bin, "fake-keygen.cmd")
    writeFileSync(fakeSshPath, `@echo off
echo %*>>"%LAB_CONTROL_TEST_RELAY_LOG%"
if /I "%~1"=="-G" goto config
echo hostname=aegis
echo username=bs
echo docker=fixture
exit /b 0
:config
echo host aegis
echo user %LAB_CONTROL_TEST_RELAY_HOST%
echo hostname %LAB_CONTROL_TEST_RELAY_HOST%
echo port 22
echo identityfile C:/fixture/id_ed25519
echo userknownhostsfile %LAB_CONTROL_TEST_RELAY_KNOWN_HOSTS%
exit /b 0
`.replace("echo user %LAB_CONTROL_TEST_RELAY_HOST%", "echo user bs"), "utf8")
    writeFileSync(fakeKeygenPath, `@echo off
if /I "%~1"=="-F" (
  echo # Host fixture found
  echo fixture ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly
  if /I "%LAB_CONTROL_TEST_RELAY_REVOKED%"=="true" echo @revoked fixture ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly
  exit /b 0
)
echo 256 %LAB_CONTROL_TEST_RELAY_FINGERPRINT% %LAB_CONTROL_TEST_RELAY_KEY_COMMENT% ^(ED25519^)
exit /b 0
`, "utf8")
    const relayPath = path.join(root, "relay.ps1")
    writeFileSync(
      relayPath,
      encoded
        .replaceAll("ssh-keygen.exe", fakeKeygenPath.replaceAll("\\", "/"))
        .replaceAll("ssh.exe", fakeSshPath.replaceAll("\\", "/")),
      "utf8",
    )

    const result = spawnSync(
      pwsh,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", relayPath],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          LAB_CONTROL_TEST_RELAY_HOST: configuredHost,
          LAB_CONTROL_TEST_RELAY_KNOWN_HOSTS: knownHosts.replaceAll("\\", "/"),
          LAB_CONTROL_TEST_RELAY_FINGERPRINT: knownFingerprint,
          LAB_CONTROL_TEST_RELAY_KEY_COMMENT: keyComment,
          LAB_CONTROL_TEST_RELAY_REVOKED: String(revoked),
          LAB_CONTROL_TEST_RELAY_LOG: relayLog,
        },
        timeout: SPAWN_BUDGET_MS,
      },
    )
    assertCompleted(result, `resident relay ${_case}`)

    expect(result.status).toBe(expectedStatus)
    expect(`${result.stdout}\n${result.stderr}`).toContain(expectedText)
    if (expectedStatus === 0) {
      const actualInvocation = readFileSync(relayLog, "utf8").split(/\r?\n/).find((line) => line && !line.startsWith("-G "))!
      expect(actualInvocation).toContain("KnownHostsCommand=none")
      expect(actualInvocation).toContain("ControlPath=none")
    }
  })

  test.each(["lab-status", "lab-hermes", "lab-atlas", "lab-aegis", "lab-daedalus", "lab-containers", "lab-backups"])(
    "%s rejects invalid topology before starting SSH",
    (command) => {
      const root = mkdtempSync(path.join(tmpdir(), "lab-control-invalid-topology-"))
      tempRoots.push(root)
      const invalidTopology = path.join(root, "topology.json")
      writeFileSync(invalidTopology, "{}\n", "utf8")

      const result = runCommand(command, "healthy", { LAB_CONTROL_TOPOLOGY_PATH: invalidTopology })

      expect(result.status).toBe(2)
      expect(result.sshArgs).toBe("")
      expect(`${result.stdout}\n${result.stderr}`).toContain("TOPOLOGY_INVALID")
    },
  )

  test.each(["lab-status", "lab-hermes", "lab-atlas", "lab-aegis", "lab-daedalus", "lab-containers", "lab-backups"])(
    "%s fails closed when its installed module is missing",
    (command) => {
      const root = mkdtempSync(path.join(tmpdir(), "lab-control-broken-wrapper-"))
      tempRoots.push(root)
      const isolatedWrapper = path.join(root, `${command}.ps1`)
      writeFileSync(isolatedWrapper, readFileSync(path.join(scriptRoot, `${command}.ps1`), "utf8"), "utf8")

      const result = spawnSync(
        pwsh,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", isolatedWrapper],
        { cwd: root, encoding: "utf8", timeout: SPAWN_BUDGET_MS },
      )
      assertCompleted(result, `${command} missing-module failure`)

      expect(result.status).toBe(2)
      expect(result.stderr).toContain("LAB_CONTROL_FAILED")
    },
  )

  test("declares and documents the PowerShell version required by strict JSON parsing", () => {
    const moduleSource = readFileSync(path.join(scriptRoot, "LabControl.psm1"), "utf8")
    const installerSource = readFileSync(path.join(scriptRoot, "install-lab-control.ps1"), "utf8")
    const runbook = readFileSync(path.join(repoRoot, "docs", "runbooks", "omen-lab-control.md"), "utf8")

    expect(moduleSource).toMatch(/^#requires -Version 7\.5\r?\n/)
    expect(installerSource).toMatch(/^#requires -Version 7\.5\r?\n/)
    expect(runbook).toContain("PowerShell 7.5 or newer")
  })

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
    for (const command of ["lab-status", "lab-hermes", "lab-atlas", "lab-aegis", "lab-daedalus", "lab-containers", "lab-backups", "lab-ssh-config"]) {
      expect(readFileSync(path.join(root, `${command}.cmd`), "utf8")).toContain(`${command}.ps1`)
    }
    expect(JSON.parse(readFileSync(path.join(root, "lab-management-topology.v1.json"), "utf8"))).toMatchObject({
      contract: "williamos-lab-management-topology/1",
      controlNodeId: "omen",
    })
    expect(JSON.parse(readFileSync(path.join(root, "lab-management-topology.v1.schema.json"), "utf8"))).toMatchObject({
      title: "WilliamOS lab management topology v1",
    })
    expect(JSON.parse(readFileSync(path.join(root, "node-identity-contract.json"), "utf8"))).toMatchObject({
      contract: "williamos-node-identity/1",
    })
    const installedTopologyPath = path.join(root, "lab-management-topology.v1.json")
    const installedTopology = JSON.parse(readFileSync(installedTopologyPath, "utf8"))
    for (const route of installedTopology.managementRoutes) {
      route.evidence = {
        state: "VERIFIED",
        observedAt: new Date(Date.now() - MINUTE_MS).toISOString(),
        expiresAt: new Date(Date.now() + (6 * DAY_MS)).toISOString(),
      }
    }
    writeFileSync(installedTopologyPath, `${JSON.stringify(installedTopology, null, 2)}\n`, "utf8")
    const rendered = spawnSync(
      pwsh,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(root, "lab-ssh-config.ps1")],
      {
        cwd: parent,
        encoding: "utf8",
        env: { ...process.env, LAB_CONTROL_TOPOLOGY_NOW_UTC: "" },
        timeout: SPAWN_BUDGET_MS,
      },
    )
    assertCompleted(rendered, "installed lab-ssh-config")
    expect(rendered.status).toBe(0)
    expect(rendered.stdout).toContain("Host hermes")
    expect(rendered.stdout).toContain("RELAY daedalus")
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

  test("installer preflights every source before creating the destination", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "lab-control-missing-source-"))
    tempRoots.push(parent)
    const isolatedScriptRoot = path.join(parent, "source", "scripts", "lab-control")
    mkdirSync(isolatedScriptRoot, { recursive: true })
    const isolatedInstaller = path.join(isolatedScriptRoot, "install-lab-control.ps1")
    copyFileSync(path.join(scriptRoot, "install-lab-control.ps1"), isolatedInstaller)
    const root = path.join(parent, "destination", "Lab Control Bin")

    const result = spawnSync(
      pwsh,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        isolatedInstaller,
        "-InstallRoot",
        root,
        "-SkipUserPath",
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: SPAWN_BUDGET_MS },
    )
    assertCompleted(result, "install-lab-control missing-source preflight")

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Installation source is unavailable")
    expect(existsSync(root)).toBe(false)
  })

  test("forced staged installer swap preserves unmanaged files and leaves no transaction directories", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "lab-control-atomic-install-"))
    tempRoots.push(parent)
    const root = path.join(parent, "Lab Control Bin")
    const invokeInstaller = (force = false) => spawnSync(
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
        ...(force ? ["-Force"] : []),
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: SPAWN_BUDGET_MS },
    )

    assertCompleted(invokeInstaller(), "initial atomic install")
    writeFileSync(path.join(root, "owner-note.txt"), "preserve me", "utf8")
    writeFileSync(path.join(root, "LabControl.psm1"), "stale managed content", "utf8")
    const replaced = invokeInstaller(true)
    assertCompleted(replaced, "forced atomic install")

    expect(replaced.status).toBe(0)
    expect(readFileSync(path.join(root, "owner-note.txt"), "utf8")).toBe("preserve me")
    expect(readFileSync(path.join(root, "LabControl.psm1"), "utf8")).toBe(
      readFileSync(path.join(scriptRoot, "LabControl.psm1"), "utf8"),
    )
    expect(readdirSync(parent).filter((name) => /\.Lab Control Bin\.(?:stage|backup)\./.test(name))).toEqual([])
  })

  test("installer recovers an interrupted backup rename before staging the next transaction", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "lab-control-interrupted-install-"))
    tempRoots.push(parent)
    const root = path.join(parent, "Lab Control Bin")
    const orphanBackup = path.join(parent, ".Lab Control Bin.backup.11111111111111111111111111111111")
    mkdirSync(orphanBackup)
    writeFileSync(path.join(orphanBackup, "owner-note.txt"), "recover me", "utf8")

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
    assertCompleted(result, "interrupted install recovery")

    expect(result.status).toBe(0)
    expect(readFileSync(path.join(root, "owner-note.txt"), "utf8")).toBe("recover me")
    expect(existsSync(orphanBackup)).toBe(false)
  })

  test("installer refuses to replace a regular file used as the install root", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "lab-control-file-root-"))
    tempRoots.push(parent)
    const root = path.join(parent, "Lab Control Bin")
    writeFileSync(root, "owner file", "utf8")

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
        "-Force",
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: SPAWN_BUDGET_MS },
    )
    assertCompleted(result, "install-lab-control file-root refusal")

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("existing install root is not a directory")
    expect(readFileSync(root, "utf8")).toBe("owner file")
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
