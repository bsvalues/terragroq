import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fork, spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export const ACTIVATION_ID = "remote-dev-offload-v1-issue-734-single-use-002"
export const AUTHORITY_REFERENCE = "issue-734-terrafusion-remote-dev-single-use-002"
const RUN_ID = "c9889658-bad2-43e2-8def-a0a9c9df5d3c"
const WORKSPACE = "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001"
const BRANCH = "codex/wo-tf-remote-dev-offload-001-734"
const BASE_SHA = "ffd2fa35f5152de2b95e7f63b220050d18193d7a"
const CONTROL_REPOSITORY = "/var/lib/williamos-remote-dev/control/terragroq"
const INSTALLED_SELF = "/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs"
const PRIVATE_KEY = "/etc/williamos-fabric/aegis-remote-dev-launch-authority.key"
const PUBLIC_KEY = "/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem"
const BRIDGE_RECEIPT = "/var/lib/williamos-fabric/remote-dev-activation-bridge-verified.json"
const STATE_ROOT = `/run/williamos-fabric/activation-${RUN_ID}`
const PREPARING_ROOT = `${STATE_ROOT}.preparing`
const PREPARED_FILE = `${STATE_ROOT}/prepared.json`
const SESSION_FILE = `${STATE_ROOT}/session.json`
const SETTLEMENT_FILE = `${STATE_ROOT}/settlement.json`
const PHASE_FILE = `${STATE_ROOT}/phase.json`
const MINT_ROOT = `${STATE_ROOT}/mints`
const NO_SUDO_FILE = `${STATE_ROOT}/no-sudo.json`
const NETWORK_INTENT_FILE = `${STATE_ROOT}/network-intent.json`
const NETWORK_APPLIED_FILE = `${STATE_ROOT}/network-applied.json`
const NETWORK_SETTLED_FILE = `${STATE_ROOT}/network-settled.json`
const NETWORK_RECEIPT_FILE = "/run/williamos-fabric/aegis-remote-dev-network-proof.json"
const FAILURE_FILE = `${STATE_ROOT}/activation-failure.json`
const NETWORK_SLICE = "/user.slice/user-999.slice/user@999.service/app.slice/williamos-aegis-remote-dev.slice"
const SNAPSHOT = `${STATE_ROOT}/control`
const UNIT = `williamos-aegis-activation-${RUN_ID}.service`
const PRECLAIM_PREDECESSOR_COMMIT = "88bd56d8f575bafaf7a6ddcf6b1a8e2e1fc4d3ec"
const LEDGER_ROOT = "/var/lib/williamos/fabric/ledger"
const OPERATIONS = Object.freeze(["PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET", "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE", "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE"])
const ENV = Object.freeze({ HOME: "/nonexistent", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" })
const SHA = /^[a-f0-9]{64}$/
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const canonical = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  throw new TypeError("unsupported canonical value")
}
const exactKeys = (value, keys) => JSON.stringify(Object.keys(value ?? {}).sort()) === JSON.stringify([...keys].sort())
const sha = value => crypto.createHash("sha256").update(value).digest("hex")
const blocked = detail => ({ status: "BLOCKED", reasonCode: "ACTIVATION_HOST_DRIFT", detail, executionAuthorized: false, activationAuthorized: false })

export function inspectActivationHostPhase(value, now) {
  try {
    if (!exactKeys(value, ["schemaVersion", "phase", "runId", "claimId", "leaseId", "authorityReference", "claimedAt", "expiresAt"])) throw new Error("activation phase keys differ")
    const current = Date.parse(now), claimed = Date.parse(value.claimedAt), expires = Date.parse(value.expiresAt)
    if (value.schemaVersion !== 1 || value.phase !== "ACTIVATION_CLAIMED_LEASED" || value.runId !== RUN_ID || value.authorityReference !== AUTHORITY_REFERENCE
      || !/^claim-[a-f0-9]{24}$/.test(value.claimId) || !/^lease-[a-f0-9]{24}$/.test(value.leaseId)
      || ![current, claimed, expires].every(Number.isFinite) || current < claimed || current >= expires + 1_800_000) throw new Error("activation phase differs")
    return { status: "RECOVERY_REQUIRED", executionAuthorized: false, runId: RUN_ID, claimId: value.claimId, leaseId: value.leaseId }
  } catch (error) { return blocked(String(error.message)) }
}

export function inspectMintRecord(expected, observed) {
  try {
    const keys = ["schemaVersion", "mintKey", "runId", "claimId", "operation", "attempt", "previousEvidenceSha256", "packetSha256", "patchSha256", "ticketSha256"]
    if (!exactKeys(expected, keys) || !exactKeys(observed, keys) || canonical(expected) !== canonical(observed) || expected.schemaVersion !== 1 || !SHA.test(expected.mintKey)
      || expected.runId !== RUN_ID || !/^claim-[a-f0-9]{24}$/.test(expected.claimId) || !OPERATIONS.includes(expected.operation) || ![1,2,3].includes(expected.attempt)
      || !(expected.previousEvidenceSha256 === null || SHA.test(expected.previousEvidenceSha256)) || ![expected.packetSha256, expected.patchSha256, expected.ticketSha256].every(value => SHA.test(value))) throw new Error("mint record differs")
    return { status: "MINT_REPLAY_EXACT", executionAuthorized: false, mintKey: expected.mintKey }
  } catch (error) { return blocked(String(error.message)) }
}

export function inspectActivationBridgeReceipt(expected, observed) {
  try {
    const keys = ["schemaVersion", "status", "runId", "authorityId", "authoritySha256", "machineIdSha256", "bootId", "controlCommit", "prerequisiteReceiptSha256", "assets", "schedulerEnabled", "standingAuthority", "executionAuthorized"]
    if (!exactKeys(expected, keys) || !exactKeys(observed, keys) || canonical(expected) !== canonical(observed) || expected.schemaVersion !== 1 || expected.status !== "ACTIVATION_BRIDGE_VERIFIED"
      || expected.runId !== RUN_ID || !GUID.test(expected.authorityId) || !SHA.test(expected.authoritySha256) || !SHA.test(expected.machineIdSha256) || !GUID.test(expected.bootId) || !/^[a-f0-9]{40}$/.test(expected.controlCommit)
      || expected.prerequisiteReceiptSha256 !== "41ea35adc284b37e381f1162e5cd2315f8a0ef2da5c2326e1a224c15e4fa541c" || !Array.isArray(expected.assets) || expected.assets.length < 1
      || expected.assets.some(asset => !exactKeys(asset, ["destination", "sha256", "mode"]) || typeof asset.destination !== "string" || !asset.destination.startsWith("/") || !SHA.test(asset.sha256) || !/^0[0-7]{3}$/.test(asset.mode))
      || expected.schedulerEnabled !== false || expected.standingAuthority !== false || expected.executionAuthorized !== false) throw new Error("activation bridge receipt differs")
    return { status: "ACTIVATION_BRIDGE_VERIFIED", executionAuthorized: false, runId: RUN_ID }
  } catch (error) { return blocked(String(error.message)) }
}

export function inspectStrandedActivationLedger(claim, lease, expected) {
  try {
    const claimKeys=["schema_version","claim_id","request_sha256","scope_sha256","authority_reference","maximum_attempts","claim_key_sha256","claimed_at","claim_sha256"],leaseKeys=["schema_version","lease_id","claim_id","acquired_at","holder","lease_sha256"]
    const {claim_sha256,...claimBody}=claim??{}, {lease_sha256,...leaseBody}=lease??{}
    if(!exactKeys(expected,["claimKeySha256","requestSha256","scopeSha256"])||!exactKeys(claim,claimKeys)||!exactKeys(lease,leaseKeys)||claim.schema_version!=="0.1-aegis-single-use-claim"||claim.claim_key_sha256!==expected.claimKeySha256||claim.request_sha256!==expected.requestSha256||claim.scope_sha256!==expected.scopeSha256||claim.authority_reference!==AUTHORITY_REFERENCE||claim.maximum_attempts!==3||!/^claim-[a-f0-9]{24}$/.test(claim.claim_id)||claim_sha256!==sha(Buffer.from(canonical(claimBody)))||lease.schema_version!=="0.1-resident-aegis-runtime-lease"||!/^lease-[a-f0-9]{24}$/.test(lease.lease_id)||lease.claim_id!==claim.claim_id||!exactKeys(lease.holder,["pid","boot_id","process_start_ticks"])||lease_sha256!==sha(Buffer.from(canonical(leaseBody))))throw new Error("stranded ledger differs")
    return {status:"STRANDED_LEASE_RECOVERY_REQUIRED",executionAuthorized:false,claimId:claim.claim_id,leaseId:lease.lease_id,claimedAt:claim.claimed_at}
  } catch(error){return blocked(String(error.message))}
}

function verifyBridgeReceiptLive() {
  const observed = JSON.parse(exactRootFile(BRIDGE_RECEIPT, 0o444))
  const expected = { ...observed, machineIdSha256: sha(Buffer.from(fs.readFileSync("/etc/machine-id", "utf8").trim())), bootId: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() }
  if (inspectActivationBridgeReceipt(expected, observed).status !== "ACTIVATION_BRIDGE_VERIFIED") throw new Error("activation bridge receipt is unproven")
  for (const asset of observed.assets) { const bytes = exactRootFile(asset.destination, Number.parseInt(asset.mode, 8)); if (sha(bytes) !== asset.sha256) throw new Error("activation bridge installed asset differs") }
  if (sha(exactRootFile("/var/lib/williamos-fabric/remote-dev-prerequisite-verified.json", 0o444)) !== observed.prerequisiteReceiptSha256) throw new Error("canonical prerequisite receipt differs")
  return observed
}

export function inspectActivationSessionToken(value, now) {
  try {
    const keys = ["schemaVersion", "activationId", "authorityReference", "runId", "claimId", "leaseId", "proofId", "noSudoProofSha256", "workspace", "branch", "baseSha", "issuedAt", "expiresAt", "daemonPid", "daemonStartTicks"]
    const current = Date.parse(now), issued = Date.parse(value?.issuedAt), expires = Date.parse(value?.expiresAt)
    if (!exactKeys(value, keys) || value.schemaVersion !== 1 || value.activationId !== ACTIVATION_ID || value.authorityReference !== AUTHORITY_REFERENCE || value.runId !== RUN_ID
      || !/^claim-[a-f0-9]{24}$/.test(value.claimId) || !/^lease-[a-f0-9]{24}$/.test(value.leaseId) || !GUID.test(value.proofId) || !SHA.test(value.noSudoProofSha256)
      || value.workspace !== WORKSPACE || value.branch !== BRANCH || value.baseSha !== BASE_SHA || !Number.isSafeInteger(value.daemonPid) || value.daemonPid <= 1
      || !/^\d+$/.test(value.daemonStartTicks) || ![current, issued, expires].every(Number.isFinite) || current < issued || current >= expires || expires - issued > 14_400_000) throw new Error("session binding differs")
    return { status: "ACTIVE_SESSION_VERIFIED", executionAuthorized: false, runId: RUN_ID, claimId: value.claimId, leaseId: value.leaseId, proofId: value.proofId }
  } catch (error) { return blocked(String(error.message)) }
}

export function inspectTicketMintRequest(request, packetBytes, patchBytes) {
  try {
    const keys = ["operation", "attempt", "previousEvidenceSha256", "packetSha256", "patchSha256"]
    if (!exactKeys(request, keys) || !OPERATIONS.includes(request.operation) || ![1, 2, 3].includes(request.attempt)
      || !(request.previousEvidenceSha256 === null || SHA.test(request.previousEvidenceSha256)) || request.packetSha256 !== sha(packetBytes) || request.patchSha256 !== sha(patchBytes)) throw new Error("ticket request differs")
    return { status: "TICKET_REQUEST_VERIFIED", executionAuthorized: false, operation: request.operation }
  } catch (error) { return blocked(String(error.message)) }
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", shell: false, timeout: options.timeout ?? 30_000, env: ENV, cwd: options.cwd })
  if (result.error || result.signal || !(options.statuses ?? [0]).includes(result.status)) throw new Error(`${path.basename(file)} ${args[0] ?? ""} failed`)
  return String(result.stdout ?? "").trim()
}
function trustedParents(file) { let cursor = "/"; for (const part of path.dirname(file).slice(1).split("/").filter(Boolean)) { cursor = path.join(cursor, part); const s = fs.lstatSync(cursor); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o022)) return false } return true }
function exactRootFile(file, mode) { const s = fs.lstatSync(file); if (!trustedParents(file) || !s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== 0 || s.gid !== 0 || (s.mode & 0o7777) !== mode) throw new Error(`${file} trust differs`); return fs.readFileSync(file) }
function exactLedgerFile(file) { const gid=Number(run("/usr/bin/id",["-g","williamos-fabric"]));for(const [p,uid,mode] of [["/var",0,0o755],["/var/lib",0,0o755],["/var/lib/williamos",999,0o750],["/var/lib/williamos/fabric",999,0o700],[LEDGER_ROOT,999,0o700]]){const v=fs.lstatSync(p);if(!v.isDirectory()||v.isSymbolicLink()||v.uid!==uid||(v.mode&0o7777)!==mode||(uid===999&&v.gid!==gid))throw new Error("ledger ancestor trust differs")}const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==999||s.gid!==gid||(s.mode&0o7777)!==0o600)throw new Error(`${file} ledger trust differs`);return JSON.parse(fs.readFileSync(file)) }
function writeRootJson(file, value, mode = 0o444) { const bytes = Buffer.from(`${canonical(value)}\n`); const temp = `${file}.${process.pid}.tmp`; const fd = fs.openSync(temp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, mode); fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(temp, file); const parent = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY); fs.fsyncSync(parent); fs.closeSync(parent) }
function createRootJson(file, value, mode = 0o400) { const bytes = Buffer.from(`${canonical(value)}\n`); const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, mode); try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); fs.fsyncSync(fd) } finally { fs.closeSync(fd) } const parent = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY); try { fs.fsyncSync(parent) } finally { fs.closeSync(parent) } }
function startTicks(pid) { return fs.readFileSync(`/proc/${pid}/stat`, "utf8").trim().split(/\s+/)[21] }
function trustedNow() { const value = run("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"]); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error("trusted time differs"); return value }
export function inspectActivationUnitState(state,mainPid){if((state==="inactive"||state==="unknown")&&mainPid===0)return "INACTIVE";if(state==="failed"&&mainPid===0)return "RESET_REQUIRED";return "DRIFT"}
export function inspectLeaseHolderState(holder,currentBootId,observedStartTicks){if(!exactKeys(holder,["pid","boot_id","process_start_ticks"])||!Number.isSafeInteger(holder.pid)||holder.pid<=1||!GUID.test(holder.boot_id)||!/^\d+$/.test(holder.process_start_ticks))return "DRIFT";return holder.boot_id===currentBootId&&observedStartTicks===holder.process_start_ticks?"ACTIVE":"DEAD"}
export function inspectRootNoSudoObservation(value){try{for(const key of["passwd","sudo"]){if(!exactKeys(value?.[key],["status","signal","errorCode","stdout","stderr"]))throw new Error()}if(value.passwd.status!==0||value.passwd.signal!==null||value.passwd.errorCode!==null||value.passwd.stderr!==""||!/^williamos-fabric L \d{4}-\d{2}-\d{2} -1 -1 -1 -1\n$/.test(value.passwd.stdout)||value.sudo.status!==0||value.sudo.signal!==null||value.sudo.errorCode!==null||value.sudo.stdout!=="User williamos-fabric is not allowed to run sudo on aegis.\n"||value.sudo.stderr!=="")throw new Error();return "ROOT_NO_SUDO_OBSERVED"}catch{return "DRIFT"}}
export function inspectHostRootNoSudoProof(p,now,e){try{if(!exactKeys(p,["schemaVersion","status","activationId","authorityReference","runId","machineIdSha256","bootId","activationHostSha256","authoritySha256","account","passwordStatus","sudoStatus","sudoStdout","sudoStderr","issuedAt","expiresAt"]))throw new Error();const n=Date.parse(now),i=Date.parse(p.issuedAt),x=Date.parse(p.expiresAt);if(p.schemaVersion!==1||p.status!=="ROOT_NO_SUDO_VERIFIED"||p.activationId!==ACTIVATION_ID||p.authorityReference!==AUTHORITY_REFERENCE||p.runId!==RUN_ID||p.machineIdSha256!==e.machineIdSha256||p.bootId!==e.bootId||p.activationHostSha256!==e.activationHostSha256||p.authoritySha256!==e.authoritySha256||p.account!=="williamos-fabric"||p.passwordStatus!=="L"||p.sudoStatus!==0||p.sudoStdout!=="User williamos-fabric is not allowed to run sudo on aegis.\n"||p.sudoStderr!==""||![n,i,x].every(Number.isFinite)||n<i||x-i!==300_000)throw new Error();return n<x?"FRESH":"EXPIRED_EXACT"}catch{return "DRIFT"}}
export function inspectPreparedSnapshotRecovery(v){try{if(!exactKeys(v,["preparedCommit","currentCommit","entries","claimExists","phaseExists","sessionExists"])||!Array.isArray(v.entries)||v.claimExists||v.phaseExists||v.sessionExists||!/^([a-f0-9]{40})$/.test(v.preparedCommit)||!/^([a-f0-9]{40})$/.test(v.currentCommit))throw new Error();const entries=[...v.entries].sort(),base=["control","mints","prepared.json"].sort(),allowed=new Set([...base,"no-sudo.json","network-intent.json","network-applied.json","network-settled.json","activation-failure.json"]);if(v.preparedCommit===v.currentCommit&&base.every(x=>entries.includes(x))&&entries.every(x=>allowed.has(x)))return"MATCH";if(v.preparedCommit===PRECLAIM_PREDECESSOR_COMMIT&&JSON.stringify(entries)===JSON.stringify(base))return"ARCHIVE_EXACT_PRECLAIM";throw new Error()}catch{return"DRIFT"}}
export function inspectNetworkActivationState(v){try{if(!exactKeys(v,["journalState","receiptState","nftExact","egressActiveEnabled","brokerInactiveDisabled","gitSocketInactiveDisabled","gitServiceInactive","listenerAbsent","workerWorkspaceAbsent"])||!["ABSENT","INTENT","APPLIED"].includes(v.journalState)||!["ABSENT","EXACT_ACTIVE","FOREIGN"].includes(v.receiptState)||["nftExact","egressActiveEnabled","brokerInactiveDisabled","gitSocketInactiveDisabled","gitServiceInactive","listenerAbsent","workerWorkspaceAbsent"].some(k=>typeof v[k]!=="boolean"))throw new Error();if(v.receiptState==="EXACT_ACTIVE"&&v.journalState==="APPLIED"&&v.nftExact&&v.egressActiveEnabled&&!v.brokerInactiveDisabled&&!v.gitSocketInactiveDisabled&&v.gitServiceInactive&&!v.listenerAbsent&&v.workerWorkspaceAbsent)return"REFRESH_EXACT_ACTIVE";if(v.receiptState==="ABSENT"&&v.nftExact&&v.egressActiveEnabled&&v.gitServiceInactive&&v.workerWorkspaceAbsent){if(["ABSENT","INTENT","APPLIED"].includes(v.journalState)&&v.brokerInactiveDisabled&&v.gitSocketInactiveDisabled&&v.listenerAbsent)return"ACTIVATE_EXACT_INERT";if(["ABSENT","INTENT","APPLIED"].includes(v.journalState)&&!v.brokerInactiveDisabled&&!v.gitSocketInactiveDisabled&&!v.listenerAbsent)return"ADOPT_EXACT_ACTIVE"}throw new Error()}catch{return"DRIFT"}}
export function inspectNetworkJournalBinding(intent,applied){try{const base=["schemaVersion","status","runId","activationId","authorityReference","proofId","generationId","policySha256","activationSha256","providerSha256","launcherSha256","workerSha256"];if(!exactKeys(intent,base)||!exactKeys(applied,[...base,"intentSha256"])||intent.status!=="NETWORK_ACTIVATION_INTENT"||applied.status!=="NETWORK_ACTIVATION_APPLIED"||[intent.policySha256,intent.activationSha256,intent.providerSha256,intent.launcherSha256,intent.workerSha256].some(value=>typeof value!=="string"||!SHA.test(value)))throw new Error();const expected={...intent,status:"NETWORK_ACTIVATION_APPLIED",intentSha256:sha(Buffer.from(`${canonical(intent)}\n`))};if(canonical(applied)!==canonical(expected))throw new Error();return"NETWORK_JOURNAL_BOUND"}catch{return"DRIFT"}}
export function inspectNetworkSettlementState(v){try{if(!exactKeys(v,["journalState","receiptState","nftExact","egressActiveEnabled","brokerInactiveDisabled","gitSocketInactiveDisabled","gitServiceInactive","listenerAbsent","workerWorkspaceAbsent"])||!["INTENT","APPLIED"].includes(v.journalState)||!["ABSENT","EXACT_ACTIVE"].includes(v.receiptState)||["nftExact","egressActiveEnabled","brokerInactiveDisabled","gitSocketInactiveDisabled","gitServiceInactive","listenerAbsent","workerWorkspaceAbsent"].some(k=>typeof v[k]!=="boolean")||!v.nftExact||!v.egressActiveEnabled||!v.gitServiceInactive||!v.workerWorkspaceAbsent)throw new Error();if(!v.brokerInactiveDisabled&&!v.gitSocketInactiveDisabled&&!v.listenerAbsent)return"SETTLE_EXACT_ACTIVE";if(v.brokerInactiveDisabled&&v.gitSocketInactiveDisabled&&v.listenerAbsent&&v.receiptState==="ABSENT")return"ALREADY_EXACT_INERT";throw new Error()}catch{return"DRIFT"}}
export function inspectReceiptTicketDirectoryIdentity(identity){try{if(!exactKeys(identity,["device","inode"])||![identity.device,identity.inode].every(value=>typeof value==="string"&&/^(0|[1-9][0-9]*)$/.test(value)))throw new Error();return{device:identity.device,inode:identity.inode}}catch{return null}}
export function buildNetworkFailureRecord(status,observedAt){if(!["NETWORK_ACTIVATION_FAILED_INERT","NETWORK_CLEANUP_UNPROVEN"].includes(status)||typeof observedAt!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(observedAt))return null;return{schemaVersion:1,status,runId:RUN_ID,activationId:ACTIVATION_ID,authorityReference:AUTHORITY_REFERENCE,observedAt}}
function requireActivationUnitInactive(){const value=run("/usr/bin/systemctl",["is-active",UNIT],{statuses:[3,4]}),mainPid=Number(run("/usr/bin/systemctl",["show",UNIT,"--property=MainPID","--value"],{statuses:[0,1]}));const state=inspectActivationUnitState(value,mainPid);if(state==="DRIFT")throw new Error("activation unit is not proven inactive");if(state==="RESET_REQUIRED")run("/usr/bin/systemctl",["reset-failed",UNIT])}

