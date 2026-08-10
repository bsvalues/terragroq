#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly WORK_ORDER_ID="WO-TF-REMOTE-DEV-OFFLOAD-001"
readonly REPOSITORY="bsvalues/terrafusion_os_1.0"
readonly REMOTE_URL="git@github.com:bsvalues/terrafusion_os_1.0.git"
readonly LOGICAL_WORKSPACE="/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001"
readonly POLICY_SHA256="8e4d17071567ed1f43c01a02251a689d1879cfadcf90af92260267ebd668fd2c"
readonly OWNER_MARKER=".williamos-remote-dev-owner.json"
readonly MERGE_MARKER=".williamos-post-merge-proven"
readonly -a ALLOWED_OPERATIONS=(
  PROVE_PREFLIGHT CREATE_WORKSPACE APPLY_RESERVED_PATCH RESTORE_DOTNET
  TEST_WORKFLOW_CONTRACT TEST_DOTNET_INFORMATIONAL BUILD_DOTNET_RELEASE
  COMMIT_RESERVED_PATHS PUSH_AUTHORIZED_BRANCH PROVE_POST_MERGE CLEAN_EXACT_WORKSPACE
)
readonly -a RESERVED_PATHS=(
  ".github/workflows/dotnet-test.yml"
  ".github/workflows/terrafusion-ci.yml"
  "tests/ci-terrafusion-unit-informational.test.ts"
  "docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md"
)

json_status() {
  local status="$1" code="$2" detail="$3"
  STATUS_VALUE="$status" EXIT_VALUE="$code" DETAIL_VALUE="$detail" timeout 5 node -e '
    const clean=(process.env.DETAIL_VALUE||"").replace(/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+\S+)/gi,"[REDACTED]").slice(0,512)
    process.stdout.write(JSON.stringify({status:process.env.STATUS_VALUE,reasonCode:process.env.STATUS_VALUE,exitCode:Number(process.env.EXIT_VALUE),detail:clean})+"\n")
  '
}

die_input() { json_status "$1" 64 "$2"; exit 64; }
die_block() { json_status "$1" 2 "$2"; exit 2; }

