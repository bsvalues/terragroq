import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const TX = "4bb8354e-b819-494d-acc1-f7c6e120b954"
const FAILED_HEAD = "97e970bddb8484820818c3de7a5dc20e89c7cb1dfaeb2f3a4f73309f5bb5e976"
const APPLY_AUTHORITY = "6cd324fa-2cad-471a-b2b7-72769b925072"
const APPLY_AUTHORITY_SHA256 = "e1ba12c43b16f2f81d7efddf8bc4d9b4e8e34e30d9ed4eaa2d130cd01b87e159"
const APPLY_REVIEWED_COMMIT = "a0462cfd5f6be035a95b773fea01d36545761e0d"
const MACHINE = "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b"
const ROOT = "/var/lib/williamos-fabric/remote-dev-prerequisite-handoff"
const INSTALLED_SELF = "/usr/local/libexec/williamos-aegis-partial-network-inert.mjs"
const OWNER_KEY = "/etc/williamos-fabric/owner-prerequisite-authority.pem"
const BROKER = "williamos-aegis-remote-dev-broker.service"
const GIT_SOCKET = "williamos-aegis-remote-dev-git-broker.socket"
const GIT_SERVICE = "williamos-aegis-remote-dev-git-broker.service"
const EGRESS = "williamos-aegis-remote-dev-egress.service"
const ENV = Object.freeze({ HOME: "/nonexistent", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" })
const canonical = v => v === null || ["string", "number", "boolean"].includes(typeof v) ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
const sha = b => crypto.createHash("sha256").update(b).digest("hex")
const exactKeys = (v, keys) => JSON.stringify(Object.keys(v ?? {}).sort()) === JSON.stringify([...keys].sort())
function run(file, args, statuses = [0]) { const r = spawnSync(file, args, { encoding: "utf8", shell: false, timeout: 10_000, env: ENV }); if (r.error || r.signal || !statuses.includes(r.status)) throw new Error(`${path.basename(file)} failed`); return String(r.stdout ?? "").trim() }
function trustedParents(file) { let cursor = "/"; for (const part of path.dirname(file).slice(1).split("/").filter(Boolean)) { cursor = path.join(cursor, part); const s = fs.lstatSync(cursor); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o022)) return false } return true }
function rootBytes(file, mode) { const s = fs.lstatSync(file); if (!trustedParents(file) || !s.isFile() || s.isSymbolicLink() || s.uid !== 0 || s.gid !== 0 || s.nlink !== 1 || (s.mode & 0o7777) !== mode || s.size > 1_048_576) throw new Error(`${file} trust differs`); return fs.readFileSync(file) }
function canonicalRootJson(file, mode = 0o400) { const b = rootBytes(file, mode), v = JSON.parse(b); if (!b.equals(Buffer.from(`${canonical(v)}\n`))) throw new Error(`${file} canonical bytes differ`); return v }
function nftSemantic() { const v = JSON.parse(run("/usr/sbin/nft", ["-j", "list", "table", "inet", "williamos_aegis_remote_dev"])); return v.nftables.filter(x => !x.metainfo).map(x => { const y = structuredClone(x); for (const item of Object.values(y)) delete item.handle; return y }) }
function exactUnit(name, active, enabled) { return run("/usr/bin/systemctl", ["is-active", name], [0, 3]) === active && run("/usr/bin/systemctl", ["is-enabled", name], [0, 1, 3]) === enabled }
function durableCreate(file, value) { const bytes = Buffer.from(`${canonical(value)}\n`), fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o400); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); const d = fs.openSync(path.dirname(file), fs.constants.O_RDONLY); fs.fsyncSync(d); fs.closeSync(d) }
function exactDirectory(directory, mode) { const s = fs.lstatSync(directory); return trustedParents(directory) && s.isDirectory() && !s.isSymbolicLink() && s.uid === 0 && s.gid === 0 && (s.mode & 0o7777) === mode }
function ensureActionRoot(directory) { try { fs.mkdirSync(directory, { mode:0o700 }); const d=fs.openSync(path.dirname(directory),fs.constants.O_RDONLY); fs.fsyncSync(d); fs.closeSync(d) } catch(e) { if(e?.code!=="EEXIST") throw e } if(!exactDirectory(directory,0o700)) throw new Error("action root trust differs") }
function inactive(name) { return ["inactive", "failed"].includes(run("/usr/bin/systemctl", ["is-active", name], [0, 3])) }
function noWorkers() { const units = run("/usr/bin/systemctl", ["list-units", "--all", "--plain", "--no-legend", "williamos-aegis-remote-dev-*.service"], [0,1]); if (units.split(/\r?\n/).some(line => /williamos-aegis-remote-dev-[0-9a-f-]{36}\.service/.test(line) && /\b(?:activating|active|deactivating)\b/.test(line))) return false; for(const entry of fs.readdirSync("/proc")){ if(!/^\d+$/.test(entry)) continue; try { const c=fs.readFileSync(`/proc/${entry}/cgroup`,"utf8"), cmd=fs.readFileSync(`/proc/${entry}/cmdline`,"utf8"); if(/williamos-aegis-remote-dev-[0-9a-f-]{36}|aegis-remote-dev-(?:worker|git-broker)/.test(c+cmd)) return false } catch(e) { if(e?.code!=="ENOENT") return false } } return true }
function within(p) { const now=Date.parse(run("/usr/bin/date",["-u","+%Y-%m-%dT%H:%M:%S.%3NZ"])); return now>=Date.parse(p.issuedAt)&&now<Date.parse(p.expiresAt) }
function withinResume(p) { const now=Date.parse(run("/usr/bin/date",["-u","+%Y-%m-%dT%H:%M:%S.%3NZ"])); return now>=Date.parse(p.issuedAt)&&now<Date.parse(p.resumeExpiresAt) }
function mutate(p,args) { if(!withinResume(p)) throw new Error("resume authority expired before mutation"); return run("/usr/bin/systemctl",args,[0]) }

