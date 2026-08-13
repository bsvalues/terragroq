import { describe, expect, it } from "vitest"
import { inspectBridgeBootstrapAuthority, inspectBridgeDestinationState, inspectBridgeReceiptState } from "../scripts/execution-fabric/provision/aegis-remote-dev-activation-bridge-bootstrap.mjs"

describe("AEGIS activation bridge bootstrap authority", () => {
  it("accepts only one exact signed-payload shape in its fifteen-minute window", () => {
    const asset = (source:string,destination:string,mode="0555") => ({source,destination,sha256:"a".repeat(64),mode})
    const payload:any={schemaVersion:1,operation:"INSTALL_ACTIVATION_BRIDGE",authorityId:"11111111-1111-4111-8111-111111111111",runId:"a3961b87-ed54-45d0-a975-678a02f1e163",issuedAt:"2026-08-12T22:30:00.000Z",expiresAt:"2026-08-12T22:45:00.000Z",singleUse:true,machineIdSha256:"b".repeat(64),bootId:"22222222-2222-4222-8222-222222222222",controlCommit:"c".repeat(40),verifierSha256:"d".repeat(64),prerequisiteReceiptSha256:"41ea35adc284b37e381f1162e5cd2315f8a0ef2da5c2326e1a224c15e4fa541c",assets:[asset("scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs","/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs"),asset("scripts/execution-fabric/provision/assets/aegis-remote-dev-activation-peer.py","/usr/local/libexec/williamos-aegis-remote-dev-activation-peer.py"),asset("scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation.socket","/etc/systemd/system/williamos-aegis-remote-dev-activation.socket","0444"),asset("scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation@.service","/etc/systemd/system/williamos-aegis-remote-dev-activation@.service","0444"),asset("scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs","/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs")]}
    const envelope={payload,signature:"AA=="}
    expect(inspectBridgeBootstrapAuthority(envelope,"2026-08-12T22:35:00.000Z",payload.verifierSha256)).toMatchObject({status:"BRIDGE_BOOTSTRAP_AUTHORITY_MATCHED"})
    expect(inspectBridgeBootstrapAuthority({payload:{...payload,extra:true},signature:"AA=="},"2026-08-12T22:35:00.000Z",payload.verifierSha256)).toMatchObject({status:"BLOCKED"})
    expect(inspectBridgeBootstrapAuthority({payload:{...payload,assets:payload.assets.map((v:any,i:number)=>i? v:{...v,destination:"/etc/shadow"})},signature:"AA=="},"2026-08-12T22:35:00.000Z",payload.verifierSha256)).toMatchObject({status:"BLOCKED"})
    expect(inspectBridgeBootstrapAuthority(envelope,payload.expiresAt,payload.verifierSha256)).toMatchObject({status:"BLOCKED"})
  })

  it("upgrades only the exact reviewed SSH entrypoint predecessor", () => {
    const destination="/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs",current="1eba36323a42353623b6659b146c7b7096d290fe883ae302524b12363e17c01f"
    expect(inspectBridgeDestinationState(destination,current,"0555",current)).toBe("MATCH")
    expect(inspectBridgeDestinationState(destination,"018406b0621df8b306bee113c4ea7cbed2e3af7c0d53d15e4d8dcb3cc59d3dd7","0555",current)).toBe("EXACT_PREDECESSOR")
    expect(inspectBridgeDestinationState(destination,"f".repeat(64),"0555",current)).toBe("DRIFT")
    expect(inspectBridgeDestinationState("/usr/local/libexec/other","018406b0621df8b306bee113c4ea7cbed2e3af7c0d53d15e4d8dcb3cc59d3dd7","0555",current)).toBe("DRIFT")
  })

  it("accepts only the exact first bridge receipt as a bounded successor predecessor", () => {
    expect(inspectBridgeReceiptState("75e9e38db576262aeb42d26cf7b35587781c75def0383b50534e2b024935d300","0".repeat(64))).toBe("EXACT_PREDECESSOR")
    expect(inspectBridgeReceiptState("b3614a3ce8e584bd25215947202ca9a29701b6f1913e7d8e67676a54f55dfd89","0".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("0".repeat(64),"1".repeat(64))).toBe("DRIFT")
    expect(inspectBridgeReceiptState("1".repeat(64),"1".repeat(64))).toBe("MATCH")
  })
})
