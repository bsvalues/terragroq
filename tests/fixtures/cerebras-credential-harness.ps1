[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$HelperPath)

$ErrorActionPreference = "Stop"

# Define the helper's native seam before dot-sourcing it. This deterministic fake
# verifies the exact target/type request and observes whether the production helper
# zeroes the returned blob before CredFree, without creating a persistent credential.
$nativeSource = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WilliamOsCredentialNative
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential
    {
        public UInt32 Flags;
        public UInt32 Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
    }

    [DllImport("kernel32.dll")]
    private static extern void SetLastError(UInt32 errorCode);

    private static string mode = "success";
    private static string secret = "";
    private static string userName = "CEREBRAS_API_KEY";
    private static IntPtr lastBlob = IntPtr.Zero;
    private static Int32 lastBlobSize = 0;

    public static string LastTarget = "";
    public static UInt32 LastType = 0;
    public static UInt32 LastFlags = 0;
    public static bool FreeCalled = false;
    public static bool BlobZeroedOnFree = false;

    public static void Configure(string nextMode, string nextSecret, string nextUserName)
    {
        mode = nextMode;
        secret = nextSecret ?? "";
        userName = nextUserName ?? "";
        LastTarget = "";
        LastType = 0;
        LastFlags = 0;
        FreeCalled = false;
        BlobZeroedOnFree = false;
        lastBlob = IntPtr.Zero;
        lastBlobSize = 0;
    }

    public static bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential)
    {
        LastTarget = target;
        LastType = type;
        LastFlags = flags;
        credential = IntPtr.Zero;
        if (mode == "missing")
        {
            SetLastError(1168);
            return false;
        }

        byte[] bytes = Encoding.Unicode.GetBytes(secret);
        lastBlobSize = bytes.Length;
        lastBlob = Marshal.AllocHGlobal(Math.Max(1, lastBlobSize));
        if (lastBlobSize > 0) Marshal.Copy(bytes, 0, lastBlob, lastBlobSize);

        Credential value = new Credential();
        value.Type = 1;
        value.TargetName = target;
        value.CredentialBlobSize = (UInt32)lastBlobSize;
        value.CredentialBlob = lastBlob;
        value.Persist = 1;
        value.UserName = userName;

        credential = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Credential)));
        Marshal.StructureToPtr(value, credential, false);
        return true;
    }

    public static void CredFree(IntPtr buffer)
    {
        FreeCalled = true;
        BlobZeroedOnFree = true;
        for (Int32 offset = 0; offset < lastBlobSize; offset++)
        {
            if (Marshal.ReadByte(lastBlob, offset) != 0) BlobZeroedOnFree = false;
        }
        if (lastBlob != IntPtr.Zero) Marshal.FreeHGlobal(lastBlob);
        lastBlob = IntPtr.Zero;
        lastBlobSize = 0;
        if (buffer != IntPtr.Zero)
        {
            Marshal.DestroyStructure(buffer, typeof(Credential));
            Marshal.FreeHGlobal(buffer);
        }
    }
}
"@

$null = Add-Type -TypeDefinition $nativeSource -Language CSharp
. $HelperPath

function Invoke-CredentialCase {
  param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Secret,
    [Parameter(Mandatory = $true)][string]$UserName
  )

  [WilliamOsCredentialNative]::Configure($Mode, $Secret, $UserName)
  try {
    $secure = Get-CerebrasCredentialSecureString
    try {
      return [ordered]@{
        status = "SUCCESS"
        length = $secure.Length
        readOnly = $secure.IsReadOnly()
        target = [WilliamOsCredentialNative]::LastTarget
        type = [WilliamOsCredentialNative]::LastType
        flags = [WilliamOsCredentialNative]::LastFlags
      }
    } finally {
      $secure.Dispose()
    }
  } catch {
    return [ordered]@{
      status = $_.Exception.Message
      target = [WilliamOsCredentialNative]::LastTarget
      type = [WilliamOsCredentialNative]::LastType
      flags = [WilliamOsCredentialNative]::LastFlags
    }
  } finally {
    $script:lastFreeCalled = [WilliamOsCredentialNative]::FreeCalled
    $script:lastBlobZeroed = [WilliamOsCredentialNative]::BlobZeroedOnFree
  }
}

$fixtureSecret = "fixture-secret-123"
$result = [ordered]@{}

$result.success = Invoke-CredentialCase -Mode "success" -Secret $fixtureSecret -UserName "CEREBRAS_API_KEY"
$result.success.freeCalled = $script:lastFreeCalled
$result.success.blobZeroed = $script:lastBlobZeroed

$result.wrongUserName = Invoke-CredentialCase -Mode "success" -Secret $fixtureSecret -UserName "WRONG_USER"
$result.wrongUserName.freeCalled = $script:lastFreeCalled
$result.wrongUserName.blobZeroed = $script:lastBlobZeroed

$result.invalidPayload = Invoke-CredentialCase -Mode "success" -Secret "fixture secret" -UserName "CEREBRAS_API_KEY"
$result.invalidPayload.freeCalled = $script:lastFreeCalled
$result.invalidPayload.blobZeroed = $script:lastBlobZeroed

$result.missing = Invoke-CredentialCase -Mode "missing" -Secret "" -UserName "CEREBRAS_API_KEY"
$result.missing.freeCalled = $script:lastFreeCalled
$result.missing.blobZeroed = $script:lastBlobZeroed

[pscustomobject]$result | ConvertTo-Json -Depth 5 -Compress
