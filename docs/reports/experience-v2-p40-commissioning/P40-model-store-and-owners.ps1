# 997 HERMES P40 COMMISSIONING -- model-store ground truth and secondary owners. PREPARED, NOT RUN.
#
# Three sources disagree about where the Ollama model library lives: the owner's expectation and the
# live container's bind both say F:\HermesData\ollama, which Test-Path reports absent; the owning
# compose file says D:/HermesData/ollama, which exists. Reconciling the compose definition would move
# the mount, so the library has to be LOCATED before the GPU binding is touched -- a mount change
# smuggled inside a GPU change is exactly the service-preservation failure 997 fails closed on.
#
# Also enumerates the layers that might claim this service besides compose. Read-only throughout.
#
# Run through the broker: node P40-brokered.mjs hermes ownership-probe <base64-of-this-file> evidence/NN.json

$ErrorActionPreference='Continue'
Write-Output '--- VOLUMES-WIN ---'
Get-Volume | Select-Object DriveLetter,FileSystemLabel,FileSystem,SizeRemaining,Size | Format-Table -AutoSize | Out-String -Width 160
Write-Output '--- D-MANIFESTS ---'
if (Test-Path 'D:\HermesData\ollama\models\manifests') { Get-ChildItem 'D:\HermesData\ollama\models\manifests' -Recurse -File | ForEach-Object { $_.FullName.Substring(38) } } else { Write-Output 'NO-MANIFESTS-D' }
Write-Output '--- D-BLOBS ---'
if (Test-Path 'D:\HermesData\ollama\models\blobs') { $m=(Get-ChildItem 'D:\HermesData\ollama\models\blobs' -File | Measure-Object -Sum Length); Write-Output "count=$($m.Count) bytes=$($m.Sum)" } else { Write-Output 'NO-BLOBS-D' }
Write-Output '--- F-DRIVE ---'
if (Test-Path 'F:\') { Write-Output 'F-DRIVE-EXISTS'; Get-ChildItem 'F:\' -Force | Select-Object -ExpandProperty Name } else { Write-Output 'F-DRIVE-ABSENT' }
Write-Output '--- START-HERMES ---'
if (Test-Path 'C:\HermesLab\hermes\start-hermes.ps1') { (Get-FileHash 'C:\HermesLab\hermes\start-hermes.ps1' -Algorithm SHA256).Hash.ToLower(); Get-Content 'C:\HermesLab\hermes\start-hermes.ps1' -Raw } else { Write-Output 'ABSENT' }
Write-Output '--- OLLAMA-INSPECT-BEFORE ---'
if (Test-Path 'C:\HermesLab\hermes\ollama-inspect-before.json') { (Get-Item 'C:\HermesLab\hermes\ollama-inspect-before.json').LastWriteTimeUtc.ToString('o') } else { Write-Output 'ABSENT' }
Write-Output '--- SCHEDULED-TASKS ---'
Get-ScheduledTask | Where-Object { $_.TaskName -match 'ollama|hermes|docker|gpu|p40' } | Select-Object TaskName,TaskPath,State | Format-Table -AutoSize | Out-String -Width 160
Write-Output '--- SERVICES ---'
Get-Service | Where-Object { $_.Name -match 'ollama|hermes' } | Select-Object Name,Status,StartType | Format-Table -AutoSize | Out-String -Width 160
Write-Output '--- HOST-OLLAMA-PROC ---'
Get-Process | Where-Object { $_.ProcessName -match 'ollama' } | Select-Object Id,ProcessName,Path | Format-Table -AutoSize | Out-String -Width 160
Write-Output '--- ELEVATION ---'
Write-Output "IsAdmin=$(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"
Write-Output '--- RC ---'
