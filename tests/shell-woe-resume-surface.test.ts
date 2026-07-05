import { describe, expect, it } from "vitest"

import {
  LOCAL_OMEN_PHASE_ROLLUP,
  SHELL_WOE_AUTHORITY_BLOCKERS,
  SHELL_WOE_FORBIDDEN_LANGUAGE,
  SHELL_WOE_NEXT_BATCH,
  SHELL_WOE_SAFETY,
} from "@/components/shell/shell-woe-resume-surface"

describe("Shell / WOE resume surface", () => {
  it("carries the completed Local OMEN phase as a read-only subsystem", () => {
    expect(LOCAL_OMEN_PHASE_ROLLUP.value).toBe("Stable")
    expect(LOCAL_OMEN_PHASE_ROLLUP.originMain).toBe(
      "fe9fb98edeb393949cab8e59337eab8550c6950d",
    )
    expect(LOCAL_OMEN_PHASE_ROLLUP.description).toContain("route status")
    expect(LOCAL_OMEN_PHASE_ROLLUP.description).toContain("host-loopback checks")
    expect(LOCAL_OMEN_PHASE_ROLLUP.description).toContain("operator-run wrappers")
    expect(LOCAL_OMEN_PHASE_ROLLUP.safety).toContain("Read-only governed subsystem")
    expect(LOCAL_OMEN_PHASE_ROLLUP.safety).toContain("PowerShell wrappers remain operator-run")
    expect(LOCAL_OMEN_PHASE_ROLLUP.safety).toContain("No command execution")
  })

  it("keeps the next batch recommendation read-only", () => {
    expect(SHELL_WOE_NEXT_BATCH.label).toBe("WILLIAMOS-SHELL-WOE-RESUME-BATCH-001")
    expect(SHELL_WOE_NEXT_BATCH.recommendedAfterThisBatch).toBe(
      "WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001",
    )
  })

  it("lists authority blockers for metadata, runtime control, execution, and external mutation", () => {
    expect(SHELL_WOE_AUTHORITY_BLOCKERS.map((item) => item.label)).toEqual([
      "Local runtime control",
      "Metadata expansion",
      "Execution authority",
      "External mutation",
    ])
  })

  it("does not use generic SaaS/productivity positioning", () => {
    const text = [
      LOCAL_OMEN_PHASE_ROLLUP.description,
      LOCAL_OMEN_PHASE_ROLLUP.safety,
      SHELL_WOE_NEXT_BATCH.description,
      ...SHELL_WOE_AUTHORITY_BLOCKERS.map((item) => item.description),
    ].join(" ")

    for (const forbidden of SHELL_WOE_FORBIDDEN_LANGUAGE) {
      expect(text).not.toContain(forbidden)
    }
  })

  it("does not authorize command execution, metadata expansion, persistence, LAN, secrets, or unrelated touches", () => {
    expect(SHELL_WOE_SAFETY).toEqual({
      readOnly: true,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      persistenceImplemented: false,
      serviceRegistered: false,
      scheduleCreated: false,
      lanExposureEnabled: false,
      secretsDisclosed: false,
      terraFusionPacsTouched: false,
      unrelatedContainersTouched: false,
    })
  })
})
