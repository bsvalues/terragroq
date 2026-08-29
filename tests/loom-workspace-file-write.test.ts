import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { workspaceFileWriteDependencies, writeGovernedWorkspaceFile } from "@/lib/loom/workspace-file-write"
import { resolveRealWorkspacePath } from "@/lib/loom/workspace"
import { acknowledgeSavedBuffer } from "@/components/workspace-shell/editor-surface"
import * as manualOwnerSave from "@/lib/loom/manual-owner-file-save"

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

  it("refuses a hard-linked target before audit or mutation", async () => {
    const { root, file } = await fixture()
    const alias = path.join(root, "src", "alias.ts")
    await fs.link(file, alias)
    const audit: string[] = []

    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "changed\n",
    }, {
      authorize: async () => ({ ok: true }),
      resolve: (requested) => resolveRealWorkspacePath(root, requested, fs.realpath),
      auditStart: async () => { audit.push("start"); return 1 },
      auditFinish: async () => { audit.push("finish") },
    })

    expect(result).toEqual({ ok: false, error: "LINK_NOT_ALLOWED", status: 409 })
    expect(await fs.readFile(file, "utf8")).toBe("export const before = true\n")
    expect(await fs.readFile(alias, "utf8")).toBe("export const before = true\n")
    expect(audit).toEqual([])
  })

  it.each([
    ".env",
    ".env.local",
    ".envrc",
    ".environment",
    ".envbackup",
    "nested/.envelope",
    ".git/config",
    "app/migrations/001.sql",
  ])("refuses %s outside the fixed workroom file envelope", async (requested) => {
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

  it("reauthorizes the canonical target after resolving an alias", async () => {
    const { root, file } = await fixture()
    const authorized: string[] = []
    const audit: string[] = []
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "alias.ts", content: "changed\n",
    }, {
      authorize: async (requested) => {
        authorized.push(requested)
        return requested === "alias.ts"
          ? ({ ok: true, facts: {} as never })
          : ({ ok: false, failure: "FAILED_SCOPE_COLLISION", detail: "canonical path is not reserved" })
      },
      resolve: async () => ({ ok: true, absolute: file, relative: "src/real.ts" }),
      auditStart: async () => { audit.push("start"); return 1 },
      auditFinish: async () => { audit.push("finish") },
    })

    expect(result).toMatchObject({ ok: false, error: "FAILED_SCOPE_COLLISION", status: 409 })
    expect(authorized).toEqual(["alias.ts", "src/real.ts"])
    expect(audit).toEqual([])
    expect(await fs.readFile(file, "utf8")).toBe("export const before = true\n")
  })

  it("permits an alias only when the canonical target is also reserved", async () => {
    const { root, file } = await fixture()
    const authorized: string[] = []
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "alias.ts", content: "canonical write\n",
    }, {
      authorize: async (requested) => {
        authorized.push(requested)
        return { ok: true, facts: {} as never }
      },
      resolve: async () => ({ ok: true, absolute: file, relative: "src/real.ts" }),
      auditStart: async () => 2,
      auditFinish: async () => undefined,
    })

    expect(result).toMatchObject({ ok: true, path: "src/real.ts" })
    expect(authorized).toEqual(["alias.ts", "src/real.ts"])
    expect(await fs.readFile(file, "utf8")).toBe("canonical write\n")
  })

  it("does not mistake a normal environment source file for the .env prefix", async () => {
    const { root } = await fixture()
    const target = path.join(root, "src", "environment.ts")
    await fs.writeFile(target, "before\n", "utf8")
    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/environment.ts", content: "after\n",
    }, {
      authorize: async () => ({ ok: true, facts: {} as never }),
      resolve: (requested) => resolveRealWorkspacePath(root, requested, fs.realpath),
      auditStart: async () => 3,
      auditFinish: async () => undefined,
    })

    expect(result).toMatchObject({ ok: true, path: "src/environment.ts" })
    expect(await fs.readFile(target, "utf8")).toBe("after\n")
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

  it("holds path serialization through authority, completion audit, and receipt-failure rollback", async () => {
    const { root, file } = await fixture()
    let insideSerializer = false
    const phases: string[] = []
    const dependencies = {
      authorize: async () => {
        phases.push(`authorize:${insideSerializer}`)
        return { ok: true, facts: {} as never }
      },
      resolve: (requested: unknown) => resolveRealWorkspacePath(root, requested, fs.realpath),
      auditStart: async () => {
        phases.push(`audit-start:${insideSerializer}`)
        return 78
      },
      auditFinish: async () => {
        phases.push(`audit-finish:${insideSerializer}`)
        throw new Error("receipt transaction failed")
      },
      serialize: async <T>(_requested: unknown, work: (lockedAbsolute: string) => Promise<T>) => {
        insideSerializer = true
        phases.push("lock-enter")
        try {
          return await work(file)
        } finally {
          phases.push(`lock-exit:${await fs.readFile(file, "utf8")}`)
          insideSerializer = false
        }
      },
    }

    const result = await writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "changed without receipt\n",
    }, dependencies)

    expect(result).toEqual({ ok: false, error: "AUDIT_UNAVAILABLE", status: 503 })
    expect(phases).toEqual([
      "lock-enter",
      "authorize:true",
      "audit-start:true",
      "audit-finish:true",
      "lock-exit:export const before = true\n",
    ])
  })

  it("serializes concurrent governed promotions before their stale-file check", async () => {
    const { root, file } = await fixture()
    const lock = (manualOwnerSave as Record<string, unknown>).withPathWriteSerialization
    expect(typeof lock).toBe("function")
    if (typeof lock !== "function") return

    let blockerEntered!: () => void
    let releaseBlocker!: () => void
    const entered = new Promise<void>((resolve) => { blockerEntered = resolve })
    const held = new Promise<void>((resolve) => { releaseBlocker = resolve })
    const blocker = (lock as <T>(absolutePath: string, work: () => Promise<T>) => Promise<T>)(file, async () => {
      blockerEntered()
      await held
    })
    await entered

    const openedAt = (await fs.stat(file)).mtime.toISOString()
    const firstDependencies = {
      ...workspaceFileWriteDependencies(root),
      authorize: async () => ({ ok: true, facts: {} as never }),
      auditStart: async () => 801,
      auditFinish: async () => undefined,
      writeFile: async (absolute: fs.PathLike, content: string) => {
        await fs.writeFile(absolute, content, "utf8")
        const definitelyNewer = new Date("2035-01-01T00:00:00.000Z")
        await fs.utimes(absolute, definitelyNewer, definitelyNewer)
      },
    }
    const secondDependencies = {
      ...workspaceFileWriteDependencies(root),
      authorize: async () => ({ ok: true, facts: {} as never }),
      auditStart: async () => 802,
      auditFinish: async () => undefined,
    }
    const first = writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "first promotion\n", modifiedAt: openedAt,
    }, firstDependencies)
    const second = writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "second promotion\n", modifiedAt: openedAt,
    }, secondDependencies)

    releaseBlocker()
    await blocker
    const [firstResult, secondResult] = await Promise.all([first, second])
    const results = [firstResult, secondResult]
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ error: "CHANGED_ON_DISK", status: 409 }),
    ])
    expect(await fs.readFile(file, "utf8")).toBe(firstResult.ok ? "first promotion\n" : "second promotion\n")
  })

  it("does not let a failed promotion rollback overwrite a later owner save", async () => {
    const { root, file } = await fixture()
    const lock = (manualOwnerSave as Record<string, unknown>).withPathWriteSerialization
    expect(typeof lock).toBe("function")
    if (typeof lock !== "function") return

    let blockerEntered!: () => void
    let releaseBlocker!: () => void
    const entered = new Promise<void>((resolve) => { blockerEntered = resolve })
    const held = new Promise<void>((resolve) => { releaseBlocker = resolve })
    const blocker = (lock as <T>(absolutePath: string, work: () => Promise<T>) => Promise<T>)(file, async () => {
      blockerEntered()
      await held
    })
    await entered

    const promotion = writeGovernedWorkspaceFile({
      userId: "owner-a", path: "src/real.ts", content: "uncommitted promotion\n",
    }, {
      ...workspaceFileWriteDependencies(root),
      authorize: async () => ({ ok: true, facts: {} as never }),
      auditStart: async () => 803,
      auditFinish: async () => { throw new Error("receipt transaction failed") },
    })
    const ownerSave = manualOwnerSave.writeManualOwnerWorkspaceFile({
      path: "src/real.ts", content: "owner committed save\n",
    }, root)

    releaseBlocker()
    await blocker
    const [promotionResult, ownerResult] = await Promise.all([promotion, ownerSave])
    expect(promotionResult).toEqual({ ok: false, error: "AUDIT_UNAVAILABLE", status: 503 })
    expect(ownerResult).toMatchObject({ ok: true, path: "src/real.ts" })
    expect(await fs.readFile(file, "utf8")).toBe("owner committed save\n")
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

describe("authenticated owner workspace writes", () => {
  it("writes an existing real workspace file without a governance receipt", async () => {
    const { root, file } = await fixture()
    const before = await fs.stat(file)
    const save = (manualOwnerSave as Record<string, unknown>).writeManualOwnerWorkspaceFile

    expect(typeof save).toBe("function")
    const result = await (save as (input: unknown, projectRoot: string) => Promise<unknown>)({
      path: "src/real.ts",
      content: "export const after = true\n",
      modifiedAt: before.mtime.toISOString(),
    }, root)

    expect(result).toMatchObject({ ok: true, path: "src/real.ts", name: "real.ts" })
    expect(await fs.readFile(file, "utf8")).toBe("export const after = true\n")
  })

  it("refuses sensitive files before changing their bytes", async () => {
    const { root } = await fixture()
    const target = path.join(root, ".env.local")
    await fs.writeFile(target, "SECRET=before\n", "utf8")

    const result = await manualOwnerSave.writeManualOwnerWorkspaceFile({
      path: ".env.local",
      content: "SECRET=after\n",
    }, root)

    expect(result).toMatchObject({ ok: false, error: "SENSITIVE_PATH", status: 403 })
    expect(await fs.readFile(target, "utf8")).toBe("SECRET=before\n")
  })

  it("refuses a stale buffer before overwriting a file changed on disk", async () => {
    const { root, file } = await fixture()
    const openedAt = (await fs.stat(file)).mtime.toISOString()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await fs.writeFile(file, "external change\n", "utf8")

    const result = await manualOwnerSave.writeManualOwnerWorkspaceFile({
      path: "src/real.ts",
      content: "owner edit\n",
      modifiedAt: openedAt,
    }, root)

    expect(result).toMatchObject({ ok: false, error: "CHANGED_ON_DISK", status: 409 })
    expect(await fs.readFile(file, "utf8")).toBe("external change\n")
  })

  it("does not follow a target replacement after the admitted file handle is open", async () => {
    const { root, file } = await fixture()
    const openedAt = (await fs.stat(file)).mtime.toISOString()
    const displaced = `${file}.displaced`

    const result = await manualOwnerSave.writeManualOwnerWorkspaceFile({
      path: "src/real.ts",
      content: "owner edit\n",
      modifiedAt: openedAt,
    }, root, {
      beforeWrite: async () => {
        await fs.rename(file, displaced)
        await fs.writeFile(file, "external replacement\n", "utf8")
      },
    })

    expect(result).toMatchObject({ ok: false, error: "CHANGED_ON_DISK", status: 409 })
    expect(await fs.readFile(file, "utf8")).toBe("external replacement\n")
    expect(await fs.readFile(displaced, "utf8")).toBe("export const before = true\n")
  })

  it("serializes concurrent manual saves to the same workspace path", async () => {
    const { root, file } = await fixture()
    const events: string[] = []
    let enterFirst!: () => void
    let releaseFirst!: () => void
    const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve })
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve })

    const first = manualOwnerSave.writeManualOwnerWorkspaceFile({
      path: "src/real.ts", content: "first save\n",
    }, root, { beforeWrite: async () => {
      events.push("first")
      enterFirst()
      await firstReleased
    } })
    await firstEntered
    const second = manualOwnerSave.writeManualOwnerWorkspaceFile({
      path: "src/real.ts", content: "second save\n",
    }, root, { beforeWrite: async () => { events.push("second") } })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events).toEqual(["first"])
    releaseFirst()
    expect((await Promise.all([first, second])).every((result) => result.ok)).toBe(true)
    expect(events).toEqual(["first", "second"])
    expect(await fs.readFile(file, "utf8")).toBe("second save\n")
  })

  it("refuses an oversized edit before changing the file", async () => {
    const { root, file } = await fixture()

    const result = await manualOwnerSave.writeManualOwnerWorkspaceFile({
      path: "src/real.ts",
      content: "x".repeat(2_000_001),
    }, root)

    expect(result).toEqual({ ok: false, error: "FILE_TOO_LARGE", status: 413 })
    expect(await fs.readFile(file, "utf8")).toBe("export const before = true\n")
  })

  it("refuses an oversized existing file before loading rollback bytes", async () => {
    const { root, file } = await fixture()
    await fs.writeFile(file, Buffer.alloc(2_000_001, 0x78))

    const result = await manualOwnerSave.writeManualOwnerWorkspaceFile({
      path: "src/real.ts",
      content: "small replacement\n",
    }, root)

    expect(result).toEqual({ ok: false, error: "FILE_TOO_LARGE", status: 413 })
    expect((await fs.stat(file)).size).toBe(2_000_001)
  })
})

describe("workspace editor save acknowledgement", () => {
  it("marks only the submitted bytes saved when the owner types during an in-flight save", () => {
    const current = {
      path: "src/real.ts",
      content: "edit typed after request started\n",
      savedContent: "disk before\n",
      modifiedAt: "2026-08-25T10:00:00.000Z",
      saving: true,
      error: null,
    }

    const acknowledged = acknowledgeSavedBuffer(
      current,
      "content actually submitted\n",
      "2026-08-25T10:01:00.000Z",
    )

    expect(acknowledged.content).toBe("edit typed after request started\n")
    expect(acknowledged.savedContent).toBe("content actually submitted\n")
    expect(acknowledged.content).not.toBe(acknowledged.savedContent)
    expect(acknowledged.saving).toBe(false)
  })
})
