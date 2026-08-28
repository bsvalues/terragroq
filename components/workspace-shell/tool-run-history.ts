import { findLoomOperation } from "@/lib/loom/operations"

export const MAX_TOOL_RUNS = 12
export const MAX_TOOL_RUN_HISTORY_BYTES = 131_072
export const MAX_TOOL_RUN_TRANSCRIPT_BYTES = 98_304

export type ToolOutputLine = Readonly<{ channel: "stdout" | "stderr" | "meta"; text: string }>
export type ToolRunTranscript = Readonly<{
  schemaVersion: 1
  id: string
  operationId: string
  operationLabel: string
  alias: string
  startedAt: string
  endedAt: string
  outcome: Readonly<{
    status: "completed" | "cancelled" | "interrupted"
    code: number | null
    reason: string | null
  }>
  lines: readonly ToolOutputLine[]
}>

type ToolRunEnvelope = Readonly<{ schemaVersion: 1; runs: readonly ToolRunTranscript[] }>
type ToolRunStorage = Pick<Storage, "getItem" | "setItem">
export type ToolRunHistoryLoad = Readonly<{ runs: readonly ToolRunTranscript[]; error: "TOOL_RUN_HISTORY_CORRUPT" | null }>
export type ToolRunHistoryVerdict = Readonly<{ ok: boolean; runs: readonly ToolRunTranscript[]; error: "TOOL_RUN_HISTORY_NOT_SAVED" | null }>

function record(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], error: string) {
  const expected = new Set(keys)
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !expected.has(key))) throw new Error(error)
}

function text(value: unknown, max: number, error: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\0")) throw new Error(error)
  return value
}

function iso(value: unknown, error: string): string {
  const result = text(value, 40, error)
  const parsed = Date.parse(result)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) throw new Error(error)
  return result
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function toolRunHistoryStorageKey(scope: string): string {
  if (typeof scope !== "string" || scope.length > 500 || !/^(server|browser):\S+$/.test(scope)) throw new Error("TOOL_RUN_SCOPE_INVALID")
  return `williamos:tool-runs:v1:${scope}`
}

function validateToolRunTranscriptShape(raw: unknown, enforceByteLimit: boolean): ToolRunTranscript {
  const run = record(raw, "TOOL_RUN_TRANSCRIPT_MALFORMED")
  exactKeys(run, ["schemaVersion", "id", "operationId", "operationLabel", "alias", "startedAt", "endedAt", "outcome", "lines"], "TOOL_RUN_TRANSCRIPT_UNKNOWN_KEY")
  if (run.schemaVersion !== 1) throw new Error("TOOL_RUN_TRANSCRIPT_VERSION")
  const outcome = record(run.outcome, "TOOL_RUN_OUTCOME_MALFORMED")
  exactKeys(outcome, ["status", "code", "reason"], "TOOL_RUN_OUTCOME_UNKNOWN_KEY")
  if (outcome.status !== "completed" && outcome.status !== "cancelled" && outcome.status !== "interrupted") throw new Error("TOOL_RUN_STATUS_INVALID")
  if (outcome.code !== null && !Number.isSafeInteger(outcome.code)) throw new Error("TOOL_RUN_CODE_INVALID")
  if (outcome.reason !== null && (typeof outcome.reason !== "string" || outcome.reason.length > 200 || outcome.reason.includes("\0"))) throw new Error("TOOL_RUN_REASON_INVALID")
  if (outcome.status === "completed" && (outcome.code === null || outcome.reason !== null)) throw new Error("TOOL_RUN_COMPLETION_INVALID")
  if (outcome.status === "cancelled" && (outcome.code !== null || outcome.reason !== "CANCELLED")) throw new Error("TOOL_RUN_CANCELLATION_INVALID")
  if (outcome.status === "interrupted" && (outcome.reason === "CANCELLED" || (outcome.code !== null && outcome.reason === null))) throw new Error("TOOL_RUN_INTERRUPTION_INVALID")
  if (!Array.isArray(run.lines) || run.lines.length > 256) throw new Error("TOOL_RUN_LINES_INVALID")
  const lines = run.lines.map((rawLine) => {
    const line = record(rawLine, "TOOL_RUN_LINE_MALFORMED")
    exactKeys(line, ["channel", "text"], "TOOL_RUN_LINE_UNKNOWN_KEY")
    if (line.channel !== "stdout" && line.channel !== "stderr" && line.channel !== "meta") throw new Error("TOOL_RUN_CHANNEL_INVALID")
    if (typeof line.text !== "string" || line.text.length > 16_384 || line.text.includes("\0")) throw new Error("TOOL_RUN_LINE_TEXT_INVALID")
    return { channel: line.channel, text: line.text } as ToolOutputLine
  })
  const operationId = text(run.operationId, 100, "TOOL_RUN_OPERATION_INVALID")
  const operationLabel = text(run.operationLabel, 200, "TOOL_RUN_LABEL_INVALID")
  const alias = text(run.alias, 200, "TOOL_RUN_ALIAS_INVALID")
  const operation = findLoomOperation(operationId)
  if (!operation || operation.scope !== "project" || operation.mutating || operation.label !== operationLabel || operation.terminalAlias !== alias) {
    throw new Error("TOOL_RUN_OPERATION_NOT_CANONICAL")
  }
  const transcript: ToolRunTranscript = {
    schemaVersion: 1,
    id: text(run.id, 200, "TOOL_RUN_ID_INVALID"),
    operationId,
    operationLabel,
    alias,
    startedAt: iso(run.startedAt, "TOOL_RUN_STARTED_AT_INVALID"),
    endedAt: iso(run.endedAt, "TOOL_RUN_ENDED_AT_INVALID"),
    outcome: { status: outcome.status, code: outcome.code as number | null, reason: outcome.reason as string | null },
    lines,
  }
  if (Date.parse(transcript.endedAt) < Date.parse(transcript.startedAt)) throw new Error("TOOL_RUN_TIME_INVALID")
  if (enforceByteLimit && bytes(transcript) > MAX_TOOL_RUN_TRANSCRIPT_BYTES) throw new Error("TOOL_RUN_TRANSCRIPT_TOO_LARGE")
  return transcript
}

