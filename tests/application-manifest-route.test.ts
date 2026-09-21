import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const auth = vi.hoisted(() => ({ user: "owner" as string | null }))
vi.mock("@/lib/session", () => ({ getSession: async () => auth.user ? { user: { id: auth.user } } : null }))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
vi.mock("@/lib/governance/owner", () => ({
  resolveOwnerUserId: async () => "owner",
  assertOwner: (user: string) => user === "owner" ? { ok: true } : { ok: false, failure: "NOT_OWNER" },
}))

import { GET } from "@/app/api/projects/[projectKey]/application-manifest/route"
import { createApplication } from "@/lib/applications/application-creation"

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "application-manifest-route-"))
  vi.stubEnv("WILLIAMOS_APPLICATIONS_ROOT", root)
  auth.user = "owner"
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

describe("safe application manifest route", () => {
  it("projects only the catalog-bound manifest identity and source truth", async () => {
    const created = await createApplication({ id: "focus-board", displayName: "Focus Board" })
    const response = await GET(new Request("https://williamos.test/api/projects/focus-board/application-manifest"), {
      params: Promise.resolve({ projectKey: "focus-board" }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      manifest: created.manifest,
      manifestDigest: created.manifestDigest,
      head: created.head,
    })
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("does not resolve an unknown or unauthenticated application", async () => {
    expect((await GET(new Request("https://williamos.test"), {
      params: Promise.resolve({ projectKey: "missing" }),
    })).status).toBe(404)
    auth.user = null
    expect((await GET(new Request("https://williamos.test"), {
      params: Promise.resolve({ projectKey: "focus-board" }),
    })).status).toBe(401)
  })
})
