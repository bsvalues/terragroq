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
if [[ -n "$WORKER_ROOT" && -d "$WORKER_ROOT/bin" ]]; then
  export PATH="$WORKER_ROOT/bin:$PATH"
fi
PHYSICAL_WORKSPACE="${WORKER_ROOT}${LOGICAL_WORKSPACE}"
PHYSICAL_PARENT="${WORKER_ROOT}/srv/william/workspaces"
TRUSTED_PARENT="${WORKER_ROOT}/srv/william"
REPO_DIR="$PHYSICAL_WORKSPACE/repository"
MARKER_PATH="$PHYSICAL_WORKSPACE/$OWNER_MARKER"
PROOF_PATH="$PHYSICAL_WORKSPACE/$MERGE_MARKER"
SCRATCH_DIR="$PHYSICAL_WORKSPACE/.williamos-scratch"

[[ "$PACKET_WORKSPACE" == "$LOGICAL_WORKSPACE" ]] || die_input "WORKSPACE_MISMATCH" "packet workspace differs"
if [[ -L "$PHYSICAL_WORKSPACE" || -L "$PHYSICAL_PARENT" ]]; then die_input "SYMLINK_REJECTED" "workspace path is a symlink"; fi

PROCESS_TIMEOUT_SECONDS="${REMOTE_DEV_PROCESS_TIMEOUT_SECONDS:-$PACKET_TIMEOUT}"
if [[ ! "$PROCESS_TIMEOUT_SECONDS" =~ ^[0-9]+$ || "$PROCESS_TIMEOUT_SECONDS" -lt 1 || "$PROCESS_TIMEOUT_SECONDS" -gt "$PACKET_TIMEOUT" ]]; then die_input "RESOURCE_LIMIT_EXCEEDED" "process timeout exceeds packet ceiling"; fi
export DOTNET_PROCESSOR_COUNT=12 MSBUILDNODECOUNT=12
readonly SCRATCH_LIMIT_BYTES=85899345920
readonly SCRATCH_LIMIT_KIB=83886080

validate_trusted_parent() {
  [[ -d "$TRUSTED_PARENT" && ! -L "$TRUSTED_PARENT" ]] || die_input "PATH_CONFINEMENT_FAILED" "trusted parent is unavailable"
  local canonical owner current
  canonical="$(timeout 5 realpath -- "$TRUSTED_PARENT")" || die_input "PATH_CONFINEMENT_FAILED" "trusted parent cannot be resolved"
  [[ "$canonical" == "$TRUSTED_PARENT" ]] || die_input "PATH_CONFINEMENT_FAILED" "trusted parent identity differs"
  owner="$(timeout 5 stat -c %u -- "$TRUSTED_PARENT")" || die_input "PATH_CONFINEMENT_FAILED" "trusted parent ownership is unavailable"
  current="$(timeout 5 id -u)" || die_input "PATH_CONFINEMENT_FAILED" "worker identity is unavailable"
  [[ "$owner" == "$current" ]] || die_input "PATH_CONFINEMENT_FAILED" "trusted parent is not worker-owned"
  [[ -d "$PHYSICAL_PARENT" && ! -L "$PHYSICAL_PARENT" ]] || die_input "PATH_CONFINEMENT_FAILED" "workspace parent is unavailable"
  canonical="$(timeout 5 realpath -- "$PHYSICAL_PARENT")" || die_input "PATH_CONFINEMENT_FAILED" "workspace parent cannot be resolved"
  [[ "$canonical" == "$PHYSICAL_PARENT" ]] || die_input "PATH_CONFINEMENT_FAILED" "workspace parent identity differs"
  owner="$(timeout 5 stat -c %u -- "$PHYSICAL_PARENT")" || die_input "PATH_CONFINEMENT_FAILED" "workspace parent ownership is unavailable"
  [[ "$owner" == "$current" ]] || die_input "PATH_CONFINEMENT_FAILED" "workspace parent is not worker-owned"
}

