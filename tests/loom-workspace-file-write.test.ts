import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { writeGovernedWorkspaceFile } from "@/lib/loom/workspace-file-write"
import { resolveRealWorkspacePath } from "@/lib/loom/workspace"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-write-"))
  roots.push(root)
  const file = path.join(root, "src", "real.ts")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, "export const before = true\n", "utf8")
  return { root, file }
}

describe("governed manual workspace writes", () => {
  it("does not mutate bytes when write authority is absent", async () => {
    const { root, file } = await fixture()
    const audit: string[] = []
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "changed\n",
    }, {
      authorize: async () => ({ ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "missing" }),
      resolve: (requested) => resolveRealWorkspacePath(root, requested, fs.realpath),
      auditStart: async () => { audit.push("start"); return 1 },
      auditFinish: async () => { audit.push("finish") },
    })

    expect(result).toMatchObject({ ok: false, error: "FAILED_CONTEXT_NOT_PROVEN", status: 409 })
    expect(await fs.readFile(file, "utf8")).toBe("export const before = true\n")
    expect(audit).toEqual([])
  })

  it("fails closed before mutation when the durable audit cannot start", async () => {
    const { root, file } = await fixture()
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "changed\n",
    }, {
      authorize: async () => ({ ok: true, facts: {} as never }),
      resolve: (requested) => resolveRealWorkspacePath(root, requested, fs.realpath),
      auditStart: async () => { throw new Error("ledger unavailable") },
      auditFinish: async () => undefined,
    })

    expect(result).toEqual({ ok: false, error: "AUDIT_UNAVAILABLE", status: 503 })
    expect(await fs.readFile(file, "utf8")).toBe("export const before = true\n")
  })

  it.each([".env", ".git/config", "app/migrations/001.sql"])("refuses %s outside the fixed workroom file envelope", async (requested) => {
    const { root, file } = await fixture()
    const target = path.join(root, ...requested.split("/"))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, "secret before\n", "utf8")
    const audit: string[] = []
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: requested, content: "changed\n",
    }, {
      authorize: async () => ({ ok: true, facts: {} as never }),
      resolve: (value) => resolveRealWorkspacePath(root, value, fs.realpath),
      auditStart: async () => { audit.push("start"); return 1 },
      auditFinish: async () => { audit.push("finish") },
    })

    expect(result).toMatchObject({ ok: false, error: "FAILED_SCOPE_COLLISION", status: 409 })
    expect(await fs.readFile(target, "utf8")).toBe("secret before\n")
    expect(await fs.readFile(file, "utf8")).toBe("export const before = true\n")
    expect(audit).toEqual([])
  })

  it("brackets a real byte write with durable start and completion audit records", async () => {
    const { root, file } = await fixture()
    const audit: string[] = []
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "export const after = true\n",
    }, {
      authorize: async () => ({ ok: true, facts: {} as never }),
      resolve: (requested) => resolveRealWorkspacePath(root, requested, fs.realpath),
      auditStart: async ({ path: relative }) => {
        audit.push(`start:${relative}:${await fs.readFile(file, "utf8")}`)
        return 41
      },
      auditFinish: async ({ startedAuditId, path: relative }) => {
        audit.push(`finish:${startedAuditId}:${relative}:${await fs.readFile(file, "utf8")}`)
      },
    })

    expect(result).toMatchObject({ ok: true, path: "src/real.ts", name: "real.ts" })
    expect(await fs.readFile(file, "utf8")).toBe("export const after = true\n")
    expect(audit).toEqual([
      "start:src/real.ts:export const before = true\n",
      "finish:41:src/real.ts:export const after = true\n",
    ])
  })

  it("restores the original bytes when the completion audit cannot become durable", async () => {
    const { root, file } = await fixture()
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "changed without completion\n",
    }, {
      authorize: async () => ({ ok: true, facts: {} as never }),
      resolve: (requested) => resolveRealWorkspacePath(root, requested, fs.realpath),
      auditStart: async () => 77,
      auditFinish: async () => { throw new Error("ledger unavailable") },
    })

    expect(result).toEqual({ ok: false, error: "AUDIT_UNAVAILABLE", status: 503 })
    expect(await fs.readFile(file, "utf8")).toBe("export const before = true\n")
  })

  it("durably terminates an audit-started attempt when the filesystem write fails", async () => {
    const { root, file } = await fixture()
    const outcomes: string[] = []
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "changed\n",
    }, {
      authorize: async () => ({ ok: true, facts: {} as never }),
      resolve: (requested) => resolveRealWorkspacePath(root, requested, fs.realpath),
      auditStart: async () => 88,
      auditFinish: async ({ outcome }) => { outcomes.push(outcome) },
      writeFile: async () => { throw new Error("disk refused") },
    })

    expect(result).toEqual({ ok: false, error: "WRITE_FAILED", status: 500 })
    expect(outcomes).toEqual(["WRITE_FAILED"])
    expect(await fs.readFile(file, "utf8")).toBe("export const before = true\n")
  })

  it("returns typed audit unavailability when a failed write cannot record its terminal audit", async () => {
    const { root } = await fixture()
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "changed\n",
    }, {
      authorize: async () => ({ ok: true, facts: {} as never }),
      resolve: (requested) => resolveRealWorkspacePath(root, requested, fs.realpath),
      auditStart: async () => 89,
      auditFinish: async () => { throw new Error("ledger refused") },
      writeFile: async () => { throw new Error("disk refused") },
    })

    expect(result).toEqual({ ok: false, error: "AUDIT_UNAVAILABLE", status: 503 })
  })
})
