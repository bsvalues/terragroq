import type { DurableAgentSession } from "./agent-sessions"
import type { AssignmentContextManifest } from "@/lib/loom/assignment-context-manifest"
import { parseAssignmentContextManifestView } from "./assignment-context-view"

export const AGENT_SESSION_INSPECTOR_PAYLOAD_KIND = "agent-session"
// Reuse the already-persisted bounded Inspector payload channel. The payload kind remains exact.
export const AGENT_SESSION_INSPECTOR_SURFACE_KIND = "agent-session"
export const AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX = "agent-session-inspector\u241f"
export const MAX_AGENT_SESSION_INSPECTOR_PAYLOAD_BYTES = 200_000

const encoder = new TextEncoder()
const providers = new Set(["Codex", "Claude", "Local"])
const verificationStates = new Set(["verified", "saved-resume-unverified"])
const modes = new Set(["delegate", "review", "diff-review", "preview", "conversation", "fork"])

export type AgentSessionInspectorSnapshot = Readonly<{
  schemaVersion: 1
  kind: typeof AGENT_SESSION_INSPECTOR_PAYLOAD_KIND
  sessionKey: string
  sessionId: string
  assignmentId: string
  role: string
  provider: "Codex" | "Claude" | "Local"
  assignment: string
  contextManifest: AssignmentContextManifest | null
  verificationAtCapture: "verified" | "saved-resume-unverified"
  capturedAt: string
  mode: "delegate" | "review" | "diff-review" | "preview" | "conversation" | "fork"
  target: Readonly<{ kind: "file"; path: string }>
    | Readonly<{ kind: "review"; path: string }>
    | Readonly<{ kind: "diff-review"; worldId: string; path: string; fingerprint: string; baseHash: string; indexHash: string; patchHash: string; completedAt: string }>
    | Readonly<{ kind: "preview"; worldId: string; evidenceFingerprint: string }>
    | null
  forkedFrom: string | null
  updatedAt: string
  turns: readonly Readonly<{ ownerPrompt: string; finalResult: string; completedAt: string }>[]
}>

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && Object.keys(value).every((key) => expected.includes(key))
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0")
}

function iso(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function validSessionId(provider: unknown, value: unknown): value is string {
  if (typeof value !== "string") return false
  if (provider === "Claude" || provider === "Local") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  return provider === "Codex" && /^[A-Za-z0-9._:-]{1,200}$/.test(value)
}

function targetSnapshot(descriptor: DurableAgentSession): AgentSessionInspectorSnapshot["target"] {
  if (descriptor.diffReview) return { kind: "diff-review", ...descriptor.diffReview }
  if (descriptor.reviewPath) return { kind: "review", path: descriptor.reviewPath }
  if (descriptor.target) return descriptor.target
  if (descriptor.preview) return { kind: "preview", ...descriptor.preview }
  return null
}

function sessionMode(descriptor: DurableAgentSession): AgentSessionInspectorSnapshot["mode"] {
  return descriptor.preview ? "preview" : descriptor.diffReview ? "diff-review" : descriptor.reviewPath ? "review"
    : descriptor.forkedFrom ? "fork" : descriptor.provider === "Local" ? "conversation" : "delegate"
}

function canonicalPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_000 && !/[\\\u0000-\u001f\u007f]/.test(value)
    && !value.startsWith("/") && !/^[A-Za-z]:/.test(value)
    && value.split("/").every((part) => part && part !== "." && part !== "..")
}

