# Keep /forge holding a current copy of every local model.
#
# FORGE is the lab's storage layer -- archives, models, datasets, backup copies -- and ATLAS is the
# node whose whole job is that durable state survives HERMES being rebuilt, reinstalled, or blown up
# during an experiment. HERMES is explicitly the box we are allowed to blow up, so its model store
# should be treated as a cache that can be recreated, not as the only copy.
#
# The live store deliberately stays local. Ollama reads weights from disk on every model load, and
# putting that on the far side of the network would make GPU inference depend on ATLAS being up --
# a coupling the role separation exists to avoid.
#
# Model blobs are content-addressed and immutable, so a sync is just "send the ones that are not
# there yet". Nothing is ever deleted on either side by this script.
#
# ---------------------------------------------------------------------------------------------
# WHAT THIS SCRIPT WAS ARCHIVING, AND WHY THAT WAS WORSE THAN NOT RUNNING
#
# It read `F:\HermesData\ollama`, and it ran green: the log records OK through 2026-08-23T04:30 with
# `local=12`. Two separate things then went wrong, and only the second one was ever visible.
#
#  1. `F:` stopped existing. The NVMe that carried it is now lettered `G:`, so from 2026-08-24 the
#     task failed outright -- loudly, which is the only mercy in this story.
#  2. Long before that, the store it was archiving had stopped being the store Ollama uses.
#     `G:\HermesData\ollama` (the old `F:`) is the container-era store: 12 blobs, 3 manifests. The
#     #997 native migration made `D:\HermesData\ollama` the live store, and it holds 21 blobs and 5
#     manifests. So every one of those green runs was faithfully archiving a stale copy while the
#     models actually being served went unprotected -- a sync that reports success and protects
#     nothing, which is the exact failure the 2026-08-18 backup recovery was supposed to have ended.
#
# The letter is repaired below, and so is the deeper fault: the store is now cross-checked against
# the Ollama service's own configuration on every run, and the script REFUSES rather than archives
# if the two disagree. Two owners of one path is drift; two owners tested against each other is
# drift with a tripwire on it.
# ---------------------------------------------------------------------------------------------
[CmdletBinding()]
param(
  # Resolve and cross-check the store, print what would be archived, then stop. No ssh, no scp,
  # nothing written on either side. This is what lets the repair be proven while ATLAS is down.
  [switch]$ResolveOnly,
  # The canonical Ollama service definition -- the file that actually decides which store is live.
  [string]$ServiceScript = "C:\HermesLab\hermes\ollama-service\hermes-ollama-service.ps1"
)

$ErrorActionPreference = "Stop"

$store   = "D:\HermesData\ollama"
$remote  = "/forge/models/ollama"
$atlas   = "bs@192.168.88.5"
$fabric  = "$env:USERPROFILE\.williamos\fabric"
$key     = "$fabric\keys\williamos-fabric"
$known   = "$fabric\known_hosts"
$logRoot = "C:\ProgramData\WilliamOS\logs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$log = Join-Path $logRoot "model-forge-sync.log"

# The store this script archives must be the store the runtime serves. The service script is the one
# place that decides it; this reads that decision rather than restating it.
#
# It fails closed in both directions. An unreadable service definition is not a licence to archive
# whatever `$store` happens to say -- that is precisely how a green run came to protect a stale copy
# -- so an absent or unparseable file refuses, and so does a disagreement.
function Assert-LiveStore {
  param([string]$Store, [string]$ServiceScript)
  if (-not (Test-Path -LiteralPath $ServiceScript -PathType Leaf)) {
    throw "SERVICE_CONFIG_UNREADABLE: $ServiceScript does not exist, so the live model store cannot be confirmed. Point -ServiceScript at the canonical Ollama service definition; do not archive an unverified store."
  }
  $line = Select-String -Path $ServiceScript -Pattern '^\s*\$ModelsDir\s*=\s*''([^'']+)''' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $line) {
    throw "SERVICE_CONFIG_UNREADABLE: $ServiceScript declares no `$ModelsDir, so the live model store cannot be confirmed."
  }
  $serviceModels = $line.Matches[0].Groups[1].Value.TrimEnd('\')
  $ourModels = (Join-Path $Store "models").TrimEnd('\')
  if ($serviceModels -ne $ourModels) {
    throw "MODEL_STORE_DISAGREEMENT: this script would archive '$ourModels' but the Ollama service serves '$serviceModels'. Archiving the store the runtime does not use is how a green sync comes to protect nothing."
  }
  return $serviceModels
}

# Native commands do not raise on failure, so every call is checked. Without this the script
# happily reported "copied 25 blobs" while ssh was rejecting the key and nothing was transferred --
# a sync that logs success while archiving nothing is worse than one that fails loudly.
function Invoke-Checked([string]$What, [scriptblock]$Action) {
  $out = & $Action 2>&1
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE): $out" }
  return $out
}

