import { describe, expect, it } from "vitest"
import { getLocalOperatorSurface } from "@/components/local/local-operator-surface"

describe("Local operator surface", () => {
  it("shows the OMEN Phase 1 manual runtime posture", () => {
    const surface = getLocalOperatorSurface()

    expect(surface.title).toBe("Local Operations")
    expect(surface.eyebrow).toBe("OMEN Manual Runtime")
    expect(surface.phaseHost).toBe("HP OMEN Gaming Laptop 16-ap0xxx")
    expect(surface.description).toContain("Read-only guidance")
    expect(surface.description).toContain("does not execute local commands")
    expect(surface.posture).toEqual([
      expect.objectContaining({ label: "Operating mode", value: "Manual-only" }),
      expect.objectContaining({ label: "Network posture", value: "Localhost-only" }),
      expect.objectContaining({ label: "Persistence", value: "Disabled" }),
      expect.objectContaining({ label: "Autonomy", value: "Disabled" }),
    ])
  })

  it("provides Home-card navigation into the runtime surface", () => {
    const surface = getLocalOperatorSurface()

    expect(surface.homeCard).toEqual({
      label: "Local Operations",
      value: "Manual-ready",
      description: "OMEN local operation is wrapper-supported, localhost-only, and operator-triggered.",
      href: "/runtime",
    })
    expect(surface.safety.executesCommands).toBe(false)
  })

  it("describes expected local runtime containers and ports without querying the host", () => {
    const surface = getLocalOperatorSurface()
    const status = new Map(surface.runtimeStatus.map((item) => [item.label, item.value]))

    expect(status.get("Postgres proof")).toContain("williamos-postgres-proof")
    expect(status.get("Postgres proof")).toContain("127.0.0.1:15432")
    expect(status.get("App proof container")).toBe("williamos-omen-app-proof")
    expect(status.get("App ports")).toContain("3100 preferred")
    expect(status.get("App ports")).toContain("3101 fallback")
  })

  it("does not add command execution, mutation, persistence, LAN exposure, or autonomy", () => {
    const surface = getLocalOperatorSurface()

    expect(surface.safety).toEqual({
      readOnly: true,
      queriesHostRuntime: false,
      executesCommands: false,
      addsShellEndpoint: false,
      mutatesContainers: false,
      registersService: false,
      createsSchedule: false,
      enablesLan: false,
      changesDbSchema: false,
      disclosesSecrets: false,
      touchesTerraFusionPostgres: false,
      enablesAutonomy: false,
    })
  })

  it("shows validated manual wrapper commands as read-only PowerShell references", () => {
    const surface = getLocalOperatorSurface()
    const commands = new Map(surface.commandReference.map((item) => [item.label, item.command]))
    const descriptions = surface.commandReference.map((item) => item.description).join(" ")

    expect(commands.get("Status")).toBe("scripts/local/williamos-omen-status.ps1")
    expect(commands.get("Backup check")).toBe("scripts/local/williamos-omen-backup-check.ps1")
    expect(commands.get("Start")).toBe("scripts/local/williamos-omen-start.ps1")
    expect(commands.get("Stop")).toBe("scripts/local/williamos-omen-stop.ps1")
    expect(commands.get("Help")).toBe("-Help")
    expect(surface.description).toContain("does not execute local commands")
    expect(descriptions).toContain("Reports Postgres proof")
    expect(descriptions).toContain("latest local backup reminder")
    expect(descriptions).toContain("Operator-run PowerShell helper")
    expect(descriptions).toContain("stopping and removing only the app proof container")
    expect(surface.safety.addsShellEndpoint).toBe(false)
    expect(surface.safety.mutatesContainers).toBe(false)
  })

  it("shows backup posture guidance without automation or secret disclosure", () => {
    const surface = getLocalOperatorSurface()
    const backup = new Map(surface.backupGuidance.map((item) => [item.label, item.value]))

    expect(backup.get("Manual backup expectation")).toBe("Before meaningful local work")
    expect(backup.get("Backup location convention")).toContain("williamos-local-runtime")
    expect(backup.get("Latest known backup example")).toBe(
      "williamos-omen-manual-backup-20260703-060207.dump",
    )
    expect(backup.get("Restore drill reminder")).toBe("Backup is trusted after restore proof")
    expect(surface.safety.createsSchedule).toBe(false)
    expect(surface.safety.disclosesSecrets).toBe(false)
  })

  it("states local runtime safety warnings without enabling persistence or LAN exposure", () => {
    const surface = getLocalOperatorSurface()
    const warningText = surface.safetyWarnings.join(" ")

    expect(warningText).toContain("Manual-only mode is intentional")
    expect(warningText).toContain("Do not expose LAN or public access")
    expect(warningText).toContain("Do not bind WilliamOS to 0.0.0.0")
    expect(warningText).toContain("Do not use host port 3000")
    expect(warningText).toContain("Do not enable services")
    expect(warningText).toContain("Do not implement persistence")
    expect(warningText).toContain("Do not disclose or commit local env files")
    expect(warningText).toContain("Do not touch TerraFusion Postgres")
    expect(surface.safety.registersService).toBe(false)
    expect(surface.safety.createsSchedule).toBe(false)
    expect(surface.safety.enablesLan).toBe(false)
    expect(surface.safety.executesCommands).toBe(false)
  })
})
