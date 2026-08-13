#!/usr/bin/node
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const SELF = "/usr/local/libexec/williamos-aegis-remote-dev-activation-bridge-bootstrap.mjs"
const OWNER_KEY = "/etc/williamos-fabric/owner-prerequisite-authority.pem"
const CONTROL = "/var/lib/williamos-remote-dev/control/terragroq"
const RECEIPT = "/var/lib/williamos-fabric/remote-dev-activation-bridge-verified.json"
const CLAIM_ROOT = "/var/lib/williamos-fabric/remote-dev-activation-bridge-claims"
const RUN_ID = "c9889658-bad2-43e2-8def-a0a9c9df5d3c"
const ASSET_LAYOUT = Object.freeze([
  ["scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs","/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs","0555"],
  ["scripts/execution-fabric/provision/assets/aegis-remote-dev-activation-peer.py","/usr/local/libexec/williamos-aegis-remote-dev-activation-peer.py","0555"],
  ["scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation.socket","/etc/systemd/system/williamos-aegis-remote-dev-activation.socket","0444"],
  ["scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation@.service","/etc/systemd/system/williamos-aegis-remote-dev-activation@.service","0444"],
  ["scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs","/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs","0555"],
])
const SSH_ENTRYPOINT = "/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs"
const SSH_ENTRYPOINT_PREDECESSOR_SHA256 = "1eba36323a42353623b6659b146c7b7096d290fe883ae302524b12363e17c01f"
const ACTIVATION_HOST = "/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs"
const ACTIVATION_HOST_PREDECESSOR_SHA256 = "44a5b12ad5a2f65a9c1a841105626aaded996c14d1ca32fc893d8fcc8ca4b152"
const BRIDGE_RECEIPT_PREDECESSOR_SHA256 = "5c70148840df17de905198c3aceb1f16d5a5efe7a8b25291c7b6d0bfee9b7293"
const SHA = /^[a-f0-9]{64}$/; const SHA40 = /^[a-f0-9]{40}$/; const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const canonical = value => value === null || ["string","boolean","number"].includes(typeof value) ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex")
const exactKeys = (v,k) => JSON.stringify(Object.keys(v??{}).sort()) === JSON.stringify([...k].sort())
const env = Object.freeze({HOME:"/nonexistent",PATH:"/usr/sbin:/usr/bin:/sbin:/bin",LANG:"C",LC_ALL:"C",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_NO_REPLACE_OBJECTS:"1"})
function run(file,args,statuses=[0]) { const r=spawnSync(file,args,{encoding:"utf8",shell:false,timeout:30_000,env}); if(r.error||r.signal||!statuses.includes(r.status)) throw new Error(`${path.basename(file)} failed`); return String(r.stdout??"").trim() }
function parents(file){let c="/";for(const p of path.dirname(file).slice(1).split("/").filter(Boolean)){c=path.join(c,p);const s=fs.lstatSync(c);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))return false}return true}
function rootFile(file,mode){const s=fs.lstatSync(file);if(!parents(file)||!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||s.gid!==0||(s.mode&0o7777)!==mode)throw new Error(`${file} trust differs`);return fs.readFileSync(file)}
function rootSource(file){const s=fs.lstatSync(file);if(!parents(file)||!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||s.gid!==0||(s.mode&0o022)!==0)throw new Error(`${file} source trust differs`);return fs.readFileSync(file)}
function trustedNow(){const v=run("/usr/bin/date",["-u","+%Y-%m-%dT%H:%M:%S.%3NZ"]);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v))throw new Error("trusted time differs");return v}
function proveControlRepository(){const config=`[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n[remote "origin"]\n\turl = ssh://git@ssh.github.com:443/bsvalues/terragroq.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n`;for(const p of[CONTROL,`${CONTROL}/.git`]){const s=fs.lstatSync(p);if(!parents(p)||!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o7777)!==0o700)throw new Error("control repository trust differs")}if(!rootFile(`${CONTROL}/.git/config`,0o600).equals(Buffer.from(config)))throw new Error("control Git config differs");const h="/usr/local/share/williamos/empty-git-hooks",s=fs.lstatSync(h);if(!parents(h)||!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o7777)!==0o555||fs.readdirSync(h).length!==0)throw new Error("empty hooks trust differs")}
function fsyncParent(file){const fd=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}
function create(file,bytes,mode){const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,mode);try{fs.writeFileSync(fd,bytes);fs.fchmodSync(fd,mode);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fsyncParent(file)}
function install(source,destination,mode){if(!parents(destination))throw new Error("bridge destination parent trust differs");const bytes=rootSource(source),temp=`${destination}.${process.pid}.tmp`;create(temp,bytes,mode);fs.renameSync(temp,destination);fsyncParent(destination);if(!rootFile(destination,mode).equals(bytes))throw new Error("installed bridge asset differs")}
function replace(file,bytes,mode){const temp=`${file}.${process.pid}.tmp`;create(temp,bytes,mode);fs.renameSync(temp,file);fsyncParent(file);if(!rootFile(file,mode).equals(bytes))throw new Error("replaced bridge receipt differs")}
function receiptFor(p){return {schemaVersion:1,status:"ACTIVATION_BRIDGE_VERIFIED",runId:RUN_ID,authorityId:p.authorityId,authoritySha256:sha(Buffer.from(canonical(p))),machineIdSha256:p.machineIdSha256,bootId:p.bootId,controlCommit:p.controlCommit,prerequisiteReceiptSha256:p.prerequisiteReceiptSha256,assets:p.assets.map(({destination,sha256,mode})=>({destination,sha256,mode})),schedulerEnabled:false,standingAuthority:false,executionAuthorized:false}}
export function inspectBridgeDestinationState(destination, observedSha256, observedMode, expectedSha256){if(observedSha256===expectedSha256)return "MATCH";if(observedMode==="0555"&&((destination===SSH_ENTRYPOINT&&observedSha256===SSH_ENTRYPOINT_PREDECESSOR_SHA256)||(destination===ACTIVATION_HOST&&observedSha256===ACTIVATION_HOST_PREDECESSOR_SHA256)))return "EXACT_PREDECESSOR";return "DRIFT"}
export function inspectBridgeReceiptState(observedSha256,expectedSha256){if(observedSha256===expectedSha256)return "MATCH";if(observedSha256===BRIDGE_RECEIPT_PREDECESSOR_SHA256)return "EXACT_PREDECESSOR";return "DRIFT"}

