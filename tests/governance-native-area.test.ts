import { describe, expect, it } from "vitest"
import { getGovernanceNativeArea } from "@/components/governance/governance-native-area"
import { getAuthorityRegistrySurface } from "@/components/governance/authority-registry"

describe("Governance native area", () => {
  it("frames Governance as the native WilliamOS authority layer", () => {
    const area = getGovernanceNativeArea()

    expect(area.title).toBe("Governance")
    expect(area.eyebrow).toBe("Primary Authority Layer")
    expect(area.description).toContain("Primary Operator authority layer")
    expect(area.description).toContain("denied authority")
    expect(area.description).toContain("without turning the shell into an approval console")
    expect(area.shellSequence).toEqual([
      expect.objectContaining({
        label: "Authority",
        value: "Declare",
      }),
      expect.objectContaining({
        label: "Gate",
        value: "Hold",
      }),
      expect.objectContaining({
        label: "Evidence",
        value: "Prove",
      }),
      expect.objectContaining({
        label: "Decision",
        value: "Return",
      }),
    ])
    expect(area.postureSummary).toEqual([
      expect.objectContaining({
        label: "Primary authority",
        value: "owner-gated",
      }),
      expect.objectContaining({
        label: "Safety gates",
        value: "mutation blocked",
      }),
      expect.objectContaining({
        label: "Evidence",
        value: "required",
      }),
    ])
  })

  it("shows authority, decision, gate, access, activation, evidence, and permission sections", () => {
    const area = getGovernanceNativeArea()
    const labels = area.sections.map((section) => section.label)

    expect(labels).toEqual([
      "Primary Authority",
      "Blocked Decisions",
      "Safety Gates",
      "Access Posture",
      "Activation Reviews",
      "Evidence Required",
      "Permission Boundaries",
    ])
    expect(area.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Access Posture",
        posture: "Disabled until approved",
      }),
      expect.objectContaining({
        label: "Activation Reviews",
        posture: "Prepared, not authorized",
      }),
      expect.objectContaining({
        label: "Permission Boundaries",
        posture: "Explicit",
      }),
    ]))
  })

  it("connects Governance to Decisions, Work Orders, Evidence, and Systems", () => {
    const area = getGovernanceNativeArea()
    const links = new Map(area.links.map((link) => [link.label, link.href]))

    expect(links.get("Decisions")).toBe("/decisions")
    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Systems")).toBe("/runtime")
  })

  it("does not implement approvals, access grants, permissions, runtime, or production writes", () => {
    const area = getGovernanceNativeArea()

    expect(area.safety).toEqual({
      nativeToWilliamOS: true,
      changesAuthBehavior: false,
      changesAuthPolicy: false,
      activatesAccessGrants: false,
      issuesTokens: false,
      addsAuditWriter: false,
      addsDurableLimiter: false,
      changesRuntimeValidation: false,
      changesPermissionModel: false,
      executesApprovals: false,
      autoApproves: false,
      mutatesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    })
    expect(area.authorityBoundaries).toEqual([
      expect.objectContaining({
        label: "Approval",
        state: "Not execution",
      }),
      expect.objectContaining({
        label: "Access grants",
        state: "Disabled",
      }),
      expect.objectContaining({
        label: "Runtime activation",
        state: "Blocked",
      }),
    ])
  })

  it("avoids admin, team permission, auto-approval, and activation copy", () => {
    const area = getGovernanceNativeArea()
    const text = [
      area.title,
      area.eyebrow,
      area.description,
      ...area.shellSequence.flatMap((item) => [item.label, item.value, item.description]),
      ...area.postureSummary.flatMap((item) => [item.label, item.value, item.description]),
      ...area.sections.flatMap((section) => [
        section.label,
        section.posture,
        section.purpose,
        section.allowed,
        section.blocked,
        section.ownerApproval,
        section.nextSafeStep,
      ]),
      ...area.authorityBoundaries.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...area.links.flatMap((link) => [link.label, link.description]),
    ].join(" ")

    expect(text).not.toMatch(
      /admin panel|user management|team permissions|workspace settings|execute approval|auto-approve|grant access now|activate now|unleash|AI administrator|compliance theater/i,
    )
  })

  it("keeps the Authority Registry static, read-only, and owner-gated", () => {
    const registry = getAuthorityRegistrySurface()

    expect(registry.doctrine.statements).toContain("WilliamOS must not grant itself authority.")
    expect(registry.records.map((record) => record.authorityId)).toContain(
      "authority-read-only-registry",
    )
    expect(registry.records.map((record) => record.authorityId)).toContain(
      "authority-local-runtime-mutation",
    )
    expect(registry.safety.staticReadOnly).toBe(true)
    expect(registry.safety.commandExecutionAdded).toBe(false)
    expect(registry.safety.runtimeEnforcementEngineAdded).toBe(false)
    expect(registry.safety.permissionModelChanged).toBe(false)
  })
})
