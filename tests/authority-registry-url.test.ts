import { execFile } from "node:child_process"
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

import {
  AuthorityRegistryUrlError,
  readDatabaseUrlFromEnv,
  redactUrl,
  resolveAuthorityRegistryUrl,
} from "@/lib/fabric/authority-registry-url.mjs"

const run = promisify(execFile)

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

// `URL.hostname` is a silent setter. Given a value the parser will not take it throws nothing and
// leaves the PREVIOUS hostname in place -- so the naive implementation returned the stale address
// this module exists to stop trusting, while reporting the registry's value as `host` and
// `changed: true`. The failure is invisible at every surface except a connection to the wrong
// machine, which is why each rejected shape is pinned individually rather than as one case.
describe("a host the URL parser will not take is a refusal, never a silent fallback", () => {
  for (const [label, host] of [
    ["a bare IPv6 literal with a space", "fd00:: 1"],
    ["a hostname with a space", "atlas box"],
    ["an address with a port attached", "192.168.88.8:9999"],
    ["a bare IPv6 literal with a trailing bracket only", "fd00::1]"],
  ] as const) {
    it(`refuses ${label}`, async () => {
      const root = await registry({ atlas: { ...ATLAS, host } })
      await expect(resolveAuthorityRegistryUrl(STALE, { fabricRoot: root }))
        .rejects.toMatchObject({ code: "FABRIC_REGISTRY_HOST_UNUSABLE" })
    })
  }

  // The specific regression: whatever it does, it must not hand back `192.168.88.5`.
  it("never returns the source's own address when the registry host is unusable", async () => {
    const root = await registry({ atlas: { ...ATLAS, host: "atlas box" } })
    await expect(resolveAuthorityRegistryUrl(STALE, { fabricRoot: root })).rejects.toThrow()
    await expect(resolveAuthorityRegistryUrl(STALE, { fabricRoot: root }))
      .rejects.not.toMatchObject({ url: expect.stringContaining("192.168.88.5") })
  })
})

// ATLAS has a link-local IPv6 address, and a registry that ever carries one must not be a refusal.
describe("a bare IPv6 address is bracketed, not rejected", () => {
  it("accepts what the registry writes and emits what a connection string needs", async () => {
    const root = await registry({ atlas: { ...ATLAS, host: "fd00::1a66:daff:fe47:a033" } })
    const resolved = await resolveAuthorityRegistryUrl(STALE, { fabricRoot: root })
    expect(resolved.host).toBe("fd00::1a66:daff:fe47:a033")
    expect(new URL(resolved.url).hostname).toBe("[fd00::1a66:daff:fe47:a033]")
    expect(new URL(resolved.url).port).toBe("15432")
    expect(resolved.changed).toBe(true)
  })

  it("takes an already-bracketed literal too", async () => {
    const root = await registry({ atlas: { ...ATLAS, host: "[::1]" } })
    const resolved = await resolveAuthorityRegistryUrl(STALE, { fabricRoot: root })
    expect(new URL(resolved.url).hostname).toBe("[::1]")
  })
})

// `postgresql:` is not one of the URL standard's "special" schemes, so its host is parsed as an
// OPAQUE host: no lower-casing, no IDNA, and a different set of forbidden characters than a web URL
// has. That is why the check above compares against what the parser gives back rather than against a
// normalisation this module performs itself — a hand-rolled `toLowerCase()` comparison would refuse
// a registry that writes `ATLAS` even though the parser accepted it perfectly well.
describe("an upper-case host is carried through, not refused and not folded", () => {
  it("accepts it verbatim", async () => {
    const root = await registry({ atlas: { ...ATLAS, host: "ATLAS.LOCAL" } })
    const resolved = await resolveAuthorityRegistryUrl(STALE, { fabricRoot: root })
    expect(resolved.host).toBe("ATLAS.LOCAL")
    expect(new URL(resolved.url).hostname).toBe("ATLAS.LOCAL")
    expect(resolved.changed).toBe(true)
  })

  it("reports no change when the source already names it", async () => {
    const root = await registry({ atlas: { ...ATLAS, host: "ATLAS.LOCAL" } })
    const already = STALE.replace("192.168.88.5", "ATLAS.LOCAL")
    expect((await resolveAuthorityRegistryUrl(already, { fabricRoot: root })).changed).toBe(false)
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

// `--out` exists so the connection string can be generated per run instead of living in a durable
// file, which means the file it writes carries the registry password. Node applies the `mode` option
// only when it CREATES a file, so writing over an existing world-readable path left the password
// world-readable — the failure being most likely on exactly the second and subsequent runs.
//
// POSIX modes are meaningful on the CI runner and on ATLAS, and are not on the Windows machines this
// is developed on, so the mode assertion runs where it means something and the rest runs everywhere.
describe("the file --out writes carries a password and must not be left readable", () => {
  const cli = path.join(__dirname, "..", "scripts", "fabric", "resolve-authority-registry-url.mjs")

  async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), "authority-out-"))
    await writeFile(path.join(root, "nodes.json"), JSON.stringify({ atlas: ATLAS }), "utf8")
    const source = path.join(root, "source.env")
    await writeFile(source, `DATABASE_URL=${STALE}\n`, "utf8")
    return { root, source, out: path.join(root, "resolved.env") }
  }

  it("overwrites an existing 0644 file and leaves it 0600", async () => {
    const { root, source, out } = await fixture()
    await writeFile(out, "DATABASE_URL=postgresql://stale:stale@192.168.88.5:15432/williamos\n", "utf8")
    await chmod(out, 0o644)

    await run(process.execPath, [cli, source, "--emit=env", `--out=${out}`, `--fabric-root=${root}`])

    expect(await readFile(out, "utf8")).toBe(`DATABASE_URL=${STALE.replace("192.168.88.5", "192.168.88.8")}\n`)
    if (process.platform !== "win32") {
      expect((await stat(out)).mode & 0o777).toBe(0o600)
    }
  })

  it("creates a new file 0600", async () => {
    const { root, source, out } = await fixture()
    await run(process.execPath, [cli, source, "--emit=env", `--out=${out}`, `--fabric-root=${root}`])
    if (process.platform !== "win32") {
      expect((await stat(out)).mode & 0o777).toBe(0o600)
    }
  })

  // A refusal must not leave the previous answer behind looking like the current one.
  it("writes nothing when the registry cannot answer", async () => {
    const { root, source, out } = await fixture()
    await writeFile(path.join(root, "nodes.json"), JSON.stringify({ hermes: {} }), "utf8")
    await expect(run(process.execPath, [cli, source, "--emit=env", `--out=${out}`, `--fabric-root=${root}`]))
      .rejects.toMatchObject({ code: 1 })
    await expect(stat(out)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
