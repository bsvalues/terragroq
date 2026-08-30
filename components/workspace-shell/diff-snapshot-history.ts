export const MAX_DIFF_SNAPSHOT_BYTES = 131_072
const MAX_DIFF_TEXT = 98_304
const MAX_STATUS_TEXT = 16_384
const TRUNCATION_MARKER = "\n… saved browser snapshot truncated …"

type DiffSnapshotStorage = Pick<Storage, "getItem" | "setItem">
type DiffSnapshotCleanupStorage = Pick<Storage, "removeItem">

export type DiffBrowserSnapshot = Readonly<{
  schemaVersion: 1
  path: string | null
  diff: string
  status: string
  capturedAt: string
}>
export type DiffBrowserSnapshotLoad = Readonly<{
  snapshot: DiffBrowserSnapshot | null
  error: "DIFF_SNAPSHOT_CORRUPT" | "DIFF_SNAPSHOT_UNAVAILABLE" | null
}>

function storageKey(scope: string): string {
  if (typeof scope !== "string" || scope.length > 500 || !/^(server|browser):\S+$/.test(scope)) {
    throw new Error("DIFF_SNAPSHOT_SCOPE_INVALID")
  }
  return `williamos:diff-snapshot:v1:${scope}`
}

export function removeDiffBrowserSnapshot(storage: DiffSnapshotCleanupStorage, scope: string): boolean {
  try {
    storage.removeItem(storageKey(scope))
    return true
  } catch {
    return false
  }
}

function validateText(value: unknown, maximum: number, error: string): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) throw new Error(error)
  return value
}

function parseSnapshot(raw: unknown, bounded: boolean): DiffBrowserSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("DIFF_SNAPSHOT_MALFORMED")
  const value = raw as Record<string, unknown>
  const keys = ["schemaVersion", "path", "diff", "status", "capturedAt"]
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("DIFF_SNAPSHOT_UNKNOWN_KEY")
  }
  if (value.schemaVersion !== 1) throw new Error("DIFF_SNAPSHOT_VERSION")
  const path = value.path === null ? null : validateText(value.path, 1_000, "DIFF_SNAPSHOT_PATH_INVALID")
  if (path === "") throw new Error("DIFF_SNAPSHOT_PATH_INVALID")
  const capturedAt = validateText(value.capturedAt, 40, "DIFF_SNAPSHOT_TIME_INVALID")
  if (!Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString() !== capturedAt) throw new Error("DIFF_SNAPSHOT_TIME_INVALID")
  const snapshot: DiffBrowserSnapshot = {
    schemaVersion: 1,
    path,
    diff: validateText(value.diff, bounded ? MAX_DIFF_TEXT : Number.MAX_SAFE_INTEGER, "DIFF_SNAPSHOT_DIFF_INVALID"),
    status: validateText(value.status, bounded ? MAX_STATUS_TEXT : Number.MAX_SAFE_INTEGER, "DIFF_SNAPSHOT_STATUS_INVALID"),
    capturedAt,
  }
  if (bounded && new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_DIFF_SNAPSHOT_BYTES) throw new Error("DIFF_SNAPSHOT_TOO_LARGE")
  return snapshot
}

function validateSnapshot(raw: unknown): DiffBrowserSnapshot {
  return parseSnapshot(raw, true)
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  return `${value.slice(0, Math.max(0, maximum - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`
}

function fitSnapshot(raw: unknown): DiffBrowserSnapshot {
  const parsed = parseSnapshot(raw, false)
  let diff = truncate(parsed.diff, MAX_DIFF_TEXT)
  const status = truncate(parsed.status, MAX_STATUS_TEXT)
  let candidate = { ...parsed, diff, status }
  while (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_DIFF_SNAPSHOT_BYTES && diff.length > TRUNCATION_MARKER.length) {
    const content = diff.endsWith(TRUNCATION_MARKER) ? diff.slice(0, -TRUNCATION_MARKER.length) : diff
    diff = `${content.slice(0, Math.floor(content.length * 0.75))}${TRUNCATION_MARKER}`
    candidate = { ...candidate, diff }
  }
  return validateSnapshot(candidate)
}

export function loadDiffBrowserSnapshot(storage: DiffSnapshotStorage, scope: string): DiffBrowserSnapshotLoad {
  let raw: string | null
  try {
    raw = storage.getItem(storageKey(scope))
  } catch {
    return { snapshot: null, error: "DIFF_SNAPSHOT_UNAVAILABLE" }
  }
  if (raw === null) return { snapshot: null, error: null }
  try {
    return { snapshot: validateSnapshot(JSON.parse(raw)), error: null }
  } catch {
    return { snapshot: null, error: "DIFF_SNAPSHOT_CORRUPT" }
  }
}

export function persistDiffBrowserSnapshot(storage: DiffSnapshotStorage, scope: string, raw: unknown): boolean {
  try {
    const snapshot = fitSnapshot(raw)
    storage.setItem(storageKey(scope), JSON.stringify(snapshot))
    return true
  } catch {
    return false
  }
}
