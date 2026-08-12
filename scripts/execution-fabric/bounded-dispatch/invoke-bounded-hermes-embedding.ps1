Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PythonExecutable = "C:\Python313\python.exe"
$DockerExecutable = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$HermesRoot = "C:\HermesLab"
$LedgerRoot = "C:\HermesLab\embedding-bakeoff-ledger"
$WorkRoot = "C:\HermesLab\work"
$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
$EvaluatorPath = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot "scripts\embedding-bakeoff\fabric_measure.py"))
$ModelsRoot = "D:\HermesData\ollama\models"
$ExecutionWorkRoot = $null
$ExecutionContainer = $null
$ExecutionNetwork = $null
$ExecutionContainerOwned = $false
$ExecutionNetworkOwned = $false

function Write-Receipt {
  param([hashtable]$Receipt)
  [Console]::Out.WriteLine(($Receipt | ConvertTo-Json -Compress))
}

function Stop-Closed {
  param([string]$ReasonCode, [int]$ExitCode = 2)
  Write-Receipt ([ordered]@{
    schema_version = "1.0-hermes-embedding-job-receipt"
    status = "FAILED_CLOSED"
    reason_code = $ReasonCode
    evaluator_exit_code = $null
    timed_out = $false
    job_assigned_before_resume = $false
    external_provider_used = $false
    fallback_used = $false
  })
  exit $ExitCode
}

function Get-RequiredEnvironment {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) { throw [InvalidOperationException]::new("ENVIRONMENT_INVALID") }
  return $value
}

