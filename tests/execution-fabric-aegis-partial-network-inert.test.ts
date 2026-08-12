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
  it("binds the exact consumed failed transaction generation", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/execution-fabric/provision/aegis-partial-network-inert.mjs"), "utf8")
    for (const expected of ["9dd7b361-e3a9-4dba-b1ca-0fb76305a9c8", "227cabd15311483e3f23136a42bb7b8ffa681eeb8158b3913b3fed41e403c05d", "d611f473-34a4-4e25-aad9-5a35aa8fc814", "d8ad68748f4302de4ce3d2f7080d7d216d06ee0c221c920385506927e1c7899e", "observedFreshMainCommit", "reviewedPackageCommit", "9a47acf2af49e71ea9d689f19d24c35ff6fef4d5", "RECONCILE_TRUSTED_REPOSITORIES", "control checkout is dirty"]) expect(source).toContain(expected)
  })
})
