import path from "node:path"

export type W1LocalFixtureConfig = Readonly<{
  root: string
  stateFile: string
}>

type FixtureEnvironment = Readonly<Record<string, string | undefined>>

export function w1LocalFixtureConfig(env: FixtureEnvironment = process.env): W1LocalFixtureConfig | null {
  if (env.NODE_ENV !== "development" || env.WILLIAMOS_W1_LOCAL_FIXTURE !== "1") return null
  const root = env.WILLIAMOS_W1_FIXTURE_ROOT?.trim()
  const stateFile = env.WILLIAMOS_W1_FIXTURE_STATE?.trim()
  if (!root || !stateFile || !path.isAbsolute(root) || !path.isAbsolute(stateFile)) return null
  return { root: path.resolve(root), stateFile: path.resolve(stateFile) }
}

export function admitW1LocalFixtureRequest(
  request: Request,
  env: FixtureEnvironment = process.env,
): W1LocalFixtureConfig | null {
  const config = w1LocalFixtureConfig(env)
  if (!config) return null
  const hostname = new URL(request.url).hostname.toLowerCase()
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" ? config : null
}