export function inspectPartialNetworkInert({ nftUnchanged, egressRetained, brokerInactiveDisabled, gitSocketInactiveDisabled, gitServiceInactive, listenerAbsent }) {
  return nftUnchanged && egressRetained && brokerInactiveDisabled && gitSocketInactiveDisabled && gitServiceInactive && listenerAbsent
    ? { status: "PARTIAL_NETWORK_INERT_VERIFIED", executionAuthorized: false, activationAuthorized: false }
    : { status: "BLOCKED", reasonCode: "PARTIAL_NETWORK_INERT_DRIFT", executionAuthorized: false, activationAuthorized: false }
}

function validateAuthority(file) {
  const e = canonicalRootJson(file), p = e.payload
  if (!exactKeys(e, ["payload", "signature"]) || !exactKeys(p, ["schemaVersion", "operation", "authorityId", "transactionId", "failedJournalHeadSha256", "applyAuthorityId", "verifierSha256", "machineIdSha256", "bootId", "trustedMainCommit", "issuedAt", "expiresAt", "resumeExpiresAt", "singleUse"])) throw new Error("authority schema differs")
  if (p.schemaVersion !== 1 || p.operation !== "AEGIS_PARTIAL_NETWORK_INERT" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.authorityId) || p.transactionId !== TX || p.failedJournalHeadSha256 !== FAILED_HEAD || p.applyAuthorityId !== APPLY_AUTHORITY || p.machineIdSha256 !== MACHINE || !/^[0-9a-f]{40}$/.test(p.trustedMainCommit) || p.singleUse !== true) throw new Error("authority binding differs")
  if (sha(rootBytes(INSTALLED_SELF, 0o555)) !== p.verifierSha256) throw new Error("verifier digest differs")
  const now = Date.parse(run("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"])), issued = Date.parse(p.issuedAt), expires = Date.parse(p.expiresAt)
  const resume=Date.parse(p.resumeExpiresAt); if (![now, issued, expires,resume].every(Number.isFinite) || expires - issued !== 900_000 || resume-expires!==1_800_000 || now < issued || now >= resume) throw new Error("authority window differs")
  if (!crypto.verify(null, Buffer.from(canonical(p)), rootBytes(OWNER_KEY, 0o444), Buffer.from(e.signature, "base64"))) throw new Error("authority signature differs")
  if (sha(Buffer.from(fs.readFileSync("/etc/machine-id", "utf8").trim())) !== MACHINE || fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() !== p.bootId) throw new Error("resident identity differs")
  const remoteOut = run("/usr/bin/git", ["--no-replace-objects", "ls-remote", "https://github.com/bsvalues/terragroq.git", "refs/heads/main"]); if (remoteOut !== `${p.trustedMainCommit}\trefs/heads/main`) throw new Error("fresh trusted main differs")
  return p
}