export function validateToolRunTranscript(raw: unknown): ToolRunTranscript {
  return validateToolRunTranscriptShape(raw, true)
}

function fitToolRunTranscript(raw: unknown): ToolRunTranscript {
  const transcript = validateToolRunTranscriptShape(raw, false)
  const terminalMeta = transcript.lines.at(-1)?.channel === "meta" ? transcript.lines.at(-1)! : null
  const output = terminalMeta ? transcript.lines.slice(0, -1) : transcript.lines.slice()
  let lines = terminalMeta ? [...output, terminalMeta] : output
  while (bytes({ ...transcript, lines }) > MAX_TOOL_RUN_TRANSCRIPT_BYTES && output.length > 1) {
    output.shift()
    lines = terminalMeta ? [...output, terminalMeta] : output.slice()
  }
  return validateToolRunTranscript({ ...transcript, lines })
}

function validateEnvelope(raw: unknown): ToolRunEnvelope {
  const envelope = record(raw, "TOOL_RUN_HISTORY_MALFORMED")
  exactKeys(envelope, ["schemaVersion", "runs"], "TOOL_RUN_HISTORY_UNKNOWN_KEY")
  if (envelope.schemaVersion !== 1 || !Array.isArray(envelope.runs) || envelope.runs.length > MAX_TOOL_RUNS) throw new Error("TOOL_RUN_HISTORY_INVALID")
  const ids = new Set<string>()
  const runs = envelope.runs.map((item) => {
    const run = validateToolRunTranscript(item)
    if (ids.has(run.id)) throw new Error("TOOL_RUN_HISTORY_DUPLICATE")
    ids.add(run.id)
    return run
  })
  if (bytes({ schemaVersion: 1, runs }) > MAX_TOOL_RUN_HISTORY_BYTES) throw new Error("TOOL_RUN_HISTORY_TOO_LARGE")
  return { schemaVersion: 1, runs }
}

export function loadToolRunHistory(storage: ToolRunStorage, scope: string): ToolRunHistoryLoad {
  const key = toolRunHistoryStorageKey(scope)
  const raw = storage.getItem(key)
  if (raw === null) return { runs: [], error: null }
  try {
    return { runs: validateEnvelope(JSON.parse(raw)).runs, error: null }
  } catch {
    return { runs: [], error: "TOOL_RUN_HISTORY_CORRUPT" }
  }
}

export function persistToolRunTranscript(storage: ToolRunStorage, scope: string, rawRun: unknown): ToolRunHistoryVerdict {
  const prior = loadToolRunHistory(storage, scope)
  if (prior.error) return { ok: false, runs: prior.runs, error: "TOOL_RUN_HISTORY_NOT_SAVED" }
  const run = fitToolRunTranscript(rawRun)
  const runs = [...prior.runs.filter((item) => item.id !== run.id), run]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id))
  while (runs.length > MAX_TOOL_RUNS || bytes({ schemaVersion: 1, runs }) > MAX_TOOL_RUN_HISTORY_BYTES) runs.shift()
  if (!runs.some((item) => item.id === run.id)) return { ok: false, runs: prior.runs, error: "TOOL_RUN_HISTORY_NOT_SAVED" }
  const envelope = validateEnvelope({ schemaVersion: 1, runs })
  try {
    storage.setItem(toolRunHistoryStorageKey(scope), JSON.stringify(envelope))
    return { ok: true, runs: envelope.runs, error: null }
  } catch {
    return { ok: false, runs: prior.runs, error: "TOOL_RUN_HISTORY_NOT_SAVED" }
  }
}
