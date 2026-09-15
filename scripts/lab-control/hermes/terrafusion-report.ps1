<#
  TerraFusionMorningReport - daily program progress report across the active
  TerraFusion constellation (7 repos), reported from TRUE GitHub state
  (origin/main + PRs + CI), never from stale local clones.

  Doctrine:
   - READ-ONLY against GitHub (GET only). Never writes to any repo.
   - current-main-first: every fact is origin/main / live PR / live CI, not a working copy.
   - INV-4: an unreachable repo resolves to UNKNOWN, never to green.
   - proof-admissibility: main CI that is only skipped/neutral is NOT a pass.
   - Token is fetched at runtime from Git Credential Manager (GCM refreshes it);
     no secret is stored in this script or the report.

  Output: G:\HermesReports\terrafusion-morning-YYYYMMDD.md (+ -latest.md)
  Heartbeat: C:\HermesLab\hermes\terrafusion-report.heartbeat
#>

$ErrorActionPreference = 'Continue'
$HermesDir = 'C:\HermesLab\hermes'
$ReportDir = 'G:\HermesReports'
$Heartbeat = Join-Path $HermesDir 'terrafusion-report.heartbeat'
$TokenFile = Join-Path $HermesDir 'gh-token.bin'   # DPAPI-LocalMachine secret; used when GCM is unavailable (e.g. SYSTEM/S4U)
$Owner = 'bsvalues'
# The active constellation: integration authority + WO/runtime hub + 5 components (created 2026-07-20)
$Repos = @('terrafusion_os_1.0','terragroq','terrafusion-forge','terrafusion-atlas','terrafusion-dais','terrafusion-dossier','terrafusion-gpt')
$WOs = 1030..1036   # HERMES_APPLIANCE_V1 work orders live as terragroq issues
$now = Get-Date
$nowUtc = $now.ToUniversalTime()
function AgeDaysUtc($s){ try { [math]::Round(($nowUtc - ([datetimeoffset]$s).UtcDateTime).TotalDays,1) } catch { $null } }

function Safe([scriptblock]$b,$fb=$null){ try { & $b } catch { $fb } }
$problems = New-Object System.Collections.Generic.List[object]
function Add-Problem([string]$sev,[string]$msg){ $problems.Add([pscustomobject]@{Sev=$sev;Msg=$msg}) }
$L = New-Object System.Collections.Generic.List[string]; function W([string]$s=''){ $L.Add($s) }

# --- token: GCM first (works when bs is logged on), else machine-scope secret (works as SYSTEM/S4U) ---
$tok = Safe { $cf = @('protocol=https','host=github.com','') | & git credential fill 2>$null; (($cf | Where-Object { $_ -match '^password=' }) -replace 'password=') }
if (-not $tok) {
  $tok = Safe {
    if (Test-Path $TokenFile) {
      Add-Type -AssemblyName System.Security -ErrorAction Stop
      $b = [IO.File]::ReadAllBytes($TokenFile)
      ([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))).Trim()
    }
  }
}
if (-not $tok) {
  W "# TerraFusion Morning Report - UNKNOWN"; W ""; W "**$($now.ToString('dddd, yyyy-MM-dd HH:mm'))**"; W ""
  W "## Cannot report"; W "No GitHub token available from Git Credential Manager - the program state could not be read. (INV-4: reporting UNKNOWN rather than a false all-clear.)"
  Safe { if(-not(Test-Path $ReportDir)){New-Item -ItemType Directory -Path $ReportDir -Force|Out-Null} }
  $t = ($L -join "`r`n"); Safe { Set-Content (Join-Path $ReportDir ("terrafusion-morning-"+$now.ToString('yyyyMMdd')+".md")) $t -Encoding UTF8 }
  Safe { Set-Content (Join-Path $ReportDir 'terrafusion-morning-latest.md') $t -Encoding UTF8 }
  Safe { Set-Content $Heartbeat (([pscustomobject]@{ts=$now.ToString('o');verdict='UNKNOWN';note='no token'}|ConvertTo-Json -Compress)) -Encoding UTF8 }
  Write-Output "TerraFusion report: UNKNOWN (no token)"; exit
}
$H = @{ 'User-Agent'='hermes-lab'; 'Accept'='application/vnd.github+json'; 'Authorization'="Bearer $tok" }
function Gh($path){ Safe { Invoke-RestMethod "https://api.github.com/$path" -Headers $H -ErrorAction Stop } }

