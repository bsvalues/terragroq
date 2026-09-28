import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The host attestation fact `inference.ollama` reads the deployed service from the protected runtime
 * root, but its task-action predicate pinned the retired user-writable C:\HermesLab\... path. Because
 * deploy-hermes-appliance.ps1 rewrites privileged task arguments onto the protected runtime root, the
 * registered action never matched that predicate, so every post-deployment attestation set
 * $taskHealthy false and the binder reported inference drift on a correctly deployed node.
 *
 * These assertions keep the predicate and the path the fact actually reads from drifting apart.
 */
const COLLECTOR = "scripts/lab-control/hermes/host-attestation/collect-hermes-host-attestation.v1.ps1"
const DEPLOYER = "scripts/lab-control/hermes/deploy-hermes-appliance.ps1"
const PROTECTED_RUNTIME_ROOT = "C:\\ProgramData\\Hermes\\runtime"

describe("host attestation ollama task-action predicate", () => {
  const collector = readFileSync(COLLECTOR, "utf8")
  const deployer = readFileSync(DEPLOYER, "utf8")

  it("derives the task-action predicate from the service path the fact reads", () => {
    const predicate = collector.split("\n").find((l) => l.includes("$exactTaskArguments ="))
    expect(predicate).toBeTruthy()
    // One source of truth: the predicate is built from $servicePath, not a second literal.
    expect(predicate).toContain("[regex]::Escape($servicePath)")
  })

  it("does not accept the retired user-writable ollama service path", () => {
    const predicate = collector.split("\n").find((l) => l.includes("$exactTaskArguments ="))
    expect(predicate).not.toMatch(/HermesLab/i)
  })

  it("agrees with the deployment about where the protected service lives", () => {
    // The collector reads the deployed service from the protected runtime root...
    const servicePath = collector.split("\n").find((l) => l.includes("$servicePath = '"))
    expect(servicePath).toContain(PROTECTED_RUNTIME_ROOT)
    // ...and the deployment is what puts privileged task scripts there.
    expect(deployer).toContain("$runtimePath=Join-Path $ProtectedRuntimeRoot")
    expect(deployer).toContain("-ireplace [regex]::Escape($oldPath),$runtimePath")
  })
})