function Get-BoundedUInt64 {
  param([string]$Name, [UInt64]$Minimum, [UInt64]$Maximum)
  $raw = Get-RequiredEnvironment $Name
  [UInt64]$value = 0
  if (-not [UInt64]::TryParse($raw, [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$value) -or $value -lt $Minimum -or $value -gt $Maximum) {
    throw [InvalidOperationException]::new("ENVIRONMENT_INVALID")
  }
  return $value
}

function Assert-NoReparsePoint {
  param([string]$Path, [bool]$LeafMustExist)
  $full = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($full)
  $relative = $full.Substring($root.Length)
  $current = $root
  $parts = $relative.Split([char[]]@('\'), [StringSplitOptions]::RemoveEmptyEntries)
  for ($index = 0; $index -lt $parts.Length; $index += 1) {
    $current = Join-Path $current $parts[$index]
    $mustExist = $index -lt ($parts.Length - 1) -or $LeafMustExist
    if ($mustExist) {
      if (-not [IO.File]::Exists($current) -and -not [IO.Directory]::Exists($current)) { throw [InvalidOperationException]::new("PATH_INVALID") }
      $attributes = [IO.File]::GetAttributes($current)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw [InvalidOperationException]::new("PATH_INVALID") }
    }
  }
}

function Assert-ExactChildPath {
  param([string]$Candidate, [string]$ExpectedRoot, [string]$NamePattern, [bool]$MustExist)
  if (-not [IO.Path]::IsPathRooted($Candidate)) { throw [InvalidOperationException]::new("PATH_INVALID") }
  $full = [IO.Path]::GetFullPath($Candidate)
  $parent = [IO.Path]::GetDirectoryName($full)
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals($parent, $ExpectedRoot)) { throw [InvalidOperationException]::new("PATH_INVALID") }
  if ([IO.Path]::GetFileName($full) -cnotmatch $NamePattern) { throw [InvalidOperationException]::new("PATH_INVALID") }
  if ($MustExist -ne [IO.File]::Exists($full)) { throw [InvalidOperationException]::new("PATH_INVALID") }
  Assert-NoReparsePoint $full $MustExist
  return $full
}

try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw [InvalidOperationException]::new("WINDOWS_REQUIRED") }
  if ($args.Count -ne 0) { throw [InvalidOperationException]::new("ARGUMENTS_FORBIDDEN") }

  $sealedInputPath = Assert-ExactChildPath (Get-RequiredEnvironment "HERMES_EMBEDDING_SEALED_INPUT_PATH") $LedgerRoot '^sealed-([a-f0-9]{64})\.json$' $true
  $resultPath = Assert-ExactChildPath (Get-RequiredEnvironment "HERMES_EMBEDDING_RESULT_PATH") $LedgerRoot '^result-([a-f0-9]{64})\.json$' $false
  if ([IO.Path]::GetFileName($sealedInputPath).Substring(7, 64) -cne [IO.Path]::GetFileName($resultPath).Substring(7, 64)) { throw [InvalidOperationException]::new("PATH_BINDING_MISMATCH") }
  [UInt64]$timeoutMs = Get-BoundedUInt64 "HERMES_EMBEDDING_TIMEOUT_MS" 1000 900000
  [UInt64]$maxInputBytes = Get-BoundedUInt64 "HERMES_EMBEDDING_MAX_INPUT_BYTES" 1 524288
  [UInt64]$maxResultBytes = Get-BoundedUInt64 "HERMES_EMBEDDING_MAX_RESULT_BYTES" 1 16777216
  [UInt64]$maxScratchBytes = Get-BoundedUInt64 "HERMES_EMBEDDING_MAX_SCRATCH_BYTES" 1 68719476736
  [UInt64]$maxCpuThreads = Get-BoundedUInt64 "HERMES_EMBEDDING_MAX_CPU_THREADS" 1 64
  [UInt64]$processMemoryBytes = Get-BoundedUInt64 "HERMES_EMBEDDING_PROCESS_MEMORY_BYTES" 67108864 68719476736
  [UInt64]$jobMemoryBytes = Get-BoundedUInt64 "HERMES_EMBEDDING_JOB_MEMORY_BYTES" 67108864 68719476736
  [UInt64]$cpuRatePercent = Get-BoundedUInt64 "HERMES_EMBEDDING_CPU_RATE_PERCENT" 1 100
  [UInt64]$activeProcessLimit = Get-BoundedUInt64 "HERMES_EMBEDDING_ACTIVE_PROCESS_LIMIT" 1 1
  $containerImageSha256 = Get-RequiredEnvironment "HERMES_EMBEDDING_CONTAINER_IMAGE_SHA256"
  if ($containerImageSha256 -cnotmatch '^[a-f0-9]{64}$') { throw [InvalidOperationException]::new("ENVIRONMENT_INVALID") }
  $affinityRaw = Get-RequiredEnvironment "HERMES_EMBEDDING_CPU_AFFINITY_MASK"
  if ($affinityRaw -cnotmatch '^0x[0-9A-Fa-f]{1,16}$') { throw [InvalidOperationException]::new("ENVIRONMENT_INVALID") }
  [UInt64]$cpuAffinityMask = [Convert]::ToUInt64($affinityRaw.Substring(2), 16)
  if ($cpuAffinityMask -eq 0) { throw [InvalidOperationException]::new("ENVIRONMENT_INVALID") }
  if ($jobMemoryBytes -lt $processMemoryBytes) { throw [InvalidOperationException]::new("ENVIRONMENT_INVALID") }

  Assert-NoReparsePoint $HermesRoot $true
  Assert-NoReparsePoint $LedgerRoot $true
  Assert-NoReparsePoint $WorkRoot $true
  $executionHash = [IO.Path]::GetFileName($sealedInputPath).Substring(7, 64)
  $ExecutionWorkRoot = Join-Path $WorkRoot "embedding-$executionHash"
  if ([IO.Directory]::Exists($ExecutionWorkRoot) -or [IO.File]::Exists($ExecutionWorkRoot)) { throw [InvalidOperationException]::new("WORK_ROOT_OCCUPIED") }
  [void][IO.Directory]::CreateDirectory($ExecutionWorkRoot)
  Assert-NoReparsePoint $ExecutionWorkRoot $true
  Assert-NoReparsePoint $PythonExecutable $true
  Assert-NoReparsePoint $DockerExecutable $true
  Assert-NoReparsePoint $EvaluatorPath $true
  Assert-NoReparsePoint $ModelsRoot $true
  $hermesPrefix = $HermesRoot.TrimEnd('\') + '\'
  if (-not $RepositoryRoot.StartsWith($hermesPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw [InvalidOperationException]::new("REPOSITORY_ROOT_INVALID") }
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals($EvaluatorPath, (Join-Path $RepositoryRoot "scripts\embedding-bakeoff\fabric_measure.py"))) { throw [InvalidOperationException]::new("EVALUATOR_PATH_INVALID") }
  $inputLength = ([IO.FileInfo]::new($sealedInputPath)).Length
  if ($inputLength -lt 1 -or [UInt64]$inputLength -gt $maxInputBytes) { throw [InvalidOperationException]::new("INPUT_SIZE_INVALID") }

  if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 11435 -State Listen -ErrorAction SilentlyContinue) { throw [InvalidOperationException]::new("LOOPBACK_PORT_OCCUPIED") }
  $ExecutionContainer = "williamos-r1b-$executionHash"
  $ExecutionNetwork = "williamos-r1b-$($executionHash.Substring(0, 24))"
  & $DockerExecutable container inspect $ExecutionContainer *> $null
  if ($LASTEXITCODE -eq 0) { throw [InvalidOperationException]::new("CONTAINER_NAME_OCCUPIED") }
  & $DockerExecutable network inspect $ExecutionNetwork *> $null
  if ($LASTEXITCODE -eq 0) { throw [InvalidOperationException]::new("NETWORK_NAME_OCCUPIED") }
  & $DockerExecutable network create --internal $ExecutionNetwork | Out-Null
  if ($LASTEXITCODE -ne 0) { throw [InvalidOperationException]::new("NETWORK_CREATE_FAILED") }
  $ExecutionNetworkOwned = $true
  $memoryLimit = "$($maxMemoryBytes)b"
  $containerId = (& $DockerExecutable run --detach --name $ExecutionContainer --label "williamos.execution-hash=$executionHash" --network $ExecutionNetwork --cpus ([string]$maxCpuThreads) --memory $memoryLimit --memory-swap $memoryLimit --pids-limit 64 --read-only --tmpfs '/root/.ollama:rw,noexec,nosuid,size=16777216' --mount "type=bind,source=$ModelsRoot,target=/root/.ollama/models,readonly" --env 'OLLAMA_HOST=0.0.0.0:11434' --env 'OLLAMA_KEEP_ALIVE=0' --publish '127.0.0.1:11435:11434' "sha256:$containerImageSha256").Trim()
  if ($LASTEXITCODE -ne 0 -or $containerId -cnotmatch '^[a-f0-9]{64}$') { throw [InvalidOperationException]::new("CONTAINER_START_FAILED") }
  $ExecutionContainerOwned = $true
  $container = (& $DockerExecutable inspect $ExecutionContainer | ConvertFrom-Json)[0]
  $resourceBindingFailed = $LASTEXITCODE -ne 0
  $resourceBindingFailed = $resourceBindingFailed -or [string]($container.Image) -cne "sha256:$containerImageSha256"
  $resourceBindingFailed = $resourceBindingFailed -or [int64]($container.HostConfig.Memory) -ne [int64]$maxMemoryBytes
  $resourceBindingFailed = $resourceBindingFailed -or [int64]($container.HostConfig.MemorySwap) -ne [int64]$maxMemoryBytes
  $resourceBindingFailed = $resourceBindingFailed -or [int64]($container.HostConfig.NanoCpus) -ne ([int64]$maxCpuThreads * 1000000000)
  $resourceBindingFailed = $resourceBindingFailed -or [int64]($container.HostConfig.PidsLimit) -ne 64
  $resourceBindingFailed = $resourceBindingFailed -or $container.HostConfig.ReadonlyRootfs -ne $true
  $resourceBindingFailed = $resourceBindingFailed -or @($container.HostConfig.DeviceRequests).Count -ne 0
  $resourceBindingFailed = $resourceBindingFailed -or [string]($container.HostConfig.NetworkMode) -cne $ExecutionNetwork
  $resourceBindingFailed = $resourceBindingFailed -or [string]($container.HostConfig.PortBindings.'11434/tcp'[0].HostIp) -cne '127.0.0.1'
  $resourceBindingFailed = $resourceBindingFailed -or [string]($container.HostConfig.PortBindings.'11434/tcp'[0].HostPort) -cne '11435'
  if ($resourceBindingFailed) { throw [InvalidOperationException]::new("CONTAINER_RESOURCE_BINDING_FAILED") }
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $version = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:11435/api/version' -TimeoutSec 2
      if ([string]$version.version -match '^\d+\.\d+\.\d+$') { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw [InvalidOperationException]::new("ISOLATED_OLLAMA_NOT_READY") }

  if (-not ("WilliamOS.ExecutionFabric.BoundedJob" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace WilliamOS.ExecutionFabric {
  public sealed class BoundedJobResult {
    public int ExitCode;
    public bool TimedOut;
    public bool OutputLimitExceeded;
    public bool ScratchLimitExceeded;
  }

  public static class BoundedJob {
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const uint HANDLE_FLAG_INHERIT = 0x00000001;
    const uint PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
    const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    const uint JOB_OBJECT_LIMIT_AFFINITY = 0x00000010;
    const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
    const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint JOB_OBJECT_CPU_RATE_CONTROL_ENABLE = 0x00000001;
    const uint JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP = 0x00000004;
    const uint WAIT_OBJECT_0 = 0x00000000;
    const uint WAIT_TIMEOUT = 0x00000102;
    const uint INFINITE = 0xffffffff;
    const uint GENERIC_READ = 0x80000000;
    const uint GENERIC_WRITE = 0x40000000;
    const uint CREATE_NEW = 1;
    const uint OPEN_EXISTING = 3;
    const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
    const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    const int JobObjectExtendedLimitInformation = 9;
    const int JobObjectCpuRateControlInformation = 15;

    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public uint dwX; public uint dwY; public uint dwXSize; public uint dwYSize; public uint dwXCountChars; public uint dwYCountChars; public uint dwFillAttribute; public uint dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount; public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_CPU_RATE_CONTROL_INFORMATION { public uint ControlFlags; public uint CpuRate; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileSizeEx(IntPtr file, out long size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessAffinityMask(IntPtr process, out UIntPtr processMask, out UIntPtr systemMask);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES security, uint disposition, uint flags, IntPtr template);

    static void Check(bool condition, string operation) { if (!condition) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    static void SetJobInfo<T>(IntPtr job, int informationClass, T value) where T : struct {
      int size = Marshal.SizeOf(typeof(T)); IntPtr buffer = Marshal.AllocHGlobal(size);
      try { Marshal.StructureToPtr(value, buffer, false); Check(SetInformationJobObject(job, informationClass, buffer, (uint)size), "SetInformationJobObject"); }
      finally { Marshal.FreeHGlobal(buffer); }
    }
    static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    static IntPtr EnvironmentBlock(string[] values) {
      Array.Sort(values, StringComparer.OrdinalIgnoreCase);
      return Marshal.StringToHGlobalUni(String.Join("\0", values) + "\0\0");
    }
    static SafeFileHandle Open(string path, uint access, uint disposition) {
      SECURITY_ATTRIBUTES security = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = true };
      SafeFileHandle handle = CreateFileW(path, access, 0, ref security, disposition, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
      Check(!handle.IsInvalid, "CreateFileW");
      Check(SetHandleInformation(handle.DangerousGetHandle(), HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT), "SetHandleInformation");
      return handle;
    }

    static ulong DirectoryBytes(string root) {
      ulong total = 0;
      foreach (string file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)) {
        checked { total += (ulong)new FileInfo(file).Length; }
      }
      return total;
    }

    public static BoundedJobResult Run(string python, string evaluator, string inputPath, string resultPath, string workingDirectory, string scratchRoot, uint timeoutMs, ulong maxResultBytes, ulong maxScratchBytes, ulong processMemoryBytes, ulong jobMemoryBytes, uint cpuRatePercent, ulong affinityMask, string[] environment) {
      if (IntPtr.Size == 4 && (processMemoryBytes > UInt32.MaxValue || jobMemoryBytes > UInt32.MaxValue || affinityMask > UInt32.MaxValue)) throw new InvalidOperationException("64-bit launcher required");
      UIntPtr available, system;
      Check(GetProcessAffinityMask(GetCurrentProcess(), out available, out system), "GetProcessAffinityMask");
      ulong availableMask = UIntPtr.Size == 8 ? available.ToUInt64() : available.ToUInt32();
      if (affinityMask == 0 || (affinityMask & ~availableMask) != 0) throw new InvalidOperationException("CPU affinity is outside the available process mask");

      IntPtr job = IntPtr.Zero, environmentBlock = IntPtr.Zero, attributeList = IntPtr.Zero, handleArray = IntPtr.Zero;
      PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION(); bool processCreated = false, attributeInitialized = false;
      using (SafeFileHandle input = Open(inputPath, GENERIC_READ, OPEN_EXISTING))
      using (SafeFileHandle output = Open(resultPath, GENERIC_WRITE, CREATE_NEW))
      using (SafeFileHandle error = Open("NUL", GENERIC_WRITE, OPEN_EXISTING)) {
        try {
          job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero, "CreateJobObject");
          JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
          limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_AFFINITY;
          limits.BasicLimitInformation.ActiveProcessLimit = 1;
          limits.BasicLimitInformation.Affinity = new UIntPtr(affinityMask);
          limits.ProcessMemoryLimit = new UIntPtr(processMemoryBytes);
          limits.JobMemoryLimit = new UIntPtr(jobMemoryBytes);
          SetJobInfo(job, JobObjectExtendedLimitInformation, limits);
          SetJobInfo(job, JobObjectCpuRateControlInformation, new JOBOBJECT_CPU_RATE_CONTROL_INFORMATION { ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP, CpuRate = cpuRatePercent * 100 });

          IntPtr attributeSize = IntPtr.Zero;
          InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
          attributeList = Marshal.AllocHGlobal(attributeSize); Check(InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize), "InitializeProcThreadAttributeList"); attributeInitialized = true;
          IntPtr[] handles = { input.DangerousGetHandle(), output.DangerousGetHandle(), error.DangerousGetHandle() };
          handleArray = Marshal.AllocHGlobal(IntPtr.Size * handles.Length); Marshal.Copy(handles, 0, handleArray, handles.Length);
          Check(UpdateProcThreadAttribute(attributeList, 0, new UIntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST), handleArray, new IntPtr(IntPtr.Size * handles.Length), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute");

          STARTUPINFOEX startup = new STARTUPINFOEX(); startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX)); startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES; startup.StartupInfo.hStdInput = handles[0]; startup.StartupInfo.hStdOutput = handles[1]; startup.StartupInfo.hStdError = handles[2]; startup.lpAttributeList = attributeList;
          environmentBlock = EnvironmentBlock(environment);
          StringBuilder command = new StringBuilder(Quote(python) + " " + Quote(evaluator));
          uint flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW;
          Check(CreateProcessW(python, command, IntPtr.Zero, IntPtr.Zero, true, flags, environmentBlock, workingDirectory, ref startup, out processInfo), "CreateProcessW"); processCreated = true;
          if (!AssignProcessToJobObject(job, processInfo.hProcess)) { TerminateProcess(processInfo.hProcess, 2); WaitForSingleObject(processInfo.hProcess, INFINITE); throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject"); }
          if (ResumeThread(processInfo.hThread) == UInt32.MaxValue) { TerminateJobObject(job, 2); WaitForSingleObject(processInfo.hProcess, INFINITE); throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread"); }
          Stopwatch elapsed = Stopwatch.StartNew(); uint wait;
          while (true) {
            uint remaining = elapsed.ElapsedMilliseconds >= timeoutMs ? 0 : timeoutMs - (uint)elapsed.ElapsedMilliseconds;
            wait = WaitForSingleObject(processInfo.hProcess, Math.Min(remaining, 50));
            long inputSize, resultSize; Check(GetFileSizeEx(input.DangerousGetHandle(), out inputSize), "GetFileSizeEx"); Check(GetFileSizeEx(output.DangerousGetHandle(), out resultSize), "GetFileSizeEx");
            if (resultSize < 0 || (ulong)resultSize > maxResultBytes) { Check(TerminateJobObject(job, 125), "TerminateJobObject"); WaitForSingleObject(processInfo.hProcess, INFINITE); return new BoundedJobResult { ExitCode = 125, OutputLimitExceeded = true }; }
            ulong retainedBytes; checked { retainedBytes = (ulong)inputSize + (ulong)resultSize + DirectoryBytes(scratchRoot); }
            if (retainedBytes > maxScratchBytes) { Check(TerminateJobObject(job, 126), "TerminateJobObject"); WaitForSingleObject(processInfo.hProcess, INFINITE); return new BoundedJobResult { ExitCode = 126, ScratchLimitExceeded = true }; }
            if (wait == WAIT_OBJECT_0) break;
            if (wait != WAIT_TIMEOUT) { TerminateJobObject(job, 2); throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject"); }
            if (elapsed.ElapsedMilliseconds >= timeoutMs) { Check(TerminateJobObject(job, 124), "TerminateJobObject"); WaitForSingleObject(processInfo.hProcess, INFINITE); return new BoundedJobResult { ExitCode = 124, TimedOut = true }; }
          }
          uint exitCode; Check(GetExitCodeProcess(processInfo.hProcess, out exitCode), "GetExitCodeProcess"); return new BoundedJobResult { ExitCode = unchecked((int)exitCode), TimedOut = false };
        } catch {
          if (processCreated) { TerminateJobObject(job, 2); WaitForSingleObject(processInfo.hProcess, INFINITE); }
          throw;
        } finally {
          if (processInfo.hThread != IntPtr.Zero) CloseHandle(processInfo.hThread);
          if (processInfo.hProcess != IntPtr.Zero) CloseHandle(processInfo.hProcess);
          if (job != IntPtr.Zero) CloseHandle(job);
          if (environmentBlock != IntPtr.Zero) Marshal.FreeHGlobal(environmentBlock);
          if (handleArray != IntPtr.Zero) Marshal.FreeHGlobal(handleArray);
          if (attributeInitialized) DeleteProcThreadAttributeList(attributeList);
          if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
        }
      }
    }
  }
}
'@
  }

  $childEnvironment = @(
    "SystemRoot=C:\WINDOWS",
    "WINDIR=C:\WINDOWS",
    "TEMP=$ExecutionWorkRoot",
    "TMP=$ExecutionWorkRoot",
    "PYTHONIOENCODING=utf-8",
    "PYTHONUTF8=1",
    "PYTHONNOUSERSITE=1",
    "PYTHONDONTWRITEBYTECODE=1",
    "NO_PROXY=127.0.0.1,localhost"
  )
  $run = [WilliamOS.ExecutionFabric.BoundedJob]::Run($PythonExecutable, $EvaluatorPath, $sealedInputPath, $resultPath, [IO.Path]::GetDirectoryName($EvaluatorPath), $ExecutionWorkRoot, [uint32]$timeoutMs, $maxResultBytes, $maxScratchBytes, $processMemoryBytes, $jobMemoryBytes, [uint32]$cpuRatePercent, $cpuAffinityMask, $childEnvironment)
  if (-not [IO.File]::Exists($resultPath)) { throw [InvalidOperationException]::new("RESULT_MISSING") }
  Assert-NoReparsePoint $resultPath $true
  $resultLength = ([IO.FileInfo]::new($resultPath)).Length
  if (-not $run.TimedOut -and -not $run.OutputLimitExceeded -and -not $run.ScratchLimitExceeded -and ($resultLength -lt 1 -or [UInt64]$resultLength -gt $maxResultBytes)) { throw [InvalidOperationException]::new("RESULT_SIZE_INVALID") }
  $resultSha256 = if ($resultLength -gt 0 -and [UInt64]$resultLength -le $maxResultBytes) { (Get-FileHash -LiteralPath $resultPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
  $status = if ($run.TimedOut) { "TIMED_OUT" } elseif ($run.OutputLimitExceeded -or $run.ScratchLimitExceeded) { "FAILED_CLOSED" } elseif ($run.ExitCode -eq 0) { "COMPLETED" } else { "FAILED_CLOSED" }
  & $DockerExecutable rm --force $ExecutionContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw [InvalidOperationException]::new("CONTAINER_CLEANUP_FAILED") }
  $ExecutionContainer = $null
  $ExecutionContainerOwned = $false
  & $DockerExecutable network rm $ExecutionNetwork | Out-Null
  if ($LASTEXITCODE -ne 0) { throw [InvalidOperationException]::new("NETWORK_CLEANUP_FAILED") }
  $ExecutionNetwork = $null
  $ExecutionNetworkOwned = $false
  Remove-Item -LiteralPath $ExecutionWorkRoot -Recurse -Force
  $ExecutionWorkRoot = $null
  Write-Receipt ([ordered]@{
    schema_version = "1.0-hermes-embedding-job-receipt"
    status = $status
    reason_code = if ($run.TimedOut) { "TIMEOUT" } elseif ($run.OutputLimitExceeded) { "RESULT_SIZE_LIMIT_EXCEEDED" } elseif ($run.ScratchLimitExceeded) { "SCRATCH_SIZE_LIMIT_EXCEEDED" } elseif ($run.ExitCode -eq 0) { $null } else { "EVALUATOR_FAILED" }
    evaluator_exit_code = $run.ExitCode
    timed_out = $run.TimedOut
    job_assigned_before_resume = $true
    active_process_limit = [int]$activeProcessLimit
    cpu_rate_percent = [int]$cpuRatePercent
    cpu_affinity_mask = ("0x{0:x}" -f $cpuAffinityMask)
    process_memory_bytes = $processMemoryBytes
    job_memory_bytes = $jobMemoryBytes
    isolated_ollama_container = $true
    internal_network = $true
    gpu_execution = "CPU_ONLY"
    container_cpu_threads = [int]$maxCpuThreads
    container_memory_bytes = $maxMemoryBytes
    container_pids_limit = 64
    container_cleaned = $true
    network_cleaned = $true
    result_bytes = $resultLength
    result_sha256 = $resultSha256
    external_provider_used = $false
    fallback_used = $false
  })
  if ($run.ExitCode -ne 0) { exit 2 }
} catch {
  if ($ExecutionContainerOwned -and $ExecutionContainer) {
    try { & $DockerExecutable rm --force $ExecutionContainer *> $null } catch { }
  }
  if ($ExecutionNetworkOwned -and $ExecutionNetwork) {
    try { & $DockerExecutable network rm $ExecutionNetwork *> $null } catch { }
  }
  if ($ExecutionWorkRoot -and [IO.Directory]::Exists($ExecutionWorkRoot)) {
    try { Remove-Item -LiteralPath $ExecutionWorkRoot -Recurse -Force } catch { }
  }
  $reason = [string]$_.Exception.Message
  if ($reason -cnotmatch '^[A-Z][A-Z0-9_]{2,63}$') { $reason = "LAUNCHER_INTERNAL_ERROR" }
  Stop-Closed $reason
}
