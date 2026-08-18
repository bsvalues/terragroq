import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  RegistryConflict,
  RegistryFieldLoss,
  readNodes,
  updateNodeFields,
} from "@/lib/fabric/registry.mjs"

async function registry(content: Record<string, unknown>) {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-registry-"))
  await writeFile(path.join(root, "nodes.json"), JSON.stringify(content, null, 2), "utf8")
  return root
}

// The shape that actually got destroyed: another lane had corrected the username and added a note.
const OMEN = { transport: "ssh", host: "Omen", user: "bsval", os: "windows", note: "corrected by the OMEN lane" }

describe("registry writes preserve what they did not touch", () => {
  it("keeps fields the caller never mentioned", async () => {
    const root = await registry({ omen: OMEN })
    await updateNodeFields("omen", { workloads: "processes" }, { fabricRoot: root })
    const { nodes } = await readNodes(root)
    // The username is the field I destroyed twice; it survives an unrelated edit now.
    expect(nodes.omen.user).toBe("bsval")
    expect(nodes.omen.note).toBe("corrected by the OMEN lane")
    expect(nodes.omen.workloads).toBe("processes")
  })

  it("leaves other nodes untouched", async () => {
    const root = await registry({ omen: OMEN, atlas: { host: "192.168.88.5", user: "bs" } })
    await updateNodeFields("omen", { host: "Omen.local" }, { fabricRoot: root })
    const { nodes } = await readNodes(root)
    expect(nodes.atlas).toEqual({ host: "192.168.88.5", user: "bs" })
  })

  it("refuses a write that would drop a field nobody asked to drop", async () => {
    const root = await registry({ omen: OMEN })
    // Passing undefined is how a rewrite quietly erases a value.
    await expect(updateNodeFields("omen", { user: undefined }, { fabricRoot: root }))
      .rejects.toBeInstanceOf(RegistryFieldLoss)
  })

  it("removes a field only when removal is asked for explicitly", async () => {
    const root = await registry({ omen: OMEN })
    await updateNodeFields("omen", {}, { fabricRoot: root, remove: ["note"] })
    const { nodes } = await readNodes(root)
    expect(nodes.omen.note).toBeUndefined()
    expect(nodes.omen.user).toBe("bsval")
  })

  it("refuses to write over an edit made since the file was read", async () => {
    const root = await registry({ omen: OMEN })
    const { fingerprint } = await readNodes(root)
    // Another lane writes while we were deciding.
    await writeFile(path.join(root, "nodes.json"), JSON.stringify({ omen: { ...OMEN, user: "someone-else" } }, null, 2), "utf8")
    await expect(updateNodeFields("omen", { host: "x" }, { fabricRoot: root, expectFingerprint: fingerprint }))
      .rejects.toBeInstanceOf(RegistryConflict)
    const after = JSON.parse(await readFile(path.join(root, "nodes.json"), "utf8"))
    expect(after.omen.user).toBe("someone-else")
  })

  it("adds a node that did not exist", async () => {
    const root = await registry({ atlas: { host: "a" } })
    await updateNodeFields("forge", { host: "f", os: "linux" }, { fabricRoot: root })
    const { nodes } = await readNodes(root)
    expect(nodes.forge).toEqual({ host: "f", os: "linux" })
    expect(nodes.atlas).toEqual({ host: "a" })
  })
})
