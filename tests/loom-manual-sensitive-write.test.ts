import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { writeManualOwnerWorkspaceFile } from "@/lib/loom/manual-owner-file-save"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function fixture(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "loom-sensitive-write-"))
  roots.push(root)
  const target = path.join(root, name)
  await fs.writeFile(target, "placeholder-before\n", "utf8")
  return { root, target }
}

describe("manual owner sensitive-file writes", () => {
  it("refuses a private-key file before changing its bytes", async () => {
    const { root, target } = await fixture("device.pem")

    const result = await writeManualOwnerWorkspaceFile({
      path: "device.pem",
      content: "placeholder-after\n",
    }, root)

    expect(result).toEqual({ ok: false, error: "SENSITIVE_PATH", status: 403 })
    expect(await fs.readFile(target, "utf8")).toBe("placeholder-before\n")
  })

  it("does not classify the documented env example as a secret path", async () => {
    const { root, target } = await fixture(".env.example")

    const result = await writeManualOwnerWorkspaceFile({
      path: ".env.example",
      content: "PLACEHOLDER=example\n",
    }, root)

    expect(result).toMatchObject({ ok: false, error: "FAILED_SCOPE_COLLISION", status: 409 })
    expect(await fs.readFile(target, "utf8")).toBe("placeholder-before\n")
  })
})