function rootResult(file,args){const r=spawnSync(file,args,{encoding:"utf8",shell:false,timeout:5000,env:ENV});return{status:r.status,signal:r.signal,errorCode:r.error?.code??null,stdout:String(r.stdout??""),stderr:String(r.stderr??"")}}
function rootSudoPolicyResult(){return rootResult("/usr/bin/systemd-run",["--quiet","--wait","--collect","--pipe","--unit",`williamos-aegis-no-sudo-proof-${RUN_ID}`,"--property","Type=oneshot","--property","User=root","--property","Group=root","--property","NoNewPrivileges=no","/usr/bin/sudo","-U","williamos-fabric","-l"])}
function ensureRootNoSudoProof(){
  const authority=JSON.parse(fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`)),issuedAt=trustedNow(),expected={machineIdSha256:sha(Buffer.from(fs.readFileSync("/etc/machine-id","utf8").trim())),bootId:fs.readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim(),activationHostSha256:authority.bindings.activationHost.sha256,authoritySha256:sha(Buffer.from(canonical(authority)))}
  if(fs.existsSync(NO_SUDO_FILE)){const bytes=exactRootFile(NO_SUDO_FILE,0o444),prior=JSON.parse(bytes);if(!bytes.equals(Buffer.from(`${canonical(prior)}\n`)))throw new Error("root no-sudo proof is not canonical");const state=inspectHostRootNoSudoProof(prior,issuedAt,expected);if(state==="FRESH")return;if(state!=="EXPIRED_EXACT")throw new Error("root no-sudo proof differs");const archive=`${NO_SUDO_FILE}.expired-${sha(bytes)}`;if(fs.existsSync(archive))throw new Error("root no-sudo archive occupied");fs.renameSync(NO_SUDO_FILE,archive);const parent=fs.openSync(path.dirname(NO_SUDO_FILE),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);fs.fsyncSync(parent);fs.closeSync(parent)}
  const observed={passwd:rootResult("/usr/bin/passwd",["-S","williamos-fabric"]),sudo:rootSudoPolicyResult()}
  if(inspectRootNoSudoObservation(observed)!=="ROOT_NO_SUDO_OBSERVED")throw new Error("root no-sudo observation differs")
  const proof={schemaVersion:1,status:"ROOT_NO_SUDO_VERIFIED",activationId:ACTIVATION_ID,authorityReference:AUTHORITY_REFERENCE,runId:RUN_ID,...expected,account:"williamos-fabric",passwordStatus:"L",sudoStatus:0,sudoStdout:observed.sudo.stdout,sudoStderr:"",issuedAt,expiresAt:new Date(Date.parse(issuedAt)+300_000).toISOString()}
  createRootJson(NO_SUDO_FILE,proof,0o444)
}

const normalized = bytes => sha(Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g,"\n")))
function networkUnit(name, active, enabled){return run("/usr/bin/systemctl",["is-active",name],{statuses:[0,3]})===active&&run("/usr/bin/systemctl",["is-enabled",name],{statuses:[0,1,3]})===enabled}
function exactNetworkNft(){
  const worker=Number(run("/usr/bin/id",["-u","williamos-fabric"])),broker=Number(run("/usr/bin/id",["-u","williamos-git-broker"]));if(worker!==999||!Number.isSafeInteger(broker)||broker<=0||broker===worker)return false
  const parsed=JSON.parse(run("/usr/sbin/nft",["-j","list","table","inet","williamos_aegis_remote_dev"]));const items=parsed.nftables.filter(v=>!v.metainfo).map(v=>{const c=structuredClone(v);for(const x of Object.values(c))delete x.handle;return c})
  const uid=right=>({match:{op:"==",left:{meta:{key:"skuid"}},right}}),ip=(protocol,right)=>({match:{op:"==",left:{payload:{protocol,field:"daddr"}},right}}),port={match:{op:"==",left:{payload:{protocol:"tcp",field:"dport"}},right:17734}},rule=expr=>({rule:{family:"inet",table:"williamos_aegis_remote_dev",chain:"output",expr}})
  return canonical(items)===canonical([{table:{family:"inet",name:"williamos_aegis_remote_dev"}},{chain:{family:"inet",table:"williamos_aegis_remote_dev",name:"output",type:"filter",hook:"output",prio:0,policy:"accept"}},rule([uid(worker),ip("ip","192.168.1.156"),{reject:{type:"icmp",expr:"port-unreachable"}}]),rule([uid(worker),ip("ip6","::ffff:192.168.1.156"),{reject:{type:"icmpv6",expr:"port-unreachable"}}]),rule([uid(worker),ip("ip","127.0.0.1"),port,{accept:null}]),rule([uid(broker),ip("ip","127.0.0.1"),port,{accept:null}]),rule([ip("ip","127.0.0.1"),port,{reject:{type:"icmp",expr:"port-unreachable"}}]),rule([uid(worker),{reject:{type:"icmpx",expr:"port-unreachable"}}])])
}
function networkObservation(){
  const listener=run("/usr/bin/ss",["-H","-ltn","sport = :17734"]),connections=run("/usr/bin/ss",["-H","-tn","sport = :17734 or dport = :17734"]),active=run("/usr/bin/systemctl",["list-units","--all","--plain","--no-legend","williamos-aegis-remote-dev-*.service"],{statuses:[0,1]})
  return {nftExact:exactNetworkNft(),egressActiveEnabled:networkUnit("williamos-aegis-remote-dev-egress.service","active","enabled"),brokerInactiveDisabled:networkUnit("williamos-aegis-remote-dev-broker.service","inactive","disabled"),gitSocketInactiveDisabled:networkUnit("williamos-aegis-remote-dev-git-broker.socket","inactive","disabled"),gitServiceInactive:run("/usr/bin/systemctl",["is-active","williamos-aegis-remote-dev-git-broker.service"],{statuses:[3]})==="inactive",listenerAbsent:listener===""&&connections==="",workerWorkspaceAbsent:!active.split(/\r?\n/).some(line=>/williamos-aegis-remote-dev-[0-9a-f-]{36}\.service/.test(line)&&!line.includes("broker"))&&!fs.existsSync(WORKSPACE)}
}
function exactNetworkJournal(file,status){const bytes=exactRootFile(file,0o444),value=JSON.parse(bytes),base=["schemaVersion","status","runId","activationId","authorityReference","proofId","generationId","policySha256","activationSha256","providerSha256","launcherSha256","workerSha256"],keys=status==="NETWORK_ACTIVATION_INTENT"?base:status==="NETWORK_ACTIVATION_APPLIED"?[...base,"intentSha256"]:[...base,"appliedSha256"];if(!exactKeys(value,keys)||!bytes.equals(Buffer.from(`${canonical(value)}\n`))||value.schemaVersion!==1||value.status!==status||value.runId!==RUN_ID||value.activationId!==ACTIVATION_ID||value.authorityReference!==AUTHORITY_REFERENCE||!GUID.test(value.proofId)||!GUID.test(value.generationId)||[value.policySha256,value.activationSha256,value.providerSha256,value.launcherSha256,value.workerSha256].some(entry=>typeof entry!=="string"||!SHA.test(entry))||(status==="NETWORK_ACTIVATION_APPLIED"&&!SHA.test(value.intentSha256))||(status==="NETWORK_ACTIVATION_SETTLED"&&!SHA.test(value.appliedSha256)))throw new Error("network journal differs");return value}
function ensureNetworkSlice(){
  run("/usr/sbin/runuser",["-u","williamos-fabric","--","/usr/bin/env","HOME=/nonexistent","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","XDG_RUNTIME_DIR=/run/user/999","DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/999/bus","/usr/bin/systemctl","--user","start","williamos-aegis-remote-dev.slice"])
  const s=fs.statSync(`/sys/fs/cgroup${NETWORK_SLICE}`,{bigint:true});if(!s.isDirectory())throw new Error("network slice unavailable");return{device:s.dev.toString(),inode:s.ino.toString(),ctimeNs:s.ctimeNs.toString()}
}
function ticketDirectory(){const p="/var/lib/williamos-fabric/remote-dev-launch-tickets",s=fs.statSync(p,{bigint:true}),a=run("/usr/bin/lsattr",["-d","--",p]),gid=Number(run("/usr/bin/id",["-g","williamos-fabric"])),directoryIdentity=inspectReceiptTicketDirectoryIdentity({device:s.dev.toString(),inode:s.ino.toString()});if(!Number.isSafeInteger(gid)||gid<=0||!s.isDirectory()||Number(s.uid)!==0||Number(s.gid)!==gid||Number(s.mode&0o7777n)!==0o3770||!/^[-A-Za-z]*a[-A-Za-z]*\s+/.test(a)||!directoryIdentity)throw new Error("ticket directory differs");return{directoryPath:p,directoryIdentity,ownerUid:0,writerGid:gid,mode:"3770",appendOnly:true}}
function networkReceiptState(intent){if(!fs.existsSync(NETWORK_RECEIPT_FILE))return"ABSENT";try{const bytes=exactRootFile(NETWORK_RECEIPT_FILE,0o444),v=JSON.parse(bytes);if(!bytes.equals(Buffer.from(`${canonical(v)}\n`))||v.runId!==RUN_ID||v.activationId!==ACTIVATION_ID||v.authorityReference!==AUTHORITY_REFERENCE||v.proofId!==intent.proofId||v.enforcementGeneration?.generationId!==intent.generationId)return"FOREIGN";return"EXACT_ACTIVE"}catch{return"FOREIGN"}}
function replaceNetworkReceipt(value){const bytes=Buffer.from(`${canonical(value)}\n`),temp=`${NETWORK_RECEIPT_FILE}.${process.pid}.tmp`;const fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o444);try{fs.writeFileSync(fd,bytes);fs.fchmodSync(fd,0o444);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(temp,NETWORK_RECEIPT_FILE);const p=fs.openSync(path.dirname(NETWORK_RECEIPT_FILE),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);fs.fsyncSync(p);fs.closeSync(p);if(!exactRootFile(NETWORK_RECEIPT_FILE,0o444).equals(bytes))throw new Error("network receipt replacement differs")}
function ensureNetworkBoundaryReceipt(){
  const activationBytes=fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`),authority=JSON.parse(activationBytes),policyBytes=fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/aegis-resident-network-boundary.json`),policy=JSON.parse(policyBytes),journalState=fs.existsSync(NETWORK_APPLIED_FILE)?"APPLIED":fs.existsSync(NETWORK_INTENT_FILE)?"INTENT":"ABSENT",bindings={policySha256:normalized(policyBytes),activationSha256:normalized(activationBytes),providerSha256:authority.bindings.networkProvider.sha256,launcherSha256:authority.bindings.networkLauncher.sha256,workerSha256:authority.bindings.worker.sha256}
  let intent;if(journalState==="ABSENT"){intent={schemaVersion:1,status:"NETWORK_ACTIVATION_INTENT",runId:RUN_ID,activationId:ACTIVATION_ID,authorityReference:AUTHORITY_REFERENCE,proofId:crypto.randomUUID(),generationId:crypto.randomUUID(),...bindings};createRootJson(NETWORK_INTENT_FILE,intent,0o444)}else{intent=exactNetworkJournal(NETWORK_INTENT_FILE,"NETWORK_ACTIVATION_INTENT");if(Object.entries(bindings).some(([key,value])=>intent[key]!==value))throw new Error("network intent binding differs")}
  let observed=networkObservation(),receiptState=networkReceiptState(intent),state=inspectNetworkActivationState({journalState,receiptState,...observed});if(state==="DRIFT")throw new Error("network activation predecessor differs")
  let activationAttempted=true
  try{
    if(state==="ACTIVATE_EXACT_INERT"){activationAttempted=true;run("/usr/bin/systemctl",["enable","--now","williamos-aegis-remote-dev-broker.service","williamos-aegis-remote-dev-git-broker.socket"]);observed=networkObservation();if(!observed.nftExact||!observed.egressActiveEnabled||observed.brokerInactiveDisabled||observed.gitSocketInactiveDisabled||observed.gitServiceInactive!==true||observed.listenerAbsent||!observed.workerWorkspaceAbsent)throw new Error("network activation postcondition differs")}
    const cgroup=ensureNetworkSlice();let applied;if(!fs.existsSync(NETWORK_APPLIED_FILE)){applied={...intent,status:"NETWORK_ACTIVATION_APPLIED",intentSha256:sha(Buffer.from(`${canonical(intent)}\n`))};createRootJson(NETWORK_APPLIED_FILE,applied,0o444)}else applied=exactNetworkJournal(NETWORK_APPLIED_FILE,"NETWORK_ACTIVATION_APPLIED");if(inspectNetworkJournalBinding(intent,applied)!=="NETWORK_JOURNAL_BOUND")throw new Error("network applied journal differs from intent")
    const observedAt=trustedNow(),receipt={schemaVersion:1,proofId:intent.proofId,providerId:policy.policyId,activationId:ACTIVATION_ID,authorityReference:AUTHORITY_REFERENCE,runId:RUN_ID,observedAt,expiresAt:new Date(Date.parse(observedAt)+30_000).toISOString(),bootId:fs.readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim(),controlGroup:NETWORK_SLICE,controlGroupIdentity:cgroup,enforcementGeneration:{generationId:intent.generationId,rulesetSha256:sha(Buffer.from(canonical(policy.enforcement)))},launcherSha256:intent.launcherSha256,workerSha256:intent.workerSha256,launchAuthority:{algorithm:"Ed25519",publicKeyPath:"/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem",publicKeySha256:sha(exactRootFile("/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem",0o444))},ticketConsumption:ticketDirectory(),nodeId:"aegis",account:"williamos-fabric",machineIdSha256:authority.executionIdentity.machineIdSha256,controlPlaneCommit:inspectPreparedState(),policySha256:intent.policySha256,activationSha256:intent.activationSha256,providerSha256:intent.providerSha256,enforcement:policy.enforcement}
    replaceNetworkReceipt(receipt);return receipt
  }catch(error){if(activationAttempted){try{settleNetworkBoundary(false);writeRootJson(FAILURE_FILE,buildNetworkFailureRecord("NETWORK_ACTIVATION_FAILED_INERT",trustedNow()))}catch(cleanupError){writeRootJson(FAILURE_FILE,buildNetworkFailureRecord("NETWORK_CLEANUP_UNPROVEN",trustedNow()));throw cleanupError}}throw error}
}
function settleNetworkBoundary(terminal=true){
  if(!fs.existsSync(NETWORK_INTENT_FILE))throw new Error("network settlement journal unavailable")
  const intent=exactNetworkJournal(NETWORK_INTENT_FILE,"NETWORK_ACTIVATION_INTENT"),journalState=fs.existsSync(NETWORK_APPLIED_FILE)?"APPLIED":"INTENT";let applied;if(journalState==="APPLIED"){applied=exactNetworkJournal(NETWORK_APPLIED_FILE,"NETWORK_ACTIVATION_APPLIED");if(inspectNetworkJournalBinding(intent,applied)!=="NETWORK_JOURNAL_BOUND")throw new Error("network applied journal differs from intent")}
  const receiptState=networkReceiptState(intent),observedBefore=networkObservation(),settlementState=inspectNetworkSettlementState({journalState,receiptState,...observedBefore});if(settlementState==="DRIFT")throw new Error("network settlement predecessor differs")
  if(settlementState==="SETTLE_EXACT_ACTIVE"){run("/usr/bin/systemctl",["disable","--now","williamos-aegis-remote-dev-broker.service","williamos-aegis-remote-dev-git-broker.socket"]);run("/usr/bin/systemctl",["stop","williamos-aegis-remote-dev-git-broker.service"],{statuses:[0,5]})}
  if(receiptState==="EXACT_ACTIVE"){fs.unlinkSync(NETWORK_RECEIPT_FILE);const p=fs.openSync(path.dirname(NETWORK_RECEIPT_FILE),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);fs.fsyncSync(p);fs.closeSync(p)}
  const observed=networkObservation();if(!observed.nftExact||!observed.egressActiveEnabled||!observed.brokerInactiveDisabled||!observed.gitSocketInactiveDisabled||!observed.gitServiceInactive||!observed.listenerAbsent)throw new Error("network inert settlement differs")
  if(terminal){if(!applied)throw new Error("terminal network settlement requires applied journal");const settled={...intent,status:"NETWORK_ACTIVATION_SETTLED",appliedSha256:sha(Buffer.from(`${canonical(applied)}\n`))};if(!fs.existsSync(NETWORK_SETTLED_FILE))createRootJson(NETWORK_SETTLED_FILE,settled,0o444);else if(canonical(exactNetworkJournal(NETWORK_SETTLED_FILE,"NETWORK_ACTIVATION_SETTLED"))!==canonical(settled))throw new Error("network settled journal differs")}
}

function proveCanonicalControlRepository() {
  const exactConfig = `[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n[remote "origin"]\n\turl = ssh://git@ssh.github.com:443/bsvalues/terragroq.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n`
  for (const candidate of [CONTROL_REPOSITORY, `${CONTROL_REPOSITORY}/.git`]) { const s = fs.lstatSync(candidate); if (!trustedParents(candidate) || !s.isDirectory() || s.isSymbolicLink() || s.uid !== 0 || s.gid !== 0 || (s.mode & 0o7777) !== 0o700) throw new Error("canonical control tree trust differs") }
  if (!exactRootFile(`${CONTROL_REPOSITORY}/.git/config`, 0o600).equals(Buffer.from(exactConfig))) throw new Error("canonical control Git config differs")
  const hooks = "/usr/local/share/williamos/empty-git-hooks", hs = fs.lstatSync(hooks)
  if (!trustedParents(hooks) || !hs.isDirectory() || hs.isSymbolicLink() || hs.uid !== 0 || hs.gid !== 0 || (hs.mode & 0o7777) !== 0o555 || fs.readdirSync(hooks).length !== 0) throw new Error("canonical empty hooks differ")
  const git = args => run("/usr/bin/git", ["-c", `safe.directory=${CONTROL_REPOSITORY}`, "-c", "core.hooksPath=/usr/local/share/williamos/empty-git-hooks", "-C", CONTROL_REPOSITORY, ...args])
  const head = git(["rev-parse", "HEAD"]), main = git(["rev-parse", "refs/heads/main"]), status = git(["status", "--porcelain=v1", "--untracked-files=all"])
  if (head !== main || status !== "") throw new Error("canonical control checkout differs")
  return head
}

function prepareSnapshot(head = proveCanonicalControlRepository()) {
  if (fs.existsSync(STATE_ROOT) || fs.existsSync(PREPARING_ROOT)) throw new Error("activation state already exists")
  const fabricGid = Number(run("/usr/bin/id", ["-g", "williamos-fabric"]))
  const stagedSnapshot=`${PREPARING_ROOT}/control`, stagedMints=`${PREPARING_ROOT}/mints`
  fs.mkdirSync(PREPARING_ROOT, { mode: 0o750 }); fs.chownSync(PREPARING_ROOT, 0, fabricGid); fs.chmodSync(PREPARING_ROOT, 0o750)
  fs.mkdirSync(stagedMints, { mode: 0o700 })
  fs.cpSync(CONTROL_REPOSITORY, stagedSnapshot, { recursive: true, dereference: false, errorOnExist: true })
  for (const entry of fs.readdirSync(stagedSnapshot, { recursive: true })) { const target = path.join(stagedSnapshot, String(entry)); const s = fs.lstatSync(target); if (s.isSymbolicLink()) throw new Error("snapshot contains symlink"); fs.chownSync(target, 0, 0); fs.chmodSync(target, s.isDirectory() ? 0o555 : 0o444) }
  fs.chmodSync(stagedSnapshot, 0o555)
  writeRootJson(`${PREPARING_ROOT}/prepared.json`, {schemaVersion:1,status:"ACTIVATION_SNAPSHOT_PREPARED",runId:RUN_ID,controlCommit:head}, 0o444)
  fs.renameSync(PREPARING_ROOT,STATE_ROOT); const pfd=fs.openSync(path.dirname(STATE_ROOT),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);fs.fsyncSync(pfd);fs.closeSync(pfd)
  return head
}

function inspectPreparedState(){const v=JSON.parse(exactRootFile(PREPARED_FILE,0o444));if(!exactKeys(v,["schemaVersion","status","runId","controlCommit"])||v.schemaVersion!==1||v.status!=="ACTIVATION_SNAPSHOT_PREPARED"||v.runId!==RUN_ID||!/^[a-f0-9]{40}$/.test(v.controlCommit))throw new Error("prepared activation state differs");return v.controlCommit}
function reconcilePreparedSnapshot(currentCommit){const preparedCommit=inspectPreparedState(),authority=JSON.parse(fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`)),candidate={runId:authority.run.runId,workOrderId:authority.workOrderId,issue:authority.issue,repository:authority.target.repository,baseRef:authority.target.baseRef,baseSha:authority.trustedMain.target.pinnedCommit,nodeId:authority.target.nodeId,workspace:authority.target.workspace,branch:authority.target.branch,operations:authority.operations,resources:authority.resources,network:authority.network,executionIdentity:authority.executionIdentity},scopeSha256=sha(Buffer.from(fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`,"utf8").replace(/\r\n/g,"\n"))),claimKeySha256=sha(Buffer.from(canonical({authority_reference:AUTHORITY_REFERENCE,scope_sha256:scopeSha256}))),claimPath=`${LEDGER_ROOT}/claim-${claimKeySha256}.json`,state=inspectPreparedSnapshotRecovery({preparedCommit,currentCommit,entries:fs.readdirSync(STATE_ROOT),claimExists:fs.existsSync(claimPath),phaseExists:fs.existsSync(PHASE_FILE),sessionExists:fs.existsSync(SESSION_FILE)});if(state==="MATCH")return;if(state!=="ARCHIVE_EXACT_PRECLAIM")throw new Error("prepared snapshot recovery differs");const archive=`${STATE_ROOT}.preclaim-${preparedCommit}`;if(fs.existsSync(archive))throw new Error("prepared snapshot archive occupied");fs.renameSync(STATE_ROOT,archive);const fd=fs.openSync(path.dirname(STATE_ROOT),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);fs.fsyncSync(fd);fs.closeSync(fd);prepareSnapshot()}
function recoverStrandedPhase(){
  const authority=JSON.parse(fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`)),candidate={runId:authority.run.runId,workOrderId:authority.workOrderId,issue:authority.issue,repository:authority.target.repository,baseRef:authority.target.baseRef,baseSha:authority.trustedMain.target.pinnedCommit,nodeId:authority.target.nodeId,workspace:authority.target.workspace,branch:authority.target.branch,operations:authority.operations,resources:authority.resources,network:authority.network,executionIdentity:authority.executionIdentity}
  const scopeSha256=sha(Buffer.from(fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`,"utf8").replace(/\r\n/g,"\n"))),requestSha256=sha(Buffer.from(canonical(candidate))),claimKeySha256=sha(Buffer.from(canonical({authority_reference:AUTHORITY_REFERENCE,scope_sha256:scopeSha256}))),claimPath=`${LEDGER_ROOT}/claim-${claimKeySha256}.json`
  if(!fs.existsSync(claimPath))return false
   const claim=exactLedgerFile(claimPath),lease=exactLedgerFile(`${LEDGER_ROOT}/resident-aegis-active.json`),proof=inspectStrandedActivationLedger(claim,lease,{claimKeySha256,requestSha256,scopeSha256});if(proof.status!=="STRANDED_LEASE_RECOVERY_REQUIRED")throw new Error("stranded activation ledger differs")
   let observedStartTicks=null;try{observedStartTicks=startTicks(lease.holder.pid)}catch(error){if(error?.code!=="ENOENT")throw error}const currentBootId=fs.readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim(),holderState=inspectLeaseHolderState(lease.holder,currentBootId,observedStartTicks);if(holderState!=="DEAD")throw new Error("stranded activation lease holder is not proven dead")
  writeRootJson(PHASE_FILE,{schemaVersion:1,phase:"ACTIVATION_CLAIMED_LEASED",runId:RUN_ID,claimId:proof.claimId,leaseId:proof.leaseId,authorityReference:AUTHORITY_REFERENCE,claimedAt:proof.claimedAt,expiresAt:authority.run.expiresAt});return true
}

