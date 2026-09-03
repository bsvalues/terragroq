import { beforeEach, describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"

const seams = vi.hoisted(() => ({
  spawn: vi.fn(),
  getSession: vi.fn(),
  resolveBinding: vi.fn(),
}))

vi.mock("node:child_process", () => ({ spawn: seams.spawn }))
vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveCanonicalWorkspaceProjectBinding: seams.resolveBinding,
}))

import { GET } from "@/app/api/loom/search/route"

const revisionByRepository = {
  "os-1": "1".repeat(40),
  atlas: "2".repeat(40),
} as const

function binding(repositoryKey: keyof typeof revisionByRepository) {
  const suffix = repositoryKey === "os-1" ? "terrafusion_os_1.0" : "terrafusion-atlas"
  return {
    workspaceRoot: `C:/mounts/${repositoryKey}`,
    projectKey: "terrafusion",
    repositoryKey,
    repositoryIdentity: `bsvalues/${suffix}`,
    repositoryMountKey: `terrafusion:${repositoryKey}:configured`,
    observedRevision: revisionByRepository[repositoryKey],
  }
}

function rgJson(path: string, line: number, excerpt: string): string {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: path },
      lines: { text: `${excerpt}\n` },
      line_number: line,
      submatches: [],
    },
  })
}

function spawnedRipgrep(stdoutText: string, exitCode = 0, stderrText = "") {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null, "SIGTERM"))
    return true
  })
  queueMicrotask(() => {
    child.stdout.end(stdoutText)
    child.stderr.end(stderrText)
    queueMicrotask(() => child.emit("close", exitCode, null))
  })
  return child
}

