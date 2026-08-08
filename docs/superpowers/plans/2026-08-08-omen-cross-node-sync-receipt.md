# OMEN Cross-Node Sync Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an atomic, mirrored, SHA-256-verified cross-node sync receipt and make OMEN report `SYNC_OK`, `SYNC_FAILED`, `SYNC_STALE`, or `SYNC_NEVER_VERIFIED` truthfully.

**Architecture:** The Hermes scheduled script keeps its existing schedule, roots, transfer directions, and retention policy, but checks every native operation and verifies canonical source/destination manifests before publishing a success receipt. OMEN reads bounded receipt evidence from both nodes, classifies it locally with a strict allowlist and 30-hour freshness window, and accepts only `SYNC_OK` for overall exit `0`.

**Tech Stack:** Windows PowerShell 5.1 on Hermes, OpenSSH `ssh`/`scp`, POSIX shell and `sha256sum` on Atlas, PowerShell 7 on OMEN, TypeScript/Vitest contract tests, Git/GitHub PR `#529`.

## Global Constraints

- Stage 1 remains complete and frozen; this is `WO-OMEN-COCKPIT-SYNC-RECEIPT-001`.
- Keep the daily 04:00 schedule, source/destination roots, archive selection, 14-day retention, SSH identity, Docker topology, databases, backup creation, and storage architecture unchanged.
- Publish success only after both transfer directions, destination existence, byte-size equality, and SHA-256 equality pass.
- Any `ssh`, `scp`, manifest, verification, receipt-copy, or promotion failure exits nonzero and never replaces the prior success receipt.
- A valid success receipt is fresh for at most 30 hours; future, malformed, mismatched, or task-unbound evidence fails closed.
- Generated receipts stay outside Git and contain no credentials, private-key paths, raw stderr, commands, environment dumps, or absolute archive paths.
- Preserve unrelated Hermes `atlas/**` untracked files and every unrelated OMEN worktree change.
- PR `#529` remains draft until live completion evidence is attached.

---

### Task 1: Hermes verified receipt producer

**Files:**
- Create on Hermes: `C:\HermesLab\hermes\crossnode-sync-lib.ps1`
- Create on Hermes: `C:\HermesLab\hermes\test-crossnode-sync-receipt.ps1`
- Modify on Hermes: `C:\HermesLab\hermes\crossnode-sync.ps1`

**Interfaces:**
- Produces: `Invoke-CheckedNative -FilePath [string] -ArgumentList [string[]]` returning captured lines or throwing on nonzero exit.
- Produces: `Get-LocalArchiveManifest -Root [string]` returning ordered records `{ name, size, sha256 }`.
- Produces: `ConvertFrom-ArchiveManifestLines -Lines <string[]>` returning the same ordered record shape.
- Produces: `Assert-ArchiveManifestMatch -Expected [object[]] -Actual [object[]] -Direction [string]` returning the canonical manifest SHA-256 or throwing.
- Produces: `New-CrossNodeSyncReceipt -StartedAt <datetime> -CompletedAt <datetime> -Directions <object[]>` returning the approved schema as JSON.
- Produces: `Write-AtomicUtf8File -Path [string] -Content [string]` that replaces the target only after a same-directory temporary write succeeds.
- Consumes no OMEN code.

- [ ] **Step 1: Stage exact Hermes source files locally for patching**

Run from OMEN with a new task-specific staging directory under the workspace:

```powershell
New-Item -ItemType Directory -Force .\work\hermes-sync-receipt-staging | Out-Null
scp hermes:'C:/HermesLab/hermes/crossnode-sync.ps1' .\work\hermes-sync-receipt-staging\crossnode-sync.ps1
```

Expected: the staged script SHA-256 equals
`8F22BAF1B8CA1E97E5E97DA0AF69571271755983F771AE4DFBE731AFA1CD6EF0` before editing.

- [ ] **Step 2: Write the failing producer tests**

Create `test-crossnode-sync-receipt.ps1` with isolated temporary directories and these concrete assertions:

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\crossnode-sync-lib.ps1"