function parseTarget(value: unknown): AgentSessionInspectorSnapshot["target"] | undefined {
  if (value === null) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (row.kind === "file" && exactKeys(row, ["kind", "path"]) && canonicalPath(row.path)) return { kind: "file", path: row.path }
  if (row.kind === "review" && exactKeys(row, ["kind", "path"]) && canonicalPath(row.path)) return { kind: "review", path: row.path }
  if (row.kind === "preview" && exactKeys(row, ["kind", "worldId", "evidenceFingerprint"])
    && text(row.worldId, 200) && typeof row.evidenceFingerprint === "string" && /^[0-9a-f]{64}$/.test(row.evidenceFingerprint)) {
    return { kind: "preview", worldId: row.worldId, evidenceFingerprint: row.evidenceFingerprint }
  }
  if (row.kind === "diff-review" && exactKeys(row, ["kind", "worldId", "path", "fingerprint", "baseHash", "indexHash", "patchHash", "completedAt"])
    && text(row.worldId, 200) && canonicalPath(row.path) && text(row.fingerprint, 16_384)
    && typeof row.baseHash === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.baseHash)
    && typeof row.indexHash === "string" && /^[0-9a-f]{64}$/.test(row.indexHash)
    && typeof row.patchHash === "string" && /^[0-9a-f]{64}$/.test(row.patchHash) && iso(row.completedAt)) {
    return { kind: "diff-review", worldId: row.worldId, path: row.path, fingerprint: row.fingerprint,
      baseHash: row.baseHash, indexHash: row.indexHash, patchHash: row.patchHash, completedAt: row.completedAt }
  }
  return undefined
}

export function parseAgentSessionInspectorPayload(value: unknown): AgentSessionInspectorSnapshot | null {
  if (typeof value !== "string" || value.length > MAX_AGENT_SESSION_INSPECTOR_PAYLOAD_BYTES
    || encoder.encode(value).byteLength > MAX_AGENT_SESSION_INSPECTOR_PAYLOAD_BYTES) return null
  let decoded: unknown
  try { decoded = JSON.parse(value) } catch { return null }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null
  const row = decoded as Record<string, unknown>
  const expectedKeys = ["schemaVersion", "kind", "sessionKey", "sessionId", "role", "provider", "assignment", "verificationAtCapture", "capturedAt", "mode", "target", "forkedFrom", "updatedAt", "turns"]
  const validKeys = exactKeys(row, expectedKeys)
    || exactKeys(row, [...expectedKeys, "contextManifest"])
    || exactKeys(row, [...expectedKeys, "assignmentId"])
    || exactKeys(row, [...expectedKeys, "assignmentId", "contextManifest"])
  if (!validKeys
    || row.schemaVersion !== 1 || row.kind !== AGENT_SESSION_INSPECTOR_PAYLOAD_KIND
    || !providers.has(row.provider as string) || !validSessionId(row.provider, row.sessionId)
    || row.sessionKey !== `${row.provider}:${row.sessionId}` || !text(row.sessionKey, 300)
    || !text(row.role, 80) || !text(row.assignment, 500) || !verificationStates.has(row.verificationAtCapture as string)
    || !iso(row.capturedAt) || !modes.has(row.mode as string)
    || row.forkedFrom !== null && !text(row.forkedFrom, 200) || !iso(row.updatedAt)
    || !Array.isArray(row.turns) || row.turns.length > 20) return null
  const target = parseTarget(row.target)
  if (target === undefined) return null
  const assignmentId = row.assignmentId === undefined ? row.sessionId : row.assignmentId
  if (!text(assignmentId, 300)) return null
  const contextManifest = row.contextManifest === undefined || row.contextManifest === null
    ? null
    : parseAssignmentContextManifestView(row.contextManifest)
  if (row.contextManifest !== undefined && row.contextManifest !== null && !contextManifest
    || contextManifest && (contextManifest.assignment.assignmentId !== assignmentId
      || target?.kind !== "file"
      || !contextManifest.mutationPosture.target.writablePaths.includes(target.path))) return null
  const turns: { ownerPrompt: string; finalResult: string; completedAt: string }[] = []
  for (const value of row.turns) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const turn = value as Record<string, unknown>
    if (!exactKeys(turn, ["ownerPrompt", "finalResult", "completedAt"])
      || !text(turn.ownerPrompt, 20_000) || !text(turn.finalResult, 200_000) || !iso(turn.completedAt)) return null
    turns.push({ ownerPrompt: turn.ownerPrompt, finalResult: turn.finalResult, completedAt: turn.completedAt })
  }
  return {
    schemaVersion: 1,
    kind: AGENT_SESSION_INSPECTOR_PAYLOAD_KIND,
    sessionKey: row.sessionKey as string,
    sessionId: row.sessionId as string,
    assignmentId,
    role: row.role as string,
    provider: row.provider as AgentSessionInspectorSnapshot["provider"],
    assignment: row.assignment as string,
    contextManifest,
    verificationAtCapture: row.verificationAtCapture as AgentSessionInspectorSnapshot["verificationAtCapture"],
    capturedAt: row.capturedAt as string,
    mode: row.mode as AgentSessionInspectorSnapshot["mode"],
    target,
    forkedFrom: row.forkedFrom as string | null,
    updatedAt: row.updatedAt as string,
    turns,
  }
}

