$env:WILLIAMOS_OPERATOR_HOME = "$env:USERPROFILE\.williamos\runtime-operator"
Set-Content -NoNewline -Encoding ascii "$env:WILLIAMOS_OPERATOR_HOME\control\activation" "disabled"
docker compose -f "$PSScriptRoot\..\..\runtime-operator\compose.yaml" stop
