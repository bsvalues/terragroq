Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RuntimeRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime'
$RuntimeClosureManifest = 'C:\Program Files\WilliamOS\EmbeddingRuntime\runtime-closure.json'
$PythonExecutable = 'C:\Program Files\WilliamOS\EmbeddingRuntime\Python313\python.exe'
$SitePackagesRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime\Python313\Lib\site-packages'
$ModelRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime\models\granite-embedding-311m-multilingual-r2'
$LedgerRoot = 'C:\ProgramData\WilliamOS\EmbeddingBakeoff\granite-r2-ledger'
$WorkRoot = 'C:\ProgramData\WilliamOS\EmbeddingBakeoff\granite-r2-work'
$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$SourceRoot = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'scripts\embedding-bakeoff'))
$ExecutionWorkRoot = $null
$ReadLocks = [Collections.Generic.List[IO.FileStream]]::new()
$RuntimeLocks = [Collections.Generic.List[IO.FileStream]]::new()

$SourceFiles = [ordered]@{
  'fabric_measure.py' = 'HERMES_GRANITE_R2_EVALUATOR_SHA256'
  'bakeoff.py' = 'HERMES_GRANITE_R2_BAKEOFF_SHA256'
  'embed.py' = 'HERMES_GRANITE_R2_EMBED_SHA256'
  'metrics.py' = 'HERMES_GRANITE_R2_METRICS_SHA256'
  'granite_r2_onnx.py' = 'HERMES_GRANITE_R2_MODULE_SHA256'
}
$CorpusFiles = [ordered]@{
  'documents.jsonl' = 'HERMES_GRANITE_R2_DOCUMENTS_SHA256'
  'queries.jsonl' = 'HERMES_GRANITE_R2_QUERIES_SHA256'
  'manifest.json' = 'HERMES_GRANITE_R2_CORPUS_MANIFEST_SHA256'
}
$ModelArtifacts = @(
  [ordered]@{ path = 'onnx/model_quint8_avx2.onnx'; sha256 = 'f1fdd44e7e1ac51f12ab7957c7bd092e064d596c288513bf9d326842f669edee'; byte_length = [UInt64]313421909 },
  [ordered]@{ path = 'tokenizer.json'; sha256 = '0087c868b33bad550a78a08d19798cfd7f713cde4f020803b8f51f405503e15f'; byte_length = [UInt64]33384821 },
  [ordered]@{ path = 'tokenizer_config.json'; sha256 = '7947bdf0378520e69ca412b8c4dacd1cffa8aef099f851fdd5c65aa27c6b36a0'; byte_length = [UInt64]1155500 },
  [ordered]@{ path = 'config.json'; sha256 = 'e1e3fc842a8e0537e25d6e4c93879698b92ae96722e8c162bef334b57978a3b0'; byte_length = [UInt64]1191 },
  [ordered]@{ path = 'special_tokens_map.json'; sha256 = 'cb9e60dcf4d8d314315cb3e761fe4c2e664fda8dbf66d7815372b2639e381182'; byte_length = [UInt64]694 },
  [ordered]@{ path = '1_Pooling/config.json'; sha256 = '781299da695e58439d70d491840da22ea0935d1d57d9646eb9725f1f19754e89'; byte_length = [UInt64]313 },
  [ordered]@{ path = 'modules.json'; sha256 = '84e40c8e006c9b1d6c122e02cba9b02458120b5fb0c87b746c41e0207cf642cf'; byte_length = [UInt64]349 },
  [ordered]@{ path = 'config_sentence_transformers.json'; sha256 = 'f09adf93fcf868bb2fc3976a435d810b2ecdffa953d1da091d2a91168abab44b'; byte_length = [UInt64]283 },
  [ordered]@{ path = 'sentence_bert_config.json'; sha256 = '967ef958285e4a7a37d8ff1832473d967edd913b4e48572f31c3d3ea361d5327'; byte_length = [UInt64]60 }
)