function sessionEnvelope(payload) { return { payload, signature: crypto.sign(null, Buffer.from(canonical(payload)), exactRootFile(PRIVATE_KEY, 0o400)).toString("base64") } }

async function childMain() {
  if (process.getuid?.() === 0 || os.userInfo().username !== "williamos-fabric") throw new Error("activation child identity differs")
  const authority = JSON.parse(fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`))
  const module = await import(`${pathToFileURL(`${SNAPSHOT}/scripts/execution-fabric/live/remote-dev-offload-activation.mjs`).href}?run=${RUN_ID}`)
  const candidate = { runId: authority.run.runId, workOrderId: authority.workOrderId, issue: authority.issue, repository: authority.target.repository, baseRef: authority.target.baseRef, baseSha: authority.trustedMain.target.pinnedCommit, nodeId: authority.target.nodeId, workspace: authority.target.workspace, branch: authority.target.branch, operations: authority.operations, resources: authority.resources, network: authority.network, executionIdentity: authority.executionIdentity }
  const authorized = await module.authorizeRemoteDevActivation(authority, candidate)
  if (authorized.status !== "AUTHORIZED_SINGLE_USE" || authorized.executionAuthorized !== true) { process.send?.({type:"blocked",value:authorized}); throw new Error("activation authorization blocked") }
  process.send?.({ type: "authorized", value: authorized })
  process.on("message", async message => {
    if (message?.type !== "settle") return
    const settled = await module.settleRemoteDevActivation(authorized.session)
    process.send?.({ type: "settled", value: settled })
    process.exit(settled.status === "CONSUMED_SINGLE_USE" ? 0 : 2)
  })
}

async function recoveryChildMain() {
  if (process.getuid?.() === 0 || os.userInfo().username !== "williamos-fabric") throw new Error("activation recovery identity differs")
  const authority = JSON.parse(fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`))
  const module = await import(`${pathToFileURL(`${SNAPSHOT}/scripts/execution-fabric/live/remote-dev-offload-activation.mjs`).href}?recover=${RUN_ID}`)
  const candidate = { runId: authority.run.runId, workOrderId: authority.workOrderId, issue: authority.issue, repository: authority.target.repository, baseRef: authority.target.baseRef, baseSha: authority.trustedMain.target.pinnedCommit, nodeId: authority.target.nodeId, workspace: authority.target.workspace, branch: authority.target.branch, operations: authority.operations, resources: authority.resources, network: authority.network, executionIdentity: authority.executionIdentity }
  const phase = JSON.parse(exactRootFile(PHASE_FILE, 0o444))
  if (inspectActivationHostPhase(phase, trustedNow()).status !== "RECOVERY_REQUIRED") throw new Error("activation recovery phase differs")
  const settled = await module.recoverRemoteDevActivationSettlement(authority, candidate, { runId: phase.runId, claimId: phase.claimId, leaseId: phase.leaseId })
  if (settled.status !== "SETTLEMENT_EVIDENCE_VERIFIED") throw new Error(JSON.stringify(settled))
  process.send?.({ type: "recovered", value: settled })
}

