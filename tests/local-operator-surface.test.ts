import { describe, expect, it } from "vitest"
import { getLocalOperatorSurface } from "@/components/local/local-operator-surface"

describe("Local operator surface", () => {
  it("shows the OMEN Phase 1 manual runtime posture", () => {
    const surface = getLocalOperatorSurface()

    expect(surface.title).toBe("Local Operations")
    expect(surface.phaseHost).toBe("HP OMEN Gaming Laptop 16-ap0xxx")
    expect(surface.posture).toEqual([
      expect.objectContaining({ label: "Operating mode", value: "Manual-only" }),
      expect.objectContaining({ label: "Network posture", value: "Localhost-only" }),
      expect.objectContaining({ label: "Persistence", value: "Disabled" }),
      expect.objectContaining({ label: "Autonomy", value: "Disabled" }),
    ])
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

    expect(commands.get("Status")).toBe("scripts/local/williamos-omen-status.ps1")
    expect(commands.get("Backup check")).toBe("scripts/local/williamos-omen-backup-check.ps1")
    expect(commands.get("Start")).toBe("scripts/local/williamos-omen-start.ps1")
    expect(commands.get("Stop")).toBe("scripts/local/williamos-omen-stop.ps1")
    expect(commands.get("Help")).toBe("-Help")
    expect(surface.description).toContain("does not execute local commands")
  })
})
