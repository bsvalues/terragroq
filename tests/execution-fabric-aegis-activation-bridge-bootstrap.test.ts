import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { inspectBridgeBootstrapAuthority, inspectBridgeDestinationState, inspectBridgeReceiptState } from "../scripts/execution-fabric/provision/aegis-remote-dev-activation-bridge-bootstrap.mjs"

describe("AEGIS activation bridge bootstrap authority", () => {
  const root=process.cwd()
  it("accepts only one exact signed-payload shape in its fifteen-minute window", () => {
    const asset = (source:string,destination:string,mode="0555") => ({source,destination,sha256:"a".repeat(64),mode})
    const payload:any={schemaVersion:1,operation:"INSTALL_ACTIVATION_BRIDGE",authorityId:"11111111-1111-4111-8111-111111111111",runId:"c9889658-bad2-43e2-8def-a0a9c9df5d3c",issuedAt:"2026-08-13T02:01:00.000Z",expiresAt:"2026-08-13T02:16:00.000Z",singleUse:true,machineIdSha256:"b".repeat(64),bootId:"22222222-2222-4222-8222-222222222222",controlCommit:"c".repeat(40),verifierSha256:"d".repeat(64),prerequisiteReceiptSha256:"41ea35adc284b37e381f1162e5cd2315f8a0ef2da5c2326e1a224c15e4fa541c",assets:[asset("scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs","/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs"),asset("scripts/execution-fabric/provision/assets/aegis-remote-dev-activation-peer.py","/usr/local/libexec/williamos-aegis-remote-dev-activation-peer.py"),asset("scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation.socket","/etc/systemd/system/williamos-aegis-remote-dev-activation.socket","0444"),asset("scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation@.service","/etc/systemd/system/williamos-aegis-remote-dev-activation@.service","0444"),asset("scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs","/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs")]}
    const envelope={payload,signature:"AA=="}
    expect(inspectBridgeBootstrapAuthority(envelope,"2026-08-13T02:06:00.000Z",payload.verifierSha256)).toMatchObject({status:"BRIDGE_BOOTSTRAP_AUTHORITY_MATCHED"})
    expect(inspectBridgeBootstrapAuthority({payload:{...payload,extra:true},signature:"AA=="},"2026-08-13T02:06:00.000Z",payload.verifierSha256)).toMatchObject({status:"BLOCKED"})
    expect(inspectBridgeBootstrapAuthority({payload:{...payload,assets:payload.assets.map((v:any,i:number)=>i? v:{...v,destination:"/etc/shadow"})},signature:"AA=="},"2026-08-13T02:06:00.000Z",payload.verifierSha256)).toMatchObject({status:"BLOCKED"})
    expect(inspectBridgeBootstrapAuthority(envelope,payload.expiresAt,payload.verifierSha256)).toMatchObject({status:"BLOCKED"})
  })

  it("upgrades only the exact reviewed SSH entrypoint predecessor", () => {
    const destination="/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs",current="dfcc26c875ccd8d7abda09131bb051becc12995ae2dd0e3865bddeb4b1856e21"
    expect(inspectBridgeDestinationState(destination,current,"0555",current)).toBe("MATCH")
    expect(inspectBridgeDestinationState(destination,"1eba36323a42353623b6659b146c7b7096d290fe883ae302524b12363e17c01f","0555",current)).toBe("EXACT_PREDECESSOR")
    expect(inspectBridgeDestinationState(destination,"018406b0621df8b306bee113c4ea7cbed2e3af7c0d53d15e4d8dcb3cc59d3dd7","0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState(destination,"f".repeat(64),"0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState("/usr/local/libexec/other","1eba36323a42353623b6659b146c7b7096d290fe883ae302524b12363e17c01f","0555",current)).toBe("DRIFT")
  })

  it("bounds activation relay long enough for the reviewed root proof and network gate", () => {
    const source=fs.readFileSync(path.join(root,"scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs"),"utf8")
    expect(source).toContain("const ACTIVATION_RELAY_TIMEOUT_MS = 60_000")
    expect(source).toContain("socket.setTimeout(ACTIVATION_RELAY_TIMEOUT_MS)")
  })

  it("upgrades only the exact reviewed activation-host predecessor", () => {
    const destination="/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs", current="b3cd24801770a73bbb63c3cf426e1c54f954a84b930d6d5f1ae5644e9e31b862"
    expect(inspectBridgeDestinationState(destination,"d467800c3f288e13174d6a12c54199fbff0047e5a8e1b7ced09372dfea78562c","0555",current)).toBe("EXACT_PREDECESSOR")
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
    expect(inspectBridgeReceiptState("658f68f9f06cf0e9296ef8493718f90a1715edc1f84ca647f9205923aab0ce92","0".repeat(64))).toBe("EXACT_PREDECESSOR")
    expect(inspectBridgeReceiptState("41b55d3f250cfb6524d203e275750d49206f91ecbbb493971ad278fec836f339","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("850deb1097fe7971d2574bee49650fd81b01b6cfd3c71d9a9b0684888d29f74b","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("5d2e41f957ceeba53839454392f607c1f5749886761ffd4f3df8f89a962ae043","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("74a9bc03353ee81b51711b66dedb3206fbef5d193997a4a1137c5f45157a5f59","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("b681cf30dba60dd1976082cd3f917478baab4935c683e3a82f02b73f162bf931","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("0".repeat(64),"1".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("1".repeat(64),"1".repeat(64))).toBe("MATCH")
  })
})
