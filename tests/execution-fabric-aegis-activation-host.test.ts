import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  inspectActivationSessionToken,
  inspectTicketMintRequest,
  ACTIVATION_ID,
  AUTHORITY_REFERENCE,
  inspectActivationHostPhase,
  inspectActivationBridgeReceipt,
  inspectMintRecord,
  inspectStrandedActivationLedger,
  inspectActivationUnitState,
  inspectLeaseHolderState,
  inspectRootNoSudoObservation,
  inspectHostRootNoSudoProof,
  inspectPreparedSnapshotRecovery,
  inspectNetworkActivationState,
  inspectNetworkJournalBinding,
  inspectNetworkSettlementState,
  inspectReceiptTicketDirectoryIdentity,
  buildNetworkFailureRecord,
  runActivationDaemonGuard,
  buildTransientCompactionEvidence,
  buildTransientCompactionIntent,
  inspectTransientCompactionEvidence,
  inspectSnapshotCapacity,
  inspectCompactionOccupancy,
  inspectPreReceiptCompactionAuthority,
  inspectPreReceiptCompactionReceipt,
  buildPreReceiptCompactionReceipt,
  diagnosePreReceiptCompactionReceipt,
  buildPreReceiptCompactionExpectation,
} from "../scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs"

const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex")
const canonical = (value:any):string => value===null||["string","boolean","number"].includes(typeof value)?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(",")}]`:`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
const runId = "c9889658-bad2-43e2-8def-a0a9c9df5d3c"
const root = path.resolve(import.meta.dirname, "..")
const session = () => ({
  schemaVersion: 1,
  activationId: ACTIVATION_ID,
  authorityReference: AUTHORITY_REFERENCE,
  runId,
  claimId: "claim-" + "a".repeat(24),
  leaseId: "lease-" + "b".repeat(24),
  proofId: "33333333-3333-4333-8333-333333333333",
  noSudoProofSha256: "c".repeat(64),
  workspace: "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001",
  branch: "codex/wo-tf-remote-dev-offload-001-734",
  baseSha: "ffd2fa35f5152de2b95e7f63b220050d18193d7a",
  issuedAt: "2026-08-12T22:30:00.000Z",
  expiresAt: "2026-08-12T23:30:00.000Z",
  daemonPid: 1234,
  daemonStartTicks: "5678",
})

