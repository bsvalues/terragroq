import type { ProjectedWorldWorkerSession } from "@/lib/environment/world-execution"
import type { WorldEvidence, WorldExecutionState, WorldSpine } from "@/lib/environment/working-world"

export const EXECUTION_ASSIGNMENT_INSPECTOR_KIND = "execution-assignment"
export const MAX_EXECUTION_ASSIGNMENT_PAYLOAD_BYTES = 200_000

const encoder = new TextEncoder()
const executionStates = new Set<WorldExecutionState>([
  "idle", "authorized", "acquired", "implementing", "validating", "reviewing", "remediating",
  "complete", "blocked",
])

export type ExecutionAssignmentInspectorSnapshot = Readonly<{
  schemaVersion: 1
  kind: typeof EXECUTION_ASSIGNMENT_INSPECTOR_KIND
  worldId: string
  workOrderId: number
  outcomeKey: string
  outcomeTitle: string
  role: "HERMES" | "Executor"
  providerLabel: string
  assignee: string
  agent: string | null
  assignment: string
  status: WorldExecutionState
  observedAt: string
  evidenceProjection: "latest-50"
  evidence: readonly WorldEvidence[]
}>

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function isoTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function boundedEvidenceText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !/[\u0000\u007f]/.test(value)
}

function parseEvidence(value: unknown): readonly WorldEvidence[] | null {
  if (!Array.isArray(value) || value.length > 50) return null
  const parsed: WorldEvidence[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
    const row = entry as Record<string, unknown>
    if (Object.keys(row).sort().join("|") !== "at|detail|kind|result"
      || !boundedText(row.kind, 200) || !boundedEvidenceText(row.detail, 2_000)
      || row.result !== null && !boundedEvidenceText(row.result, 2_000) || !isoTime(row.at)) return null
    parsed.push({ kind: row.kind, detail: row.detail, result: row.result as string | null, at: row.at })
  }
  return parsed
}

export function parseExecutionAssignmentInspectorPayload(value: unknown): ExecutionAssignmentInspectorSnapshot | null {
  if (typeof value !== "string" || value.length > MAX_EXECUTION_ASSIGNMENT_PAYLOAD_BYTES
    || encoder.encode(value).byteLength > MAX_EXECUTION_ASSIGNMENT_PAYLOAD_BYTES) return null
  let decoded: unknown
  try { decoded = JSON.parse(value) } catch { return null }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null
  const row = decoded as Record<string, unknown>
  if (Object.keys(row).sort().join("|") !== "agent|assignee|assignment|evidence|evidenceProjection|kind|observedAt|outcomeKey|outcomeTitle|providerLabel|role|schemaVersion|status|workOrderId|worldId"
    || row.schemaVersion !== 1 || row.kind !== EXECUTION_ASSIGNMENT_INSPECTOR_KIND
    || !boundedText(row.worldId, 200) || !Number.isSafeInteger(row.workOrderId) || (row.workOrderId as number) <= 0
    || !boundedText(row.outcomeKey, 300) || !boundedText(row.outcomeTitle, 500)
    || row.role !== "HERMES" && row.role !== "Executor" || !boundedText(row.providerLabel, 200)
    || !boundedText(row.assignee, 200) || row.agent !== null && !boundedText(row.agent, 200)
    || !boundedText(row.assignment, 2_000) || !executionStates.has(row.status as WorldExecutionState)
    || row.evidenceProjection !== "latest-50"
    || !isoTime(row.observedAt)) return null
  const evidence = parseEvidence(row.evidence)
  if (!evidence) return null
  const isHermes = row.assignee === "hermes-codex-bridge" && row.agent === "codex"
  if ((row.role === "HERMES") !== isHermes || isHermes && row.providerLabel !== "Local execution") return null
  return { ...row, evidence } as ExecutionAssignmentInspectorSnapshot
}

export function encodeExecutionAssignmentInspectorPayload(
  session: ProjectedWorldWorkerSession,
  spine: WorldSpine,
): string {
  if (session.worldId.length === 0 || session.workOrderId !== spine.workOrderId
    || !spine.outcomeKey || !spine.outcomeTitle) throw new Error("EXECUTION_ASSIGNMENT_CONTEXT_MISMATCH")
  const encoded = JSON.stringify({
    schemaVersion: 1,
    kind: EXECUTION_ASSIGNMENT_INSPECTOR_KIND,
    worldId: session.worldId,
    workOrderId: session.workOrderId,
    outcomeKey: spine.outcomeKey,
    outcomeTitle: spine.outcomeTitle,
    role: session.role,
    providerLabel: session.providerLabel,
    assignee: session.assignee,
    agent: session.agent,
    assignment: session.assignment,
    status: session.status,
    observedAt: session.observedAt,
    evidenceProjection: "latest-50",
    evidence: spine.evidence.slice(-50),
  } satisfies ExecutionAssignmentInspectorSnapshot)
  if (!parseExecutionAssignmentInspectorPayload(encoded)) throw new Error("EXECUTION_ASSIGNMENT_SNAPSHOT_INVALID")
  return encoded
}

export function executionAssignmentInspectorIdentity(
  value: Pick<ExecutionAssignmentInspectorSnapshot, "worldId" | "workOrderId">,
): string {
  return JSON.stringify([value.worldId, value.workOrderId])
}
