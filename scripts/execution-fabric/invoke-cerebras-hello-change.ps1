# Fixed one-shot bridge for bounded WilliamOS applications. The owner request and source travel on
# stdin; the key comes from one exact Windows generic-credential target and reaches only one child.
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$credentialHelper = Join-Path $PSScriptRoot "cerebras-credential-manager.ps1"
$changeScript = Join-Path $PSScriptRoot "cerebras-hello-change.mjs"
$nodeExecutable = "C:\Program Files\nodejs\node.exe"

$secureKey = $null
$keyHandle = [IntPtr]::Zero
$plainKey = $null
$child = $null
try {
  if (-not [Environment]::UserInteractive) { throw "CEREBRAS_LOCAL_INTERACTION_REQUIRED" }
  $payload = [Console]::In.ReadToEnd()
  if ([Text.Encoding]::UTF8.GetByteCount($payload) -gt 800000) { throw "CEREBRAS_HELLO_INPUT_INVALID" }
  $parsed = $payload | ConvertFrom-Json
  $expectedProperties = if ($parsed.schemaVersion -eq 1) {
    @("files", "model", "requestText", "schemaVersion")
  } elseif ($parsed.schemaVersion -eq 2) {
    @("application", "files", "model", "requestText", "schemaVersion")
  } else {
    @()
  }
  $actualProperties = @($parsed.PSObject.Properties.Name | Sort-Object)
  if (
    $parsed -isnot [pscustomobject] -or
    $actualProperties.Count -ne $expectedProperties.Count -or
    (Compare-Object $actualProperties $expectedProperties -CaseSensitive) -or
    $parsed.schemaVersion -notin @(1, 2) -or
    $parsed.model -notin @("gpt-oss-120b", "qwen-3.8-27b")
  ) {
    throw "CEREBRAS_HELLO_INPUT_INVALID"
  }
  if ($parsed.schemaVersion -eq 2) {
    $applicationProperties = @($parsed.application.PSObject.Properties.Name | Sort-Object)
    $expectedApplicationProperties = @("displayName", "id", "manifestDigest", "writablePaths")
    $paths = @($parsed.application.writablePaths)
    $filePaths = @($parsed.files | ForEach-Object { $_.path })
    if (
      $parsed.application -isnot [pscustomobject] -or
      $applicationProperties.Count -ne $expectedApplicationProperties.Count -or
      (Compare-Object $applicationProperties $expectedApplicationProperties -CaseSensitive) -or
      $parsed.application.id -notmatch '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' -or
      $parsed.application.manifestDigest -notmatch '^[0-9a-f]{64}$' -or
      $paths.Count -ne 3 -or
      (@($paths | Select-Object -Unique)).Count -ne 3 -or
      $filePaths.Count -ne 3 -or
      (Compare-Object @($paths | Sort-Object) @($filePaths | Sort-Object) -CaseSensitive)
    ) {
      throw "CEREBRAS_APPLICATION_INPUT_INVALID"
    }
  }

  . $credentialHelper
  $secureKey = Get-CerebrasCredentialSecureString
  $keyHandle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyHandle)
  $env:CEREBRAS_API_KEY = $plainKey
  $env:WILLIAMOS_CEREBRAS_ENABLED = "true"

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodeExecutable
  $startInfo.Arguments = '"' + $changeScript + '"'
  $startInfo.WorkingDirectory = $PSScriptRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
  $startInfo.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
  $child = New-Object System.Diagnostics.Process
  $child.StartInfo = $startInfo
  if (-not $child.Start()) { throw "CEREBRAS_HELLO_CHILD_FAILED" }
  $stdoutTask = $child.StandardOutput.ReadToEndAsync()
  $stderrTask = $child.StandardError.ReadToEndAsync()
  $child.StandardInput.Write($payload)
  $child.StandardInput.Close()
  if (-not $child.WaitForExit(130000)) {
    try { $child.Kill() } catch { }
    throw "CEREBRAS_HELLO_TIMEOUT"
  }
  $stdout = $stdoutTask.Result
  $null = $stderrTask.Result
  if ([Text.Encoding]::UTF8.GetByteCount($stdout) -gt 512000) { throw "CEREBRAS_HELLO_RESPONSE_INVALID" }
  [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
  [Console]::Out.Write($stdout)
  exit $child.ExitCode
} finally {
  Remove-Item Env:CEREBRAS_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:WILLIAMOS_CEREBRAS_ENABLED -ErrorAction SilentlyContinue
  $plainKey = $null
  if ($keyHandle -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyHandle) }
  if ($null -ne $secureKey) { $secureKey.Dispose() }
  if ($null -ne $child) { $child.Dispose() }
}