function proveFailedTransaction() {
  const names = fs.readdirSync(`${ROOT}/journal`).filter(n => n.startsWith(`${TX}.`)).sort(); if (names.length !== 14) throw new Error("journal record set differs")
  const phases = ["AUTHORITY_CONSUMED", "STEP_INTENT", "STEP_APPLIED", "STEP_INTENT", "STEP_APPLIED", "STEP_INTENT", "STEP_APPLIED", "STEP_INTENT", "STEP_APPLIED", "STEP_INTENT", "STEP_APPLIED", "STEP_INTENT", "STEP_APPLIED", "FAILED_PARTIAL"]
  const steps = [null, "RECONCILE_BOUNDED_IDENTITY", "RECONCILE_BOUNDED_IDENTITY", "INSTALL_DUAL_STACK_BROKER_BOUNDARY", "INSTALL_DUAL_STACK_BROKER_BOUNDARY", "RECONCILE_TRUSTED_REPOSITORIES", "RECONCILE_TRUSTED_REPOSITORIES", "INSTALL_PINNED_TOOLCHAIN", "INSTALL_PINNED_TOOLCHAIN", "CREATE_DURABLE_LEDGER", "CREATE_DURABLE_LEDGER", "INSTALL_FORCED_COMMAND_TRANSPORT", "INSTALL_FORCED_COMMAND_TRANSPORT", null]
  let previous = "0".repeat(64)
  for (let i = 0; i < names.length; i++) { const r = canonicalRootJson(`${ROOT}/journal/${names[i]}`); if (!exactKeys(r, ["schemaVersion", "sequence", "previousSha256", "phase", "detail", "recordSha256"])) throw new Error("journal schema differs"); const digest = sha(Buffer.from(canonical({ schemaVersion:r.schemaVersion, sequence:r.sequence, previousSha256:r.previousSha256, phase:r.phase, detail:r.detail }))); if (r.schemaVersion !== 1 || r.sequence !== i + 1 || r.previousSha256 !== previous || r.phase !== phases[i] || r.recordSha256 !== digest || names[i] !== `${TX}.${String(i+1).padStart(6,"0")}.${digest}.json` || (steps[i] && r.detail?.stepId !== steps[i])) throw new Error("journal chain differs"); if (i === 0 && (r.detail?.authorityId !== APPLY_AUTHORITY || r.detail?.transactionId !== TX)) throw new Error("journal authority differs"); if (i === 13 && (digest !== FAILED_HEAD || r.detail?.detail !== "post-apply prerequisite verification differs")) throw new Error("terminal failure differs"); previous = digest }
  const claim = canonicalRootJson(`${ROOT}/claims/${APPLY_AUTHORITY}.claimed`); if (!exactKeys(claim,["authorityId","transactionId","authoritySha256","observedFreshMainCommit","reviewedPackageCommit"]) || claim.authorityId !== APPLY_AUTHORITY || claim.transactionId !== TX || claim.authoritySha256 !== APPLY_AUTHORITY_SHA256 || claim.observedFreshMainCommit !== APPLY_REVIEWED_COMMIT || claim.reviewedPackageCommit !== APPLY_REVIEWED_COMMIT) throw new Error("apply claim differs")
}