describe("Experience V2 Working Set search route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-a" } })
    seams.resolveBinding.mockImplementation(async (_userId: string, _projectKey: string, _dependencies: unknown, repositoryKey: string) => (
      repositoryKey === "os-1" || repositoryKey === "atlas"
        ? { ok: true, binding: binding(repositoryKey) }
        : { ok: false, error: "WORKSPACE_REPOSITORY_UNBOUND" }
    ))
    seams.spawn.mockImplementation((_file, _args, options) => {
      const repositoryKey = String(options.cwd).endsWith("atlas") ? "atlas" : "os-1"
      return spawnedRipgrep(rgJson(
        repositoryKey === "atlas" ? "src/project-atlas-feature.mjs" : "backend/AtlasProjectionConsumer.cs",
        repositoryKey === "atlas" ? 14 : 31,
        repositoryKey === "atlas" ? "export const parcelProjection = true" : "ConsumeAtlasProjection();",
      ))
    })
  })

  it("requires authentication before resolving or searching any repository", async () => {
    seams.getSession.mockResolvedValue(null)

    const response = await GET(new Request(
      "http://localhost/api/loom/search?projectKey=terrafusion&query=parcel&repositoryKey=os-1",
    ))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHENTICATED" })
    expect(seams.resolveBinding).not.toHaveBeenCalled()
    expect(seams.spawn).not.toHaveBeenCalled()
  })

  it.each([
    ["query missing", "http://localhost/api/loom/search?projectKey=terrafusion&repositoryKey=os-1", "SEARCH_QUERY_REQUIRED"],
    ["query too short", "http://localhost/api/loom/search?projectKey=terrafusion&query=x&repositoryKey=os-1", "SEARCH_QUERY_INVALID"],
    ["repository missing", "http://localhost/api/loom/search?projectKey=terrafusion&query=parcel", "REPOSITORY_KEYS_REQUIRED"],
    ["foreign parameter", "http://localhost/api/loom/search?projectKey=terrafusion&query=parcel&repositoryKey=os-1&root=C%3A%2Fforeign", "SEARCH_PARAMETER_INVALID"],
    ["ambiguous query", "http://localhost/api/loom/search?projectKey=terrafusion&query=parcel&query=owner&repositoryKey=os-1", "SEARCH_PARAMETER_INVALID"],
    ["unknown repository", "http://localhost/api/loom/search?projectKey=terrafusion&query=parcel&repositoryKey=sync", "WORKSPACE_REPOSITORY_UNKNOWN"],
  ])("fails closed for %s", async (_name, url, error) => {
    const response = await GET(new Request(url))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error })
    expect(seams.spawn).not.toHaveBeenCalled()
  })

  it("searches only server-resolved mounts and returns bounded repository-qualified matches", async () => {
    const response = await GET(new Request(
      "http://localhost/api/loom/search?projectKey=terrafusion&query=parcel&repositoryKey=os-1&repositoryKey=atlas",
    ))

    expect(response.status).toBe(200)
    expect(seams.resolveBinding.mock.calls).toEqual([
      ["owner-a", "terrafusion", undefined, "os-1", { includeRepositoryCatalog: false }],
      ["owner-a", "terrafusion", undefined, "atlas", { includeRepositoryCatalog: false }],
    ])
    expect(seams.spawn).toHaveBeenCalledTimes(2)
    for (const [file, args, options] of seams.spawn.mock.calls) {
      expect(file).toBe("rg")
      expect(args).toEqual(expect.arrayContaining(["--fixed-strings", "--json", "--", "parcel", "."]))
      expect(options).toEqual(expect.objectContaining({ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }))
      expect(String(options.cwd)).toMatch(/^C:\/mounts\/(os-1|atlas)$/)
    }
    await expect(response.json()).resolves.toEqual({
      projectKey: "terrafusion",
      query: "parcel",
      repositoryKeys: ["os-1", "atlas"],
      results: [
        {
          repositoryKey: "os-1",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          repositoryMountKey: "terrafusion:os-1:configured",
          observedRevision: "1".repeat(40),
          path: "backend/AtlasProjectionConsumer.cs",
          line: 31,
          excerpt: "ConsumeAtlasProjection();",
        },
        {
          repositoryKey: "atlas",
          repositoryIdentity: "bsvalues/terrafusion-atlas",
          repositoryMountKey: "terrafusion:atlas:configured",
          observedRevision: "2".repeat(40),
          path: "src/project-atlas-feature.mjs",
          line: 14,
          excerpt: "export const parcelProjection = true",
        },
      ],
      unavailable: [],
      partial: [],
      truncated: false,
    })
  })

  it("omits an unavailable mount from execution and reports that absence truthfully", async () => {
    seams.resolveBinding.mockImplementation(async (_userId: string, _projectKey: string, _dependencies: unknown, repositoryKey: string) => (
      repositoryKey === "atlas"
        ? { ok: false, error: "WORKSPACE_REPOSITORY_ROOT_UNCONFIGURED" }
        : { ok: true, binding: binding("os-1") }
    ))

    const response = await GET(new Request(
      "http://localhost/api/loom/search?projectKey=terrafusion&query=parcel&repositoryKey=os-1&repositoryKey=atlas",
    ))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(seams.spawn).toHaveBeenCalledTimes(1)
    expect(payload.results).toHaveLength(1)
    expect(payload.unavailable).toEqual([{
      repositoryKey: "atlas",
      reason: "WORKSPACE_REPOSITORY_ROOT_UNCONFIGURED",
    }])
    expect(payload.partial).toEqual([])
  })

  it("filters sensitive paths before returning excerpts", async () => {
    seams.spawn.mockImplementation(() => spawnedRipgrep([
      rgJson("secrets/private.pem", 1, "PRIVATE MATERIAL"),
      rgJson("src/safe.ts", 2, "parcelProjection"),
    ].join("\n")))

    const response = await GET(new Request(
      "http://localhost/api/loom/search?projectKey=terrafusion&query=parcel&repositoryKey=os-1",
    ))
    const raw = await response.text()

    expect(response.status).toBe(200)
    expect(raw).not.toContain("PRIVATE MATERIAL")
    expect(JSON.parse(raw).results).toEqual([expect.objectContaining({ path: "src/safe.ts" })])
  })

  it("stops a large repository stream at the global per-repository result bound", async () => {
    const child = spawnedRipgrep(Array.from({ length: 40 }, (_, index) => (
      rgJson(`docs/result-${index}.md`, index + 1, `README result ${index}`)
    )).join("\n"))
    seams.spawn.mockReturnValue(child)

    const response = await GET(new Request(
      "http://localhost/api/loom/search?projectKey=terrafusion&query=README&repositoryKey=os-1",
    ))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.results).toHaveLength(12)
    expect(payload.truncated).toBe(true)
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(payload.unavailable).toEqual([])
  })

  it("returns valid results with explicit partial truth when unreadable repository paths make rg exit two", async () => {
    seams.spawn.mockImplementation(() => spawnedRipgrep([
      rgJson("src/safe.ts", 9, "Sovereign domain pack"),
      JSON.stringify({ type: "summary", data: { stats: {} } }),
    ].join("\n"), 2, "rg: broken-link: path not found"))

    const response = await GET(new Request(
      "http://localhost/api/loom/search?projectKey=terrafusion&query=Sovereign%20domain%20pack&repositoryKey=os-1",
    ))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.results).toEqual([expect.objectContaining({ repositoryKey: "os-1", path: "src/safe.ts" })])
    expect(payload.unavailable).toEqual([])
    expect(payload.partial).toEqual([{ repositoryKey: "os-1", reason: "WORKSPACE_SEARCH_INCOMPLETE" }])
  })
})
