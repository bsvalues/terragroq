<#
  OMEN self-inventory - READ-ONLY classifier for WILLIAMOS_REMOTE_DEV_OFFLOAD_V1 cleanup.

  Scans OMEN's dev clutter and classifies each finding into exactly one bucket:
    KEEP_LOCAL | MOVE_AEGIS | MOVE_ATLAS | MOVE_HERMES | REPRODUCIBLE_DELETE | REVIEW
  Emits a machine-readable JSON report + a Markdown summary. It NEVER deletes, moves, or
  modifies anything (no Remove-Item / Move-Item anywhere). A human decides what to act on.

  Run on OMEN:
    pwsh -File scripts/omen-inventory.ps1 -OutDir docs/reports/omen-inventory
  then commit the produced report.
#>
[CmdletBinding()]
param(
  [string[]]$Roots = @($env:USERPROFILE, 'C:\dev', 'C:\src', 'C:\repos',
                       (Join-Path $env:USERPROFILE 'source'), (Join-Path $env:USERPROFILE 'repos'),
                       (Join-Path $env:USERPROFILE 'Documents'), 'D:\'),
  [string]$OutDir = '.',
  [int]$LargeFileMB = 500,
  [int]$MaxDepth = 6
)
$ErrorActionPreference = 'SilentlyContinue'
$findings = New-Object System.Collections.Generic.List[object]

function Add-Finding($path, $kind, $bucket, $bytes, $note) {
  $findings.Add([pscustomobject]@{
    path = "$path"; kind = $kind; bucket = $bucket
    size_mb = [math]::Round(($bytes/1MB), 1); note = $note
  })
}
function Dir-Bytes($p) {
  try { (Get-ChildItem -LiteralPath $p -Recurse -File -Force -EA SilentlyContinue |
         Measure-Object -Property Length -Sum).Sum } catch { 0 }
}
$roots = $Roots | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
Write-Host "Scanning roots: $($roots -join ', ')"

# ---- 1. Git repos: dirty(REVIEW) / duplicate(REVIEW) / clean-dev(MOVE_AEGIS) ----
$repoRemotes = @{}
foreach ($root in $roots) {
  $gitDirs = Get-ChildItem -LiteralPath $root -Directory -Recurse -Force -Depth $MaxDepth -Filter '.git' -EA SilentlyContinue
  foreach ($g in $gitDirs) {
    $repo = Split-Path $g.FullName -Parent
    $remote = (& git -C $repo config --get remote.origin.url 2>$null)
    $dirty  = (& git -C $repo status --porcelain 2>$null)
    $bytes  = Dir-Bytes $repo
    if ($remote) { if ($repoRemotes.ContainsKey($remote)) { $repoRemotes[$remote] += @($repo) } else { $repoRemotes[$remote] = @($repo) } }
    if ($dirty) {
      Add-Finding $repo 'git-repo(dirty)' 'REVIEW' $bytes 'uncommitted changes - do NOT delete; commit/push first'
    } elseif ($remote) {
      Add-Finding $repo 'git-repo(clean)' 'MOVE_AEGIS' $bytes "clean, remote=$remote - dev workspace belongs on AEGIS"
    } else {
      Add-Finding $repo 'git-repo(no-remote)' 'REVIEW' $bytes 'local-only repo, no remote - review before anything'
    }
    # worktrees
    $wts = (& git -C $repo worktree list --porcelain 2>$null) | Select-String '^worktree ' | ForEach-Object { $_.ToString().Substring(9) }
    foreach ($wt in $wts) { if ($wt -and ($wt -ne $repo)) { Add-Finding $wt 'git-worktree' 'REVIEW' (Dir-Bytes $wt) "worktree of $repo (possible Codex temp worktree)" } }
  }
}
foreach ($k in $repoRemotes.Keys) { if ($repoRemotes[$k].Count -gt 1) {
  foreach ($p in $repoRemotes[$k]) { Add-Finding $p 'duplicate-repo' 'REVIEW' (Dir-Bytes $p) "duplicate checkout of $k ($($repoRemotes[$k].Count) copies)" } } }

# ---- 2. Reproducible build/dep dirs ----
$reproNames = @{ 'node_modules'='node deps (reinstallable)'; '.next'='Next.js build output'; 'dist'='build output';
                 'build'='build output'; 'out'='build output'; '.turbo'='turbo cache'; '.cache'='cache';
                 '__pycache__'='python bytecode'; '.pytest_cache'='pytest cache'; '.mypy_cache'='mypy cache' }
foreach ($root in $roots) {
  foreach ($nm in $reproNames.Keys) {
    Get-ChildItem -LiteralPath $root -Directory -Recurse -Force -Depth $MaxDepth -Filter $nm -EA SilentlyContinue |
      ForEach-Object { Add-Finding $_.FullName "reproducible:$nm" 'REPRODUCIBLE_DELETE' (Dir-Bytes $_.FullName) $reproNames[$nm] }
  }
  # python venvs (pyvenv.cfg marker)
  Get-ChildItem -LiteralPath $root -File -Recurse -Force -Depth $MaxDepth -Filter 'pyvenv.cfg' -EA SilentlyContinue |
    ForEach-Object { $v = Split-Path $_.FullName -Parent; Add-Finding $v 'python-venv' 'REPRODUCIBLE_DELETE' (Dir-Bytes $v) 'venv - recreate from requirements' }
}

# ---- 3. Package caches ----
$caches = @{
  (Join-Path $env:APPDATA 'npm-cache')                 = 'npm cache';
  (Join-Path $env:LOCALAPPDATA 'pnpm-cache')           = 'pnpm cache';
  (Join-Path $env:USERPROFILE '.pnpm-store')           = 'pnpm store';
  (Join-Path $env:LOCALAPPDATA 'pip\cache')            = 'pip cache';
  (Join-Path $env:USERPROFILE '.cargo\registry\cache') = 'cargo cache';
  (Join-Path $env:LOCALAPPDATA 'Yarn\Cache')           = 'yarn cache'
}
foreach ($c in $caches.Keys) { if (Test-Path $c) { Add-Finding $c 'package-cache' 'REPRODUCIBLE_DELETE' (Dir-Bytes $c) $caches[$c] } }

# ---- 4. Docker (read-only `docker system df -v`) ----
if (Get-Command docker -EA SilentlyContinue) {
  $df = (& docker system df -v 2>$null) -join "`n"
  if ($df) { Add-Finding 'docker' 'docker-usage' 'REVIEW' 0 'see docker_system_df in report; build-cache + dangling images are REPRODUCIBLE_DELETE, tagged images/volumes REVIEW' }
} else { $df = '(docker not found)' }

# ---- 5. WSL VHDXs (large; canonical distro data -> REVIEW) ----
foreach ($base in @((Join-Path $env:LOCALAPPDATA 'Packages'), (Join-Path $env:LOCALAPPDATA 'Docker'))) {
  Get-ChildItem -LiteralPath $base -File -Recurse -Force -Depth 5 -EA SilentlyContinue |
    Where-Object { $_.Extension -eq '.vhdx' -and $_.Length -gt 100MB } |
    ForEach-Object { Add-Finding $_.FullName 'wsl-or-docker-vhdx' 'REVIEW' $_.Length 'VM disk - canonical distro/data; never delete without confirming the distro is retired' }
}

# ---- 6. State / model artifacts (ATLAS / HERMES hints) ----
foreach ($root in $roots) {
  Get-ChildItem -LiteralPath $root -File -Recurse -Force -Depth $MaxDepth -Include '*.db','*.sqlite','*.sqlite3','*.mdf' -EA SilentlyContinue |
    Where-Object { $_.Length -gt 50MB } | ForEach-Object { Add-Finding $_.FullName 'state-db' 'MOVE_ATLAS' $_.Length 'database/state belongs on ATLAS' }
  Get-ChildItem -LiteralPath $root -File -Recurse -Force -Depth $MaxDepth -Include '*.gguf','*.safetensors','*.bin' -EA SilentlyContinue |
    Where-Object { $_.Length -gt 200MB } | ForEach-Object { Add-Finding $_.FullName 'model-weights' 'MOVE_HERMES' $_.Length 'model weights belong on the HERMES AI runtime' }
  # large misc artifacts
  Get-ChildItem -LiteralPath $root -File -Recurse -Force -Depth $MaxDepth -EA SilentlyContinue |
    Where-Object { $_.Length -gt ($LargeFileMB*1MB) -and $_.Extension -notin '.gguf','.safetensors','.bin','.db','.sqlite','.vhdx' } |
    ForEach-Object { Add-Finding $_.FullName 'large-file' 'REVIEW' $_.Length "large artifact (> $LargeFileMB MB)" }
}

# ---- report ----
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$host_ = $env:COMPUTERNAME
$byBucket = $findings | Group-Object bucket | ForEach-Object {
  [pscustomobject]@{ bucket=$_.Name; items=$_.Count; total_mb=[math]::Round((($_.Group|Measure-Object size_mb -Sum).Sum),1) } } | Sort-Object total_mb -Descending
$report = [pscustomobject]@{
  host=$host_; generated_utc=(Get-Date).ToUniversalTime().ToString('u'); roots=$roots
  buckets=@('KEEP_LOCAL','MOVE_AEGIS','MOVE_ATLAS','MOVE_HERMES','REPRODUCIBLE_DELETE','REVIEW')
  summary=$byBucket; findings=($findings | Sort-Object size_mb -Descending); docker_system_df=$df
  note='READ-ONLY inventory. No file was deleted, moved, or modified. A human decides actions.'
}
$jsonPath = Join-Path $OutDir "omen-inventory-$host_-$stamp.json"
$mdPath   = Join-Path $OutDir "omen-inventory-$host_-$stamp.md"
$report | ConvertTo-Json -Depth 6 | Out-File $jsonPath -Encoding utf8
$md = New-Object System.Collections.Generic.List[string]
$md.Add("# OMEN inventory - $host_ ($stamp)"); $md.Add(""); $md.Add("READ-ONLY. No deletions."); $md.Add("")
$md.Add("## Totals by bucket"); $md.Add(""); $md.Add("| bucket | items | total MB |"); $md.Add("|---|---:|---:|")
$byBucket | ForEach-Object { $md.Add("| $($_.bucket) | $($_.items) | $($_.total_mb) |") }
$md.Add(""); $md.Add("## Largest 40 findings"); $md.Add(""); $md.Add("| size MB | bucket | kind | path |"); $md.Add("|---:|---|---|---|")
$findings | Sort-Object size_mb -Descending | Select-Object -First 40 | ForEach-Object { $md.Add("| $($_.size_mb) | $($_.bucket) | $($_.kind) | $($_.path) |") }
($md -join "`n") | Out-File $mdPath -Encoding utf8
Write-Host "OMEN_INVENTORY_DONE  json=$jsonPath  md=$mdPath  findings=$($findings.Count)"