export function main(argument) {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || path.resolve(process.argv[1] ?? "") !== INSTALLED_SELF) throw new Error("fixed root Linux verifier required")
  const expected = `${ROOT}/authorities/${path.basename(argument ?? "")}`; if (argument !== expected) throw new Error("authority path differs")
  const p = validateAuthority(argument)
  proveFailedTransaction()
  if (!exactUnit(EGRESS, "active", "enabled")) throw new Error("egress policy state differs")
  const before = nftSemantic(), beforeSha = sha(Buffer.from(canonical(before))), actionRoot = `${ROOT}/partial-network-inert-actions`, intentPath = `${actionRoot}/${p.authorityId}.intent.json`, appliedPath = `${actionRoot}/${p.authorityId}.applied.json`, steps=[`DISABLE_STOP:${BROKER}`,`DISABLE_STOP:${GIT_SOCKET}`,`STOP:${GIT_SERVICE}`]
  ensureActionRoot(actionRoot)
  const existingIntent = (() => { try { return canonicalRootJson(intentPath) } catch (e) { if (e?.code === "ENOENT") return null; throw e } })()
  if (!existingIntent) { ensureActionRoot(actionRoot); if(!within(p)) throw new Error("authority expired before mutation"); durableCreate(intentPath, { schemaVersion:1, authorityId:p.authorityId, transactionId:TX, nftSemanticSha256:beforeSha, steps }) }
  else if (!exactKeys(existingIntent,["schemaVersion","authorityId","transactionId","nftSemanticSha256","steps"]) || existingIntent.schemaVersion!==1 || existingIntent.authorityId !== p.authorityId || existingIntent.transactionId !== TX || existingIntent.nftSemanticSha256 !== beforeSha || canonical(existingIntent.steps)!==canonical(steps)) throw new Error("action intent differs")
  if (!exactUnit(BROKER, "inactive", "disabled")) { mutate(p,["disable", BROKER]); mutate(p,["stop", BROKER]) }
  if (!exactUnit(GIT_SOCKET, "inactive", "disabled")) { mutate(p,["disable", GIT_SOCKET]); mutate(p,["stop", GIT_SOCKET]) }
  if (!inactive(GIT_SERVICE)) mutate(p,["stop", GIT_SERVICE])
  const after = nftSemantic(), socketUse = run("/usr/bin/ss", ["-H", "-tn", "sport = :17734 or dport = :17734"]), observation = { nftUnchanged: canonical(before) === canonical(after), egressRetained: exactUnit(EGRESS, "active", "enabled"), brokerInactiveDisabled: exactUnit(BROKER, "inactive", "disabled"), gitSocketInactiveDisabled: exactUnit(GIT_SOCKET, "inactive", "disabled"), gitServiceInactive: inactive(GIT_SERVICE) && noWorkers(), listenerAbsent: run("/usr/bin/ss", ["-H", "-ltn", "sport = :17734"]) === "" && socketUse === "" }
  const result = inspectPartialNetworkInert(observation); if (result.status !== "PARTIAL_NETWORK_INERT_VERIFIED") throw new Error(result.reasonCode)
  const applied={ schemaVersion:1, authorityId:p.authorityId, transactionId:TX, nftSemanticSha256:beforeSha, observation }; try { if(canonical(canonicalRootJson(appliedPath))!==canonical(applied)) throw new Error("applied evidence differs") } catch (e) { if (e?.code !== "ENOENT") throw e; if(!withinResume(p)) throw new Error("resume authority expired before settlement"); durableCreate(appliedPath, applied) }
  const verifiedAt=run("/usr/bin/date",["-u","+%Y-%m-%dT%H:%M:%S.%3NZ"]), intentSha256=sha(rootBytes(intentPath,0o400)), appliedSha256=sha(rootBytes(appliedPath,0o400)); const receipt = { schemaVersion: 1, status: result.status, transactionId: TX, applyAuthorityId: APPLY_AUTHORITY, inertAuthorityId: p.authorityId, inertAuthoritySha256:sha(rootBytes(argument,0o400)), failedJournalHeadSha256: FAILED_HEAD, nftSemanticSha256: beforeSha, machineIdSha256:MACHINE, bootId:p.bootId, trustedMainCommit:p.trustedMainCommit, verifierSha256:p.verifierSha256, authorityExpiresAt:p.expiresAt, resumeExpiresAt:p.resumeExpiresAt, verifiedAt, intentSha256, appliedSha256, observation, mutations: [`DISABLE_STOP:${BROKER}`, `DISABLE_STOP:${GIT_SOCKET}`], executionAuthorized: false, activationAuthorized: false }
  receipt.mutations=steps; const target = `${ROOT}/partial-network-inert-${TX}.json`; try { const existing = canonicalRootJson(target); const stable={...receipt,verifiedAt:existing.verifiedAt}; if (canonical(existing) !== canonical(stable)) throw new Error("existing receipt differs"); return existing } catch (e) { if (e?.code !== "ENOENT") throw e; if(!withinResume(p)) throw new Error("resume authority expired before receipt"); durableCreate(target, receipt); return receipt }
}
if (process.argv[1] === new URL(import.meta.url).pathname) { try { console.log(canonical(main(process.argv[2]))) } catch (e) { console.log(canonical({ status: "BLOCKED", reasonCode: "PARTIAL_NETWORK_INERT_BLOCKED", detail: String(e.message), executionAuthorized: false })); process.exitCode = 1 } }