async function daemonMain() {
  if (process.getuid?.() !== 0 || process.argv[1] !== INSTALLED_SELF) throw new Error("fixed root daemon required")
  const snapshotGit = args => run("/usr/bin/git", ["-c", `safe.directory=${SNAPSHOT}`, "-c", "core.hooksPath=/usr/local/share/williamos/empty-git-hooks", "-C", SNAPSHOT, ...args])
  const head = snapshotGit(["rev-parse", "HEAD"])
  const account = run("/usr/bin/id", ["-u", "williamos-fabric"]), group = run("/usr/bin/id", ["-g", "williamos-fabric"])
  const child = fork(INSTALLED_SELF, ["child"], { uid: Number(account), gid: Number(group), cwd: SNAPSHOT, stdio: ["ignore", "ignore", "ignore", "ipc"], env: ENV })
  const daemonPid = process.pid, daemonStartTicks = startTicks(daemonPid)
  child.on("message", message => {
    if (message?.type === "authorized") {
      const value = message.value
      const payload = { schemaVersion: 1, activationId: ACTIVATION_ID, authorityReference: AUTHORITY_REFERENCE, runId: value.runId, claimId: value.claimId, leaseId: value.leaseId, proofId: value.networkProofId, noSudoProofSha256: value.noSudoProofSha256, workspace: WORKSPACE, branch: BRANCH, baseSha: BASE_SHA, issuedAt: trustedNow(), expiresAt: JSON.parse(fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`)).run.expiresAt, daemonPid, daemonStartTicks }
      if (inspectActivationSessionToken(payload, trustedNow()).status !== "ACTIVE_SESSION_VERIFIED" || head !== snapshotGit(["rev-parse", "HEAD"])) throw new Error("authorized session differs")
      writeRootJson(PHASE_FILE, { schemaVersion: 1, phase: "ACTIVATION_CLAIMED_LEASED", runId: RUN_ID, claimId: payload.claimId, leaseId: payload.leaseId, authorityReference: AUTHORITY_REFERENCE, claimedAt: payload.issuedAt, expiresAt: payload.expiresAt })
      writeRootJson(SESSION_FILE, sessionEnvelope(payload))
    } else if (message?.type === "blocked") {
      const value=message.value,reason=Array.isArray(value?.reasons)&&value.reasons.length===1?value.reasons[0]:null
      writeRootJson(FAILURE_FILE,{schemaVersion:1,status:"ACTIVATION_PRECLAIM_BLOCKED",runId:RUN_ID,reasonCode:String(reason?.code??value?.reasonCode??"ACTIVATION_HOST_DRIFT").slice(0,128),detail:String(reason?.detail??value?.detail??"activation authorization blocked").slice(0,512),observedAt:trustedNow()})
    } else if (message?.type === "settled") {
      writeRootJson(SETTLEMENT_FILE, message.value)
      process.exit(message.value?.status === "CONSUMED_SINGLE_USE" ? 0 : 2)
    }
  })
  process.on("SIGUSR1", () => child.send({ type: "settle" }))
  child.on("exit", code => { if (!fs.existsSync(SETTLEMENT_FILE)) process.exit(code ?? 2) })
}

function startMain() {
  if (process.getuid?.() !== 0 || process.argv[1] !== INSTALLED_SELF) throw new Error("fixed root host required")
  verifyBridgeReceiptLive()
   if (fs.existsSync(SETTLEMENT_FILE)) { run("/usr/bin/systemctl",["disable","--now","williamos-aegis-remote-dev-activation.socket"]);process.stdout.write(exactRootFile(SETTLEMENT_FILE,0o444)); return }
  if (fs.existsSync(SESSION_FILE)) {
    const envelope = JSON.parse(exactRootFile(SESSION_FILE, 0o444)); const value = envelope.payload
    if (!crypto.verify(null, Buffer.from(canonical(value)), exactRootFile(PUBLIC_KEY, 0o444), Buffer.from(envelope.signature, "base64")) || inspectActivationSessionToken(value, value.issuedAt).status !== "ACTIVE_SESSION_VERIFIED") throw new Error("existing activation session differs")
    let alive=false;try{alive=startTicks(value.daemonPid)===value.daemonStartTicks}catch(error){if(error?.code!=="ENOENT")throw error}
    if(alive&&inspectActivationSessionToken(value,trustedNow()).status==="ACTIVE_SESSION_VERIFIED"){process.stdout.write(fs.readFileSync(SESSION_FILE));return}
  }
  if (fs.existsSync(PHASE_FILE)) {
    requireActivationUnitInactive()
    const phase = JSON.parse(exactRootFile(PHASE_FILE, 0o444)); if (inspectActivationHostPhase(phase, trustedNow()).status !== "RECOVERY_REQUIRED") throw new Error("existing activation phase differs")
    const account = Number(run("/usr/bin/id", ["-u", "williamos-fabric"])), group = Number(run("/usr/bin/id", ["-g", "williamos-fabric"]))
    const child = fork(INSTALLED_SELF, ["recover"], { uid: account, gid: group, cwd: SNAPSHOT, stdio: ["ignore", "ignore", "ignore", "ipc"], env: ENV })
    child.on("message", message => { if (message?.type === "recovered") writeRootJson(SETTLEMENT_FILE, message.value) })
    for (let index = 0; index < 100 && !fs.existsSync(SETTLEMENT_FILE); index++) spawnSync("/usr/bin/sleep", ["0.1"])
    if (!fs.existsSync(SETTLEMENT_FILE)) throw new Error("activation recovery settlement unavailable")
    process.stdout.write(fs.readFileSync(SETTLEMENT_FILE)); return
  }
  const currentCommit=proveCanonicalControlRepository()
  if (!fs.existsSync(STATE_ROOT)) prepareSnapshot(currentCommit)
  requireActivationUnitInactive()
  if (recoverStrandedPhase()) return startMain()
  reconcilePreparedSnapshot(currentCommit)
  ensureRootNoSudoProof()
  ensureNetworkBoundaryReceipt()
  const result = run("/usr/bin/systemd-run", ["--unit", UNIT.replace(/\.service$/, ""), "--property", "Type=simple", "--property", "NoNewPrivileges=yes", "--property", "PrivateTmp=yes", "--property", "ProtectSystem=strict", "--property", `ReadWritePaths=${STATE_ROOT} /var/lib/williamos/fabric/ledger /var/lib/williamos-fabric/remote-dev-launch-tickets`, "/usr/bin/node", INSTALLED_SELF, "daemon"])
  for (let index = 0; index < 450 && !fs.existsSync(SESSION_FILE); index++) spawnSync("/usr/bin/sleep", ["0.1"])
  if (!fs.existsSync(SESSION_FILE)) {run("/usr/bin/systemctl",["stop",UNIT]);requireActivationUnitInactive();settleNetworkBoundary(false);const detail=fs.existsSync(FAILURE_FILE)?JSON.parse(exactRootFile(FAILURE_FILE,0o444)).detail:"activation daemon did not publish session";throw new Error(`${detail}: ${result}`)}
  process.stdout.write(fs.readFileSync(SESSION_FILE))
}

function mintMain(requestPath, packetPath, patchPath) {
  if (process.getuid?.() !== 0 || process.argv[1] !== INSTALLED_SELF) throw new Error("fixed root ticket minter required")
  verifyBridgeReceiptLive()
  if (fs.existsSync(SETTLEMENT_FILE)||fs.existsSync(NETWORK_SETTLED_FILE)) throw new Error("terminal activation cannot mint")
  const sessionEnvelope = JSON.parse(exactRootFile(SESSION_FILE, 0o444)); const payload = sessionEnvelope.payload
  if (!crypto.verify(null, Buffer.from(canonical(payload)), exactRootFile(PUBLIC_KEY, 0o444), Buffer.from(sessionEnvelope.signature, "base64"))) throw new Error("session signature differs")
  if (inspectActivationSessionToken(payload, trustedNow()).status !== "ACTIVE_SESSION_VERIFIED" || startTicks(payload.daemonPid) !== payload.daemonStartTicks) throw new Error("active daemon differs")
  const request = JSON.parse(fs.readFileSync(requestPath)), packetBytes = fs.readFileSync(packetPath), patchBytes = fs.readFileSync(patchPath)
  if (inspectTicketMintRequest(request, packetBytes, patchBytes).status !== "TICKET_REQUEST_VERIFIED") throw new Error("ticket request unproven")
  const packet = JSON.parse(packetBytes)
  if (packet.runId !== RUN_ID || packet.workspace !== WORKSPACE || packet.branch !== BRANCH || packet.baseSha !== BASE_SHA) throw new Error("packet session binding differs")
  const mintKey = sha(Buffer.from(canonical({ runId: RUN_ID, claimId: payload.claimId, operation: request.operation, attempt: request.attempt, previousEvidenceSha256: request.previousEvidenceSha256, packetSha256: request.packetSha256, patchSha256: request.patchSha256 })))
  const mintFile = `${MINT_ROOT}/${mintKey}.json`
  ensureNetworkBoundaryReceipt()
  if (!fs.existsSync(mintFile)) {
    const issuedAt = trustedNow(), expiresAt = new Date(Date.parse(issuedAt) + 30_000).toISOString()
    const ticketPayload = { schemaVersion: 1, ticketId: crypto.randomUUID(), activationId: ACTIVATION_ID, authorityReference: AUTHORITY_REFERENCE, runId: RUN_ID, proofId: payload.proofId, claimId: payload.claimId, leaseId: payload.leaseId, operation: request.operation, attempt: request.attempt, previousEvidenceSha256: request.previousEvidenceSha256, packetSha256: request.packetSha256, patchSha256: request.patchSha256, workerSha256: JSON.parse(fs.readFileSync(`${SNAPSHOT}/config/execution-fabric/remote-dev-offload-v1-activation.json`)).bindings.worker.sha256, issuedAt, expiresAt }
    const ticket = { payload: ticketPayload, signature: crypto.sign(null, Buffer.from(canonical(ticketPayload)), exactRootFile(PRIVATE_KEY, 0o400)).toString("base64") }
    const record = { schemaVersion: 1, mintKey, runId: RUN_ID, claimId: payload.claimId, operation: request.operation, attempt: request.attempt, previousEvidenceSha256: request.previousEvidenceSha256, packetSha256: request.packetSha256, patchSha256: request.patchSha256, ticketSha256: sha(Buffer.from(`${canonical(ticket)}\n`)) }
    try { createRootJson(mintFile, { record, ticket }, 0o400) } catch (error) { if (error?.code !== "EEXIST") throw error }
  }
  const stored = JSON.parse(exactRootFile(mintFile, 0o400)); const expected = { schemaVersion: 1, mintKey, runId: RUN_ID, claimId: payload.claimId, operation: request.operation, attempt: request.attempt, previousEvidenceSha256: request.previousEvidenceSha256, packetSha256: request.packetSha256, patchSha256: request.patchSha256, ticketSha256: sha(Buffer.from(`${canonical(stored.ticket)}\n`)) }
  if (!exactKeys(stored, ["record", "ticket"]) || inspectMintRecord(expected, stored.record).status !== "MINT_REPLAY_EXACT") throw new Error("durable mint record differs")
  process.stdout.write(Buffer.from(`${canonical(stored.ticket)}\n`))
}

function settleMain() {
  verifyBridgeReceiptLive()
  if(fs.existsSync(SETTLEMENT_FILE)){settleNetworkBoundary();run("/usr/bin/systemctl",["disable","--now","williamos-aegis-remote-dev-activation.socket"]);process.stdout.write(exactRootFile(SETTLEMENT_FILE,0o444));return}
  const envelope = JSON.parse(exactRootFile(SESSION_FILE, 0o444)); const payload = envelope.payload
  if (!crypto.verify(null, Buffer.from(canonical(payload)), exactRootFile(PUBLIC_KEY, 0o444), Buffer.from(envelope.signature, "base64")) || inspectActivationSessionToken(payload, payload.issuedAt).status !== "ACTIVE_SESSION_VERIFIED" || inspectActivationHostPhase(JSON.parse(exactRootFile(PHASE_FILE, 0o444)), trustedNow()).status !== "RECOVERY_REQUIRED" || startTicks(payload.daemonPid) !== payload.daemonStartTicks) throw new Error("active daemon differs")
  process.kill(payload.daemonPid, "SIGUSR1")
  for (let index = 0; index < 100 && !fs.existsSync(SETTLEMENT_FILE); index++) spawnSync("/usr/bin/sleep", ["0.1"])
  if (!fs.existsSync(SETTLEMENT_FILE)) throw new Error("activation settlement unavailable")
  settleNetworkBoundary()
  run("/usr/bin/systemctl", ["disable", "--now", "williamos-aegis-remote-dev-activation.socket"])
  process.stdout.write(fs.readFileSync(SETTLEMENT_FILE))
}

function serveMain() {
  const request = JSON.parse(fs.readFileSync(0, "utf8"))
  if (!exactKeys(request, request.action === "mint" ? ["action", "request", "packetBase64", "patchBase64"] : ["action"])) throw new Error("activation bridge request differs")
  if (request.action === "start") return startMain()
  if (request.action === "settle") return settleMain()
  if (request.action !== "mint" || typeof request.request !== "object" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.packetBase64) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.patchBase64)) throw new Error("activation bridge mint differs")
  const packet = Buffer.from(request.packetBase64, "base64"), patch = Buffer.from(request.patchBase64, "base64")
  if (packet.length < 2 || packet.length > 1_048_576 || patch.length > 1_048_576) throw new Error("activation bridge payload size differs")
  const root = fs.mkdtempSync(`${STATE_ROOT}/request-`), requestPath = `${root}/request.json`, packetPath = `${root}/packet.json`, patchPath = `${root}/patch.bin`
  try {
    fs.writeFileSync(requestPath, `${canonical(request.request)}\n`, { mode: 0o400 }); fs.writeFileSync(packetPath, packet, { mode: 0o400 }); fs.writeFileSync(patchPath, patch, { mode: 0o400 })
    mintMain(requestPath, packetPath, patchPath)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    if (process.argv[2] === "child") await childMain()
    else if (process.argv[2] === "recover") await recoveryChildMain()
    else if (process.argv[2] === "daemon") await daemonMain()
    else if (process.argv[2] === "start") startMain()
    else if (process.argv[2] === "mint") mintMain(process.argv[3], process.argv[4], process.argv[5])
    else if (process.argv[2] === "settle") settleMain()
    else if (process.argv[2] === "serve") serveMain()
    else throw new Error("operation differs")
  } catch (error) { console.log(canonical(blocked(String(error.message)))); process.exitCode = 2 }
}