# --- per-repo scan ---------------------------------------------------------
$rows = New-Object System.Collections.Generic.List[string]
$totalOpenPR = 0
foreach ($n in $Repos) {
  $r = Gh "repos/$Owner/$n"
  if (-not $r) { $rows.Add("- **$n** - UNREACHABLE (token/permission/API)"); Add-Problem 'UNKNOWN' "$n unreachable"; continue }
  $branch = $r.default_branch
  $pushAgeD = AgeDaysUtc $r.pushed_at

  $prs = @(Gh "repos/$Owner/$n/pulls?state=open&per_page=100")
  $prCount = $prs.Count; $totalOpenPR += $prCount
  $drafts = @($prs | Where-Object { $_.draft }).Count

  $c = Gh "repos/$Owner/$n/commits/$branch"
  $mainAgeD = if ($c) { AgeDaysUtc $c.commit.author.date } else { $null }
  $msg = if ($c) { ($c.commit.message -split "`n")[0] } else { '?' }
  if ($msg.Length -gt 60) { $msg = $msg.Substring(0,57)+'...' }

  # CI on the head of main
  $ci = 'none'; $ciNote = ''
  if ($c) {
    $chk = Gh "repos/$Owner/$n/commits/$($c.sha)/check-runs"
    if ($chk -and $chk.total_count -gt 0) {
      $conc = @($chk.check_runs | ForEach-Object { $_.conclusion })
      $fail = @($chk.check_runs | Where-Object { $_.conclusion -in 'failure','timed_out','cancelled','startup_failure' })
      $real = @($conc | Where-Object { $_ -eq 'success' }).Count
      $soft = @($conc | Where-Object { $_ -in 'skipped','neutral',$null }).Count
      if ($fail.Count -gt 0) {
        $ci = "FAILING ($($fail.Count))"; $ciNote = "failing: " + ((@($fail | ForEach-Object { $_.name }) | Select-Object -Unique) -join ', ')
        Add-Problem 'FAIL' "$n main CI has $($fail.Count) failing check(s): $((@($fail|ForEach-Object{$_.name})|Select-Object -Unique) -join ', ')"
      } elseif ($real -eq 0 -and $soft -gt 0) {
        $ci = "SOFT-ONLY ($soft skipped/neutral)"; Add-Problem 'DEGRADED' "$n main CI is only skipped/neutral - no real proof (merge-gate gap)"
      } else {
        $ci = "green ($real ok$(if($soft){"/$soft soft"}))"
      }
    } else { $ci = 'no checks'; Add-Problem 'UNKNOWN' "$n main head has no CI checks" }
  } else { Add-Problem 'UNKNOWN' "$n main branch unreadable" }

  # staleness (components should track; hub repos push daily)
  if ($mainAgeD -ne $null -and $mainAgeD -gt 10) { Add-Problem 'DEGRADED' "$n main stale ${mainAgeD}d" }
  if ($prCount -gt 8) { Add-Problem 'DEGRADED' "$n has $prCount open PRs (pile-up)" }

  $prTxt = "$prCount open PR$(if($prCount -ne 1){'s'})$(if($drafts){" ($drafts draft)"})"
  $rows.Add(("- **{0}** ({1}) - main {2}d old, {3}, CI {4}" -f $n,$branch,$mainAgeD,$prTxt,$ci))
  $rows.Add(("    - last: `"{0}`"{1}" -f $msg, $(if($ciNote){"  |  $ciNote"}else{''})))
}

# --- WO tracker (terragroq issues #1030-1036) ------------------------------
$woRows = New-Object System.Collections.Generic.List[string]
$woOpen = 0; $woClosed = 0
foreach ($i in $WOs) {
  $iss = Gh "repos/$Owner/terragroq/issues/$i"
  if ($iss -and -not $iss.pull_request) {
    $st = $iss.state.ToUpper(); if ($st -eq 'OPEN'){$woOpen++} else {$woClosed++}
    $t = $iss.title; if ($t.Length -gt 64){$t=$t.Substring(0,61)+'...'}
    $woRows.Add(("- #{0} [{1}] {2}" -f $i,$st,$t))
  } elseif ($iss -and $iss.pull_request) {
    $woRows.Add(("- #{0} is a PR, not the WO issue" -f $i))
  } else { $woRows.Add(("- #{0} - not found / unreadable" -f $i)); Add-Problem 'UNKNOWN' "WO #$i unreadable" }
}

# --- verdict ---------------------------------------------------------------
$hasFail = ($problems | Where-Object Sev -eq 'FAIL').Count -gt 0
$hasDeg  = ($problems | Where-Object Sev -eq 'DEGRADED').Count -gt 0
$hasUnk  = ($problems | Where-Object Sev -eq 'UNKNOWN').Count -gt 0
$verdict = if ($hasFail) {'FAILED'} elseif ($hasDeg -or $hasUnk) {'DEGRADED'} else {'HEALTHY'}
$fails = @($problems | Where-Object Sev -eq 'FAIL' | ForEach-Object { $_.Msg })
$watch = @($problems | Where-Object Sev -in 'DEGRADED','UNKNOWN' | ForEach-Object { "$($_.Sev): $($_.Msg)" })

# --- assemble --------------------------------------------------------------
W "# TerraFusion Morning Report - $verdict"; W ""
W "**$($now.ToString('dddd, yyyy-MM-dd HH:mm'))**  |  source: live GitHub (origin/main, PRs, CI)  |  7 repos, $totalOpenPR open PRs"; W ""
if ($fails.Count) { W "## Action needed: YES"; foreach($f in $fails){ W "- **$f**" } }
elseif ($watch.Count) { W "## Action needed: not urgent - $($watch.Count) item(s) to watch" }
else { W "## Action needed: no - all 7 repos green on main, all sources read" }
W ""
W "## HERMES_APPLIANCE_V1 work orders (terragroq #1030-1036)"
W "$woClosed closed / $woOpen open"
$woRows | ForEach-Object { W $_ }
W ""
W "## Repos (live origin/main state)"
$rows | ForEach-Object { W $_ }
W ""
if ($watch.Count) { W "## Watch list"; foreach($d in $watch){ W "- $d" }; W "" }
W "## Reading notes"
W "- CI 'SOFT-ONLY' or 'no checks' = the merge-gate can be satisfied without a real proof (skipped/neutral counted as pass). Treat as unproven, not green."
W "- 'main Nd old' is the age of the newest commit on the default branch - the true integration line, not any local clone."
W ""
W "---"
W "_TerraFusionMorningReport - read-only GitHub GET - next run daily 07:35. Report: $ReportDir . Heartbeat: terrafusion-report.heartbeat._"

# --- write -----------------------------------------------------------------
Safe { if(-not(Test-Path $ReportDir)){New-Item -ItemType Directory -Path $ReportDir -Force|Out-Null} }
$text = ($L -join "`r`n")
Safe { Set-Content (Join-Path $ReportDir ("terrafusion-morning-"+$now.ToString('yyyyMMdd')+".md")) $text -Encoding UTF8 }
Safe { Set-Content (Join-Path $ReportDir 'terrafusion-morning-latest.md') $text -Encoding UTF8 }
$hb = [pscustomobject]@{ ts=$now.ToString('o'); verdict=$verdict; fails=$fails.Count; watch=$watch.Count; openPRs=$totalOpenPR; wo_open=$woOpen } | ConvertTo-Json -Compress
Safe { Set-Content $Heartbeat $hb -Encoding UTF8 }
Write-Output "TerraFusion report: $verdict ($($fails.Count) failing, $($watch.Count) watch, $totalOpenPR open PRs)"
