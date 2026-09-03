import { spawn } from "node:child_process"

import { getSession } from "@/lib/session"
import { isSensitiveWorkspacePath } from "@/lib/loom/workspace"
import {
  resolveCanonicalWorkspaceProjectBinding,
  type WorkspaceProjectBinding,
} from "@/lib/projects/workspace-project-binding"
import { resolveWorkspaceRepositorySelection } from "@/lib/projects/core-seven-repositories"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const ALLOWED_PARAMETERS = new Set(["projectKey", "query", "repositoryKey"])
const MAX_QUERY_CHARACTERS = 120
const MAX_REPOSITORIES = 7
const MAX_RESULTS = 60
const MAX_RESULTS_PER_REPOSITORY = 12
const MAX_EXCERPT_CHARACTERS = 320
const MAX_RG_OUTPUT_BYTES = 512_000
const SEARCH_TIMEOUT_MS = 8_000

type SearchMatch = Readonly<{
  repositoryKey: string
  repositoryIdentity: string
  repositoryMountKey: string
  observedRevision: string
  path: string
  line: number
  excerpt: string
}>

type SearchUnavailable = Readonly<{
  repositoryKey: string
  reason: string
}>

type RipgrepMatchEvent = Readonly<{
  type?: unknown
  data?: Readonly<{
    path?: Readonly<{ text?: unknown }>
    lines?: Readonly<{ text?: unknown }>
    line_number?: unknown
  }>
}>

function refuse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } })
}

type RipgrepRun = Readonly<{
  output: string
  truncated: boolean
  incomplete: boolean
}>

function hasRipgrepSummary(output: string): boolean {
  return output.split(/\r?\n/).some((line) => {
    if (!line) return false
    try { return (JSON.parse(line) as RipgrepMatchEvent).type === "summary" } catch { return false }
  })
}

function runRipgrep(workspaceRoot: string, query: string): Promise<RipgrepRun> {
  const args = [
    "--fixed-strings",
    "--json",
    "--color",
    "never",
    "--max-count",
    String(MAX_RESULTS_PER_REPOSITORY),
    "--max-filesize",
    "1M",
    "--max-columns",
    String(MAX_EXCERPT_CHARACTERS),
    "--max-columns-preview",
    "--",
    query,
    ".",
  ]

  return new Promise((resolve, reject) => {
    const child = spawn("rg", args, {
      cwd: workspaceRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    let pending = ""
    let stderr = ""
    let outputBytes = 0
    let matches = 0
    let settled = false

    const settle = (result: RipgrepRun | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }

    const stopAtBound = () => {
      child.kill()
      settle({ output, truncated: true, incomplete: false })
    }

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      if (settled) return
      outputBytes += Buffer.byteLength(chunk)
      if (outputBytes > MAX_RG_OUTPUT_BYTES) {
        child.kill()
        settle(new Error("WORKSPACE_SEARCH_OUTPUT_LIMIT"))
        return
      }
      output += chunk
      pending += chunk
      for (;;) {
        const lineEnd = pending.indexOf("\n")
        if (lineEnd < 0) break
        const line = pending.slice(0, lineEnd)
        pending = pending.slice(lineEnd + 1)
        try {
          const event = JSON.parse(line) as RipgrepMatchEvent
          if (event.type === "match") matches += 1
        } catch {
          // Ripgrep's JSON stream may contain non-match records; parsing is validated again below.
        }
        if (matches >= MAX_RESULTS_PER_REPOSITORY) {
          stopAtBound()
          return
        }
      }
    })
    child.stderr.on("data", (chunk: string) => {
      if (!settled) stderr = `${stderr}${chunk}`.slice(-2_000)
    })
    child.on("error", (error) => settle(error))
    child.on("close", (code) => {
      if (code === 0 || code === 1) {
        settle({ output, truncated: false, incomplete: false })
        return
      }
      if (code === 2 && hasRipgrepSummary(output)) {
        settle({ output, truncated: false, incomplete: true })
        return
      }
      settle(new Error(stderr || `rg exited with code ${String(code)}`))
    })

    const timeout = setTimeout(() => {
      child.kill()
      settle(new Error("WORKSPACE_SEARCH_TIMEOUT"))
    }, SEARCH_TIMEOUT_MS)
    timeout.unref()
  })
}

function normalizeRelativeSearchPath(value: string): string | null {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null
  if (normalized.split("/").some((segment) => segment === "..")) return null
  return normalized
}

