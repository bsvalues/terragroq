import { describe, expect, it } from "vitest"

import {
  LOCAL_RUNTIME_EVIDENCE_REFERENCES,
  LOCAL_RUNTIME_STATUS_BOUNDARY_COPY,
} from "@/components/local/local-runtime-live-status-surface"

describe("Local runtime live status surface model", () => {
  it("shows static read-only evidence references for the first live status slice", () => {
    expect(LOCAL_RUNTIME_EVIDENCE_REFERENCES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/reports/WO-LOCAL-079-get-only-local-runtime-status-api.md",
        }),
        expect.objectContaining({
          path: "docs/reports/WO-LOCAL-081-runtime-surface-live-status-integration.md",
        }),
        expect.objectContaining({
          path: "docs/reports/WO-LOCAL-107-resume-williamos-proof-image-refresh.md",
        }),
      ]),
    )

    for (const reference of LOCAL_RUNTIME_EVIDENCE_REFERENCES) {
      expect(reference.path).toMatch(/^docs\/reports\//)
      expect(reference.summary).not.toContain("DATABASE_URL")
      expect(reference.summary).not.toContain("BETTER_AUTH_SECRET")
    }
  })

  it("keeps the UI copy scoped to status display rather than local control", () => {
    const copy = Object.values(LOCAL_RUNTIME_STATUS_BOUNDARY_COPY).join(" ")

    expect(copy).toContain("Read-only GET status")
    expect(copy).toContain("Primary Operator")
    expect(copy).toContain("No start, stop, restart, repair")
    expect(copy).toContain("command execution")
    expect(copy).not.toContain("Run wrapper")
    expect(copy).not.toContain("Execute wrapper")
    expect(copy).not.toContain("Start Docker")
    expect(copy).not.toContain("Reset Docker")
  })
})