function Invoke-Atlas([string]$Command) {
  Invoke-Checked "ssh" { & ssh -i $key -o UserKnownHostsFile=$known -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=30 $atlas $Command }
}

$serviceModels = Assert-LiveStore -Store $store -ServiceScript $ServiceScript

if ($ResolveOnly) {
  $blobs = @(Get-ChildItem "$store\models\blobs" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "*-partial*" })
  [pscustomobject]@{
    store              = $store
    serviceModelsDir   = $serviceModels
    storeAgrees        = $true
    blobCount          = $blobs.Count
    blobBytes          = ($blobs | Measure-Object Length -Sum).Sum
    manifestCount      = @(Get-ChildItem "$store\models\manifests" -Recurse -File -ErrorAction SilentlyContinue).Count
    remote             = $remote
    atlas              = $atlas
  } | ConvertTo-Json -Compress
  exit 0
}

$stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
try {
  # Partial downloads are skipped: an interrupted pull is not a model, and copying a moving file
  # would archive something that never finishes existing.
  $local = Get-ChildItem "$store\models\blobs" -File -ErrorAction Stop | Where-Object { $_.Name -notlike "*-partial*" }
  $remoteNames = (Invoke-Atlas "sudo ls $remote/models/blobs 2>/dev/null") -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $missing = $local | Where-Object { $remoteNames -notcontains $_.Name }

  foreach ($blob in $missing) {
    Invoke-Checked "scp $($blob.Name)" { & scp -i $key -o UserKnownHostsFile=$known -o StrictHostKeyChecking=yes -o BatchMode=yes $blob.FullName "${atlas}:/tmp/$($blob.Name)" } | Out-Null
    Invoke-Atlas "sudo mv /tmp/$($blob.Name) $remote/models/blobs/$($blob.Name)"
  }

  # Manifests are small, mutable, and name which blobs make up which model, so they are refreshed
  # every run -- a blob without its manifest is unusable for restore.
  Invoke-Checked "scp manifests" { & scp -i $key -o UserKnownHostsFile=$known -o StrictHostKeyChecking=yes -o BatchMode=yes -r "$store\models\manifests" "${atlas}:/tmp/manifests-sync" } | Out-Null
  Invoke-Atlas "sudo rm -rf $remote/models/manifests && sudo mv /tmp/manifests-sync $remote/models/manifests"

  # Confirm from the far side, BY NAME rather than by count.
  #
  # The old check compared ATLAS's total blob count against ours and passed if it was not smaller.
  # ATLAS accumulates blobs from every store this script has ever pointed at, so that comparison
  # could -- and after the store correction demonstrably would -- report success with none of this
  # store's blobs present at all. A count is not a fact about our blobs; their names are.
  $afterNames = (Invoke-Atlas "sudo ls $remote/models/blobs 2>/dev/null") -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $stillMissing = $local | Where-Object { $afterNames -notcontains $_.Name }
  if ($stillMissing) {
    throw "archive incomplete: $($stillMissing.Count) of $($local.Count) blobs are not on ATLAS after the run ($(($stillMissing | Select-Object -First 3 | ForEach-Object { $_.Name }) -join ', '))"
  }
  "$stamp OK store=$store copied=$($missing.Count) local=$($local.Count) remote=$($afterNames.Count) verified=by-name" | Add-Content $log
  "copied $($missing.Count) new blob(s); ATLAS holds all $($local.Count) blob(s) of $store"
} catch {
  "$stamp FAIL $($_.Exception.Message)" | Add-Content $log
  throw
}