function parseMatches(binding: WorkspaceProjectBinding, stdout: string): SearchMatch[] {
  if (!binding.observedRevision || !/^[a-f0-9]{40,64}$/i.test(binding.observedRevision)) return []
  const matches: SearchMatch[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line || matches.length >= MAX_RESULTS_PER_REPOSITORY) continue
    let event: RipgrepMatchEvent
    try {
      event = JSON.parse(line) as RipgrepMatchEvent
    } catch {
      continue
    }
    if (event.type !== "match") continue
    const rawPath = event.data?.path?.text
    const rawExcerpt = event.data?.lines?.text
    const lineNumber = event.data?.line_number
    if (typeof rawPath !== "string" || typeof rawExcerpt !== "string" || typeof lineNumber !== "number") continue
    const relativePath = normalizeRelativeSearchPath(rawPath)
    if (!relativePath || isSensitiveWorkspacePath(relativePath)) continue
    matches.push({
      repositoryKey: binding.repositoryKey,
      repositoryIdentity: binding.repositoryIdentity,
      repositoryMountKey: binding.repositoryMountKey,
      observedRevision: binding.observedRevision.toLowerCase(),
      path: relativePath,
      line: lineNumber,
      excerpt: rawExcerpt.replace(/[\r\n]+$/g, "").slice(0, MAX_EXCERPT_CHARACTERS),
    })
  }
  return matches
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return refuse("UNAUTHENTICATED", 401)

  const url = new URL(request.url)
  if ([...url.searchParams.keys()].some((key) => !ALLOWED_PARAMETERS.has(key))) {
    return refuse("SEARCH_PARAMETER_INVALID", 400)
  }
  if (url.searchParams.getAll("projectKey").length > 1 || url.searchParams.getAll("query").length > 1) {
    return refuse("SEARCH_PARAMETER_INVALID", 400)
  }
  const projectKey = url.searchParams.get("projectKey")
  if (projectKey !== "terrafusion" && projectKey !== "williamos") return refuse("SPACE_PROJECT_INVALID", 400)

  const rawQuery = url.searchParams.get("query")
  if (rawQuery === null) return refuse("SEARCH_QUERY_REQUIRED", 400)
  const query = rawQuery.trim()
  if (query.length < 2 || query.length > MAX_QUERY_CHARACTERS || /[\0\r\n]/.test(query)) {
    return refuse("SEARCH_QUERY_INVALID", 400)
  }

  const repositoryKeys = [...new Set(url.searchParams.getAll("repositoryKey"))]
  if (repositoryKeys.length === 0) return refuse("REPOSITORY_KEYS_REQUIRED", 400)
  if (repositoryKeys.length > MAX_REPOSITORIES || repositoryKeys.some((repositoryKey) => (
    !resolveWorkspaceRepositorySelection(projectKey, repositoryKey).ok
  ))) {
    return refuse("WORKSPACE_REPOSITORY_UNKNOWN", 400)
  }

  const resolved = await Promise.all(repositoryKeys.map(async (repositoryKey) => {
    const result = await resolveCanonicalWorkspaceProjectBinding(
      session.user.id,
      projectKey,
      undefined,
      repositoryKey,
      { includeRepositoryCatalog: false },
    )
    return { repositoryKey, result }
  }))

  const searched = await Promise.all(resolved.map(async ({ repositoryKey, result }) => {
    if (!result.ok) {
      return { results: [] as SearchMatch[], unavailable: { repositoryKey, reason: result.error }, truncated: false, partial: null }
    }
    if (!result.binding.observedRevision || !/^[a-f0-9]{40,64}$/i.test(result.binding.observedRevision)) {
      return {
        results: [] as SearchMatch[],
        unavailable: { repositoryKey, reason: "WORKSPACE_REVISION_UNAVAILABLE" },
        truncated: false,
        partial: null,
      }
    }
    try {
      const search = await runRipgrep(result.binding.workspaceRoot, query)
      return {
        results: parseMatches(result.binding, search.output),
        unavailable: null,
        truncated: search.truncated,
        partial: search.incomplete ? { repositoryKey, reason: "WORKSPACE_SEARCH_INCOMPLETE" } : null,
      }
    } catch {
      return {
        results: [] as SearchMatch[],
        unavailable: { repositoryKey, reason: "WORKSPACE_SEARCH_UNAVAILABLE" },
        truncated: false,
        partial: null,
      }
    }
  }))

  const allResults = searched.flatMap((item) => item.results)
  const unavailable: SearchUnavailable[] = searched.flatMap((item) => item.unavailable ? [item.unavailable] : [])
  const partial: SearchUnavailable[] = searched.flatMap((item) => item.partial ? [item.partial] : [])
  const results = allResults.slice(0, MAX_RESULTS)
  return Response.json({
    projectKey,
    query,
    repositoryKeys,
    results,
    unavailable,
    partial,
    truncated: searched.some((item) => item.truncated) || allResults.length > MAX_RESULTS,
  }, { headers: { "cache-control": "no-store" } })
}
