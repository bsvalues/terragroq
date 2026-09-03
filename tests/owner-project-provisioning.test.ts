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
    if (text.startsWith('select "canonicalIdentity","resourceKey" from "project_resource"')) {
      if (options.conflictingPrimaryRepo && values?.[1] === 1 && values?.[3] === "primary-repo") {
        return { rowCount: 2, rows: [
          { canonicalIdentity: "bsvalues/other", resourceKey: "other" },
          { canonicalIdentity: "bsvalues/terragroq", resourceKey: "williamos" },
        ] }
      }
      if (values?.length === 4) {
        return { rowCount: 1, rows: [{
          canonicalIdentity: values?.[1] === 1 ? "bsvalues/terragroq" : "bsvalues/terrafusion_os_1.0",
          resourceKey: values?.[1] === 1 ? "williamos" : "os-1",
        }] }
      }
      return { rowCount: 1, rows: [{ canonicalIdentity: values?.[3], resourceKey: values?.[5] }] }
    }
    throw new Error(`unexpected query: ${text}`)
  })
  return { calls, query, release: vi.fn() }
}

describe("canonical owner Project provisioning", () => {
  it("creates the two Projects and the exact role-qualified Core Seven resources in one transaction", async () => {
    const database = client()
    await expect(ensureCanonicalOwnerProjects("owner", {
      connect: async () => database,
    })).resolves.toEqual({ status: "APPLIED", projects: 2, resources: 8 })

    expect(database.calls[0]?.[0]).toBe("BEGIN")
    expect(database.calls.at(-1)?.[0]).toBe("COMMIT")
    const inserts = database.calls.filter(([text]) => text.startsWith('insert into "project_resource"'))
    expect(inserts.map(([, values]) => values)).toEqual([
      ["owner", 1, "repo", "bsvalues/terragroq", "WilliamOS repo", "primary-repo", "williamos"],
      ["owner", 2, "repo", "bsvalues/terrafusion_os_1.0", "OS 1.0", "primary-repo", "os-1"],
      ["owner", 2, "repo", "bsvalues/terrafusion-os", "Sovereign OS", "sovereign-planning-and-promotion", "sovereign-os"],
      ["owner", 2, "repo", "bsvalues/terrafusion-forge", "Forge", "suite-source", "forge"],
      ["owner", 2, "repo", "bsvalues/terrafusion-atlas", "Atlas", "suite-source", "atlas"],
      ["owner", 2, "repo", "bsvalues/terrafusion-dais", "Dais", "suite-source", "dais"],
      ["owner", 2, "repo", "bsvalues/terrafusion-dossier", "Dossier", "suite-source", "dossier"],
      ["owner", 2, "repo", "bsvalues/terrafusion-gpt", "GPT", "suite-source", "gpt"],
    ])
    expect(database.release).toHaveBeenCalledOnce()
  })

  it("reuses existing canonical Projects without widening or duplicating them", async () => {
    const database = client({ existing: true })
    await expect(ensureCanonicalOwnerProjects("owner", {
      connect: async () => database,
    })).resolves.toEqual({ status: "APPLIED", projects: 2, resources: 8 })

    expect(database.calls.filter(([text]) => text.startsWith('select "id" from "project"')))
      .toHaveLength(2)
    expect(database.calls.filter(([text]) => text.startsWith('insert into "project_resource"')))
      .toHaveLength(8)
    expect(database.release).toHaveBeenCalledOnce()
  })

  it("verifies each exact canonical resource rather than treating suite role cardinality as a conflict", async () => {
    const database = client()
    await expect(ensureCanonicalOwnerProjects("owner", {
      connect: async () => database,
    })).resolves.toEqual({ status: "APPLIED", projects: 2, resources: 8 })

    const verifications = database.calls.filter(([text]) =>
      text.startsWith('select "canonicalIdentity","resourceKey" from "project_resource"'))
    expect(verifications).toHaveLength(8)
    expect(verifications.filter(([text]) => text.includes('"relationship" = $4'))).toHaveLength(2)
    expect(verifications.filter(([text]) =>
      text.includes('"canonicalIdentity" = $4') && text.includes('"relationship" = $5'))).toHaveLength(6)
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