export function isAgentSessionInspectorPayload(value: unknown): boolean {
  if (typeof value !== "string") return false
  if (value.startsWith('{"schemaVersion":1,"kind":"agent-session"')) return true
  try {
    const decoded = JSON.parse(value) as unknown
    return Boolean(decoded && typeof decoded === "object" && !Array.isArray(decoded)
      && (decoded as Record<string, unknown>).kind === AGENT_SESSION_INSPECTOR_PAYLOAD_KIND)
  } catch { return false }
}

export function encodeAgentSessionInspectorPayload(
  sessionKey: string,
  descriptor: DurableAgentSession,
  truth: "live" | "persisted" | "resume-unverified",
  capturedAt: string,
): string {
  const encoded = JSON.stringify({
    schemaVersion: 1,
    kind: AGENT_SESSION_INSPECTOR_PAYLOAD_KIND,
    sessionKey,
    sessionId: descriptor.sessionId,
    assignmentId: descriptor.assignmentId ?? descriptor.sessionId,
    role: descriptor.role,
    provider: descriptor.provider,
    assignment: descriptor.assignment,
    contextManifest: descriptor.contextManifest ?? null,
    verificationAtCapture: truth === "live" ? "verified" : "saved-resume-unverified",
    capturedAt,
    mode: sessionMode(descriptor),
    target: targetSnapshot(descriptor),
    forkedFrom: descriptor.forkedFrom ?? null,
    updatedAt: descriptor.updatedAt,
    turns: descriptor.completedTurns ?? [],
  } satisfies AgentSessionInspectorSnapshot)
  if (!parseAgentSessionInspectorPayload(encoded)) {
    return JSON.stringify({ schemaVersion: 1, kind: AGENT_SESSION_INSPECTOR_PAYLOAD_KIND, unavailable: true })
  }
  return encoded
}

export function agentSessionInspectorIdentity(value: Pick<AgentSessionInspectorSnapshot, "sessionKey"> | string): string {
  return JSON.stringify([typeof value === "string" ? value : value.sessionKey])
}

export function agentSessionInspectorIdFromIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null
  let decoded: unknown
  try { decoded = JSON.parse(value) } catch { return null }
  if (!Array.isArray(decoded) || decoded.length !== 1 || typeof decoded[0] !== "string") return null
  const separator = decoded[0].indexOf(":")
  if (separator <= 0) return null
  const provider = decoded[0].slice(0, separator)
  const sessionId = decoded[0].slice(separator + 1)
  if (!providers.has(provider) || !validSessionId(provider, sessionId)) return null
  return agentSessionInspectorId(decoded[0])
}

function identityToken(value: string): string {
  return [2166136261, 2246822507, 3266489909, 668265263].map((seed) => {
    let hash = seed
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
  }).join("")
}

export function agentSessionInspectorId(value: Pick<AgentSessionInspectorSnapshot, "sessionKey"> | string): string {
  return `inspector-agent-session:${identityToken(agentSessionInspectorIdentity(value))}`
}

export function isRestorableAgentSessionInspector(id: string, subject: string, payload: unknown): boolean {
  if (!/^inspector-agent-session:[0-9a-f]{32}$/.test(id)
    || !subject.startsWith(AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX)) return false
  const snapshot = parseAgentSessionInspectorPayload(payload)
  return snapshot ? id === agentSessionInspectorId(snapshot) : true
}
