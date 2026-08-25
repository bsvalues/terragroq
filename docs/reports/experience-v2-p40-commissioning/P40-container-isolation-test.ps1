# 997 HERMES P40 COMMISSIONING -- container isolation test. PREPARED, NOT RUN.
#
# The decision point of this lane. Docker Desktop on Windows reaches GPUs through the WSL2 backend,
# which enumerates adapters via the WDDM stack; the P40 is in TCC. Whether a TCC device can be
# presented to a WSL2 container -- and whether its presence breaks enumeration for the WDDM card
# beside it -- is what T1..T4 answer, and it decides whether the compose edit is worth making.
#
# Every probe is --rm, publishes no port, mounts nothing, and reuses the ollama/ollama image that is
# ALREADY present locally, so nothing is pulled and the `ollama` container is not disturbed. The
# image is the one the service actually runs, so a pass here is a pass for the real runtime and not
# for a convenient stand-in.
#
# Run through the broker: node P40-brokered.mjs hermes probe <base64-of-this-file> evidence/NN.json

$ErrorActionPreference='Continue'
$P40='GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2'
$RTX='GPU-6d9ae165-7272-a38c-06b1-7276869e980f'
$IMG='ollama/ollama:latest'
Write-Output '--- WSL-DISTROS ---'
& wsl.exe --list --verbose 2>&1 | Out-String -Width 200
Write-Output '--- T1-ALL-GPUS ---'
& docker run --rm --gpus all --entrypoint nvidia-smi $IMG -L 2>&1
Write-Output "T1_RC=$LASTEXITCODE"
Write-Output '--- T2-RTX-ONLY ---'
& docker run --rm --gpus "`"device=$RTX`"" --entrypoint nvidia-smi $IMG -L 2>&1
Write-Output "T2_RC=$LASTEXITCODE"
Write-Output '--- T3-P40-ONLY ---'
& docker run --rm --gpus "`"device=$P40`"" --entrypoint nvidia-smi $IMG -L 2>&1
Write-Output "T3_RC=$LASTEXITCODE"
Write-Output '--- T4-P40-ENV ---'
& docker run --rm --runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=$P40 -e NVIDIA_DRIVER_CAPABILITIES=compute,utility --entrypoint nvidia-smi $IMG -L 2>&1
Write-Output "T4_RC=$LASTEXITCODE"
Write-Output '--- T5-NO-GPU ---'
& docker run --rm --entrypoint sh $IMG -c 'ls -l /dev/dxg 2>&1; echo dxg_rc=$?' 2>&1
Write-Output "T5_RC=$LASTEXITCODE"
Write-Output '--- RC ---'
