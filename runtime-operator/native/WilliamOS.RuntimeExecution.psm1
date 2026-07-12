Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-BoundedProcess {
  param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [int]$TimeoutSeconds = 900, [int]$MaxOutputBytes = 1048576, [string]$StandardInput = "")
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $FilePath
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.RedirectStandardInput = $true
  foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
  foreach ($name in @("OPENAI_API_KEY", "GH_TOKEN", "GITHUB_TOKEN")) { $info.Environment.Remove($name) }
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
  if (-not $process.Start()) { throw "PROCESS_START_WALL" }
  if ($StandardInput) { $process.StandardInput.Write($StandardInput) }
  $process.StandardInput.Close()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) { $process.Kill($true); throw "PROCESS_TIMEOUT_WALL" }
  $stdout = $stdoutTask.Result; $stderr = $stderrTask.Result
  if ([Text.Encoding]::UTF8.GetByteCount($stdout) -gt $MaxOutputBytes -or [Text.Encoding]::UTF8.GetByteCount($stderr) -gt $MaxOutputBytes) { throw "PROCESS_OUTPUT_BUDGET_WALL" }
  return @{ exitCode = $process.ExitCode; stdout = $stdout; stderr = $stderr; pid = $process.Id }
}

function Assert-WilliamOSRepository([string]$RepositoryPath) {
  $remote = (Invoke-BoundedProcess git @("remote", "get-url", "origin") $RepositoryPath 30).stdout.Trim()
  if ($remote -notin @("git@github.com:bsvalues/terragroq.git", "https://github.com/bsvalues/terragroq.git")) { throw "REPOSITORY_ALLOWLIST_WALL" }
  $status = (Invoke-BoundedProcess git @("status", "--porcelain=v1", "--untracked-files=all") $RepositoryPath 30).stdout
  return @{ remote = "bsvalues/terragroq"; dirty = [bool]$status; statusClass = if ($status) { "USER_WORKTREE_DIRTY" } else { "CLEAN" } }
}

function New-WilliamOSWorktree([string]$RuntimeRoot, [string]$RepositoryPath, [string]$WorkOrder, [string]$BaseSha) {
  Assert-WilliamOSRepository $RepositoryPath | Out-Null
  if ($WorkOrder -notmatch '^WO-[A-Z0-9-]+$' -or $BaseSha -notmatch '^[a-f0-9]{40}$') { throw "WORKSPACE_IDENTITY_WALL" }
  $name = $WorkOrder.ToLowerInvariant()
  $path = Join-Path $RuntimeRoot "workspace\$name-$($BaseSha.Substring(0, 12))"
  if (Test-Path -LiteralPath $path) { throw "WORKSPACE_EXISTS_WALL" }
  $result = Invoke-BoundedProcess git @("worktree", "add", "--detach", $path, $BaseSha) $RepositoryPath 120
  if ($result.exitCode -ne 0) { throw "WORKTREE_CREATE_WALL" }
  return $path
}

function Get-WilliamOSIdempotencyKey([string]$Repository, [string]$WorkOrder, [string]$BaseSha) {
  $bytes = [Text.Encoding]::UTF8.GetBytes("$Repository|$WorkOrder|$BaseSha")
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Get-WilliamOSRetryDecision([string]$Category, [int]$Attempt, [int]$MaxAttempts = 2) {
  if ($Category -in @("authority", "authentication", "scope", "secret")) { return "NO_RETRY_TERMINAL" }
  if ($Attempt -ge $MaxAttempts) { return "NO_RETRY_EXHAUSTED" }
  return "RETRY_RECOVERABLE"
}

function Test-WilliamOSBudget([string]$BudgetPath, [hashtable]$Usage) {
  $budget = Get-Content -Raw -LiteralPath $BudgetPath | ConvertFrom-Json
  $checks = @(
    @("cyclesHour", "maxCyclesPerHour"), @("cyclesDay", "maxCyclesPerDay"),
    @("codexInvocations", "maxCodexInvocationsPerWorkOrder"), @("remediationAttempts", "maxRemediationAttempts"),
    @("elapsedMinutes", "maxElapsedMinutes"), @("changedFiles", "maxChangedFiles"), @("patchBytes", "maxPatchBytes")
  )
  foreach ($check in $checks) {
    if ($Usage.ContainsKey($check[0]) -and $Usage[$check[0]] -ge $budget.($check[1])) { return "BUDGET_EXHAUSTED_$($check[0].ToUpperInvariant())" }
  }
  return "BUDGET_AVAILABLE"
}

Export-ModuleMember -Function Invoke-BoundedProcess, Assert-WilliamOSRepository, New-WilliamOSWorktree, Get-WilliamOSIdempotencyKey, Get-WilliamOSRetryDecision, Test-WilliamOSBudget