require_containment_tools() {
  local required_tool
  for required_tool in timeout node realpath sha256sum flock findmnt systemd-run hostname id git dotnet corepack nproc df awk stat find tail tr grep du xfs_io xfs_quota; do
    command -v "$required_tool" >/dev/null 2>&1 || die_block "CONTAINMENT_UNAVAILABLE" "$required_tool is required for bounded execution"
  done
}

prove_project_quota() {
  local mount_info filesystem options mount_target quota_stat project_id quota_line quota_id hard_kib
  mount_info="$(timeout 10 findmnt -n -o FSTYPE,OPTIONS,TARGET --target "$PHYSICAL_PARENT")" || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace filesystem identity is unavailable"
  read -r filesystem options mount_target <<< "$mount_info"
  [[ "$filesystem" == "xfs" ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace parent is not on XFS"
  if [[ ",$options," != *,prjquota,* && ",$options," != *,pquota,* ]]; then
    die_block "SCRATCH_CONFINEMENT_FAILED" "XFS project quota is not active for the workspace parent"
  fi
  quota_stat="$(timeout 10 xfs_io -c stat "$PHYSICAL_PARENT")" || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace project identity is unavailable"
  printf '%s\n' "$quota_stat" | grep -qi 'proj-inherit' || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace parent does not enforce project inheritance"
  project_id="$(printf '%s\n' "$quota_stat" | awk '/projid =/{print $3;exit}')"
  [[ "$project_id" =~ ^[1-9][0-9]*$ ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace project ID is invalid"
  quota_line="$(timeout 10 xfs_quota -x -c "quota -p -b -N $project_id" "$mount_target" | awk 'NF>=4 && $1 ~ /^#?[0-9]+$/ {print $1, $4;exit}')" || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace quota report is unavailable"
  read -r quota_id hard_kib <<< "$quota_line"
  quota_id="${quota_id#\#}"
  [[ "$quota_id" == "$project_id" ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace quota report does not match the inherited project"
  [[ "$hard_kib" == "$SCRATCH_LIMIT_KIB" ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace project hard limit is not exactly 80 GiB"
  QUOTA_PROJECT_ID="$project_id"
}

validate_workspace_project() {
  [[ -n "${QUOTA_PROJECT_ID:-}" ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "trusted quota project ID is unavailable"
  local workspace_stat workspace_project_id
  workspace_stat="$(timeout 10 xfs_io -c stat "$PHYSICAL_WORKSPACE")" || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace project identity is unavailable"
  workspace_project_id="$(printf '%s\n' "$workspace_stat" | awk '/projid =/{print $3;exit}')"
  [[ "$workspace_project_id" == "$QUOTA_PROJECT_ID" ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "workspace did not inherit the bounded project quota"
}

probe_containment() {
  : > "$OUTPUT_FILE"
  set +e
  timeout 30 systemd-run --user --quiet --wait --pipe --collect --service-type=exec \
    -p AllowedCPUs=0-11 -p CPUQuota=1200% -p MemoryMax=12884901888 -p TasksMax=64 \
    -p RuntimeMaxSec=30 -p ProtectSystem=strict -p ProtectHome=read-only \
    -p "TemporaryFileSystem=/tmp:size=1048576,mode=0700" -- \
    findmnt -n -o FSTYPE --target /tmp >"$OUTPUT_FILE" 2>&1
  local code=$?
  set -e
  [[ $code -eq 0 && "$(tr -d '\r\n' < "$OUTPUT_FILE")" == "tmpfs" ]] || die_block "CONTAINMENT_UNAVAILABLE" "systemd cgroup and bounded temporary filesystem could not be proven"
}

acquire_workspace_lock() {
  validate_trusted_parent
  exec 9>"$PHYSICAL_PARENT/.remote-dev-offload.lock" || die_block "WORKSPACE_LOCK_FAILED" "cannot open lifecycle lock"
  flock -n 9 || die_block "WORKSPACE_LOCK_BUSY" "another exact-workspace operation is active"
}

validate_scratch_dir() {
  [[ -d "$SCRATCH_DIR" && ! -L "$SCRATCH_DIR" ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "exact workspace scratch directory is unavailable"
  local canonical owner current
  canonical="$(timeout 5 realpath -- "$SCRATCH_DIR")" || die_block "SCRATCH_CONFINEMENT_FAILED" "scratch cannot be resolved"
  [[ "$canonical" == "$SCRATCH_DIR" ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "scratch identity differs"
  owner="$(timeout 5 stat -c %u -- "$SCRATCH_DIR")" || die_block "SCRATCH_CONFINEMENT_FAILED" "scratch ownership is unavailable"
  current="$(timeout 5 id -u)" || die_block "SCRATCH_CONFINEMENT_FAILED" "worker identity is unavailable"
  [[ "$owner" == "$current" ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "scratch is not worker-owned"
}

measure_scratch() {
  local bytes
  bytes="$(timeout 10 du -s -B1 -- "$SCRATCH_DIR" | awk '{print $1;exit}')" || die_block "SCRATCH_CONFINEMENT_FAILED" "scratch usage cannot be measured"
  [[ "$bytes" =~ ^[0-9]+$ && "$bytes" -le "$SCRATCH_LIMIT_BYTES" ]] || die_block "SCRATCH_CONFINEMENT_FAILED" "scratch usage exceeds the approved limit"
  SCRATCH_MEASURED_BYTES="$bytes"
}

run_capture() {
  : > "$OUTPUT_FILE"
  validate_scratch_dir
  measure_scratch; SCRATCH_BEFORE="$SCRATCH_MEASURED_BYTES"
  set +e
  timeout --signal=TERM --kill-after=5 "$PROCESS_TIMEOUT_SECONDS" systemd-run --user --quiet --wait --pipe --collect --service-type=exec \
    -p AllowedCPUs=0-11 -p CPUQuota=1200% -p MemoryMax=12884901888 -p TasksMax=64 \
    -p "RuntimeMaxSec=$PROCESS_TIMEOUT_SECONDS" -p ProtectSystem=strict -p ProtectHome=read-only \
    -p "ReadWritePaths=$PHYSICAL_WORKSPACE" -p "ReadOnlyPaths=/tmp /var/tmp" \
    --setenv=TMPDIR="$SCRATCH_DIR/tmp" --setenv=TMP="$SCRATCH_DIR/tmp" --setenv=TEMP="$SCRATCH_DIR/tmp" \
    --setenv=XDG_CACHE_HOME="$SCRATCH_DIR/xdg-cache" --setenv=NUGET_PACKAGES="$SCRATCH_DIR/nuget" \
    --setenv=DOTNET_CLI_HOME="$SCRATCH_DIR/dotnet-home" --setenv=COREPACK_HOME="$SCRATCH_DIR/corepack" \
    --setenv=npm_config_cache="$SCRATCH_DIR/npm-cache" -- "$@" >"$OUTPUT_FILE" 2>&1
  RUN_EXIT=$?
  set -e
  validate_scratch_dir
  measure_scratch; SCRATCH_AFTER="$SCRATCH_MEASURED_BYTES"
}

run_cleanup_capture() {
  : > "$OUTPUT_FILE"
  measure_scratch; SCRATCH_BEFORE="$SCRATCH_MEASURED_BYTES"
  set +e
  timeout --signal=TERM --kill-after=5 "$PROCESS_TIMEOUT_SECONDS" systemd-run --user --quiet --wait --pipe --collect --service-type=exec \
    -p AllowedCPUs=0-11 -p CPUQuota=1200% -p MemoryMax=12884901888 -p TasksMax=64 \
    -p "RuntimeMaxSec=$PROCESS_TIMEOUT_SECONDS" -p ProtectSystem=strict -p ProtectHome=read-only \
    -p "ReadWritePaths=$PHYSICAL_WORKSPACE" -p "ReadOnlyPaths=/tmp /var/tmp" -- "$@" >"$OUTPUT_FILE" 2>&1
  RUN_EXIT=$?
  set -e
  SCRATCH_AFTER=0
}

validate_reserved_paths() {
  local relative current component
  [[ -d "$REPO_DIR" && ! -L "$REPO_DIR" ]] || return 0
  for relative in "${RESERVED_PATHS[@]}"; do
    current="$REPO_DIR"
    IFS='/' read -r -a components <<< "$relative"
    for component in "${components[@]}"; do
      current="$current/$component"
      [[ ! -L "$current" ]] || die_input "RESERVED_PATH_SYMLINK_REJECTED" "reserved path contains a symlink"
    done
  done
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
  validate_reserved_paths
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

STARTED_AT="$(timeout 5 date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" || die_block "CLOCK_FAILED" "cannot read clock"
RUN_EXIT=0
RESULT_STATUS="SUCCEEDED"
HEAD_SHA="$BASE_SHA"

if [[ "$OPERATION" != "PROVE_PREFLIGHT" ]]; then
  require_containment_tools
  prove_project_quota
  acquire_workspace_lock
fi

case "$OPERATION" in
  PROVE_PREFLIGHT)
    require_containment_tools
    validate_trusted_parent
    [[ ! -e "$PHYSICAL_WORKSPACE" && ! -L "$PHYSICAL_WORKSPACE" ]] || die_block "WORKSPACE_NOT_ABSENT" "exact proof workspace must be absent before acquisition"
    if [[ -e "$PHYSICAL_PARENT/.remote-dev-offload.lock" || -L "$PHYSICAL_PARENT/.remote-dev-offload.lock" ]]; then
      [[ -f "$PHYSICAL_PARENT/.remote-dev-offload.lock" && ! -L "$PHYSICAL_PARENT/.remote-dev-offload.lock" ]] || die_block "PATH_CONFINEMENT_FAILED" "lifecycle lock path is unsafe"
      [[ "$(timeout 5 stat -c %u -- "$PHYSICAL_PARENT/.remote-dev-offload.lock")" == "$(timeout 5 id -u)" ]] || die_block "PATH_CONFINEMENT_FAILED" "lifecycle lock is not worker-owned"
    fi
    probe_containment
    prove_project_quota
    host_name="$(timeout 5 hostname | tr '[:upper:]' '[:lower:]')" || die_block "PREFLIGHT_IDENTITY_FAILED" "hostname is unavailable"
    [[ "$host_name" == "aegis" ]] || die_block "PREFLIGHT_IDENTITY_FAILED" "worker hostname is not aegis"
    user_name="$(timeout 5 id -un)" || die_block "PREFLIGHT_IDENTITY_FAILED" "worker user is unavailable"
    [[ "$user_name" == "bs" ]] || die_block "PREFLIGHT_IDENTITY_FAILED" "worker user is not bs"
    timeout 10 git --version >>"$OUTPUT_FILE" 2>&1 || die_block "PREFLIGHT_TOOLCHAIN_FAILED" "Git is unavailable"
    dotnet_version="$(timeout 10 dotnet --version)" || die_block "PREFLIGHT_TOOLCHAIN_FAILED" ".NET is unavailable"
    [[ "$dotnet_version" == 8.* ]] || die_block "PREFLIGHT_TOOLCHAIN_FAILED" ".NET 8 is required"
    node_version="$(timeout 10 node --version)" || die_block "PREFLIGHT_TOOLCHAIN_FAILED" "Node is unavailable"
    [[ "$node_version" =~ ^v[0-9]+\. ]] || die_block "PREFLIGHT_TOOLCHAIN_FAILED" "Node version is malformed"
    pnpm_version="$(timeout 15 corepack pnpm --version)" || die_block "PREFLIGHT_TOOLCHAIN_FAILED" "Corepack/pnpm is unavailable"
    [[ -n "$pnpm_version" ]] || die_block "PREFLIGHT_TOOLCHAIN_FAILED" "Corepack/pnpm version is empty"
    cpu_count="$(timeout 5 nproc)" || die_block "PREFLIGHT_CAPACITY_FAILED" "CPU capacity is unavailable"
    [[ "$cpu_count" =~ ^[0-9]+$ ]] && (( cpu_count >= 12 )) || die_block "PREFLIGHT_CAPACITY_FAILED" "fewer than 12 CPUs are available"
    memory_bytes="$(timeout 5 awk '/^MemTotal:/{print $2*1024}' /proc/meminfo)" || die_block "PREFLIGHT_CAPACITY_FAILED" "memory capacity is unavailable"
    awk -v bytes="$memory_bytes" 'BEGIN{exit !(bytes>=12884901888)}' || die_block "PREFLIGHT_CAPACITY_FAILED" "less than 12 GiB memory is available"
    disk_bytes="$(timeout 5 df -PB1 --output=avail "$PHYSICAL_PARENT" | tail -n 1 | tr -d ' ')" || die_block "PREFLIGHT_CAPACITY_FAILED" "disk capacity is unavailable"
    [[ "$disk_bytes" =~ ^[0-9]+$ ]] && (( disk_bytes >= SCRATCH_LIMIT_BYTES )) || die_block "PREFLIGHT_CAPACITY_FAILED" "less than 80 GiB disk is available"
    timeout 30 git ls-remote --exit-code "$REMOTE_URL" refs/heads/main >>"$OUTPUT_FILE" 2>&1 || die_block "PREFLIGHT_REPOSITORY_AUTH_FAILED" "authenticated repository read failed"
    PREFLIGHT_REPO="$TMP_ROOT/preflight.git"
    timeout 15 git init --bare "$PREFLIGHT_REPO" >>"$OUTPUT_FILE" 2>&1 || die_block "PREFLIGHT_REPOSITORY_AUTH_FAILED" "temporary repository proof setup failed"
    timeout 30 git -C "$PREFLIGHT_REPO" fetch --depth=1 "$REMOTE_URL" "$BASE_SHA" >>"$OUTPUT_FILE" 2>&1 || die_block "PREFLIGHT_REPOSITORY_AUTH_FAILED" "authenticated pinned revision read failed"
    timeout 30 git -C "$PREFLIGHT_REPO" push --dry-run "$REMOTE_URL" "$BASE_SHA:refs/heads/williamos-preflight-$RUN_ID" >>"$OUTPUT_FILE" 2>&1 || die_block "PREFLIGHT_REPOSITORY_AUTH_FAILED" "authenticated repository push capability failed"
    RUN_EXIT=0; SCRATCH_BEFORE=0; SCRATCH_AFTER=0
    ;;
  CREATE_WORKSPACE)
    if [[ -e "$PHYSICAL_WORKSPACE" ]]; then
      [[ -d "$PHYSICAL_WORKSPACE" && ! -L "$PHYSICAL_WORKSPACE" ]] || die_input "PATH_CONFINEMENT_FAILED" "partial workspace is not an exact directory"
      validate_owner_marker
      PARTIAL_WORKSPACE_RECOVERED=true
      if [[ -e "$REPO_DIR" ]]; then
        [[ -d "$REPO_DIR" && ! -L "$REPO_DIR" ]] || die_block "PARTIAL_WORKSPACE_UNSAFE" "partial repository is not an exact directory"
        repo_canonical="$(timeout 5 realpath -- "$REPO_DIR")" || die_block "PARTIAL_WORKSPACE_UNSAFE" "partial repository cannot be resolved"
        [[ "$repo_canonical" == "$REPO_DIR" ]] || die_block "PARTIAL_WORKSPACE_UNSAFE" "partial repository identity differs"
        partial_mounts="$(timeout 10 findmnt -R -n -o TARGET -- "$REPO_DIR" 2>/dev/null || true)"
        [[ -z "$partial_mounts" ]] || die_block "PARTIAL_WORKSPACE_UNSAFE" "partial repository contains a mount boundary"
        [[ -d "$SCRATCH_DIR" ]] || timeout 10 mkdir -m 0700 -- "$SCRATCH_DIR" || die_block "SCRATCH_CONFINEMENT_FAILED" "cannot create exact scratch directory"
        validate_scratch_dir
        run_cleanup_capture rm -rf -- "$REPO_DIR"
        [[ $RUN_EXIT -eq 0 && ! -e "$REPO_DIR" ]] || die_block "PARTIAL_WORKSPACE_UNSAFE" "partial repository could not be reset"
      fi
    else
      timeout 15 mkdir -- "$PHYSICAL_WORKSPACE" || die_block "WORKSPACE_CREATE_FAILED" "cannot create exact workspace"
      timeout 10 node -e 'const fs=require("node:fs"),[file,run,wo,repo,branch,base]=process.argv.slice(1);const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify({run_id:run,work_order_id:wo,repository:repo,branch,base_sha:base}),{mode:0o600,flag:"wx"});fs.renameSync(tmp,file)' "$MARKER_PATH" "$RUN_ID" "$PACKET_WORK_ORDER" "$PACKET_REPOSITORY" "$BRANCH" "$BASE_SHA" || die_block "WORKSPACE_CREATE_FAILED" "cannot publish ownership marker"
    fi
    [[ -d "$SCRATCH_DIR" ]] || timeout 10 mkdir -m 0700 -- "$SCRATCH_DIR" || die_block "SCRATCH_CONFINEMENT_FAILED" "cannot create exact scratch directory"
    timeout 10 mkdir -p -m 0700 -- "$SCRATCH_DIR/tmp" "$SCRATCH_DIR/xdg-cache" "$SCRATCH_DIR/nuget" "$SCRATCH_DIR/dotnet-home" "$SCRATCH_DIR/corepack" "$SCRATCH_DIR/npm-cache" || die_block "SCRATCH_CONFINEMENT_FAILED" "cannot create bounded cache directories"
    validate_workspace_project
    validate_scratch_dir
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
    run_capture dotnet build backend/tests/TerraFusion.Unit.Tests/TerraFusion.Unit.Tests.csproj -c Release --no-restore -v:minimal /nologo
    [[ $RUN_EXIT -eq 0 ]] || die_block "INFORMATIONAL_TEST_INFRASTRUCTURE_FAILED" "focused test project did not build"
    TRX_FILE="$TMP_ROOT/informational.trx"
    run_capture dotnet test backend/tests/TerraFusion.Unit.Tests/TerraFusion.Unit.Tests.csproj -c Release --no-build -v:minimal /nologo --logger "trx;LogFileName=$TRX_FILE"
    [[ -f "$TRX_FILE" && ! -L "$TRX_FILE" ]] || die_block "INFORMATIONAL_TEST_INFRASTRUCTURE_FAILED" "test runner did not publish a trustworthy result file"
    set +e
    TEST_COUNTS="$(timeout 10 node -e '
      const fs=require("node:fs"),s=fs.readFileSync(process.argv[1],"utf8"),tag=s.match(/<Counters\b([^>]*)\/?\s*>/i);if(!tag)process.exit(1);
      const attrs=Object.fromEntries([...tag[1].matchAll(/([A-Za-z]+)="(\d+)"/g)].map(m=>[m[1].toLowerCase(),Number(m[2])]));
      for(const key of ["total","executed","passed","failed","error","timeout","aborted"])if(!Number.isSafeInteger(attrs[key])||attrs[key]<0)process.exit(1);
      if(attrs.error!==0||attrs.timeout!==0||attrs.aborted!==0)process.exit(1);
      process.stdout.write(JSON.stringify({total:attrs.total,executed:attrs.executed,passed:attrs.passed,failed:attrs.failed}));
    ' "$TRX_FILE")"
    trx_exit=$?
    set -e
    [[ $trx_exit -eq 0 ]] || die_block "INFORMATIONAL_TEST_INFRASTRUCTURE_FAILED" "test results show runner or infrastructure failure"
    failed_count="$(printf '%s' "$TEST_COUNTS" | timeout 5 node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).failed)))')"
    if [[ $RUN_EXIT -ne 0 ]]; then
      (( failed_count > 0 )) || die_block "INFORMATIONAL_TEST_INFRASTRUCTURE_FAILED" "nonzero test result is not an assertion-only failure"
      RESULT_STATUS="OBSERVED_FAILURE"
    else
      (( failed_count == 0 )) || die_block "INFORMATIONAL_TEST_INFRASTRUCTURE_FAILED" "runner exit disagrees with failed assertions"
    fi
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
    nested_mounts="$(timeout 10 findmnt -R -n -o TARGET -- "$PHYSICAL_WORKSPACE" 2>/dev/null || true)"
    [[ -z "$nested_mounts" ]] || die_block "CLEANUP_NESTED_MOUNT" "workspace contains a mount boundary"
    validate_scratch_dir
    run_cleanup_capture rm -rf -- "$PHYSICAL_WORKSPACE"
    [[ $RUN_EXIT -eq 0 && ! -e "$PHYSICAL_WORKSPACE" ]] || die_block "BLOCKING_OPERATION_FAILED" "exact cleanup failed"
    RESULT_STATUS="CLEANUP_ABSENCE_PROVEN"
    ;;
esac

if [[ $RUN_EXIT -eq 124 || $RUN_EXIT -eq 137 ]]; then die_block "PROCESS_TIMEOUT" "fixed operation exceeded its timeout"; fi
if [[ $RUN_EXIT -ne 0 && "$RESULT_STATUS" != "OBSERVED_FAILURE" ]]; then die_block "BLOCKING_OPERATION_FAILED" "fixed blocking operation failed with exit $RUN_EXIT"; fi
if [[ -d "$REPO_DIR/.git" ]]; then HEAD_SHA="$(repo_value rev-parse HEAD 2>/dev/null || printf '%s' "$BASE_SHA")"; fi
OUTPUT_SHA="$(timeout 10 sha256sum "$OUTPUT_FILE" | { read -r digest _rest; printf '%s' "$digest"; })" || die_block "EVIDENCE_FAILED" "output digest failed"
COMPLETED_AT="$(timeout 5 date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" || die_block "CLOCK_FAILED" "cannot read clock"
set +e
timeout 5 node -e 'const a=Date.parse(process.argv[1]),b=Date.parse(process.argv[2]);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)process.exit(1)' "$STARTED_AT" "$COMPLETED_AT"
clock_exit=$?
set -e
[[ $clock_exit -eq 0 ]] || die_block "CLOCK_NOT_MONOTONIC" "operation timestamps are not strictly increasing"

SUMMARY_JSON="$(timeout 10 node -e '
  const [operation,startedAt,completedAt,status,exitCode,before,after,counts]=process.argv.slice(1);let testCounts=null;try{testCounts=JSON.parse(counts)}catch{}
  process.stdout.write(JSON.stringify({schemaVersion:1,operation,startedAt,completedAt,status,exitCode:Number(exitCode),resourceObservations:{cpuThreads:12,memoryBytes:12884901888,scratchBeforeBytes:Number(before),scratchAfterBytes:Number(after)},testCounts}))
' "$OPERATION" "$STARTED_AT" "$COMPLETED_AT" "$RESULT_STATUS" "$RUN_EXIT" "$SCRATCH_BEFORE" "${SCRATCH_AFTER:-$SCRATCH_BEFORE}" "${TEST_COUNTS:-null}")" || die_block "EVIDENCE_FAILED" "cannot create sanitized operation summary"
printf 'REMOTE_DEV_SUMMARY\t%s\n' "$(printf '%s' "$SUMMARY_JSON" | timeout 5 base64 | tr -d '\r\n')" >&2

timeout 10 node -e '
  const a=process.argv.slice(1);const previous=a[16]==="null"?null:a[16]
  process.stdout.write(JSON.stringify({schemaVersion:1,runId:a[0],operation:a[1],attempt:Number(a[2]),startedAt:a[3],completedAt:a[4],status:a[5],exitCode:Number(a[6]),nodeId:"aegis",workspace:"/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001",branch:a[7],baseSha:a[8],headSha:a[9],outputSha256:a[10],policySha256:a[11],packetSha256:a[12],patchSha256:a[13],patchGeneration:Number(a[14]),previousEvidenceSha256:previous})+"\n")
' "$RUN_ID" "$OPERATION" "$ATTEMPT" "$STARTED_AT" "$COMPLETED_AT" "$RESULT_STATUS" "$RUN_EXIT" "$BRANCH" "$BASE_SHA" "$HEAD_SHA" "$OUTPUT_SHA" "$PACKET_POLICY_SHA" "$PACKET_SHA" "$PATCH_SHA" "$PATCH_GENERATION" "$PACKET_TIMEOUT" "$PREVIOUS_EVIDENCE"

exit 0
