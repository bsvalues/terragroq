import { describe, expect, it, vi } from "vitest"

import { ensureCanonicalOwnerProjects } from "@/lib/projects/owner-project-provisioning"

function client(options: { fail?: boolean; existing?: boolean; conflictingPrimaryRepo?: boolean } = {}) {
  const calls: Array<readonly [string, readonly unknown[] | undefined]> = []
  const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
    calls.push([text, values])
    if (options.fail && text.startsWith('insert into "project"')) throw new Error("database unavailable")
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rowCount: null, rows: [] }
    if (text.startsWith('select 1 from "user"')) return { rowCount: 1, rows: [{ '?column?': 1 }] }
    if (text.startsWith('insert into "project"')) {
      if (options.existing) return { rowCount: 0, rows: [] }
      return { rowCount: 1, rows: [{ id: values?.[1] === "williamos" ? 1 : 2 }] }
    }
    if (text.startsWith('select "id" from "project"')) {
      return { rowCount: 1, rows: [{ id: values?.[1] === "williamos" ? 1 : 2 }] }
    }
    if (text.startsWith('insert into "project_resource"')) return { rowCount: 1, rows: [] }
    if (text.startsWith('select "canonicalIdentity" from "project_resource"')) {
      if (options.conflictingPrimaryRepo) {
        return { rowCount: 2, rows: [
          { canonicalIdentity: "bsvalues/other" },
          { canonicalIdentity: "bsvalues/terragroq" },
        ] }
      }
      return { rowCount: 1, rows: [{ canonicalIdentity: values?.[1] === 1
        ? "bsvalues/terragroq"
        : "bsvalues/terrafusion_os_1.0" }] }
    }
    throw new Error(`unexpected query: ${text}`)
  })
  return { calls, query, release: vi.fn() }
}

describe("canonical owner Project provisioning", () => {
  it("creates the exact two server-owned Project bindings in one transaction", async () => {
    const database = client()
    await expect(ensureCanonicalOwnerProjects("owner", {
      connect: async () => database,
    })).resolves.toEqual({ status: "APPLIED", projects: 2, resources: 2 })

    expect(database.calls.map(([text]) => text)).toEqual([
      "BEGIN",
      'select 1 from "user" where "id" = $1',
      expect.stringContaining('insert into "project"'),
      expect.stringContaining('insert into "project"'),
      expect.stringContaining('insert into "project_resource"'),
      expect.stringContaining('select "canonicalIdentity" from "project_resource"'),
      expect.stringContaining('insert into "project_resource"'),
      expect.stringContaining('select "canonicalIdentity" from "project_resource"'),
      "COMMIT",
    ])
    const inserts = database.calls.filter(([text]) => text.startsWith('insert into "project_resource"'))
    expect(inserts.map(([, values]) => values)).toEqual([
      ["owner", 1, "repo", "bsvalues/terragroq", "WilliamOS repo", "primary-repo"],
      ["owner", 2, "repo", "bsvalues/terrafusion_os_1.0", "TerraFusion OS repo", "primary-repo"],
    ])
    expect(database.release).toHaveBeenCalledOnce()
  })

  it("reuses existing canonical Projects without widening or duplicating them", async () => {
    const database = client({ existing: true })
    await expect(ensureCanonicalOwnerProjects("owner", {
      connect: async () => database,
    })).resolves.toEqual({ status: "APPLIED", projects: 2, resources: 2 })

    expect(database.calls.filter(([text]) => text.startsWith('select "id" from "project"')))
      .toHaveLength(2)
    expect(database.calls.filter(([text]) => text.startsWith('insert into "project_resource"')))
      .toHaveLength(2)
    expect(database.release).toHaveBeenCalledOnce()
  })

  it("verifies only the canonical primary repo, so unrelated Project resources remain valid", async () => {
    const database = client()
    await expect(ensureCanonicalOwnerProjects("owner", {
      connect: async () => database,
    })).resolves.toEqual({ status: "APPLIED", projects: 2, resources: 2 })

    const verifications = database.calls.filter(([text]) =>
      text.startsWith('select "canonicalIdentity" from "project_resource"'))
    expect(verifications).toHaveLength(2)
    expect(verifications.every(([text]) =>
      text.includes('"type" = $3') && text.includes('"relationship" = $4'))).toBe(true)
  })

  it("fails closed rather than choosing among conflicting primary repositories", async () => {
    const database = client({ conflictingPrimaryRepo: true })
    await expect(ensureCanonicalOwnerProjects("owner", {
      connect: async () => database,
    })).rejects.toThrow("PROJECT_BACKFILL_PRIMARY_REPO_CONFLICT:williamos")

    expect(database.calls.map(([text]) => text)).toContain("ROLLBACK")
    expect(database.calls.map(([text]) => text)).not.toContain("COMMIT")
    expect(database.release).toHaveBeenCalledOnce()
  })

  it("rolls back the transaction and releases the client on failure", async () => {
    const database = client({ fail: true })
    await expect(ensureCanonicalOwnerProjects("owner", {
      connect: async () => database,
    })).rejects.toThrow("database unavailable")

    expect(database.calls.map(([text]) => text)).toContain("ROLLBACK")
    expect(database.calls.map(([text]) => text)).not.toContain("COMMIT")
    expect(database.release).toHaveBeenCalledOnce()
  })
})
