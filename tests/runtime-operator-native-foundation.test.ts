import fs from "node:fs"
import { describe, expect, it } from "vitest"

describe("native supervisor foundation", () => {
  const module = fs.readFileSync("runtime-operator/native/WilliamOS.RuntimeOperator.psm1", "utf8")
  const supervisor = fs.readFileSync("scripts/local/williamos-native-supervisor.ps1", "utf8")
  const registry = JSON.parse(fs.readFileSync("runtime-operator/native/authority-registry.json", "utf8"))

  it("enforces the directory, ACL, and reparse boundary", () => {
    for (const child of ["control", "state", "audit", "workspace", "locks"]) expect(module).toContain(`"${child}"`)
    expect(module).toContain("RUNTIME_ROOT_REPARSE_WALL")
    expect(module).toContain("RUNTIME_ROOT_PERMISSIVE_ACL_WALL")
    expect(module).not.toContain('"secrets"')
  })

  it("is disabled-first with bounded retry and a single-instance lock", () => {
    expect(supervisor.indexOf("Get-WilliamOSActivation")).toBeLessThan(supervisor.indexOf("williamos-auth-readiness"))
    expect(supervisor).toContain("NATIVE_RUNTIME_STATUS=DISABLED")
    expect(supervisor).toContain("MaxRetrySeconds")
    expect(module).toContain("FileMode]::CreateNew")
    expect(module).toContain("ACTIVE_SUPERVISOR_LOCK")
    const invocation = "& node $kernel --root $Root --repository $RepositoryPath --registry $registry 2>&1"
    expect(supervisor).toContain(invocation)
    expect(supervisor.indexOf("Get-WilliamOSActivation")).toBeLessThan(supervisor.indexOf(invocation))
    expect(supervisor.indexOf('"runtime-operator\\native\\authority-registry.json"')).toBeLessThan(supervisor.indexOf(invocation))
    expect(supervisor.indexOf('$exitCode -eq 2')).toBeLessThan(supervisor.indexOf('$exitCode -eq 3'))
    expect(supervisor.indexOf('$exitCode -eq 3')).toBeLessThan(supervisor.indexOf('$exitCode -ne 0'))
    expect(supervisor).toContain("OPERATIONAL_KERNEL_TERMINAL_WALL")
    expect(supervisor).not.toContain('workOrder = $null; state = "READY"')
  })

  it("terminally quarantines the rejected adapter before readiness or kernel dispatch", () => {
    expect(registry.adapter).toMatchObject({
      adapterId: "local-nested-codex-exec",
      state: "QUARANTINED_TERMINAL",
      dispatchAllowed: false,
      retryAllowed: false,
      terminalIssueNumber: 357,
      terminalReason: "CODEX_NETWORK_WALL",
      revocationEvent: { required: true, status: "PENDING_OWNER_SIGNED_EVENT", eventId: null },
    })
    expect(registry.workOrders).toHaveLength(2)
    expect(registry.workOrders.every((record: Record<string, unknown>) =>
      record.authority === "REVOKED_TERMINAL"
      && record.executionAllowed === false
      && record.retryAllowed === false)).toBe(true)

    const quarantineCall = "Assert-LegacyAdapterQuarantined -RegistryPath $registry -VerifierPath $OwnerRevocationVerifierPath"
    const readinessCall = '& "$PSScriptRoot\\williamos-auth-readiness.ps1"'
    const invocation = "& node $kernel --root $Root --repository $RepositoryPath --registry $registry 2>&1"
    expect(supervisor).toContain('throw "QUARANTINED_TERMINAL"')
    expect(supervisor).toContain('OWNER_REVOCATION_EVENT=VERIFIED')
    expect(supervisor.indexOf(quarantineCall)).toBeLessThan(supervisor.indexOf(readinessCall))
    expect(supervisor.indexOf(quarantineCall)).toBeLessThan(supervisor.indexOf(invocation))
  })

  it("uses atomic schema-bound secret-free checkpoints", () => {
    expect(module).toContain("schemaVersion = 1")
    expect(module).toContain("Move-Item -LiteralPath $temp")
    expect(module).toContain("CORRUPT_CHECKPOINT_WALL")
    expect(module).toContain("CHECKPOINT_FIELD_WALL")
  })
})