export function inspectBridgeBootstrapAuthority(envelope, now, selfSha) {
  try {
    if(!exactKeys(envelope,["payload","signature"])||typeof envelope.signature!=="string")throw new Error("envelope differs")
    const p=envelope.payload,k=["schemaVersion","operation","authorityId","runId","issuedAt","expiresAt","singleUse","machineIdSha256","bootId","controlCommit","verifierSha256","prerequisiteReceiptSha256","assets"]
    const n=Date.parse(now),i=Date.parse(p?.issuedAt),e=Date.parse(p?.expiresAt)
    if(!exactKeys(p,k)||p.schemaVersion!==1||p.operation!=="INSTALL_ACTIVATION_BRIDGE"||!GUID.test(p.authorityId)||p.runId!==RUN_ID||p.singleUse!==true||!SHA.test(p.machineIdSha256)||!GUID.test(p.bootId)||!SHA40.test(p.controlCommit)||p.verifierSha256!==selfSha||p.prerequisiteReceiptSha256!=="41ea35adc284b37e381f1162e5cd2315f8a0ef2da5c2326e1a224c15e4fa541c"||!Array.isArray(p.assets)||p.assets.length!==5||![n,i,e].every(Number.isFinite)||n<i||n>=e||e-i>900000)throw new Error("authority differs")
    for(let index=0;index<p.assets.length;index++){const a=p.assets[index],layout=ASSET_LAYOUT[index];if(!exactKeys(a,["source","destination","sha256","mode"])||a.source!==layout[0]||a.destination!==layout[1]||a.mode!==layout[2]||!SHA.test(a.sha256))throw new Error("asset differs")}
    return {status:"BRIDGE_BOOTSTRAP_AUTHORITY_MATCHED",executionAuthorized:false}
  } catch(error){return {status:"BLOCKED",reasonCode:"BRIDGE_BOOTSTRAP_AUTHORITY_INVALID",detail:String(error.message),executionAuthorized:false}}
}

