# Reads one named generic credential from the current Windows logon session.
# The credential blob is treated as UTF-16LE, copied directly into SecureString,
# zeroed in native memory, and never written to the pipeline.

if (-not ("WilliamOsCredentialNative" -as [type])) {
  $nativeSource = @"
using System;
using System.Runtime.InteropServices;

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

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredFree", SetLastError = false)]
    public static extern void CredFree(IntPtr buffer);
}
"@

  $null = Add-Type -TypeDefinition $nativeSource -Language CSharp
}

function Get-CerebrasCredentialSecureString {
  [CmdletBinding()]
  param()

  $credentialTarget = "WilliamOS/Cerebras/API-Key"
  $expectedUserName = "CEREBRAS_API_KEY"
  $credentialPointer = [IntPtr]::Zero
  $blobPointer = [IntPtr]::Zero
  $blobSize = 0
  $secure = $null

  try {
    if (-not [WilliamOsCredentialNative]::CredRead($credentialTarget, 1, 0, [ref]$credentialPointer)) {
      $nativeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($nativeError -eq 1168) { throw "CEREBRAS_CREDENTIAL_NOT_FOUND" }
      throw "CEREBRAS_CREDENTIAL_UNAVAILABLE"
    }

    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
      $credentialPointer,
      [type][WilliamOsCredentialNative+Credential]
    )
    $blobPointer = $credential.CredentialBlob
    $blobSize = [int]$credential.CredentialBlobSize

    if (
      $credential.Type -ne 1 -or
      $credential.UserName -cne $expectedUserName -or
      $blobPointer -eq [IntPtr]::Zero -or
      $blobSize -le 0 -or
      $blobSize -gt 2560 -or
      ($blobSize % 2) -ne 0
    ) {
      throw "CEREBRAS_CREDENTIAL_INVALID"
    }

    $secure = New-Object Security.SecureString
    for ($offset = 0; $offset -lt $blobSize; $offset += 2) {
      $character = [char][Runtime.InteropServices.Marshal]::ReadInt16($blobPointer, $offset)
      if (
        $character -eq [char]0 -or
        [char]::IsControl($character) -or
        [char]::IsWhiteSpace($character)
      ) {
        throw "CEREBRAS_CREDENTIAL_INVALID"
      }
      $secure.AppendChar($character)
    }
    $secure.MakeReadOnly()
    return $secure
  } catch {
    if ($null -ne $secure) { $secure.Dispose() }
    throw
  } finally {
    if ($blobPointer -ne [IntPtr]::Zero -and $blobSize -gt 0) {
      for ($offset = 0; $offset -lt $blobSize; $offset++) {
        [Runtime.InteropServices.Marshal]::WriteByte($blobPointer, $offset, 0)
      }
    }
    if ($credentialPointer -ne [IntPtr]::Zero) {
      [WilliamOsCredentialNative]::CredFree($credentialPointer)
    }
  }
}