function Assert-Equal($Expected, $Actual, [string]$Message) {
    if ($Expected -ne $Actual) { throw "$Message expected=$Expected actual=$Actual" }
}
function Assert-Throws([scriptblock]$Action, [string]$Message) {
    try { & $Action; throw "Expected throw: $Message" } catch {
        if ($_.Exception.Message -eq "Expected throw: $Message") { throw }
    }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ("crossnode-receipt-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $source = Join-Path $root 'source'
    $dest = Join-Path $root 'dest'
    New-Item -ItemType Directory -Path $source,$dest | Out-Null
    [IO.File]::WriteAllText((Join-Path $source 'one.tar.gz'),'one')
    Copy-Item (Join-Path $source 'one.tar.gz') $dest
    $expected = Get-LocalArchiveManifest -Root $source
    $actual = Get-LocalArchiveManifest -Root $dest
    $manifestHash = Assert-ArchiveManifestMatch -Expected $expected -Actual $actual -Direction 'ATLAS_TO_HERMES'
    Assert-Equal 64 $manifestHash.Length 'manifest hash length'

    [IO.File]::WriteAllText((Join-Path $dest 'one.tar.gz'),'changed')
    Assert-Throws { Assert-ArchiveManifestMatch -Expected $expected -Actual (Get-LocalArchiveManifest -Root $dest) -Direction 'ATLAS_TO_HERMES' } 'hash mismatch fails'
    Assert-Throws { Assert-ArchiveManifestMatch -Expected @() -Actual @() -Direction 'ATLAS_TO_HERMES' } 'empty source fails'

    $receipt = New-CrossNodeSyncReceipt -StartedAt ([datetime]'2026-08-08T11:00:00Z') -CompletedAt ([datetime]'2026-08-08T11:00:25Z') -Directions @(
        [pscustomobject]@{ direction='ATLAS_TO_HERMES'; source='atlas'; destination='hermes'; file_count=3; manifest_sha256=('a' * 64) },
        [pscustomobject]@{ direction='HERMES_TO_ATLAS'; source='hermes'; destination='atlas'; file_count=5; manifest_sha256=('b' * 64) }
    )
    $parsed = $receipt | ConvertFrom-Json
    Assert-Equal 'SUCCESS' $parsed.result 'receipt result'
    Assert-Equal 'SHA256_PASS' $parsed.verification 'receipt verification'
    Assert-Equal 2 $parsed.directions.Count 'direction count'

    $target = Join-Path $root 'crossnode-sync-receipt.json'
    Write-AtomicUtf8File -Path $target -Content $receipt
    Assert-Equal $receipt ([IO.File]::ReadAllText($target)) 'atomic content'
    if (Get-ChildItem $root -Filter '*.tmp' -Recurse) { throw 'temporary file leaked' }
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
Write-Output 'PRODUCER_TESTS_PASS'
```

- [ ] **Step 3: Run the producer test to verify RED**

Run on the staged files:

```powershell
pwsh -NoProfile -File .\work\hermes-sync-receipt-staging\test-crossnode-sync-receipt.ps1
```

Expected: nonzero with `crossnode-sync-lib.ps1` missing. This is the required failing-test evidence.

- [ ] **Step 4: Implement the minimal producer library and checked main flow**

Implement the declared functions in `crossnode-sync-lib.ps1`. Canonicalize manifests as UTF-8 lines
`name|size|sha256` sorted with `[StringComparer]::Ordinal`, then hash those bytes with SHA-256. Reject
names containing path separators or `..`, duplicate names, nonpositive counts, and non-64-hex hashes.

Refactor `crossnode-sync.ps1` to:

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\crossnode-sync-lib.ps1"
$startedAt = [datetime]::UtcNow

# Keep the existing Atlas->Hermes scp, Hermes->Atlas scp loop, mkdir, and 14-day retention roots.
# Route every native command through Invoke-CheckedNative.
# Collect source and destination manifests after both copies.
# Assert both direction pairs and construct the two direction summaries.
# Serialize only the approved receipt fields.
# Upload Atlas .tmp, verify its SHA-256, atomically mv it, then atomically promote Hermes .tmp.
# Throw and exit nonzero before replacing the prior success receipt on any failure.
```

Use `try/catch` only at the outer boundary. Map native nonzero exits to
`CROSSNODE_SYNC_FAILED code=NATIVE_COMMAND_FAILED`, manifest differences to
`CROSSNODE_SYNC_FAILED code=MANIFEST_MISMATCH`, and receipt persistence errors to
`CROSSNODE_SYNC_FAILED code=RECEIPT_PERSIST_FAILED`; all exit `1`. Emit
`CROSSNODE_SYNC_SUCCESS receipt=D:\CrossNodeBackups\crossnode-sync-receipt.json` and exit `0` only
after both receipt copies are promoted.

- [ ] **Step 5: Run producer tests to verify GREEN**

```powershell
pwsh -NoProfile -File .\work\hermes-sync-receipt-staging\test-crossnode-sync-receipt.ps1
```

Expected: exit `0`, exactly `PRODUCER_TESTS_PASS`, and no temporary files remain.

- [ ] **Step 6: Deploy and commit only reserved Hermes files**

Before overwrite, recheck the remote source hash and Git status. Stop if the tracked script changed
from the discovered hash or if any reserved Hermes path has a foreign change. Then:

```powershell
scp .\work\hermes-sync-receipt-staging\crossnode-sync.ps1 hermes:'C:/HermesLab/hermes/crossnode-sync.ps1'
scp .\work\hermes-sync-receipt-staging\crossnode-sync-lib.ps1 hermes:'C:/HermesLab/hermes/crossnode-sync-lib.ps1'
scp .\work\hermes-sync-receipt-staging\test-crossnode-sync-receipt.ps1 hermes:'C:/HermesLab/hermes/test-crossnode-sync-receipt.ps1'
ssh hermes "powershell.exe -NoProfile -File C:\HermesLab\hermes\test-crossnode-sync-receipt.ps1"
ssh hermes "git -C C:\HermesLab add -- hermes/crossnode-sync.ps1 hermes/crossnode-sync-lib.ps1 hermes/test-crossnode-sync-receipt.ps1; git -C C:\HermesLab commit -m 'feat(backup): add verified sync receipts'"
```

Expected: producer tests pass and the local Hermes commit contains only the three reserved files.

---

### Task 2: OMEN strict receipt classifier

**Files:**
- Modify: `scripts/lab-control/LabControl.psm1`
- Modify: `tests/lab-control-cli.test.ts`

**Interfaces:**
- Consumes producer receipt schema version `1` and fixed receipt paths from Task 1.
- Produces: `Get-LabCrossSyncEvidence -HermesValues <IDictionary> -AtlasValues <IDictionary> -NowUtc <datetime>` returning `{ State, Detail, CompletedAtUtc }`.
- Produces exact states `SYNC_OK`, `SYNC_FAILED`, `SYNC_STALE`, `SYNC_NEVER_VERIFIED`.

- [ ] **Step 1: Write receipt fixtures and failing CLI tests**

In `tests/lab-control-cli.test.ts`, add deterministic `nowUtc = "2026-08-08T12:00:00Z"`, generate
compact receipt JSON/base64/SHA-256 in Node, make production-faithful Atlas output include only its
receipt hash, and add fixture modes `receipt-fresh`, `receipt-failed`, `receipt-stale`,
`receipt-missing`, and `receipt-malformed`.

Add these assertions:

```ts
test("fresh mirrored task-bound receipt is the only green sync state", () => {
  const result = runCommand("lab-status", "receipt-fresh")
  expect(result.status).toBe(0)
  expect(result.stdout).toContain("latest cross-node sync: SYNC_OK")
  expect(result.stdout).toContain("operator blocker: NONE")
})

test.each([
  ["receipt-failed", "SYNC_FAILED"],
  ["receipt-stale", "SYNC_STALE"],
  ["receipt-missing", "SYNC_NEVER_VERIFIED"],
  ["receipt-malformed", "SYNC_FAILED"],
] as const)("%s remains non-green as %s", (mode, state) => {
  const result = runCommand("lab-status", mode)
  expect(result.status).toBe(2)
  expect(result.stdout).toContain(`latest cross-node sync: ${state}`)
  expect(result.stdout).toContain("operator blocker: REQUIRED_EVIDENCE_INCOMPLETE")
  expect(result.stdout).not.toContain("operator blocker: NONE")
})
```

Also assert wrong schema, future completion, missing direction, zero file count, invalid hash, mirror
hash mismatch, and task/receipt start-time mismatch each classify `SYNC_FAILED`. Decode both remote
commands and assert fixed bounded read-only receipt paths with no `Set-Content`, `Out-File`, `mv`,
`rm`, or redirection write.

- [ ] **Step 2: Run focused tests to verify RED**

```powershell
pnpm exec vitest run tests/lab-control-cli.test.ts
```

Expected: the new receipt tests fail because the module still emits `UNVERIFIED_TASK_RESULT_0` and
accepts arbitrary non-denylisted strings.

- [ ] **Step 3: Implement strict receipt transport and classification**

Change the Hermes probe to emit:

```text
cross_sync_task_result=<decimal>
cross_sync_task_last_utc=<ISO-8601 UTC>
cross_sync_receipt_b64=<bounded base64 JSON or empty>
cross_sync_receipt_sha256=<64 lowercase hex or empty>
```

Read at most 65,536 bytes from `D:\CrossNodeBackups\crossnode-sync-receipt.json`. Change the Atlas
probe to emit `cross_sync_receipt_sha256` for
`/home/bs/from-hermes/crossnode-sync-receipt.json` using read-only `stat` and `sha256sum`.

Implement `Get-LabCrossSyncEvidence` as a pure function. It must parse base64/JSON without evaluation,
require the exact schema/task/result/verification/directions, require both receipt hashes to match,
require task result `0`, bind receipt `started_at` to task last-run time within five minutes, reject a
completion more than five minutes in the future, and apply the 30-hour freshness threshold. Set
`LAB_CONTROL_NOW_UTC` only as a focused-test clock override; production defaults to UTC now.

Replace the old denylist acceptance with:

```powershell
$syncEvidence = Get-LabCrossSyncEvidence -HermesValues $hermes.Values -AtlasValues $atlas.Values -NowUtc $nowUtc
$syncReady = $syncEvidence.State -eq 'SYNC_OK'
```

Use `$syncReady` in the overall gate and print the typed state plus completion detail. Make
`Invoke-LabBackups` call the same classifier.

- [ ] **Step 4: Run focused tests to verify GREEN**

```powershell
pnpm exec vitest run tests/lab-control-cli.test.ts
```

Expected: all focused tests pass, including fresh/stale/failed/never/malformed and remote-command
safety cases.

- [ ] **Step 5: Reinstall the managed OMEN commands and prove fixture behavior**

```powershell
pwsh -NoProfile -File .\scripts\lab-control\install-lab-control.ps1 -Force
```

Expected: only managed files under `%LOCALAPPDATA%\WilliamOS\LabControl\bin` change; user PATH remains
present once; no SSH config or credentials change.

- [ ] **Step 6: Commit the consumer slice**

```powershell
git add -- scripts/lab-control/LabControl.psm1 tests/lab-control-cli.test.ts
git diff --cached --check
git commit -m "feat(lab): verify cross-node sync receipts"
```

---

### Task 3: Follow-up evidence and operator documentation

**Files:**
- Create: `docs/reports/WO-OMEN-COCKPIT-SYNC-RECEIPT-001.md`
- Modify: `docs/runbooks/omen-lab-control.md`
- Do not modify: `docs/reports/WO-OMEN-COCKPIT-001-stage-1.md`

**Interfaces:**
- Consumes exact producer/consumer commits and live evidence from Tasks 1-2.
- Produces the auditable follow-up report attached to PR `#529` without reopening Stage 1.

- [ ] **Step 1: Write the follow-up report and runbook update**

Capture the exact commits with `git rev-parse HEAD` in each repository, then record the new Work Order
separately with literal values rather than templates. The completed report begins with:

```text
OMEN_COCKPIT_STAGE_1: COMPLETE_FROZEN
OMEN_COCKPIT_SYNC_RECEIPT_FOLLOWUP: COMPLETE
SYNC_STATE: SYNC_OK
OWNER_ACTION_REQUIRED: false
```

Add `HERMES_PRODUCER_COMMIT` and `OMEN_CONSUMER_COMMIT` lines using the captured 40-character hashes.
If live proof fails, do not commit a success report; record the exact typed blocker in the final handoff.

Document the fixed receipt paths, 30-hour threshold, four public states, exact exit behavior, atomic
write semantics, and the distinction between task result and verified receipt. Do not place generated
receipt content containing machine paths in Git.

- [ ] **Step 2: Run documentation and focused validation**

```powershell
pnpm exec vitest run tests/lab-control-cli.test.ts
git diff --check
```

Expected: focused tests pass and no whitespace errors exist.

- [ ] **Step 3: Commit documentation**

```powershell
git add -- docs/runbooks/omen-lab-control.md docs/reports/WO-OMEN-COCKPIT-SYNC-RECEIPT-001.md
git commit -m "docs(lab): record verified sync receipt follow-up"
```

---

### Task 4: Live scheduled-task proof and PR handoff

**Files:**
- Generated outside Git: `D:\CrossNodeBackups\crossnode-sync-receipt.json`
- Generated outside Git: `/home/bs/from-hermes/crossnode-sync-receipt.json`
- GitHub target: draft PR `#529`

**Interfaces:**
- Consumes deployed producer and installed consumer.
- Produces live `SYNC_OK` evidence and review-ready PR state.

- [ ] **Step 1: Run the existing scheduled task once and wait boundedly**

```powershell
ssh hermes "powershell.exe -NoProfile -Command Start-ScheduledTask -TaskName 'HermesCrossNodeBackupSync'"
```

Poll read-only at intervals no longer than 30 seconds for at most 20 minutes. Require task state to
return to `Ready` and capture `LastTaskResult`; do not launch a second instance.

- [ ] **Step 2: Verify live receipts independently**

Read both receipt copies, require identical SHA-256, parse the allowlisted schema, confirm two positive
direction counts, and independently recompute current source/destination archive manifests. Do not
print credentials, private key material, raw environment, or unrelated backup contents.

Expected: task result `0`, receipt hashes equal, both manifests equal, result `SUCCESS`, verification
`SHA256_PASS`.

- [ ] **Step 3: Prove installed cockpit success**

```powershell
lab-status
lab-backups
```

Expected: `latest cross-node sync: SYNC_OK`, `operator blocker: NONE`, and `lab-status` exit `0`.

- [ ] **Step 4: Run final repository verification**

```powershell
pnpm exec vitest run tests/lab-control-cli.test.ts
git diff --check
git status --short
```

Expected: focused tests pass, diff check passes, and the worktree is clean after intended commits.

- [ ] **Step 5: Independent review and bounded remediation**

Require an assurance agent to inspect the producer diff, consumer diff, tests, receipt samples,
freshness/task binding, secrets, exact changed paths, and live proof. Remediate every actionable
finding within the reserved files and rerun Tasks 1-4 verification.

- [ ] **Step 6: Push, attach evidence, and mark PR ready**

Push the OMEN branch, attach a concise PR `#529` comment containing exact commits, test counts, receipt
hash, task result, `lab-status` result, and owner-touch counters. Verify the PR head matches local HEAD
and completion evidence is visible. Then change PR `#529` from draft to ready for review as explicitly
authorized after successful evidence attachment. Do not merge.