if [[ $# -ne 5 ]]; then die_input "INVALID_INPUT" "expected operation, packet, patch, attempt, and previous evidence digest"; fi
OPERATION="$1"; PACKET_B64="$2"; PATCH_B64="$3"; ATTEMPT="$4"; PREVIOUS_EVIDENCE="$5"

operation_allowed=false
for candidate in "${ALLOWED_OPERATIONS[@]}"; do
  if [[ "$candidate" == "$OPERATION" ]]; then operation_allowed=true; break; fi
done
if [[ "$operation_allowed" != true ]]; then die_input "OPERATION_NOT_ALLOWED" "operation is outside the fixed allowlist"; fi
if [[ ! "$ATTEMPT" =~ ^[1-3]$ ]]; then die_input "ATTEMPT_INVALID" "attempt must be 1, 2, or 3"; fi
if [[ "$PREVIOUS_EVIDENCE" != "null" && ! "$PREVIOUS_EVIDENCE" =~ ^[a-f0-9]{64}$ ]]; then die_input "EVIDENCE_CHAIN_INVALID" "previous evidence digest is invalid"; fi
if [[ ! "$PACKET_B64" =~ ^[A-Za-z0-9+/]+={0,2}$ || ! "$PATCH_B64" =~ ^[A-Za-z0-9+/]*={0,2}$ ]]; then die_input "INVALID_INPUT" "payloads must be base64"; fi

TMP_ROOT="$(timeout 5 mktemp -d)" || die_block "WORKER_IO_FAILED" "cannot create private temporary directory"
cleanup_temp() { timeout 5 rm -rf -- "$TMP_ROOT" >/dev/null 2>&1 || true; }
trap cleanup_temp EXIT
PACKET_FILE="$TMP_ROOT/packet.json"
PATCH_FILE="$TMP_ROOT/change.patch"
META_FILE="$TMP_ROOT/meta.bin"
OUTPUT_FILE="$TMP_ROOT/output.log"

set +e
timeout 15 node -e '
  const crypto=require("node:crypto"),fs=require("node:fs")
  const [packetB64,patchB64,operation,attempt,packetFile,patchFile,metaFile]=process.argv.slice(1)
  const fail=(code,detail)=>{process.stderr.write(`${code}\t${detail}\n`);process.exit(65)}
  let bytes,patch,p
  try { bytes=Buffer.from(packetB64,"base64"); patch=Buffer.from(patchB64,"base64"); p=JSON.parse(bytes.toString("utf8")) } catch { fail("INVALID_INPUT","packet JSON is malformed") }
  const exact=(v,keys,label)=>{if(!v||typeof v!=="object"||Array.isArray(v)||JSON.stringify(Object.keys(v).sort())!==JSON.stringify([...keys].sort()))fail("INVALID_INPUT",`${label} fields differ`)}
  const canonical=v=>v===null?"null":typeof v==="string"?JSON.stringify(v):typeof v==="number"?(Number.isFinite(v)?JSON.stringify(v):fail("INVALID_INPUT","non-finite number")):typeof v==="boolean"?String(v):Array.isArray(v)?`[${v.map(canonical).join(",")}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
  const digest=v=>crypto.createHash("sha256").update(v).digest("hex")
  const expectedOps=["PROVE_PREFLIGHT","CREATE_WORKSPACE","APPLY_RESERVED_PATCH","RESTORE_DOTNET","TEST_WORKFLOW_CONTRACT","TEST_DOTNET_INFORMATIONAL","BUILD_DOTNET_RELEASE","COMMIT_RESERVED_PATHS","PUSH_AUTHORIZED_BRANCH","PROVE_POST_MERGE","CLEAN_EXACT_WORKSPACE"]
  const expectedPaths=[".github/workflows/dotnet-test.yml",".github/workflows/terrafusion-ci.yml","tests/ci-terrafusion-unit-informational.test.ts","docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md"]
  exact(p,["schemaVersion","runId","workOrderId","repository","baseRef","baseSha","branch","nodeId","workspace","transport","resourceLimits","operations","patch","authority","bindings"],"packet")
  if(p.workspace!=="/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001")fail("WORKSPACE_MISMATCH","logical workspace differs")
  if(p.workOrderId!=="WO-TF-REMOTE-DEV-OFFLOAD-001"||p.repository!=="bsvalues/terrafusion_os_1.0"||p.baseRef!=="refs/heads/main"||p.nodeId!=="aegis"||!/^codex\/wo-tf-remote-dev-offload-001-[a-z0-9-]+$/.test(p.branch)||!/^[a-f0-9]{40}$/.test(p.baseSha)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.runId))fail("IDENTITY_MISMATCH","immutable identity differs")
  exact(p.transport,["controller","relay","worker"],"transport")
  if(JSON.stringify(p.transport)!==JSON.stringify({controller:"omen",relay:"hermes",worker:"aegis"}))fail("TRANSPORT_MISMATCH","Hermes relay is mandatory")
  exact(p.resourceLimits,["cpuThreads","memoryBytes","scratchBytes","timeoutSeconds","maxAttempts"],"resourceLimits")
  const limits={cpuThreads:12,memoryBytes:12884901888,scratchBytes:85899345920,timeoutSeconds:5400,maxAttempts:3}
  if(JSON.stringify(p.resourceLimits)!==JSON.stringify(limits))fail("RESOURCE_LIMIT_EXCEEDED","resource envelope differs")
  if(JSON.stringify(p.operations)!==JSON.stringify(expectedOps)||!p.operations.includes(operation))fail("OPERATION_NOT_ALLOWED","operation set differs")
  exact(p.patch,["sha256","generation","changedPaths"],"patch")
  if(p.patch.generation!==1||JSON.stringify(p.patch.changedPaths)!==JSON.stringify(expectedPaths)||digest(patch)!==p.patch.sha256)fail("PATCH_BINDING_MISMATCH","patch bytes or reserved paths differ")
  exact(p.authority,["grantId","issuedAt","expiresAt","singleUse"],"authority")
  const issued=Date.parse(p.authority.issuedAt),expires=Date.parse(p.authority.expiresAt),now=Date.now()
  if(p.authority.grantId!=="grant-remote-dev-offload-v1"||p.authority.singleUse!==true||!Number.isFinite(issued)||!Number.isFinite(expires)||issued>=now||expires<=now||expires-issued>14400000)fail("AUTHORITY_INVALID","grant is invalid or expired")
  exact(p.bindings,["policySha256","packetSha256"],"bindings")
  if(p.bindings.policySha256!=="8e4d17071567ed1f43c01a02251a689d1879cfadcf90af92260267ebd668fd2c")fail("POLICY_DIGEST_MISMATCH","policy digest differs")
  const unsigned=structuredClone(p);delete unsigned.bindings
  if(p.bindings.packetSha256!==digest(Buffer.from(canonical(unsigned),"utf8")))fail("PACKET_DIGEST_MISMATCH","packet digest differs")
  fs.writeFileSync(packetFile,bytes,{mode:0o600});fs.writeFileSync(patchFile,patch,{mode:0o600})
  const fields=[p.runId,p.workOrderId,p.repository,p.baseSha,p.branch,p.workspace,p.patch.sha256,p.bindings.policySha256,p.bindings.packetSha256,String(p.patch.generation),String(p.resourceLimits.timeoutSeconds)]
  fs.writeFileSync(metaFile,Buffer.from(fields.join("\0")+"\0"),{mode:0o600})
' "$PACKET_B64" "$PATCH_B64" "$OPERATION" "$ATTEMPT" "$PACKET_FILE" "$PATCH_FILE" "$META_FILE" 2>"$TMP_ROOT/validation.err"
validation_exit=$?
set -e
if [[ $validation_exit -ne 0 ]]; then
  validation="$(timeout 5 head -n 1 "$TMP_ROOT/validation.err" 2>/dev/null || true)"
  code="${validation%%$'\t'*}"; detail="${validation#*$'\t'}"
  [[ -n "$code" ]] || code="INVALID_INPUT"
  die_input "$code" "$detail"
fi

mapfile -d '' -t meta < "$META_FILE"
RUN_ID="${meta[0]}"; PACKET_WORK_ORDER="${meta[1]}"; PACKET_REPOSITORY="${meta[2]}"; BASE_SHA="${meta[3]}"; BRANCH="${meta[4]}"; PACKET_WORKSPACE="${meta[5]}"; PATCH_SHA="${meta[6]}"; PACKET_POLICY_SHA="${meta[7]}"; PACKET_SHA="${meta[8]}"; PATCH_GENERATION="${meta[9]}"; PACKET_TIMEOUT="${meta[10]}"

WORKER_ROOT="${REMOTE_DEV_WORKER_ROOT:-}"
if [[ -n "$WORKER_ROOT" ]]; then
  [[ ! -L "$WORKER_ROOT" ]] || die_input "SYMLINK_REJECTED" "worker root is a symlink"
  WORKER_ROOT="$(timeout 5 realpath -- "$WORKER_ROOT")" || die_input "PATH_CONFINEMENT_FAILED" "worker root is unavailable"
fi
PHYSICAL_WORKSPACE="${WORKER_ROOT}${LOGICAL_WORKSPACE}"
PHYSICAL_PARENT="${WORKER_ROOT}/srv/william/workspaces"
REPO_DIR="$PHYSICAL_WORKSPACE/repository"
MARKER_PATH="$PHYSICAL_WORKSPACE/$OWNER_MARKER"
PROOF_PATH="$PHYSICAL_WORKSPACE/$MERGE_MARKER"

[[ "$PACKET_WORKSPACE" == "$LOGICAL_WORKSPACE" ]] || die_input "WORKSPACE_MISMATCH" "packet workspace differs"
if [[ -L "$PHYSICAL_WORKSPACE" || -L "$PHYSICAL_PARENT" ]]; then die_input "SYMLINK_REJECTED" "workspace path is a symlink"; fi

PROCESS_TIMEOUT_SECONDS="${REMOTE_DEV_PROCESS_TIMEOUT_SECONDS:-$PACKET_TIMEOUT}"
if [[ ! "$PROCESS_TIMEOUT_SECONDS" =~ ^[0-9]+$ || "$PROCESS_TIMEOUT_SECONDS" -lt 1 || "$PROCESS_TIMEOUT_SECONDS" -gt "$PACKET_TIMEOUT" ]]; then die_input "RESOURCE_LIMIT_EXCEEDED" "process timeout exceeds packet ceiling"; fi
export DOTNET_PROCESSOR_COUNT=12 MSBUILDNODECOUNT=12
ulimit -n 256 2>/dev/null || true
ulimit -u 64 2>/dev/null || true
ulimit -v 12582912 2>/dev/null || true

run_capture() {
  : > "$OUTPUT_FILE"
  set +e
  timeout --signal=TERM --kill-after=5 "$PROCESS_TIMEOUT_SECONDS" "$@" >"$OUTPUT_FILE" 2>&1
  RUN_EXIT=$?
  set -e
}

run_quiet() {
  set +e
  timeout --signal=TERM --kill-after=5 "$PROCESS_TIMEOUT_SECONDS" "$@" >/dev/null 2>&1
  local code=$?
  set -e
  return "$code"
}

is_reserved() {
  local wanted="$1" candidate
  [[ "$wanted" != /* && "$wanted" != *\\* && "$wanted" != *".."* ]] || return 1
  for candidate in "${RESERVED_PATHS[@]}"; do [[ "$candidate" == "$wanted" ]] && return 0; done
  return 1
}

validate_owner_marker() {
  [[ -f "$MARKER_PATH" && ! -L "$MARKER_PATH" ]] || die_block "OWNERSHIP_MARKER_MISMATCH" "ownership marker is missing"
  set +e
  timeout 10 node -e '
    const fs=require("node:fs");const [file,run,wo,repo,branch,base]=process.argv.slice(1);let v
    try{v=JSON.parse(fs.readFileSync(file,"utf8"))}catch{process.exit(1)}
    const expected={run_id:run,work_order_id:wo,repository:repo,branch,base_sha:base}
    if(JSON.stringify(v)!==JSON.stringify(expected))process.exit(1)
  ' "$MARKER_PATH" "$RUN_ID" "$PACKET_WORK_ORDER" "$PACKET_REPOSITORY" "$BRANCH" "$BASE_SHA"
  marker_exit=$?
  set -e
  [[ $marker_exit -eq 0 ]] || die_block "OWNERSHIP_MARKER_MISMATCH" "ownership marker differs"
}

repo_value() {
  timeout 15 git -C "$REPO_DIR" "$@" 2>/dev/null
}

validate_repo() {
  [[ -d "$REPO_DIR/.git" && ! -L "$REPO_DIR" ]] || die_block "GIT_REPOSITORY_MISSING" "repository is unavailable"
  local remote branch head
  remote="$(repo_value remote get-url origin)" || die_block "GIT_REMOTE_MISMATCH" "origin is unavailable"
  [[ "$remote" == "$REMOTE_URL" ]] || die_block "GIT_REMOTE_MISMATCH" "origin differs"
  branch="$(repo_value branch --show-current)" || die_block "GIT_BRANCH_MISMATCH" "branch is unavailable"
  [[ "$branch" == "$BRANCH" ]] || die_block "GIT_BRANCH_MISMATCH" "branch differs"
  head="$(repo_value rev-parse HEAD)" || die_block "GIT_BASE_MISMATCH" "HEAD is unavailable"
  if [[ "$head" != "$BASE_SHA" && ! -f "$PHYSICAL_WORKSPACE/.williamos-commit-created" ]]; then die_block "GIT_BASE_MISMATCH" "HEAD is not the pinned base"; fi
  local changed
  changed="$(timeout 15 git -C "$REPO_DIR" status --porcelain --untracked-files=all)" || die_block "GIT_STATUS_FAILED" "cannot inspect worktree"
  if [[ -n "$changed" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      local file="${line:3}"
      [[ "$file" != *" -> "* ]] || die_block "PATH_NOT_RESERVED" "renames are not allowed"
      if ! is_reserved "$file"; then die_block "DIRTY_WORKSPACE" "worktree contains a non-reserved path"; fi
    done <<< "$changed"
  fi
}

STARTED_AT="$(timeout 5 date -u +%Y-%m-%dT%H:%M:%S.000Z)" || die_block "CLOCK_FAILED" "cannot read clock"
RUN_EXIT=0
RESULT_STATUS="SUCCEEDED"
HEAD_SHA="$BASE_SHA"

case "$OPERATION" in
  PROVE_PREFLIGHT)
    if [[ -e "$PHYSICAL_WORKSPACE" ]]; then
      [[ -d "$PHYSICAL_WORKSPACE" ]] || die_input "PATH_CONFINEMENT_FAILED" "workspace is not a directory"
      canonical="$(timeout 5 realpath -- "$PHYSICAL_WORKSPACE")" || die_input "PATH_CONFINEMENT_FAILED" "workspace cannot be resolved"
      [[ "$canonical" == "$PHYSICAL_WORKSPACE" ]] || die_input "SYMLINK_REJECTED" "workspace does not resolve exactly"
    fi
    run_capture node --version
    ;;
  CREATE_WORKSPACE)
    [[ ! -e "$PHYSICAL_WORKSPACE" ]] || die_block "WORKSPACE_ALREADY_EXISTS" "exact workspace already exists"
    [[ -d "${WORKER_ROOT}/srv/william" && ! -L "${WORKER_ROOT}/srv/william" ]] || die_input "PATH_CONFINEMENT_FAILED" "trusted parent is unavailable"
    timeout 15 install -d -m 0700 -- "$PHYSICAL_PARENT" || die_block "WORKSPACE_CREATE_FAILED" "cannot create workspace parent"
    timeout 15 mkdir -- "$PHYSICAL_WORKSPACE" || die_block "WORKSPACE_CREATE_FAILED" "cannot create exact workspace"
    timeout 10 node -e 'const fs=require("node:fs"),p=require("node:path"),[file,run,wo,repo,branch,base]=process.argv.slice(1);const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify({run_id:run,work_order_id:wo,repository:repo,branch,base_sha:base}),{mode:0o600,flag:"wx"});fs.renameSync(tmp,file)' "$MARKER_PATH" "$RUN_ID" "$PACKET_WORK_ORDER" "$PACKET_REPOSITORY" "$BRANCH" "$BASE_SHA" || die_block "WORKSPACE_CREATE_FAILED" "cannot publish ownership marker"
    run_capture git clone --no-checkout --origin origin "$REMOTE_URL" "$REPO_DIR"
    [[ $RUN_EXIT -eq 0 ]] || die_block "BLOCKING_OPERATION_FAILED" "Git clone failed"
    run_capture git -C "$REPO_DIR" fetch --no-tags origin main
    [[ $RUN_EXIT -eq 0 ]] || die_block "BLOCKING_OPERATION_FAILED" "Git fetch failed"
    fetched="$(repo_value rev-parse origin/main)" || die_block "GIT_BASE_MISMATCH" "origin/main is unavailable"
    [[ "$fetched" == "$BASE_SHA" ]] || die_block "GIT_BASE_MISMATCH" "fresh origin/main differs from pinned base"
    run_capture git -C "$REPO_DIR" switch --create "$BRANCH" --detach "$BASE_SHA"
    if [[ $RUN_EXIT -ne 0 ]]; then
      run_capture git -C "$REPO_DIR" checkout -b "$BRANCH" "$BASE_SHA"
    fi
    [[ $RUN_EXIT -eq 0 ]] || die_block "BLOCKING_OPERATION_FAILED" "branch creation failed"
    ;;
  APPLY_RESERVED_PATCH)
    validate_owner_marker; validate_repo
    run_capture git -C "$REPO_DIR" apply --numstat -- "$PATCH_FILE"
    [[ $RUN_EXIT -eq 0 ]] || die_block "PATCH_INVALID" "patch cannot be inspected"
    while IFS=$'\t' read -r _added _deleted file; do
      [[ -n "${file:-}" ]] || continue
      is_reserved "$file" || die_input "PATH_NOT_RESERVED" "patch touches a non-reserved path"
    done < "$OUTPUT_FILE"
    run_capture git -C "$REPO_DIR" apply --check -- "$PATCH_FILE"
    [[ $RUN_EXIT -eq 0 ]] || die_block "PATCH_INVALID" "patch does not apply cleanly"
    run_capture git -C "$REPO_DIR" apply -- "$PATCH_FILE"
    [[ $RUN_EXIT -eq 0 ]] || die_block "BLOCKING_OPERATION_FAILED" "patch application failed"
    ;;
  RESTORE_DOTNET)
    validate_owner_marker; validate_repo
    run_capture dotnet restore backend/tests/TerraFusion.Unit.Tests/TerraFusion.Unit.Tests.csproj
    ;;
  TEST_WORKFLOW_CONTRACT)
    validate_owner_marker; validate_repo
    run_capture corepack pnpm exec vitest run tests/ci-terrafusion-unit-informational.test.ts
    ;;
  TEST_DOTNET_INFORMATIONAL)
    validate_owner_marker; validate_repo
    run_capture dotnet test backend/tests/TerraFusion.Unit.Tests/TerraFusion.Unit.Tests.csproj -c Release --no-build -v:minimal /nologo
    if [[ $RUN_EXIT -ne 0 ]]; then RESULT_STATUS="OBSERVED_FAILURE"; fi
    ;;
  BUILD_DOTNET_RELEASE)
    validate_owner_marker; validate_repo
    run_capture dotnet build backend/TerraFusion.sln -c Release --no-restore -v:minimal /nologo
    ;;
  COMMIT_RESERVED_PATHS)
    validate_owner_marker
    while IFS= read -r file; do [[ -z "$file" ]] || is_reserved "$file" || die_input "PATH_NOT_RESERVED" "staged path is not reserved"; done < <(timeout 15 git -C "$REPO_DIR" diff --cached --name-only)
    validate_repo
    run_capture git -C "$REPO_DIR" add -- "${RESERVED_PATHS[@]}"
    [[ $RUN_EXIT -eq 0 ]] || die_block "BLOCKING_OPERATION_FAILED" "reserved staging failed"
    while IFS= read -r file; do [[ -z "$file" ]] || is_reserved "$file" || die_input "PATH_NOT_RESERVED" "staged path is not reserved"; done < <(timeout 15 git -C "$REPO_DIR" diff --cached --name-only)
    run_capture git -C "$REPO_DIR" commit -m "ci(backend): expose doctrine tests as informational"
    [[ $RUN_EXIT -eq 0 ]] || die_block "BLOCKING_OPERATION_FAILED" "commit failed"
    HEAD_SHA="$(repo_value rev-parse HEAD)"
    printf '%s\n' "$HEAD_SHA" > "$PHYSICAL_WORKSPACE/.williamos-commit-created"
    ;;
  PUSH_AUTHORIZED_BRANCH)
    validate_owner_marker; validate_repo
    HEAD_SHA="$(repo_value rev-parse HEAD)"
    run_capture git -C "$REPO_DIR" push origin "HEAD:refs/heads/$BRANCH"
    ;;
  PROVE_POST_MERGE)
    validate_owner_marker; validate_repo
    HEAD_SHA="$(repo_value rev-parse HEAD)"
    run_capture git -C "$REPO_DIR" fetch --no-tags origin main
    [[ $RUN_EXIT -eq 0 ]] || die_block "BLOCKING_OPERATION_FAILED" "post-merge fetch failed"
    run_capture git -C "$REPO_DIR" merge-base --is-ancestor "$HEAD_SHA" origin/main
    [[ $RUN_EXIT -eq 0 ]] || die_block "MERGE_ANCESTRY_NOT_PROVEN" "head is not on origin/main"
    printf '%s:%s\n' "$RUN_ID" "$HEAD_SHA" > "$PROOF_PATH"
    RESULT_STATUS="MERGE_ANCESTRY_PROVEN"
    ;;
  CLEAN_EXACT_WORKSPACE)
    validate_owner_marker; validate_repo
    HEAD_SHA="$(repo_value rev-parse HEAD)"
    [[ -f "$PROOF_PATH" && ! -L "$PROOF_PATH" ]] || die_block "CLEANUP_NOT_AUTHORIZED" "post-merge proof is absent"
    proof="$(timeout 5 tr -d '\r\n' < "$PROOF_PATH")"
    [[ "$proof" == "$RUN_ID:$HEAD_SHA" ]] || die_block "CLEANUP_NOT_AUTHORIZED" "post-merge proof differs"
    canonical="$(timeout 5 realpath -- "$PHYSICAL_WORKSPACE")" || die_block "CLEANUP_NOT_AUTHORIZED" "workspace cannot be resolved"
    [[ "$canonical" == "$PHYSICAL_WORKSPACE" && "$canonical" != "$PHYSICAL_PARENT" ]] || die_block "CLEANUP_NOT_AUTHORIZED" "workspace does not resolve exactly"
    if timeout 5 mountpoint -q -- "$PHYSICAL_WORKSPACE"; then die_block "CLEANUP_NOT_AUTHORIZED" "workspace is a mount point"; fi
    run_capture rm -rf -- "$PHYSICAL_WORKSPACE"
    [[ $RUN_EXIT -eq 0 && ! -e "$PHYSICAL_WORKSPACE" ]] || die_block "BLOCKING_OPERATION_FAILED" "exact cleanup failed"
    RESULT_STATUS="CLEANUP_ABSENCE_PROVEN"
    ;;
esac

if [[ $RUN_EXIT -eq 124 || $RUN_EXIT -eq 137 ]]; then die_block "PROCESS_TIMEOUT" "fixed operation exceeded its timeout"; fi
if [[ $RUN_EXIT -ne 0 && "$RESULT_STATUS" != "OBSERVED_FAILURE" ]]; then die_block "BLOCKING_OPERATION_FAILED" "fixed blocking operation failed with exit $RUN_EXIT"; fi
if [[ -d "$REPO_DIR/.git" ]]; then HEAD_SHA="$(repo_value rev-parse HEAD 2>/dev/null || printf '%s' "$BASE_SHA")"; fi
OUTPUT_SHA="$(timeout 10 sha256sum "$OUTPUT_FILE" | { read -r digest _rest; printf '%s' "$digest"; })" || die_block "EVIDENCE_FAILED" "output digest failed"
COMPLETED_AT="$(timeout 5 date -u +%Y-%m-%dT%H:%M:%S.000Z)" || die_block "CLOCK_FAILED" "cannot read clock"

timeout 10 node -e '
  const a=process.argv.slice(1);const previous=a[16]==="null"?null:a[16]
  process.stdout.write(JSON.stringify({schemaVersion:1,runId:a[0],operation:a[1],attempt:Number(a[2]),startedAt:a[3],completedAt:a[4],status:a[5],exitCode:Number(a[6]),nodeId:"aegis",workspace:"/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001",branch:a[7],baseSha:a[8],headSha:a[9],outputSha256:a[10],policySha256:a[11],packetSha256:a[12],patchSha256:a[13],patchGeneration:Number(a[14]),previousEvidenceSha256:previous})+"\n")
' "$RUN_ID" "$OPERATION" "$ATTEMPT" "$STARTED_AT" "$COMPLETED_AT" "$RESULT_STATUS" "$RUN_EXIT" "$BRANCH" "$BASE_SHA" "$HEAD_SHA" "$OUTPUT_SHA" "$PACKET_POLICY_SHA" "$PACKET_SHA" "$PATCH_SHA" "$PATCH_GENERATION" "$PACKET_TIMEOUT" "$PREVIOUS_EVIDENCE"

exit 0
