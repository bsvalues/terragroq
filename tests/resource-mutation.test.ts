import { describe, expect, it } from "vitest"

import { planRelocation, relocationCommand } from "../lib/resource/mutation"
import type { ResourceRecord } from "../lib/resource/resolve"

const record = (over: Partial<ResourceRecord> = {}): ResourceRecord => ({
  identity: "PACS",
  project: { key: "terrafusion", name: "TerraFusion" },
  workloadOwner: { identity: "aegis", label: "AEGIS" },
  sources: [
    {
      identity: "atlas:/forge/sources/pacs/pacs_oltp_backup_2026_01_15_170502_7994110.bak",
      label: "PACS OLTP backup, 102,359,101,440 bytes",
      type: "data_source",
    },
  ],
  runtime: [],
  derivatives: [{ identity: "omen:terrafusion_benton_demo", label: "capture", type: "database" }],
  completionEvidence: [{ identity: "atlas:/forge/mssql/data", label: "738 GB restore" }],
  allowedOperations: ["read", "verify", "restore"],
  ratified: true,
  ...over,
})

describe("planning a relocation from the record", () => {
  it("moves declared sources to the declared owner", () => {
    const verdict = planRelocation(record())
    expect(verdict.ok).toBe(true)
    expect(verdict.plans).toHaveLength(1)
    expect(verdict.plans[0]).toMatchObject({
      sourceNode: "atlas",
      destinationNode: "aegis",
      destinationPath: "/backup-primary/pacs/pacs_oltp_backup_2026_01_15_170502_7994110.bak",
      recordedBytes: 102359101440,
    })
  })

  it("does not relocate completion evidence or derivatives", () => {
    // Copying evidence would fabricate history in a new place; a derivative belongs to its own resource.
    const verdict = planRelocation(record())
    const identities = verdict.plans.map((plan) => plan.identity)
    expect(identities).not.toContain("atlas:/forge/mssql/data")
    expect(identities).not.toContain("omen:terrafusion_benton_demo")
  })

  it("refuses when the record declares no owner, rather than choosing one", () => {
    expect(planRelocation(record({ workloadOwner: null })).refusal).toBe("NO_DECLARED_OWNER")
  })

  it("says nothing to do when the sources already sit on the owner", () => {
    const verdict = planRelocation(
      record({ sources: [{ identity: "aegis:/backup-primary/pacs/x.bak", label: "x", type: "data_source" }] }),
    )
    expect(verdict.refusal).toBe("ALREADY_ON_OWNER")
  })

  it("refuses a path that could influence a shell instead of escaping it", () => {
    const verdict = planRelocation(
      record({ sources: [{ identity: "atlas:/forge/$(id)", label: "hostile", type: "data_source" }] }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.refusal).toBe("PATH_REFUSED")
  })
})

describe("the relocation command", () => {
  const plan = {
    identity: "atlas:/forge/sources/pacs/pacs_oltp.bak",
    sourceNode: "atlas",
    sourcePath: "/forge/sources/pacs/pacs_oltp.bak",
    destinationNode: "aegis",
    destinationPath: "/backup-primary/pacs/pacs_oltp.bak",
    recordedBytes: null,
  }

  it("copies and never deletes", () => {
    const command = relocationCommand(plan)
    expect(command).toContain("rsync -a")
    // A relocation that removed the origin would make a failed transfer unrecoverable, and removing the
    // origin is a decision nobody has made.
    expect(command).not.toContain("--delete")
    expect(command).not.toMatch(/\brm\b/)
    expect(command).not.toMatch(/\bmv\b/)
  })

  it("resumes rather than restarting, and verifies what was already there", () => {
    const command = relocationCommand(plan)
    expect(command).toContain("--partial")
    expect(command).toContain("--append-verify")
  })

  it("pulls from the source, so only the destination holds a credential", () => {
    expect(relocationCommand(plan)).toContain("'atlas:/forge/sources/pacs/pacs_oltp.bak'")
  })

  it("throws rather than emitting a command for a refused path", () => {
    expect(() => relocationCommand({ ...plan, sourcePath: "/forge/`id`" })).toThrowError(/RELOCATION_PATH_REFUSED/)
    expect(() => relocationCommand({ ...plan, destinationNode: "aegis; rm -rf /" })).toThrowError(
      /RELOCATION_NODE_REFUSED/,
    )
  })
})
