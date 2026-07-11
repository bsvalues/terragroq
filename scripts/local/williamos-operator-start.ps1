[CmdletBinding()]
param([string]$OperatorHome = "$env:USERPROFILE\.williamos\runtime-operator")
$env:WILLIAMOS_OPERATOR_HOME = $OperatorHome
docker compose -f "$PSScriptRoot\..\..\runtime-operator\compose.yaml" up -d --build
