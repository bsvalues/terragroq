import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const MARKER_NAME = ".williamos-w1-fixture.json"
const MARKER_PURPOSE = "disposable-w1-acceptance"

export type W1LocalFixtureConfig = Readonly<{
  home: string
  root: string
  stateFile: string
  markerFile: string
  token: string
}>

type FixtureEnvironment = Readonly<Record<string, string | undefined>>

export function w1LocalFixtureConfig(env: FixtureEnvironment = process.env): W1LocalFixtureConfig | null {
  if (env.NODE_ENV !== "development" || env.WILLIAMOS_W1_LOCAL_FIXTURE !== "1") return null
  const configuredHome = env.WILLIAMOS_W1_FIXTURE_HOME?.trim()
  const token = env.WILLIAMOS_W1_FIXTURE_TOKEN?.trim()
  if (!configuredHome || !token || !path.isAbsolute(configuredHome)) return null
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null
  const home = path.resolve(configuredHome)
  return {
    home,
    root: path.join(home, "workspace"),
    stateFile: path.join(home, "space-state.json"),
    markerFile: path.join(home, MARKER_NAME),
    token,
  }
}

export function matchesW1FixtureToken(supplied: string, actual: string): boolean {
  const actualBytes = Buffer.from(actual)
  const suppliedBytes = Buffer.from(supplied)
  return suppliedBytes.length === actualBytes.length && crypto.timingSafeEqual(suppliedBytes, actualBytes)
}

function isLoopbackUrl(candidate: string | null): URL | null {
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" ? url : null
  } catch {
    return null
  }
}

export function admitW1LocalFixtureRequest(
  request: Request,
  env: FixtureEnvironment = process.env,
): W1LocalFixtureConfig | null {
  const config = w1LocalFixtureConfig(env)
  if (!config) return null
  const url = isLoopbackUrl(request.url)
  if (!url || !matchesW1FixtureToken(url.searchParams.get("token") ?? "", config.token)) return null
  return config
}

/** Select the browser-visible loopback origin without trusting the caller-controlled Host header. */
export function w1FixtureRunningUrl(request: Request): string {
  const requestUrl = new URL(request.url)
  const requestedToken = requestUrl.searchParams.get("token") ?? ""
  const referer = isLoopbackUrl(request.headers.get("referer"))
  const admittedReferer = referer
    && referer.pathname === "/w1-fixture"
    && matchesW1FixtureToken(referer.searchParams.get("token") ?? "", requestedToken)
    ? referer
    : null
  const browserUrl = admittedReferer ?? isLoopbackUrl(request.url)
  if (!browserUrl) throw new Error("FIXTURE_ORIGIN_INVALID")
  const running = new URL("/api/w1-fixture/running", browserUrl.origin)
  running.searchParams.set("token", requestedToken)
  return running.toString()
}

/**
 * The fixture is only valid inside a deliberately created, non-linked scratch home. The marker is
 * the mechanical designation; the workspace and state paths are derived rather than operator chosen.
 */
export async function validateW1LocalFixtureHome(config: W1LocalFixtureConfig): Promise<boolean> {
  try {
    const [homeStat, rootStat, markerStat, realHome, realRoot, markerText] = await Promise.all([
      fs.lstat(config.home),
      fs.lstat(config.root),
      fs.lstat(config.markerFile),
      fs.realpath(config.home),
      fs.realpath(config.root),
      fs.readFile(config.markerFile, "utf8"),
    ])
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink()) return false
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false
    if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 1024) return false
    if (path.dirname(realRoot) !== realHome) return false
    const marker = JSON.parse(markerText) as Record<string, unknown>
    if (marker.schemaVersion !== 1 || marker.purpose !== MARKER_PURPOSE) return false
    if (Object.keys(marker).sort().join(",") !== "purpose,schemaVersion") return false
    try {
      const stateStat = await fs.lstat(config.stateFile)
      if (!stateStat.isFile() || stateStat.isSymbolicLink()) return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false
    }
    return true
  } catch {
    return false
  }
}

const stateQueues = new Map<string, Promise<void>>()

/** Serialize every compare-and-write for one fixture state file within the development process. */
export async function withW1FixtureStateLock<T>(stateFile: string, operation: () => Promise<T>): Promise<T> {
  const previous = stateQueues.get(stateFile) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  stateQueues.set(stateFile, tail)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (stateQueues.get(stateFile) === tail) stateQueues.delete(stateFile)
  }
}

/** Replace state from a same-directory temporary file so interruption cannot expose partial JSON. */
export async function writeW1FixtureStateAtomically(stateFile: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  const temporary = path.join(
    path.dirname(stateFile),
    `.${path.basename(stateFile)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(temporary, "wx")
    await handle.writeFile(content, "utf8")
    await handle.sync()
    await handle.close()
    handle = null
    await fs.rename(temporary, stateFile)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
  }
}
