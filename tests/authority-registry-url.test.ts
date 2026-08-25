import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  AuthorityRegistryUrlError,
  readDatabaseUrlFromEnv,
  redactUrl,
  resolveAuthorityRegistryUrl,
} from "@/lib/fabric/authority-registry-url.mjs"

// The address that survived a DHCP lease change and made the lab's authority oracle unreadable.
const STALE = "postgresql://williamos:s3cr3t@192.168.88.5:15432/williamos?sslmode=disable"

async function registry(content: Record<string, unknown> | null) {
  const root = await mkdtemp(path.join(tmpdir(), "authority-url-"))
  if (content) await writeFile(path.join(root, "nodes.json"), JSON.stringify(content, null, 2), "utf8")
  return root
}

const ATLAS = { transport: "ssh", host: "192.168.88.8", user: "bs", os: "linux" }

describe("the authority registry's address comes from the fabric registry", () => {
  it("replaces the host with what the registry holds", async () => {
    const root = await registry({ atlas: ATLAS })
    const resolved = await resolveAuthorityRegistryUrl(STALE, { fabricRoot: root })
    expect(resolved.host).toBe("192.168.88.8")
    expect(resolved.previousHost).toBe("192.168.88.5")
    expect(resolved.changed).toBe(true)
    expect(resolved.url).toBe("postgresql://williamos:s3cr3t@192.168.88.8:15432/williamos?sslmode=disable")
  })

  // The whole point is that only the address is the registry's business. A resolver that also
  // normalised the port or dropped a query parameter would be a second thing that can go wrong.
  it("carries the role, password, port, database and query through untouched", async () => {
    const root = await registry({ atlas: ATLAS })
    const { url } = await resolveAuthorityRegistryUrl(STALE, { fabricRoot: root })
    const parsed = new URL(url)
    expect(parsed.username).toBe("williamos")
    expect(parsed.password).toBe("s3cr3t")
    expect(parsed.port).toBe("15432")
    expect(parsed.pathname).toBe("/williamos")
    expect(parsed.search).toBe("?sslmode=disable")
  })

  it("reports no change when the registry already agrees", async () => {
    const root = await registry({ atlas: ATLAS })
    const current = STALE.replace("192.168.88.5", "192.168.88.8")
    const resolved = await resolveAuthorityRegistryUrl(current, { fabricRoot: root })
    expect(resolved.changed).toBe(false)
    expect(resolved.url).toBe(current)
  })
})

describe("it refuses rather than falling back", () => {
  // A fallback to the source address is how the stale value survives the repair meant to remove it:
  // correct on the day it is written, silently wrong again the day the lease moves.
  it("refuses when the registry is absent, and does NOT return the source address", async () => {
    const root = await registry(null)
    await expect(resolveAuthorityRegistryUrl(STALE, { fabricRoot: root }))
      .rejects.toMatchObject({ code: "FABRIC_REGISTRY_UNREADABLE" })
  })

  it("refuses when the registry carries no atlas entry", async () => {
    const root = await registry({ hermes: { transport: "local", os: "windows" } })
    await expect(resolveAuthorityRegistryUrl(STALE, { fabricRoot: root }))
      .rejects.toMatchObject({ code: "FABRIC_REGISTRY_INCOMPLETE" })
  })

  it("refuses when the atlas entry has no host", async () => {
    const root = await registry({ atlas: { transport: "ssh", user: "bs", os: "linux" } })
    await expect(resolveAuthorityRegistryUrl(STALE, { fabricRoot: root }))
      .rejects.toMatchObject({ code: "FABRIC_REGISTRY_INCOMPLETE" })
  })

  it("refuses an unparseable source rather than rewriting it by hand", async () => {
    const root = await registry({ atlas: ATLAS })
    await expect(resolveAuthorityRegistryUrl("not-a-url", { fabricRoot: root }))
      .rejects.toBeInstanceOf(AuthorityRegistryUrlError)
  })
})

describe("reading DATABASE_URL out of a dotenv file", () => {
  it("takes the last assignment, as a loader would", () => {
    const text = "DATABASE_URL=postgresql://a:b@one/x\nOTHER=1\nDATABASE_URL=postgresql://a:b@two/x\n"
    expect(readDatabaseUrlFromEnv(text)).toBe("postgresql://a:b@two/x")
  })

  it("strips one layer of matching quotes and tolerates export", () => {
    expect(readDatabaseUrlFromEnv('export DATABASE_URL="postgresql://a:b@h/x"')).toBe("postgresql://a:b@h/x")
  })

  it("refuses a file that has none", () => {
    expect(() => readDatabaseUrlFromEnv("NEXTAUTH_URL=http://localhost\n", "x.env"))
      .toThrowError(/SOURCE_ENV_NO_DATABASE_URL/)
  })

  it("does not mistake a commented-out assignment for a live one", () => {
    expect(() => readDatabaseUrlFromEnv("# DATABASE_URL=postgresql://a:b@h/x\n"))
      .toThrowError(/SOURCE_ENV_NO_DATABASE_URL/)
  })
})

describe("redaction", () => {
  it("removes the password and keeps everything a reader needs", () => {
    expect(redactUrl(STALE)).toBe("postgresql://williamos:***@192.168.88.5:15432/williamos?sslmode=disable")
  })
})
