import { describe, expect, it } from "vitest"
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { inspectBridgeBootstrapAuthority, inspectBridgeDestinationState, inspectBridgeReceiptState } from "../scripts/execution-fabric/provision/aegis-remote-dev-activation-bridge-bootstrap.mjs"
import { relayActivation } from "../scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs"

describe("AEGIS activation bridge bootstrap authority", () => {
  const root=process.cwd()
  it("accepts only one exact signed-payload shape in its fifteen-minute window", () => {
    const asset = (source:string,destination:string,mode="0555") => ({source,destination,sha256:"a".repeat(64),mode})
    const payload:any={schemaVersion:1,operation:"INSTALL_ACTIVATION_BRIDGE",authorityId:"11111111-1111-4111-8111-111111111111",runId:"bd39dfc5-ef3b-4789-a5e6-095385330424",issuedAt:"2026-08-13T06:05:00.000Z",expiresAt:"2026-08-13T06:20:00.000Z",singleUse:true,machineIdSha256:"b".repeat(64),bootId:"22222222-2222-4222-8222-222222222222",controlCommit:"c".repeat(40),verifierSha256:"d".repeat(64),prerequisiteReceiptSha256:"41ea35adc284b37e381f1162e5cd2315f8a0ef2da5c2326e1a224c15e4fa541c",assets:[asset("scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs","/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs"),asset("scripts/execution-fabric/provision/assets/aegis-remote-dev-activation-peer.py","/usr/local/libexec/williamos-aegis-remote-dev-activation-peer.py"),asset("scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation.socket","/etc/systemd/system/williamos-aegis-remote-dev-activation.socket","0444"),asset("scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation@.service","/etc/systemd/system/williamos-aegis-remote-dev-activation@.service","0444"),asset("scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs","/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs")]}
    const envelope={payload,signature:"AA=="}
    expect(inspectBridgeBootstrapAuthority(envelope,"2026-08-13T06:06:00.000Z",payload.verifierSha256)).toMatchObject({status:"BRIDGE_BOOTSTRAP_AUTHORITY_MATCHED"})
    expect(inspectBridgeBootstrapAuthority({payload:{...payload,extra:true},signature:"AA=="},"2026-08-13T06:06:00.000Z",payload.verifierSha256)).toMatchObject({status:"BLOCKED"})
    expect(inspectBridgeBootstrapAuthority({payload:{...payload,assets:payload.assets.map((v:any,i:number)=>i? v:{...v,destination:"/etc/shadow"})},signature:"AA=="},"2026-08-13T06:06:00.000Z",payload.verifierSha256)).toMatchObject({status:"BLOCKED"})
    expect(inspectBridgeBootstrapAuthority(envelope,payload.expiresAt,payload.verifierSha256)).toMatchObject({status:"BLOCKED"})
  })

  it("upgrades only the exact reviewed SSH entrypoint predecessor", () => {
    const destination="/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs",current="2c6c5ccd69e1dd13a6c02ff2c766542bb222e160e2589a1a389302ec41f079ec"
    expect(inspectBridgeDestinationState(destination,"dfcc26c875ccd8d7abda09131bb051becc12995ae2dd0e3865bddeb4b1856e21","0555",current)).toBe("EXACT_PREDECESSOR")
    expect(inspectBridgeDestinationState(destination,current,"0555",current)).toBe("MATCH")
    expect(inspectBridgeDestinationState(destination,"1eba36323a42353623b6659b146c7b7096d290fe883ae302524b12363e17c01f","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"018406b0621df8b306bee113c4ea7cbed2e3af7c0d53d15e4d8dcb3cc59d3dd7","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"f".repeat(64),"0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState("/usr/local/libexec/other","1eba36323a42353623b6659b146c7b7096d290fe883ae302524b12363e17c01f","0555",current)).toBe("DRIFT")
  })

  it("bounds activation relay long enough for the reviewed root proof and network gate", () => {
    const source=fs.readFileSync(path.join(root,"scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs"),"utf8")
    expect(source).toContain("const ACTIVATION_RELAY_TIMEOUT_MS = 60_000")
    expect(source).toContain("timeoutMs = ACTIVATION_RELAY_TIMEOUT_MS")
    expect(source).toContain("socket.setTimeout(timeoutMs)")
  })

  it.runIf(process.platform !== "win32")("delivers an immediate structured exit-2 Unix-socket response before the relay bound", async () => {
    const socketPath=path.join(os.tmpdir(),`williamos-activation-${crypto.randomUUID()}.sock`)
    const response=Buffer.from('{"status":"BLOCKED","reasonCode":"PRECLAIM_DRIFT"}\n')
    const server=net.createServer({allowHalfOpen:true},socket=>{socket.resume();socket.on("end",()=>socket.end(response))})
    await new Promise<void>((resolve,reject)=>server.listen(socketPath,resolve).once("error",reject))
    const output:Buffer[]=[]
    try { expect(await relayActivation(Buffer.from('{"action":"start"}\n'),{socketPath,timeoutMs:1000,write:value=>{output.push(Buffer.from(value));return true}})).toBe(2) }
    finally { await new Promise<void>(resolve=>server.close(()=>resolve())); fs.rmSync(socketPath,{force:true}) }
    expect(Buffer.concat(output)).toEqual(response)
  })

  it("upgrades only the exact reviewed activation-host predecessor", () => {
    const destination="/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs", current="0c0a85298fd3bdb90c55bd9a031c71fbe8e5aad64669815701c299cde2a727d8"
    expect(inspectBridgeDestinationState(destination,"0c0a85298fd3bdb90c55bd9a031c71fbe8e5aad64669815701c299cde2a727d8","0555","0".repeat(64))).toBe("EXACT_PREDECESSOR")
    expect(inspectBridgeDestinationState(destination,"3d0ac39c7a3ae6ea7e31c5fba0f1ad2556ebddd31b230930d8a991b9a64d3665","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"e5d91a9a6b33ba1915283786416374eea57c4d4fb1f9650a172f37b6755447f2","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"523711b8c19b17aee31c796d220e976942df104679bb2b8a95d3e8e615b3589c","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"4c19a73dbbc48a6030b2f1e53d908344bac9b8bd9a57da7a791773b083c29e92","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"bdb38281726e0e44e21016747a0a3046423326fa997f8ab3d4d6a2fbf5994a33","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"623ea9391498c005ac3a642a8d0041140dd2890dbcb371e64f8aa5bf04fe7128","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"b3cd24801770a73bbb63c3cf426e1c54f954a84b930d6d5f1ae5644e9e31b862","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"d467800c3f288e13174d6a12c54199fbff0047e5a8e1b7ced09372dfea78562c","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"0ab20d9b3df524e9201187f7f3e4927aba0376688c3fb2c4ce229d920cc19e8d","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"f".repeat(64),"0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"44a5b12ad5a2f65a9c1a841105626aaded996c14d1ca32fc893d8fcc8ca4b152","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"1c46a0ff878715df84811d159845802b6543961d3d90f4db056d21b547f56635","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"db0d3cd51563d5ca47fee8e285a6b38d57df1c158f3bc8bbc140bbb77aad79c6","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"70ca4609b406dddc78bfa53f8aee50255d257fd9a0a9b3610854564c90a192d7","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"a06e5ba83c19586f6c97909a048a92d139057bc9590ccc5276a8927e2f86a9d5","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState("/usr/local/libexec/other","d467800c3f288e13174d6a12c54199fbff0047e5a8e1b7ced09372dfea78562c","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"d467800c3f288e13174d6a12c54199fbff0047e5a8e1b7ced09372dfea78562c","0777",current)).toBe("DRIFT")
  })

  it("accepts only the exact first bridge receipt as a bounded successor predecessor", () => {
    expect(inspectBridgeReceiptState("1ea25244c7e0125195b36f5f22de5d42c6fbbb2000ece1c5b67983b1f652144f","0".repeat(64))).toBe("EXACT_PREDECESSOR")
    expect(inspectBridgeReceiptState("df9544b07350764c8faffbea288f215a8fe41eca7e657fc8e7dd77744f56dd75","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("1c7b05274186f6087ff9c7e0db871a5cb4e4ed3c160fa0194f045cab734eeda6","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("b26aa28b2a8a82526dfad2297962811850073592691f0e0a06c6ec2ac0931f50","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("d65c6a014254da36942278c2740d0bc716b46b0f3476f85200f255f0080b6938","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("b9d802bbd19f6c1a2e40863a56139c73c3e6bda2387a2b0baa5c35786eb3760d","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("f810fcf1fb86368679c5f84a621a637be35d2d25e2f46013f7b21f518f1b8af5","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("831b87bd2fa0797f59d427697941868a0fc3678cf6b643db353e658a194cc702","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("41b55d3f250cfb6524d203e275750d49206f91ecbbb493971ad278fec836f339","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("850deb1097fe7971d2574bee49650fd81b01b6cfd3c71d9a9b0684888d29f74b","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("5d2e41f957ceeba53839454392f607c1f5749886761ffd4f3df8f89a962ae043","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("74a9bc03353ee81b51711b66dedb3206fbef5d193997a4a1137c5f45157a5f59","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("b681cf30dba60dd1976082cd3f917478baab4935c683e3a82f02b73f162bf931","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("0".repeat(64),"1".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("1".repeat(64),"1".repeat(64))).toBe("MATCH")
  })
})
