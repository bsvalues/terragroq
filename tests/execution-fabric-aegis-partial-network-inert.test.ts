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
    for (const expected of ["4bb8354e-b819-494d-acc1-f7c6e120b954", "97e970bddb8484820818c3de7a5dc20e89c7cb1dfaeb2f3a4f73309f5bb5e976", "6cd324fa-2cad-471a-b2b7-72769b925072", "e1ba12c43b16f2f81d7efddf8bc4d9b4e8e34e30d9ed4eaa2d130cd01b87e159", "observedFreshMainCommit", "reviewedPackageCommit", "a0462cfd5f6be035a95b773fea01d36545761e0d", "INSTALL_FORCED_COMMAND_TRANSPORT", "post-apply prerequisite verification differs"]) expect(source).toContain(expected)
    expect(source).toContain("names.length !== 14")
    expect(source).toContain("i === 13")
  })
})
