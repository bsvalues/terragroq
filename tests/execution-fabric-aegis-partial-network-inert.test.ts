import { describe, expect, it } from "vitest"
import { inspectPartialNetworkInert } from "../scripts/execution-fabric/provision/aegis-partial-network-inert.mjs"
import fs from "node:fs"
import path from "node:path"

describe("AEGIS partial network inert settlement", () => {
  const exact = () => ({ nftUnchanged: true, egressRetained: true, brokerInactiveDisabled: true, gitSocketInactiveDisabled: true, gitServiceInactive: true, listenerAbsent: true })
  it("requires every postcondition", () => {
    expect(inspectPartialNetworkInert(exact()).status).toBe("PARTIAL_NETWORK_INERT_VERIFIED")
    for (const key of Object.keys(exact())) expect(inspectPartialNetworkInert({ ...exact(), [key]: false }).status).toBe("BLOCKED")
  })
  it("binds durable recovery, trusted time, isolated Git, and exact process/socket proofs", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/execution-fabric/provision/aegis-partial-network-inert.mjs"), "utf8")
    for (const expected of ["GIT_CONFIG_NOSYSTEM", "GIT_NO_REPLACE_OBJECTS", "ensureActionRoot", "function mutate(p,args)", "mutate(p,[\"disable\", BROKER])", "mutate(p,[\"stop\", BROKER])", "mutate(p,[\"disable\", GIT_SOCKET])", "mutate(p,[\"stop\", GIT_SOCKET])", "authority expired before mutation", "authority expired before settlement", "applied evidence differs", "STOP:${GIT_SERVICE}", "/proc", "sport = :17734 or dport = :17734"]) expect(source).toContain(expected)
  })
})