function Write-Receipt([hashtable]$Receipt) { [Console]::Out.WriteLine(($Receipt | ConvertTo-Json -Compress -Depth 8)) }
function Stop-Closed([string]$ReasonCode, [int]$ExitCode = 2) {
  Write-Receipt ([ordered]@{ schema_version = '1.0-hermes-granite-r2-job-receipt'; status = 'FAILED_CLOSED'; reason_code = $ReasonCode; evaluator_exit_code = $null; timed_out = $false; job_assigned_before_resume = $false; network_used = $false; container_used = $false; external_provider_used = $false; fallback_used = $false; database_write_performed = $false; vector_write_performed = $false })
  exit $ExitCode
}
function Get-RequiredEnvironment([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ([string]::IsNullOrWhiteSpace($value)) { throw [InvalidOperationException]::new('ENVIRONMENT_INVALID') }
  return $value
}
function Get-BoundedUInt64([string]$Name, [UInt64]$Minimum, [UInt64]$Maximum) {
  [UInt64]$value = 0
  if (-not [UInt64]::TryParse((Get-RequiredEnvironment $Name), [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$value) -or $value -lt $Minimum -or $value -gt $Maximum) { throw [InvalidOperationException]::new('ENVIRONMENT_INVALID') }
  return $value
}
function Get-FileSha256([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try { $algorithm = [Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } finally { $algorithm.Dispose() } } finally { $stream.Dispose() }
}
function Assert-NoReparsePoint([string]$Path, [bool]$LeafMustExist = $true) {
  $full = [IO.Path]::GetFullPath($Path); $root = [IO.Path]::GetPathRoot($full); $current = $root
  $parts = $full.Substring($root.Length).Split([char[]]@('\'), [StringSplitOptions]::RemoveEmptyEntries)
  for ($index = 0; $index -lt $parts.Length; $index += 1) {
    $current = Join-Path $current $parts[$index]; $mustExist = $index -lt $parts.Length - 1 -or $LeafMustExist
    if ($mustExist -and -not [IO.File]::Exists($current) -and -not [IO.Directory]::Exists($current)) { throw [InvalidOperationException]::new('PATH_INVALID') }
    if ($mustExist -and (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw [InvalidOperationException]::new('REPARSE_POINT_FORBIDDEN') }
  }
}
function Assert-ExactChildPath([string]$Root, [string]$Path) {
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'; $pathFull = [IO.Path]::GetFullPath($Path)
  if (-not $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { throw [InvalidOperationException]::new('PATH_INVALID') }
}
function Assert-RuntimeAcl([string]$Path) {
  $systemSid = 'S-1-5-18'; $trustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'; $usersSid = 'S-1-5-32-545'; $administratorsSid = 'S-1-5-32-544'
  $acl = Get-Acl -LiteralPath $Path; $owner = ([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value
  if ($owner -cne $trustedInstallerSid) { throw [InvalidOperationException]::new('RUNTIME_ACL_OWNER_INVALID') }
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object AccessControlType -eq Allow)
  $writeRights = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($sid in @($systemSid, $trustedInstallerSid)) { if (@($rules | Where-Object { $_.IdentityReference.Value -ceq $sid -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl }).Count -lt 1) { throw [InvalidOperationException]::new('RUNTIME_ACL_MACHINE_INVALID') } }
  foreach ($sid in @($usersSid, $administratorsSid)) { $principal = @($rules | Where-Object { $_.IdentityReference.Value -ceq $sid }); if ($principal.Count -lt 1 -or @($principal | Where-Object { ($_.FileSystemRights -band $writeRights) -ne 0 }).Count -ne 0) { throw [InvalidOperationException]::new('RUNTIME_ACL_WRITE_INVALID') } }
  foreach ($rule in $rules) { if (@($systemSid, $trustedInstallerSid) -cnotcontains $rule.IdentityReference.Value -and ($rule.FileSystemRights -band $writeRights) -ne 0) { throw [InvalidOperationException]::new('RUNTIME_ACL_WRITE_INVALID') } }
}
function Lock-RuntimeClosure([string]$ExpectedManifestSha256) {
  Assert-NoReparsePoint $RuntimeRoot; Assert-NoReparsePoint $RuntimeClosureManifest
  $manifestBytes = [IO.File]::ReadAllBytes($RuntimeClosureManifest)
  if ((Get-FileSha256 $RuntimeClosureManifest) -cne $ExpectedManifestSha256) { throw [InvalidOperationException]::new('RUNTIME_CLOSURE_MANIFEST_DRIFT') }
  try { $manifest = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json } catch { throw [InvalidOperationException]::new('RUNTIME_CLOSURE_MANIFEST_INVALID') }
  if ((@($manifest.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'entries,root,schema_version' -or $manifest.schema_version -cne '1.0-williamos-embedding-runtime-closure' -or $manifest.root -cne $RuntimeRoot) { throw [InvalidOperationException]::new('RUNTIME_CLOSURE_MANIFEST_INVALID') }
  $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in @($manifest.entries)) {
    if ((@($entry.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'path,sha256,size_bytes' -or [string]$entry.path -cnotmatch '^(?!\.\.?($|\\))(?:[A-Za-z0-9_. -]+\\)*[A-Za-z0-9_. -]+$' -or [string]$entry.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw [InvalidOperationException]::new('RUNTIME_CLOSURE_ENTRY_INVALID') }
    $file = [IO.Path]::GetFullPath((Join-Path $RuntimeRoot ([string]$entry.path))); Assert-ExactChildPath $RuntimeRoot $file; Assert-NoReparsePoint $file; Assert-RuntimeAcl $file
    $lock = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ([UInt64]$lock.Length -ne [UInt64]$entry.size_bytes) { $lock.Dispose(); throw [InvalidOperationException]::new('RUNTIME_CLOSURE_SIZE_DRIFT') }
    $algorithm = [Security.Cryptography.SHA256]::Create(); try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($lock))).Replace('-', '').ToLowerInvariant() } finally { $algorithm.Dispose() }; $lock.Position = 0
    if ($hash -cne [string]$entry.sha256 -or -not $expected.Add($file)) { $lock.Dispose(); throw [InvalidOperationException]::new('RUNTIME_CLOSURE_HASH_DRIFT') }
    $RuntimeLocks.Add($lock)
  }
  if (-not $expected.Contains($PythonExecutable) -or -not $expected.Contains((Join-Path $SitePackagesRoot 'onnxruntime\__init__.py'))) { throw [InvalidOperationException]::new('RUNTIME_CLOSURE_FILE_SET_INVALID') }
  $actual = @(Get-ChildItem -LiteralPath $RuntimeRoot -File -Recurse -Force | Where-Object { -not [StringComparer]::OrdinalIgnoreCase.Equals($_.FullName, $RuntimeClosureManifest) })
  if ($actual.Count -ne $expected.Count -or @($actual | Where-Object { -not $expected.Contains($_.FullName) }).Count -ne 0) { throw [InvalidOperationException]::new('RUNTIME_CLOSURE_FILE_SET_INVALID') }
  Assert-RuntimeAcl $RuntimeRoot
}
function Copy-And-Lock([string]$Source, [string]$Destination, [string]$ExpectedSha256, [UInt64]$ExpectedBytes = 0) {
  Assert-NoReparsePoint $Source; [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Destination)); [IO.File]::Copy($Source, $Destination, $false); Assert-NoReparsePoint $Destination
  $lock = [IO.File]::Open($Destination, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  if (($ExpectedBytes -gt 0 -and [UInt64]$lock.Length -ne $ExpectedBytes)) { $lock.Dispose(); throw [InvalidOperationException]::new('SNAPSHOT_SIZE_DRIFT') }
  $algorithm = [Security.Cryptography.SHA256]::Create(); try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($lock))).Replace('-', '').ToLowerInvariant() } finally { $algorithm.Dispose() }; $lock.Position = 0
  if ($hash -cne $ExpectedSha256) { $lock.Dispose(); throw [InvalidOperationException]::new('SNAPSHOT_HASH_DRIFT') }; $ReadLocks.Add($lock)
}

if ($args.Count -ne 0) { Stop-Closed 'ARGUMENTS_FORBIDDEN' }
try {
  $sealedInputPath = Get-RequiredEnvironment 'HERMES_GRANITE_R2_SEALED_INPUT_PATH'; $sealedInputSha256 = Get-RequiredEnvironment 'HERMES_GRANITE_R2_SEALED_INPUT_SHA256'; $resultPath = Get-RequiredEnvironment 'HERMES_GRANITE_R2_RESULT_PATH'
  $timeoutMs = Get-BoundedUInt64 'HERMES_GRANITE_R2_TIMEOUT_MS' 1000 900000; $maxResultBytes = Get-BoundedUInt64 'HERMES_GRANITE_R2_MAX_RESULT_BYTES' 1 16777216; $maxScratchBytes = Get-BoundedUInt64 'HERMES_GRANITE_R2_MAX_SCRATCH_BYTES' 1 ([UInt64]::MaxValue)
  $maxCpuThreads = Get-BoundedUInt64 'HERMES_GRANITE_R2_MAX_CPU_THREADS' 1 64; $processMemoryBytes = Get-BoundedUInt64 'HERMES_GRANITE_R2_PROCESS_MEMORY_BYTES' 67108864 68719476736; $jobMemoryBytes = Get-BoundedUInt64 'HERMES_GRANITE_R2_JOB_MEMORY_BYTES' 67108864 68719476736
  $cpuRatePercent = Get-BoundedUInt64 'HERMES_GRANITE_R2_CPU_RATE_PERCENT' 1 100; $activeProcessLimit = Get-BoundedUInt64 'HERMES_GRANITE_R2_ACTIVE_PROCESS_LIMIT' 1 1; $closureManifestSha256 = Get-RequiredEnvironment 'HERMES_GRANITE_R2_CLOSURE_MANIFEST_SHA256'
  $modelId = Get-RequiredEnvironment 'HERMES_GRANITE_R2_MODEL_ID'; $revision = Get-RequiredEnvironment 'HERMES_GRANITE_R2_REVISION'; $dimension = Get-BoundedUInt64 'HERMES_GRANITE_R2_DIMENSION' 768 768; $backend = Get-RequiredEnvironment 'HERMES_GRANITE_R2_BACKEND'
  if ($sealedInputSha256 -cnotmatch '^[a-f0-9]{64}$' -or $closureManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or $modelId -cne 'ibm-granite/granite-embedding-311m-multilingual-r2' -or $revision -cne '44399559930365213510b1ee2eb15ded83374f0e' -or $backend -cne 'local-python-onnx-cls-v1') { throw [InvalidOperationException]::new('ENVIRONMENT_INVALID') }
  Assert-ExactChildPath $LedgerRoot $sealedInputPath; Assert-ExactChildPath $LedgerRoot $resultPath
  if ([IO.Path]::GetFileName($sealedInputPath) -cnotmatch '^sealed-([a-f0-9]{64})\.json$' -or [IO.Path]::GetFileName($resultPath) -cne "result-$($Matches[1]).json") { throw [InvalidOperationException]::new('PATH_INVALID') }
  $executionHash = $Matches[1]; Assert-NoReparsePoint $sealedInputPath; Assert-NoReparsePoint $resultPath $false; Assert-NoReparsePoint $PythonExecutable; Assert-NoReparsePoint $SitePackagesRoot; Assert-NoReparsePoint $ModelRoot
  Lock-RuntimeClosure $closureManifestSha256
  if ((Get-FileSha256 $PythonExecutable) -cne (Get-RequiredEnvironment 'HERMES_GRANITE_R2_PYTHON_SHA256')) { throw [InvalidOperationException]::new('PYTHON_DIGEST_DRIFT') }
  $ExecutionWorkRoot = Join-Path $WorkRoot $executionHash
  if ([IO.Directory]::Exists($ExecutionWorkRoot)) { throw [InvalidOperationException]::new('SCRATCH_COLLISION') }; [void][IO.Directory]::CreateDirectory($ExecutionWorkRoot); Assert-NoReparsePoint $ExecutionWorkRoot
  $snapshotSource = Join-Path $ExecutionWorkRoot 'source'; $snapshotCorpus = Join-Path $ExecutionWorkRoot 'corpus'; $snapshotModel = Join-Path $ExecutionWorkRoot 'model'
  foreach ($name in $SourceFiles.Keys) { Copy-And-Lock (Join-Path $SourceRoot $name) (Join-Path $snapshotSource $name) (Get-RequiredEnvironment $SourceFiles[$name]) }
  foreach ($name in $CorpusFiles.Keys) { Copy-And-Lock (Join-Path (Join-Path $SourceRoot 'corpus') $name) (Join-Path $snapshotCorpus $name) (Get-RequiredEnvironment $CorpusFiles[$name]) }
  foreach ($artifact in $ModelArtifacts) { Copy-And-Lock (Join-Path $ModelRoot ([string]$artifact.path).Replace('/', '\')) (Join-Path $snapshotModel ([string]$artifact.path).Replace('/', '\')) ([string]$artifact.sha256) ([UInt64]$artifact.byte_length) }
  if (@(Get-ChildItem -LiteralPath $snapshotSource -File -Recurse).Count -ne 5 -or @(Get-ChildItem -LiteralPath $snapshotCorpus -File -Recurse).Count -ne 3 -or @(Get-ChildItem -LiteralPath $snapshotModel -File -Recurse).Count -ne 9) { throw [InvalidOperationException]::new('SNAPSHOT_FILE_SET_INVALID') }
  $plannedBytes = [UInt64](Get-ChildItem -LiteralPath $ExecutionWorkRoot -File -Recurse | Measure-Object Length -Sum).Sum + [UInt64]([IO.FileInfo]::new($sealedInputPath)).Length + $maxResultBytes
  if ($plannedBytes -gt $maxScratchBytes) { throw [InvalidOperationException]::new('SCRATCH_SIZE_LIMIT_EXCEEDED') }
  $bootstrap = Join-Path $ExecutionWorkRoot 'granite_r2_evaluator.py'
  $bootstrapSource = @'
import json, os, site, sys, tempfile
site.addsitedir(os.environ["WILLIAMOS_GRANITE_R2_SITE_PACKAGES"])
sys.path.insert(0, os.environ["WILLIAMOS_GRANITE_R2_SOURCE"])
import bakeoff
from granite_r2_onnx import embed_texts as granite_embed_texts
def main():
    envelope=json.load(sys.stdin)
    if set(envelope)!={"schema_version","model","revision","dimension","backend","model_manifest","runtime_manifest","host_manifest","execution_limits"}: raise ValueError("envelope fields invalid")
    if envelope["schema_version"]!="1.0-r1b-granite-r2-measurement-envelope" or envelope["model"]!="ibm-granite/granite-embedding-311m-multilingual-r2" or envelope["revision"]!="44399559930365213510b1ee2eb15ded83374f0e" or envelope["dimension"]!=768 or envelope["backend"]!="local-python-onnx-cls-v1": raise ValueError("Granite identity invalid")
    original=bakeoff.embed_texts
    def fixed(texts, backend=None, base_url=None, model=None, api_key=None, batch_size=None, timeout=None, dim=None):
        if model!=envelope["model"]: raise ValueError("model substitution")
        return granite_embed_texts(os.environ["WILLIAMOS_GRANITE_R2_MODEL_ROOT"], texts, envelope["execution_limits"]["max_cpu_threads"])
    with tempfile.TemporaryDirectory(dir=os.environ["TEMP"]) as root:
        paths={}
        for name in ("model","runtime","host"):
            path=os.path.join(root,name+".json")
            with open(path,"w",encoding="utf-8",newline="\n") as handle: json.dump(envelope[name+"_manifest"],handle,sort_keys=True,separators=(",",":")); handle.write("\n")
            paths[name]=path
        try:
            bakeoff.embed_texts=fixed
            result=bakeoff.run(os.environ["WILLIAMOS_GRANITE_R2_CORPUS"],"endpoint",None,envelope["model"],None,8,768,model_manifest_path=paths["model"],runtime_manifest_path=paths["runtime"],host_manifest_path=paths["host"])
        finally: bakeoff.embed_texts=original
    json.dump(result,sys.stdout,sort_keys=True,separators=(",",":")); sys.stdout.write("\n")
if __name__=="__main__": main()
'@
  [IO.File]::WriteAllText($bootstrap, $bootstrapSource, [Text.UTF8Encoding]::new($false)); $bootstrapHash = Get-FileSha256 $bootstrap

  if (-not ('WilliamOS.ExecutionFabric.GraniteR2BoundedJob' -as [type])) {
    Add-Type -TypeDefinition @'
using System; using System.ComponentModel; using System.Diagnostics; using System.IO; using System.Runtime.InteropServices; using System.Security.Cryptography; using System.Text; using Microsoft.Win32.SafeHandles;
namespace WilliamOS.ExecutionFabric {
 public sealed class GraniteR2JobResult { public int ExitCode; public bool TimedOut; public bool OutputLimitExceeded; public bool ScratchLimitExceeded; }
 public static class GraniteR2BoundedJob {
  const uint CREATE_SUSPENDED=4,CREATE_UNICODE_ENVIRONMENT=0x400,EXTENDED_STARTUPINFO_PRESENT=0x80000,CREATE_NO_WINDOW=0x08000000,STARTF_USESTDHANDLES=0x100,PROC_THREAD_ATTRIBUTE_HANDLE_LIST=0x20002;
  const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS=8,JOB_OBJECT_LIMIT_AFFINITY=0x10,JOB_OBJECT_LIMIT_PROCESS_MEMORY=0x100,JOB_OBJECT_LIMIT_JOB_MEMORY=0x200,JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE=0x2000;
  const uint JOB_OBJECT_CPU_RATE_CONTROL_ENABLE=1,JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP=4,WAIT_OBJECT_0=0,WAIT_TIMEOUT=0x102,INFINITE=0xffffffff,GENERIC_WRITE=0x40000000,CREATE_NEW=1,OPEN_EXISTING=3,FILE_ATTRIBUTE_NORMAL=0x80,FILE_FLAG_OPEN_REPARSE_POINT=0x200000;
  const int JobObjectExtendedLimitInformation=9,JobObjectCpuRateControlInformation=15;
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved,lpDesktop,lpTitle; public uint dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags; public short wShowWindow,cbReserved2; public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess,hThread; public uint dwProcessId,dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a,b; public uint LimitFlags; public UIntPtr c,d; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)] struct CPU { public uint ControlFlags,CpuRate; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string n); [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int c,IntPtr i,uint l);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string a,StringBuilder c,IntPtr pa,IntPtr ta,bool ih,uint f,IntPtr e,string wd,ref STARTUPINFOEX s,out PROCESS_INFORMATION p);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p); [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr t); [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint m); [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr p,out uint e); [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr j,uint e); [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h); [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint m,uint f); [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr l,int c,uint f,ref IntPtr s); [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr l,uint f,UIntPtr a,IntPtr v,IntPtr s,IntPtr p,IntPtr r); [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr l); [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string n,uint a,uint s,ref SECURITY_ATTRIBUTES sa,uint d,uint f,IntPtr t);
  static void Check(bool c,string o){if(!c)throw new Win32Exception(Marshal.GetLastWin32Error(),o);} static void Set<T>(IntPtr j,int c,T v)where T:struct{int s=Marshal.SizeOf(typeof(T));IntPtr b=Marshal.AllocHGlobal(s);try{Marshal.StructureToPtr(v,b,false);Check(SetInformationJobObject(j,c,b,(uint)s),"SetInformationJobObject");}finally{Marshal.FreeHGlobal(b);}}
  static string Q(string v){return "\""+v.Replace("\"","\\\"")+"\"";} static IntPtr Env(string[] v){Array.Sort(v,StringComparer.OrdinalIgnoreCase);return Marshal.StringToHGlobalUni(String.Join("\0",v)+"\0\0");}
  static SafeFileHandle Open(string p,uint a,uint d){var sa=new SECURITY_ATTRIBUTES{nLength=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),bInheritHandle=true};var h=CreateFileW(p,a,0,ref sa,d,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,IntPtr.Zero);Check(!h.IsInvalid,"CreateFileW");Check(SetHandleInformation(h.DangerousGetHandle(),1,1),"SetHandleInformation");return h;}
  static ulong Bytes(string r){ulong t=0;foreach(string f in Directory.EnumerateFiles(r,"*",SearchOption.AllDirectories))checked{t+=(ulong)new FileInfo(f).Length;}return t;}
  public static GraniteR2JobResult Run(string python,string script,string inputPath,string inputHash,string resultPath,string wd,uint timeout,ulong resultMax,ulong scratchMax,ulong processMemory,ulong jobMemory,uint cpuRate,ulong affinity,string[] env){
   IntPtr job=IntPtr.Zero,eb=IntPtr.Zero,al=IntPtr.Zero,ha=IntPtr.Zero;var pi=new PROCESS_INFORMATION();bool created=false,initialized=false;
   using(var input=new FileStream(inputPath,FileMode.Open,FileAccess.Read,FileShare.None))using(var output=Open(resultPath,GENERIC_WRITE,CREATE_NEW))using(var error=Open("NUL",GENERIC_WRITE,OPEN_EXISTING))try{
    Check(SetHandleInformation(input.SafeFileHandle.DangerousGetHandle(),1,1),"SetHandleInformation");string hash;using(var s=SHA256.Create())hash=BitConverter.ToString(s.ComputeHash(input)).Replace("-","").ToLowerInvariant();input.Position=0;if(!StringComparer.Ordinal.Equals(hash,inputHash))throw new InvalidOperationException("SEALED_INPUT_DIGEST_MISMATCH");
    job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"CreateJobObject");var limits=new EXTENDED();limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_PROCESS_MEMORY|JOB_OBJECT_LIMIT_JOB_MEMORY|JOB_OBJECT_LIMIT_ACTIVE_PROCESS|JOB_OBJECT_LIMIT_AFFINITY;limits.BasicLimitInformation.ActiveProcessLimit=1;limits.BasicLimitInformation.Affinity=new UIntPtr(affinity);limits.ProcessMemoryLimit=new UIntPtr(processMemory);limits.JobMemoryLimit=new UIntPtr(jobMemory);Set(job,JobObjectExtendedLimitInformation,limits);Set(job,JobObjectCpuRateControlInformation,new CPU{ControlFlags=JOB_OBJECT_CPU_RATE_CONTROL_ENABLE|JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,CpuRate=cpuRate*100});
    IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);al=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(al,1,0,ref size),"InitializeProcThreadAttributeList");initialized=true;IntPtr[] handles={input.SafeFileHandle.DangerousGetHandle(),output.DangerousGetHandle(),error.DangerousGetHandle()};ha=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.Copy(handles,0,ha,3);Check(UpdateProcThreadAttribute(al,0,new UIntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST),ha,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"UpdateProcThreadAttribute");
    var si=new STARTUPINFOEX();si.StartupInfo.cb=Marshal.SizeOf(typeof(STARTUPINFOEX));si.StartupInfo.dwFlags=STARTF_USESTDHANDLES;si.StartupInfo.hStdInput=handles[0];si.StartupInfo.hStdOutput=handles[1];si.StartupInfo.hStdError=handles[2];si.lpAttributeList=al;eb=Env(env);var command=new StringBuilder(Q(python)+" -I -S "+Q(script));Check(CreateProcessW(python,command,IntPtr.Zero,IntPtr.Zero,true,CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT|CREATE_NO_WINDOW,eb,wd,ref si,out pi),"CreateProcessW");created=true;Check(AssignProcessToJobObject(job,pi.hProcess),"AssignProcessToJobObject");if(ResumeThread(pi.hThread)==UInt32.MaxValue)throw new Win32Exception(Marshal.GetLastWin32Error(),"ResumeThread");
    var watch=Stopwatch.StartNew();while(true){uint wait=WaitForSingleObject(pi.hProcess,50);long length=new FileInfo(resultPath).Length;if(length>0&&(ulong)length>resultMax){TerminateJobObject(job,125);WaitForSingleObject(pi.hProcess,INFINITE);return new GraniteR2JobResult{ExitCode=125,OutputLimitExceeded=true};}if(Bytes(wd)+(ulong)input.Length>scratchMax){TerminateJobObject(job,126);WaitForSingleObject(pi.hProcess,INFINITE);return new GraniteR2JobResult{ExitCode=126,ScratchLimitExceeded=true};}if(wait==WAIT_OBJECT_0)break;if(wait!=WAIT_TIMEOUT)throw new Win32Exception(Marshal.GetLastWin32Error(),"WaitForSingleObject");if(watch.ElapsedMilliseconds>=timeout){TerminateJobObject(job,124);WaitForSingleObject(pi.hProcess,INFINITE);return new GraniteR2JobResult{ExitCode=124,TimedOut=true};}}uint exit;Check(GetExitCodeProcess(pi.hProcess,out exit),"GetExitCodeProcess");return new GraniteR2JobResult{ExitCode=unchecked((int)exit)};
   }catch{if(created){TerminateJobObject(job,2);WaitForSingleObject(pi.hProcess,INFINITE);}throw;}finally{if(pi.hThread!=IntPtr.Zero)CloseHandle(pi.hThread);if(pi.hProcess!=IntPtr.Zero)CloseHandle(pi.hProcess);if(job!=IntPtr.Zero)CloseHandle(job);if(eb!=IntPtr.Zero)Marshal.FreeHGlobal(eb);if(ha!=IntPtr.Zero)Marshal.FreeHGlobal(ha);if(initialized)DeleteProcThreadAttributeList(al);if(al!=IntPtr.Zero)Marshal.FreeHGlobal(al);}
  }
 }
}
'@
  }
  $affinity = if ($maxCpuThreads -eq 64) { [UInt64]::MaxValue } else { ([UInt64]1 -shl [int]$maxCpuThreads) - 1 }
  $childEnvironment = @('SystemRoot=C:\WINDOWS','WINDIR=C:\WINDOWS',"TEMP=$ExecutionWorkRoot", "TMP=$ExecutionWorkRoot",'PYTHONIOENCODING=utf-8','PYTHONUTF8=1','PYTHONNOUSERSITE=1','PYTHONDONTWRITEBYTECODE=1',"WILLIAMOS_GRANITE_R2_SITE_PACKAGES=$SitePackagesRoot", "WILLIAMOS_GRANITE_R2_SOURCE=$snapshotSource", "WILLIAMOS_GRANITE_R2_CORPUS=$snapshotCorpus", "WILLIAMOS_GRANITE_R2_MODEL_ROOT=$snapshotModel",'NO_PROXY=*')
  $run = [WilliamOS.ExecutionFabric.GraniteR2BoundedJob]::Run($PythonExecutable, $bootstrap, $sealedInputPath, $sealedInputSha256, $resultPath, $ExecutionWorkRoot, [uint32]$timeoutMs, $maxResultBytes, $maxScratchBytes, $processMemoryBytes, $jobMemoryBytes, [uint32]$cpuRatePercent, $affinity, $childEnvironment)
  if (-not [IO.File]::Exists($resultPath)) { throw [InvalidOperationException]::new('RESULT_MISSING') }; $resultLength = [UInt64]([IO.FileInfo]::new($resultPath)).Length; $resultSha256 = if ($resultLength -gt 0 -and $resultLength -le $maxResultBytes) { Get-FileSha256 $resultPath } else { $null }
  $status = if ($run.TimedOut) { 'TIMED_OUT' } elseif ($run.OutputLimitExceeded -or $run.ScratchLimitExceeded -or $run.ExitCode -ne 0) { 'FAILED_CLOSED' } else { 'COMPLETED' }
  foreach ($lock in $ReadLocks) { $lock.Dispose() }; $ReadLocks.Clear(); foreach ($lock in $RuntimeLocks) { $lock.Dispose() }; $RuntimeLocks.Clear(); Remove-Item -LiteralPath $ExecutionWorkRoot -Recurse -Force; $ExecutionWorkRoot = $null
  Write-Receipt ([ordered]@{ schema_version = '1.0-hermes-granite-r2-job-receipt'; status = $status; reason_code = if ($status -eq 'COMPLETED') { $null } elseif ($run.TimedOut) { 'TIMEOUT' } elseif ($run.OutputLimitExceeded) { 'RESULT_SIZE_LIMIT_EXCEEDED' } elseif ($run.ScratchLimitExceeded) { 'SCRATCH_SIZE_LIMIT_EXCEEDED' } else { 'EVALUATOR_FAILED' }; evaluator_exit_code = $run.ExitCode; timed_out = $run.TimedOut; job_assigned_before_resume = $true; active_process_limit = [int]$activeProcessLimit; cpu_rate_percent = [int]$cpuRatePercent; process_memory_bytes = $processMemoryBytes; job_memory_bytes = $jobMemoryBytes; python_isolated = $true; site_packages_injected_after_dash_s = $true; runtime_closure_manifest_sha256 = $closureManifestSha256; runtime_closure_reverified = $true; model_file_count = 9; model_reverified = $true; source_file_count = 5; corpus_file_count = 3; bootstrap_sha256 = $bootstrapHash; scratch_cleaned = $true; result_bytes = $resultLength; result_sha256 = $resultSha256; network_used = $false; container_used = $false; external_provider_used = $false; fallback_used = $false; database_write_performed = $false; vector_write_performed = $false })
  if ($status -ne 'COMPLETED') { exit 2 }
} catch {
  foreach ($lock in $ReadLocks) { try { $lock.Dispose() } catch {} }; foreach ($lock in $RuntimeLocks) { try { $lock.Dispose() } catch {} }
  if ($ExecutionWorkRoot -and [IO.Directory]::Exists($ExecutionWorkRoot)) { try { Remove-Item -LiteralPath $ExecutionWorkRoot -Recurse -Force } catch {} }
  $reason = [string]$_.Exception.Message; if ($reason -cnotmatch '^[A-Z][A-Z0-9_]{2,63}$') { $reason = 'LAUNCHER_INTERNAL_ERROR' }; Stop-Closed $reason
}