describe("AEGIS production activation host trust", () => {
  it("accepts only the exact active issue #734 session", () => {
    expect(inspectActivationSessionToken(session(), "2026-08-12T22:45:00.000Z")).toMatchObject({ status: "ACTIVE_SESSION_VERIFIED" })
    for (const mutate of [
      (v: any) => { v.activationId = "other" },
      (v: any) => { v.runId = crypto.randomUUID() },
      (v: any) => { v.workspace = "/tmp/other" },
      (v: any) => { v.expiresAt = "2026-08-12T22:45:00.000Z" },
      (v: any) => { v.extra = true },
    ]) { const value: any = session(); mutate(value); expect(inspectActivationSessionToken(value, "2026-08-12T22:45:00.000Z")).toMatchObject({ status: "BLOCKED" }) }
  })

  it("binds every ticket to one operation and exact packet, patch, attempt, and evidence predecessor", () => {
    const packet = Buffer.from("packet")
    const patch = Buffer.from("patch")
    const request = { operation: "CREATE_WORKSPACE", attempt: 1, previousEvidenceSha256: null, packetSha256: sha("packet"), patchSha256: sha("patch") }
    expect(inspectTicketMintRequest(request, packet, patch)).toMatchObject({ status: "TICKET_REQUEST_VERIFIED" })
    expect(inspectTicketMintRequest({ ...request, operation: "ARBITRARY_SHELL" }, packet, patch)).toMatchObject({ status: "BLOCKED" })
    expect(inspectTicketMintRequest({ ...request, packetSha256: "f".repeat(64) }, packet, patch)).toMatchObject({ status: "BLOCKED" })
    expect(inspectTicketMintRequest({ ...request, extra: true }, packet, patch)).toMatchObject({ status: "BLOCKED" })
  })

  it("accepts recovery only for one exact durable claimed phase inside the authority window", () => {
    const phase = { schemaVersion: 1, phase: "ACTIVATION_CLAIMED_LEASED", runId, claimId: "claim-" + "a".repeat(24), leaseId: "lease-" + "b".repeat(24), authorityReference: AUTHORITY_REFERENCE, claimedAt: "2026-08-13T02:02:00.000Z", expiresAt: "2026-08-13T06:01:00.000Z" }
    expect(inspectActivationHostPhase(phase, "2026-08-13T02:30:00.000Z")).toMatchObject({ status: "RECOVERY_REQUIRED" })
    expect(inspectActivationHostPhase({ ...phase, extra: true }, "2026-08-13T02:30:00.000Z")).toMatchObject({ status: "BLOCKED" })
    expect(inspectActivationHostPhase(phase, phase.expiresAt)).toMatchObject({ status: "RECOVERY_REQUIRED" })
    expect(inspectActivationHostPhase(phase, "2026-08-13T06:31:00.000Z")).toMatchObject({ status: "BLOCKED" })
  })

  it("makes each exact operation tuple a single durable mint generation", () => {
    const value = { schemaVersion: 1, mintKey: "a".repeat(64), runId, claimId: "claim-" + "b".repeat(24), operation: "CREATE_WORKSPACE", attempt: 1, previousEvidenceSha256: null, packetSha256: "c".repeat(64), patchSha256: "d".repeat(64), ticketSha256: "e".repeat(64) }
    expect(inspectMintRecord(value, value)).toMatchObject({ status: "MINT_REPLAY_EXACT" })
    expect(inspectMintRecord(value, { ...value, ticketSha256: "f".repeat(64) })).toMatchObject({ status: "BLOCKED" })
  })

  it("requires a deterministic root bridge receipt binding every installed byte and prerequisite receipt", () => {
    const value = { schemaVersion: 1, status: "ACTIVATION_BRIDGE_VERIFIED", runId, authorityId: "22222222-2222-4222-8222-222222222222", authoritySha256: "f".repeat(64), machineIdSha256: "a".repeat(64), bootId: "11111111-1111-4111-8111-111111111111", controlCommit: "b".repeat(40), prerequisiteReceiptSha256: "41ea35adc284b37e381f1162e5cd2315f8a0ef2da5c2326e1a224c15e4fa541c", assets: [{ destination: "/usr/local/libexec/host", sha256: "c".repeat(64), mode: "0555" }], schedulerEnabled: false, standingAuthority: false, executionAuthorized: false }
    expect(inspectActivationBridgeReceipt(value, value)).toMatchObject({ status: "ACTIVATION_BRIDGE_VERIFIED" })
    expect(inspectActivationBridgeReceipt(value, { ...value, assets: [] })).toMatchObject({ status: "BLOCKED" })
  })

  it("recovers a crash between canonical lease acquisition and host phase publication only from exact ledger records", () => {
    const expected={claimKeySha256:"a".repeat(64),requestSha256:"b".repeat(64),scopeSha256:"c".repeat(64)}
    const claim:any={schema_version:"0.1-aegis-single-use-claim",claim_id:"claim-"+"a".repeat(24),request_sha256:expected.requestSha256,scope_sha256:expected.scopeSha256,authority_reference:AUTHORITY_REFERENCE,maximum_attempts:3,claim_key_sha256:expected.claimKeySha256,claimed_at:"2026-08-12T22:10:00.000Z"};claim.claim_sha256=sha(canonical(claim))
    const lease:any={schema_version:"0.1-resident-aegis-runtime-lease",lease_id:"lease-"+"b".repeat(24),claim_id:claim.claim_id,acquired_at:"2026-08-12T22:10:01.000Z",holder:{pid:123,boot_id:"22222222-2222-4222-8222-222222222222",process_start_ticks:"456"}};lease.lease_sha256=sha(canonical(lease))
    expect(inspectStrandedActivationLedger(claim,lease,expected)).toMatchObject({status:"STRANDED_LEASE_RECOVERY_REQUIRED"})
    expect(inspectStrandedActivationLedger({...claim,request_sha256:"f".repeat(64)},lease,expected)).toMatchObject({status:"BLOCKED"})
  })

  it("confines the authenticated root socket request to only the activation state, ledger, and ticket roots", () => {
    const service=fs.readFileSync(path.join(root,"scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation@.service"),"utf8").replace(/\r\n/g,"\n")
    expect(service).toContain("StandardInput=socket")
    expect(service).toContain("User=root\nGroup=root")
    expect(service).toContain("ReadWritePaths=/run/williamos-fabric /var/lib/williamos/fabric/ledger /var/lib/williamos-fabric/remote-dev-launch-tickets")
    expect(service).not.toContain("/var/lib/williamos-remote-dev")
  })

  it("authenticates the socket peer by uid, executable, exact entrypoint argv, and ssh session cgroup", () => {
    const peer=fs.readFileSync(path.join(root,"scripts/execution-fabric/provision/assets/aegis-remote-dev-activation-peer.py"),"utf8")
    for(const proof of ["SO_PEERCRED","EXPECTED_UID = 999","/proc/{pid}/exe","/proc/{pid}/cmdline","/usr/sbin/sshd","sshd: williamos-fabric@notty","/proc/net/tcp","192.168.88.9","EXPECTED_SCRIPT"]) expect(peer).toContain(proof)
    expect(peer).not.toContain('"session-"')
    expect(peer).not.toContain("sudo")
  })

  it("proves repository config and empty hooks before the first root Git command", () => {
    const source=fs.readFileSync(path.join(root,"scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs"),"utf8")
    const start=source.indexOf("function proveCanonicalControlRepository")
    expect(source.indexOf("canonical control Git config differs",start)).toBeLessThan(source.indexOf("const git = args => run",start))
    expect(source.indexOf("canonical empty hooks differ",start)).toBeLessThan(source.indexOf("const git = args => run",start))
    const startMain=source.indexOf("function startMain")
    const firstControlGit=source.indexOf("proveCanonicalControlRepository()",startMain)
    expect(firstControlGit).toBeGreaterThan(startMain)
    expect(source.slice(startMain,firstControlGit)).not.toContain('run("/usr/bin/git"')
    expect(source.indexOf("reconcilePreparedSnapshot(currentCommit)",firstControlGit)).toBeGreaterThan(firstControlGit)
  })

  it("never recovers a phase or stranded lease while the original activation unit is still active", () => {
    const source=fs.readFileSync(path.join(root,"scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs"),"utf8")
    expect(source).toContain('run("/usr/bin/systemctl",["is-active",UNIT],{statuses:[3,4]})')
    expect(source).toContain('throw new Error("activation unit is not proven inactive")')
  })

  it("accepts failed transient units only after MainPID is proven absent", () => {
    expect(inspectActivationUnitState("inactive",0)).toBe("INACTIVE")
    expect(inspectActivationUnitState("unknown",0)).toBe("INACTIVE")
    expect(inspectActivationUnitState("failed",0)).toBe("RESET_REQUIRED")
    expect(inspectActivationUnitState("failed",123)).toBe("DRIFT")
    for(const state of ["active","activating","deactivating"])expect(inspectActivationUnitState(state,0)).toBe("DRIFT")
  })

  it("recovers a stranded lease only when its exact recorded holder is dead", () => {
    const holder={pid:4242,boot_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",process_start_ticks:"101"}
    expect(inspectLeaseHolderState(holder,holder.boot_id,"101")).toBe("ACTIVE")
    expect(inspectLeaseHolderState(holder,holder.boot_id,null)).toBe("DEAD")
    expect(inspectLeaseHolderState(holder,"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","101")).toBe("DEAD")
    expect(inspectLeaseHolderState({...holder,pid:0},holder.boot_id,null)).toBe("DRIFT")
  })

  it("publishes root no-sudo evidence only from the locked account and exact C-locale policy denial", () => {
    const good={passwd:{status:0,signal:null,errorCode:null,stdout:"williamos-fabric L 2026-08-10 -1 -1 -1 -1\n",stderr:""},sudo:{status:0,signal:null,errorCode:null,stdout:"User williamos-fabric is not allowed to run sudo on aegis.\n",stderr:""}}
    expect(inspectRootNoSudoObservation(good)).toBe("ROOT_NO_SUDO_OBSERVED")
    expect(inspectRootNoSudoObservation({...good,passwd:{...good.passwd,stdout:"williamos-fabric P 2026-08-10 -1 -1 -1 -1\n"}})).toBe("DRIFT")
    expect(inspectRootNoSudoObservation({...good,sudo:{...good.sudo,stdout:"User williamos-fabric may run the following commands\n"}})).toBe("DRIFT")
  })

  it("keeps the activation service no-new-privileges while isolating the exact root policy query", () => {
    const source=fs.readFileSync(path.join(root,"scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs"),"utf8")
    const proof=source.slice(source.indexOf("function rootSudoPolicyResult"),source.indexOf("function ensureRootNoSudoProof"))
    expect(proof).toContain('"/usr/bin/systemd-run"')
    expect(proof).toContain('"NoNewPrivileges=no"')
    expect(proof).toContain('"/usr/bin/sudo","-U","williamos-fabric","-l"')
    expect(source).toContain('"NoNewPrivileges=yes"')
    expect(source).not.toContain('sudo:rootResult("/usr/bin/sudo"')
  })

  it("delegates only the exact bounded user-slice start through the system manager", () => {
    const source=fs.readFileSync(path.join(root,"scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs"),"utf8")
    const start=source.slice(source.indexOf("function startNetworkSliceResult"),source.indexOf("function ensureNetworkSlice"))
    expect(start).toContain('"--wait","--collect","--pipe"')
    expect(start).toContain('"User=williamos-fabric"')
    expect(start).toContain('"Group=williamos-fabric"')
    expect(start).toContain('"NoNewPrivileges=no"')
    expect(start).toContain('"PrivateTmp=yes"')
    expect(start).toContain('"ProtectSystem=strict"')
    expect(start).toContain('"ReadWritePaths=/run/user/999"')
    expect(start).toContain('"TimeoutStartSec=10"')
    expect(start).toContain('"/usr/bin/systemctl","--user","start","williamos-aegis-remote-dev.slice"')
    expect(start).not.toContain("runuser")
  })

  it("adopts only a fresh exact pre-claim proof and archives an exact expired generation", () => {
    const proof:any={schemaVersion:1,status:"ROOT_NO_SUDO_VERIFIED",activationId:ACTIVATION_ID,authorityReference:AUTHORITY_REFERENCE,runId,machineIdSha256:"a".repeat(64),bootId:"11111111-1111-4111-8111-111111111111",activationHostSha256:"b".repeat(64),authoritySha256:"c".repeat(64),account:"williamos-fabric",passwordStatus:"L",sudoStatus:0,sudoStdout:"User williamos-fabric is not allowed to run sudo on aegis.\n",sudoStderr:"",issuedAt:"2026-08-13T01:10:00.000Z",expiresAt:"2026-08-13T01:15:00.000Z"}
    const expected={machineIdSha256:proof.machineIdSha256,bootId:proof.bootId,activationHostSha256:proof.activationHostSha256,authoritySha256:proof.authoritySha256}
    expect(inspectHostRootNoSudoProof(proof,"2026-08-13T01:12:00.000Z",expected)).toBe("FRESH")
    expect(inspectHostRootNoSudoProof(proof,proof.expiresAt,expected)).toBe("EXPIRED_EXACT")
    expect(inspectHostRootNoSudoProof({...proof,account:"bs"},"2026-08-13T01:12:00.000Z",expected)).toBe("DRIFT")
  })

  it("archives only the exact failed pre-claim snapshot generation", () => {
    const exactFailure={preparedCommit:"77b1430f6c0966ce0fcfd03c46cccfa487d3b8aa",currentCommit:"c934f96bb079c3effbadb4779d1ad0049a118b2a",entries:["control","mints","prepared.json","no-sudo.json","network-intent.json","activation-failure.json"],claimExists:false,leaseExists:false,phaseExists:false,sessionExists:false,workspaceExists:false,networkInert:true,preparedSha256:"d3b110a512823700df85f2f885f3f2edb46da05a6e70fd6cff3b9ae76a122883",noSudoSha256:"f3812b437d19c568df6171bfaa884eca29ca1f2481541e1cb00c9042c204141b",networkIntentSha256:"3c32ff762b47b605d0266d987ebe5c99fc99f8aa3e75af3115fa41e7d6ce78cb",failureSha256:"e25ab062dee7e4a6f7d31827ead9ce4962e5d6ad91e5c20a5013e71305ec0054"}
    expect(inspectPreparedSnapshotRecovery(exactFailure)).toBe("ARCHIVE_EXACT_PRECLAIM_INERT_FAILURE")
    for(const drift of [{networkInert:false},{leaseExists:true},{workspaceExists:true},{failureSha256:"f".repeat(64)},{entries:[...exactFailure.entries,"foreign"]}])expect(inspectPreparedSnapshotRecovery({...exactFailure,...drift})).toBe("DRIFT")
    expect(inspectPreparedSnapshotRecovery({preparedCommit:"070b93f1fe2fbf1e9f2072c7c150e329618878c9",currentCommit:"9a085f6f7d06af2d0f3c35b6271282cec85ade51",entries:["control","mints","prepared.json","no-sudo.json"],claimExists:false,leaseExists:false,phaseExists:false,sessionExists:false,workspaceExists:false,networkInert:true,preparedSha256:"a".repeat(64),noSudoSha256:"b".repeat(64),networkIntentSha256:null,failureSha256:null})).toBe("DRIFT")
    const state=(overrides:any)=>({preparedCommit:"a314d3a604f1ddec83f7d793168bfa5f0adc0305",currentCommit:"a314d3a604f1ddec83f7d793168bfa5f0adc0305",entries:["control","mints","prepared.json"],claimExists:false,leaseExists:false,phaseExists:false,sessionExists:false,workspaceExists:false,networkInert:true,preparedSha256:"a".repeat(64),noSudoSha256:null,networkIntentSha256:null,failureSha256:null,...overrides})
    expect(inspectPreparedSnapshotRecovery(state({preparedCommit:"88bd56d8f575bafaf7a6ddcf6b1a8e2e1fc4d3ec",currentCommit:"9a085f6f7d06af2d0f3c35b6271282cec85ade51"}))).toBe("DRIFT")
    expect(inspectPreparedSnapshotRecovery(state({preparedCommit:"9a04dbf4f488567d5d5328d4c26f65819aea7e3c",currentCommit:"7fab579402798ba6e0d7cafbd74bba5be4d79101"}))).toBe("DRIFT")
    expect(inspectPreparedSnapshotRecovery(state({}))).toBe("MATCH")
    expect(inspectPreparedSnapshotRecovery(state({entries:["control","mints","prepared.json","no-sudo.json","network-intent.json","network-applied.json","activation-failure.json"]}))).toBe("MATCH")
    expect(inspectPreparedSnapshotRecovery(state({entries:["control","mints","prepared.json","foreign"]}))).toBe("DRIFT")
    expect(inspectPreparedSnapshotRecovery(state({preparedCommit:"f".repeat(40)}))).toBe("DRIFT")
  })

  it("compacts only the fixed canonical transient inventories and preserves a capacity reserve", () => {
    const evidence=buildTransientCompactionEvidence()
    const intent=buildTransientCompactionIntent()
    expect(intent.status).toBe("TRANSIENT_ACTIVATION_ARCHIVES_VALIDATED")
    expect(evidence.status).toBe("TRANSIENT_ACTIVATION_ARCHIVES_COMPACTED")
    expect(evidence.intentSha256).toBe(sha(`${canonical(intent)}\n`))
    expect(inspectTransientCompactionEvidence(evidence)).toBe("EXACT")
    expect(evidence.archives.map((entry:any)=>entry.id)).toEqual(["preclaim-88bd","preclaim-070b","preclaim-77b","partial-879d"])
    expect(inspectTransientCompactionEvidence({...evidence,archives:evidence.archives.slice(1)})).toBe("DRIFT")
    expect(inspectTransientCompactionEvidence({...evidence,archives:evidence.archives.map((entry:any,index:number)=>index?entry:{...entry,inventorySha256:"f".repeat(64)})})).toBe("DRIFT")
    expect(inspectSnapshotCapacity(600*1024*1024,472*1024*1024)).toBe("SUFFICIENT")
    expect(inspectSnapshotCapacity(600*1024*1024-1,472*1024*1024)).toBe("INSUFFICIENT")
    expect(inspectCompactionOccupancy({sourceExists:true,targetExists:false,evidenceExists:false})).toBe("VALIDATE_ALL_AND_RECORD")
    expect(inspectCompactionOccupancy({sourceExists:true,targetExists:false,evidenceExists:true})).toBe("VALIDATE_AND_RENAME")
    expect(inspectCompactionOccupancy({sourceExists:false,targetExists:true,evidenceExists:true})).toBe("REMOVE_RENAMED")
    expect(inspectCompactionOccupancy({sourceExists:false,targetExists:false,evidenceExists:true})).toBe("COMPLETE")
    expect(inspectCompactionOccupancy({sourceExists:true,targetExists:true,evidenceExists:true})).toBe("DRIFT")
    expect(inspectCompactionOccupancy({sourceExists:false,targetExists:true,evidenceExists:false})).toBe("DRIFT")
  })

  it("authorizes pre-receipt compaction only from the fresh claimed bridge generation", () => {
    const hostSha256="a".repeat(64), machineIdSha256="b".repeat(64), bootId="11111111-1111-4111-8111-111111111111", controlCommit="c".repeat(40)
    const payload:any={schemaVersion:1,operation:"INSTALL_ACTIVATION_BRIDGE",authorityId:"22222222-2222-4222-8222-222222222222",runId,issuedAt:"2026-08-13T05:00:00.000Z",expiresAt:"2026-08-13T05:15:00.000Z",singleUse:true,machineIdSha256,bootId,controlCommit,verifierSha256:"d".repeat(64),prerequisiteReceiptSha256:"41ea35adc284b37e381f1162e5cd2315f8a0ef2da5c2326e1a224c15e4fa541c",assets:[
      {source:"scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs",destination:"/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs",sha256:hostSha256,mode:"0555"},
      {source:"scripts/execution-fabric/provision/assets/aegis-remote-dev-activation-peer.py",destination:"/usr/local/libexec/williamos-aegis-remote-dev-activation-peer.py",sha256:"1".repeat(64),mode:"0555"},
      {source:"scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation.socket",destination:"/etc/systemd/system/williamos-aegis-remote-dev-activation.socket",sha256:"2".repeat(64),mode:"0444"},
      {source:"scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation@.service",destination:"/etc/systemd/system/williamos-aegis-remote-dev-activation@.service",sha256:"3".repeat(64),mode:"0444"},
      {source:"scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs",destination:"/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs",sha256:"4".repeat(64),mode:"0555"},
    ]}
    const expected={machineIdSha256,bootId,controlCommit,activationHostSha256:hostSha256,claimSha256:sha(canonical(payload))}
    expect(inspectPreReceiptCompactionAuthority(payload,"2026-08-13T05:01:00.000Z",expected)).toBe("MATCH")
    expect(inspectPreReceiptCompactionAuthority(payload,payload.expiresAt,expected)).toBe("DRIFT")
    expect(inspectPreReceiptCompactionAuthority({...payload,controlCommit:"e".repeat(40)},"2026-08-13T05:01:00.000Z",expected)).toBe("DRIFT")
    expect(inspectPreReceiptCompactionAuthority({...payload,assets:payload.assets.map((asset:any,index:number)=>index?asset:{...asset,sha256:"f".repeat(64)})},"2026-08-13T05:01:00.000Z",expected)).toBe("DRIFT")
    expect(inspectPreReceiptCompactionAuthority({...payload,extra:true},"2026-08-13T05:01:00.000Z",expected)).toBe("DRIFT")
  })

  it("accepts only the exact capacity-proven pre-receipt compaction result", () => {
    const expected={authorityId:"22222222-2222-4222-8222-222222222222",authoritySha256:"a".repeat(64),authorityIssuedAt:"2026-08-13T05:00:00.000Z",authorityExpiresAt:"2026-08-13T05:15:00.000Z",machineIdSha256:"b".repeat(64),bootId:"11111111-1111-4111-8111-111111111111",controlCommit:"c".repeat(40),activationHostSha256:"d".repeat(64),compactionIntentSha256:"e".repeat(64),compactionSha256:"f".repeat(64),minimumAvailableBytes:32*1024*1024}
    const receipt={schemaVersion:1,status:"TRANSIENT_ACTIVATION_COMPACTION_VERIFIED",runId,...expected,availableBytes:128*1024*1024,completedAt:"2026-08-13T05:02:00.000Z",executionAuthorized:false,activationAuthorized:false}
    expect(inspectPreReceiptCompactionReceipt(receipt,expected)).toBe("MATCH")
    expect(inspectPreReceiptCompactionReceipt({...receipt,availableBytes:expected.minimumAvailableBytes-1},expected)).toBe("DRIFT")
    expect(inspectPreReceiptCompactionReceipt({...receipt,compactionSha256:"0".repeat(64)},expected)).toBe("DRIFT")
    expect(inspectPreReceiptCompactionReceipt({...receipt,extra:true},expected)).toBe("DRIFT")
  })

  it("builds the production compaction receipt with typed bounded diagnostics", () => {
    const authority={authorityId:"22222222-2222-4222-8222-222222222222",authoritySha256:"a".repeat(64),authorityIssuedAt:"2026-08-13T05:00:00.000Z",authorityExpiresAt:"2026-08-13T05:15:00.000Z",machineIdSha256:"b".repeat(64),bootId:"11111111-1111-4111-8111-111111111111",controlCommit:"c".repeat(40),activationHostSha256:"d".repeat(64)}
    const expected=buildPreReceiptCompactionExpectation(authority,{intentSha256:"e".repeat(64),compactionSha256:"f".repeat(64)})
    expect(expected).toHaveProperty("compactionIntentSha256","e".repeat(64))
    expect(expected).not.toHaveProperty("intentSha256")
    const receipt=buildPreReceiptCompactionReceipt(expected,128*1024*1024,"2026-08-13T05:02:00.000Z")
    expect(diagnosePreReceiptCompactionReceipt(receipt,expected)).toEqual({status:"MATCH",reasonCode:"PRE_RECEIPT_COMPACTION_RECEIPT_MATCHED"})
    expect(diagnosePreReceiptCompactionReceipt({...receipt,completedAt:"2026-08-13T05:15:00.000Z"},expected)).toEqual({status:"DRIFT",reasonCode:"COMPLETION_TIME_OUTSIDE_AUTHORITY"})
    expect(diagnosePreReceiptCompactionReceipt({...receipt,availableBytes:1},expected)).toEqual({status:"DRIFT",reasonCode:"POST_CAPACITY_INSUFFICIENT"})
    expect(diagnosePreReceiptCompactionReceipt({...receipt,extra:true},expected)).toEqual({status:"DRIFT",reasonCode:"RECEIPT_KEYS_DIFFER"})
  })

  it("keeps pre-receipt compaction outside the activation and network lifecycle", () => {
    const source=fs.readFileSync(path.join(root,"scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs"),"utf8")
    const compact=source.slice(source.indexOf("function compactMain"),source.indexOf("function startMain"))
    expect(compact).toContain("compactTransientActivationState()")
    expect(compact).not.toContain("verifyBridgeReceiptLive()")
    expect(compact).not.toContain("ensureNetworkBoundaryReceipt()")
    expect(compact).not.toContain("systemctl")
    expect(source).toContain('else if (process.argv[2] === "compact") compactMain(process.argv[3])')
  })

  it("accepts only an exact transaction-bound network transition", () => {
    const exact = { journalState:"ABSENT", receiptState:"ABSENT", nftExact:true, egressActiveEnabled:true, brokerInactiveDisabled:true, gitSocketInactiveDisabled:true, gitServiceInactive:true, listenerAbsent:true, workerWorkspaceAbsent:true }
    expect(inspectNetworkActivationState(exact)).toBe("ACTIVATE_EXACT_INERT")
    expect(inspectNetworkActivationState({...exact, journalState:"INTENT"})).toBe("ACTIVATE_EXACT_INERT")
    expect(inspectNetworkActivationState({...exact, brokerInactiveDisabled:false})).toBe("DRIFT")
    expect(inspectNetworkActivationState({...exact, brokerInactiveDisabled:false, gitSocketInactiveDisabled:false, listenerAbsent:false})).toBe("ADOPT_EXACT_ACTIVE")
    expect(inspectNetworkActivationState({...exact, journalState:"APPLIED", brokerInactiveDisabled:false, gitSocketInactiveDisabled:false, listenerAbsent:false})).toBe("ADOPT_EXACT_ACTIVE")
    expect(inspectNetworkActivationState({...exact, journalState:"APPLIED", receiptState:"EXACT_ACTIVE", brokerInactiveDisabled:false, gitSocketInactiveDisabled:false, listenerAbsent:false})).toBe("REFRESH_EXACT_ACTIVE")
    expect(inspectNetworkActivationState({...exact, receiptState:"FOREIGN"})).toBe("DRIFT")
  })

  it("requires the applied network record to bind the exact intent proof and generation", () => {
    const intent={schemaVersion:1,status:"NETWORK_ACTIVATION_INTENT",runId,activationId:ACTIVATION_ID,authorityReference:AUTHORITY_REFERENCE,proofId:"11111111-1111-4111-8111-111111111111",generationId:"22222222-2222-4222-8222-222222222222",policySha256:"a".repeat(64),activationSha256:"b".repeat(64),providerSha256:"c".repeat(64),launcherSha256:"d".repeat(64),workerSha256:"e".repeat(64)}
    const intentSha256=sha(`${canonical(intent)}\n`),applied={...intent,status:"NETWORK_ACTIVATION_APPLIED",intentSha256}
    expect(inspectNetworkJournalBinding(intent,applied)).toBe("NETWORK_JOURNAL_BOUND")
    expect(inspectNetworkJournalBinding(intent,{...applied,proofId:"33333333-3333-4333-8333-333333333333"})).toBe("DRIFT")
    expect(inspectNetworkJournalBinding(intent,{...applied,generationId:"44444444-4444-4444-8444-444444444444"})).toBe("DRIFT")
    expect(inspectNetworkJournalBinding(intent,{...applied,policySha256:"f".repeat(64)})).toBe("DRIFT")
    expect(inspectNetworkJournalBinding(intent,{...applied,intentSha256:"0".repeat(64)})).toBe("DRIFT")
  })

  it("can settle an exact active INTENT state after activation fails before APPLIED publication", () => {
    const exact={journalState:"INTENT",receiptState:"ABSENT",nftExact:true,egressActiveEnabled:true,brokerInactiveDisabled:false,gitSocketInactiveDisabled:false,gitServiceInactive:true,listenerAbsent:false,workerWorkspaceAbsent:true}
    expect(inspectNetworkSettlementState(exact)).toBe("SETTLE_EXACT_ACTIVE")
    expect(inspectNetworkSettlementState({...exact,nftExact:false})).toBe("DRIFT")
    expect(inspectNetworkSettlementState({...exact,brokerInactiveDisabled:true})).toBe("SETTLE_EXACT_PARTIAL")
    expect(inspectNetworkSettlementState({...exact,brokerInactiveDisabled:true,listenerAbsent:true})).toBe("SETTLE_EXACT_PARTIAL")
    expect(inspectNetworkSettlementState({...exact,gitSocketInactiveDisabled:true})).toBe("SETTLE_EXACT_PARTIAL")
  })

  it("settles the network boundary when transient daemon creation fails before a session", () => {
    const events:string[]=[]
    expect(()=>runActivationDaemonGuard(()=>{events.push("start");throw new Error("systemd-run failed")},()=>false,()=>events.push("sleep"),()=>events.push("cleanup"),2)).toThrow("systemd-run failed")
    expect(events).toEqual(["start","cleanup"])
  })

  it("settles the network boundary when the daemon starts but publishes no session", () => {
    const events:string[]=[]
    expect(()=>runActivationDaemonGuard(()=>{events.push("start");return"unit"},()=>false,()=>events.push("sleep"),()=>events.push("cleanup"),2)).toThrow("activation daemon did not publish session")
    expect(events).toEqual(["start","sleep","sleep","cleanup"])
  })

  it("publishes only the two-field ticket directory identity accepted by provider and launcher", () => {
    expect(inspectReceiptTicketDirectoryIdentity({device:"29",inode:"88301"})).toEqual({device:"29",inode:"88301"})
    expect(inspectReceiptTicketDirectoryIdentity({device:"29",inode:"88301",ctimeNs:"1786410000000000100"})).toBeNull()
  })

  it("records a bounded inert network failure without serializing the thrown error", () => {
    expect(buildNetworkFailureRecord("NETWORK_ACTIVATION_FAILED_INERT","2026-08-13T02:10:00.000Z","NETWORK_SLICE_START_FAILED")).toEqual({schemaVersion:1,status:"NETWORK_ACTIVATION_FAILED_INERT",runId,activationId:ACTIVATION_ID,authorityReference:AUTHORITY_REFERENCE,reasonCode:"NETWORK_SLICE_START_FAILED",observedAt:"2026-08-13T02:10:00.000Z"})
    expect(buildNetworkFailureRecord("NETWORK_ACTIVATION_FAILED_INERT","2026-08-13T02:10:00.000Z","secret value")).toBeNull()
    expect(buildNetworkFailureRecord("foreign" as any,"2026-08-13T02:10:00.000Z")).toBeNull()
  })

  it("re-disables the bridge before replaying an existing settlement", () => {
    const source=fs.readFileSync(path.join(root,"scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs"),"utf8")
    expect(source).toContain('if (fs.existsSync(SETTLEMENT_FILE)) { run("/usr/bin/systemctl",["disable","--now","williamos-aegis-remote-dev-activation.socket"])')
  })
})