function main(authorityPath){
  if(process.getuid?.()!==0||process.argv[1]!==SELF)throw new Error("fixed root bootstrap required")
  const self=rootFile(SELF,0o555), envelope=JSON.parse(rootFile(authorityPath,0o400)), now=trustedNow(), match=inspectBridgeBootstrapAuthority(envelope,now,sha(self));if(match.status!=="BRIDGE_BOOTSTRAP_AUTHORITY_MATCHED")throw new Error(match.detail)
  if(!crypto.verify(null,Buffer.from(canonical(envelope.payload)),crypto.createPublicKey(rootFile(OWNER_KEY,0o444)),Buffer.from(envelope.signature,"base64")))throw new Error("owner signature differs")
  const p=envelope.payload;if(sha(Buffer.from(fs.readFileSync("/etc/machine-id","utf8").trim()))!==p.machineIdSha256||fs.readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim()!==p.bootId)throw new Error("resident identity differs")
  proveControlRepository();const git=a=>run("/usr/bin/git",["-c",`safe.directory=${CONTROL}`,"-c","core.hooksPath=/usr/local/share/williamos/empty-git-hooks","-C",CONTROL,...a]);if(git(["rev-parse","HEAD"])!==p.controlCommit||git(["rev-parse","refs/heads/main"])!==p.controlCommit||git(["status","--porcelain=v1","--untracked-files=all"])!=="")throw new Error("control generation differs")
  for(const a of p.assets){const source=path.join(CONTROL,...a.source.split("/"));if(sha(rootSource(source))!==a.sha256)throw new Error("reviewed source differs")}
  if(!fs.existsSync(CLAIM_ROOT)){if(!parents(CLAIM_ROOT))throw new Error("claim parent trust differs");fs.mkdirSync(CLAIM_ROOT,{mode:0o700});fs.chownSync(CLAIM_ROOT,0,0);fs.chmodSync(CLAIM_ROOT,0o700);fsyncParent(CLAIM_ROOT)}else{const cs=fs.lstatSync(CLAIM_ROOT);if(!parents(`${CLAIM_ROOT}/claim`)||!cs.isDirectory()||cs.isSymbolicLink()||cs.uid!==0||cs.gid!==0||(cs.mode&0o7777)!==0o700)throw new Error("claim root trust differs")}
  const claim=`${CLAIM_ROOT}/${p.authorityId}.consumed`;if(!fs.existsSync(claim))create(claim,Buffer.from(`${sha(Buffer.from(canonical(p)))}\n`),0o400);else if(rootFile(claim,0o400).toString("utf8")!==`${sha(Buffer.from(canonical(p)))}\n`)throw new Error("authority claim differs")
  const receipt=receiptFor(p),receiptBytes=Buffer.from(`${canonical(receipt)}\n`);let receiptState="ABSENT";if(fs.existsSync(RECEIPT)){const current=rootFile(RECEIPT,0o444);receiptState=inspectBridgeReceiptState(sha(current),sha(receiptBytes));if(receiptState==="DRIFT")throw new Error("bridge receipt differs");if(receiptState==="MATCH"){process.stdout.write(receiptBytes);return}const backup=`${CLAIM_ROOT}/${p.authorityId}.bridge-receipt-predecessor`;if(!fs.existsSync(backup))create(backup,current,0o400);else if(!rootFile(backup,0o400).equals(current))throw new Error("bridge receipt predecessor evidence differs")}
  for(const a of p.assets){const source=path.join(CONTROL,...a.source.split("/"));if(fs.existsSync(a.destination)){const current=rootFile(a.destination,Number.parseInt(a.mode,8)),state=inspectBridgeDestinationState(a.destination,sha(current),a.mode,a.sha256);if(state==="DRIFT")throw new Error("occupied bridge destination differs");if(state==="EXACT_PREDECESSOR"){const label=a.destination===SSH_ENTRYPOINT?"ssh-entrypoint":"activation-host",backup=`${CLAIM_ROOT}/${p.authorityId}.${label}-predecessor`;if(!fs.existsSync(backup))create(backup,current,0o400);else if(!rootFile(backup,0o400).equals(current))throw new Error("bridge predecessor evidence differs");install(source,a.destination,Number.parseInt(a.mode,8))}}else install(source,a.destination,Number.parseInt(a.mode,8))}
  run("/usr/bin/systemctl",["daemon-reload"]);run("/usr/bin/systemctl",["enable","--now","williamos-aegis-remote-dev-activation.socket"])
  if(receiptState==="EXACT_PREDECESSOR")replace(RECEIPT,receiptBytes,0o444);else create(RECEIPT,receiptBytes,0o444)
  process.stdout.write(`${canonical(receipt)}\n`)
}
if(process.argv[1]===new URL(import.meta.url).pathname){try{main(process.argv[2])}catch(error){console.log(canonical({status:"BLOCKED",reasonCode:"ACTIVATION_BRIDGE_BOOTSTRAP_FAILED",detail:String(error.message),executionAuthorized:false}));process.exitCode=2}}
