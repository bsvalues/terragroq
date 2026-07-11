$env:WILLIAMOS_OPERATOR_HOME = "$env:USERPROFILE\.williamos\runtime-operator"
docker compose -f "$PSScriptRoot\..\..\runtime-operator\compose.yaml" ps
docker compose -f "$PSScriptRoot\..\..\runtime-operator\compose.yaml" logs --tail 20 operator
