import { createHash } from "node:crypto"
import { Activity, Database, ShieldCheck, TriangleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"

const CHECKPOINT_EVENT = "HERMES_RUNTIME_CHECKPOINT"
const FAILURE_EVAL_EVENT = "HERMES_RUNTIME_FAILURE_EVAL"
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,159}$/
const SAFE_DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/i

type RuntimeEventType = typeof CHECKPOINT_EVENT | typeof FAILURE_EVAL_EVENT

export interface RuntimeTraceProjection {
  id: string
  eventType: RuntimeEventType
  provenance: {
    actor: string
    entity: string
    sourceCheckpoint: string | null
  }
  sequence: number | null
  attempt: number | null
  timestamp: string | null
  evidenceDigest: string | null
  state: string | null
  failureClass: string | null
  disposition: string | null
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : null
}

function safeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function safeTimestamp(value: unknown): string | null {
  const date = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function safeDigest(value: unknown): string | null {
  return typeof value === "string" && SAFE_DIGEST.test(value) ? value.toLowerCase() : null
}

function projectedEvidenceDigest(value: unknown): string | null {
  const evidence = objectValue(value)
  const prNumber = safeInteger(evidence.prNumber)
  const commitFields = ["commit", "priorHeadRefOid", "headRefOid", "mergeSha"]
    .map((key) => evidence[key])
    .filter((entry): entry is string => typeof entry === "string" && /^[a-f0-9]{40,64}$/i.test(entry))
    .map((entry) => entry.toLowerCase())
  if (prNumber === null && commitFields.length === 0) return null
  return createHash("sha256")
    .update(JSON.stringify({ prNumber, commits: commitFields }))
    .digest("hex")
}

function executionCandidates(value: unknown): Array<{ value: unknown; eventType: RuntimeEventType }> {
  const execution = objectValue(value)
  if (!Array.isArray(execution.attempts)) return []
  const entityId = safeIdentifier(execution.workOrderRef)
  const candidates: Array<{ value: unknown; eventType: RuntimeEventType }> = []

  for (const attemptValue of execution.attempts) {
    const attempt = objectValue(attemptValue)
    if (Array.isArray(attempt.checkpoints)) {
      for (const checkpointValue of attempt.checkpoints) {
        const checkpoint = objectValue(checkpointValue)
        candidates.push({
          eventType: CHECKPOINT_EVENT,
          value: {
            ...checkpoint,
            id: checkpoint.eventId,
            entityType: "work_order",
            entityId,
            actor: "hermes-codex-bridge",
            createdAt: checkpoint.recordedAt,
            checkpointSequence: checkpoint.sequence,
            checkpointState: checkpoint.state,
            evidenceDigest: projectedEvidenceDigest(checkpoint.evidence),
          },
        })
      }
    }
    if (Array.isArray(attempt.failureEvaluations)) {
      for (const failureValue of attempt.failureEvaluations) {
        const failure = objectValue(failureValue)
        const checkpoint = Array.isArray(attempt.checkpoints)
          ? attempt.checkpoints
            .map(objectValue)
            .find((candidate) => safeInteger(candidate.sequence) === safeInteger(failure.sequence))
          : undefined
        candidates.push({
          eventType: FAILURE_EVAL_EVENT,
          value: {
            ...failure,
            id: failure.eventId,
            entityType: "work_order",
            entityId,
            actor: "hermes-codex-bridge",
            createdAt: failure.recordedAt,
            checkpointSequence: failure.sequence,
            state: failure.checkpointState,
            evidenceDigest: projectedEvidenceDigest(checkpoint?.evidence),
          },
        })
      }
    }
  }
  return candidates
}

function eventCandidates(truth: unknown): Array<{ value: unknown; eventType?: RuntimeEventType }> {
  if (Array.isArray(truth)) {
    return truth.flatMap((value) => {
      const projected = executionCandidates(value)
      return projected.length > 0 ? projected : [{ value }]
    })
  }

  const root = objectValue(truth)
  const candidates: Array<{ value: unknown; eventType?: RuntimeEventType }> = []
  for (const key of ["events", "records", "runtimeEvents"]) {
    if (Array.isArray(root[key])) {
      candidates.push(...(root[key] as unknown[]).map((value) => ({ value })))
    }
  }
  if (Array.isArray(root.checkpoints)) {
    candidates.push(...root.checkpoints.map(
      (value): { value: unknown; eventType: RuntimeEventType } => ({ value, eventType: CHECKPOINT_EVENT }),
    ))
  }
  if (Array.isArray(root.failureEvals)) {
    candidates.push(...root.failureEvals.map(
      (value): { value: unknown; eventType: RuntimeEventType } => ({ value, eventType: FAILURE_EVAL_EVENT }),
    ))
  }
  if (Array.isArray(root.failureEvaluations)) {
    candidates.push(...root.failureEvaluations.map(
      (value): { value: unknown; eventType: RuntimeEventType } => ({ value, eventType: FAILURE_EVAL_EVENT }),
    ))
  }
  return candidates
}

function projectEvent(
  value: unknown,
  fallbackEventType?: RuntimeEventType,
): RuntimeTraceProjection | null {
  const event = objectValue(value)
  const metadata = objectValue(event.metadata)
  const provenance = objectValue(event.provenance)
  const eventType = safeIdentifier(event.eventType ?? event.type) ?? fallbackEventType
  if (eventType !== CHECKPOINT_EVENT && eventType !== FAILURE_EVAL_EVENT) return null

  const actor = safeIdentifier(event.actor ?? provenance.actor ?? event.source) ?? "hermes-codex-bridge"
  const entityType = safeIdentifier(event.entityType ?? provenance.entityType) ?? "work_order"
  const entityId = safeIdentifier(event.entityId ?? provenance.entityId ?? metadata.workOrderRef)
  const eventId = safeInteger(event.id)
  const sourceCheckpointValue = event.sourceCheckpointId
    ?? provenance.sourceCheckpoint
    ?? metadata.sourceCheckpointId
    ?? metadata.sourceCheckpointKey
  const sourceCheckpoint = safeIdentifier(sourceCheckpointValue)
    ?? (safeInteger(sourceCheckpointValue) !== null ? String(safeInteger(sourceCheckpointValue)) : null)

  return {
    id: safeIdentifier(event.ref)
      ?? (eventId !== null ? `GEV-${eventId}` : `${eventType}-${safeInteger(metadata.checkpointSequence) ?? 0}`),
    eventType,
    provenance: {
      actor,
      entity: entityId ? `${entityType}:${entityId}` : entityType,
      sourceCheckpoint,
    },
    sequence: safeInteger(event.sequence ?? event.checkpointSequence ?? metadata.checkpointSequence),
    attempt: safeInteger(event.attempt ?? metadata.attempt),
    timestamp: safeTimestamp(event.timestamp ?? event.createdAt ?? metadata.recordedAt),
    evidenceDigest: safeDigest(
      event.evidenceDigest
        ?? event.payloadDigest
        ?? metadata.evidenceDigest
        ?? metadata.payloadDigest,
    ),
    state: safeIdentifier(event.state ?? event.checkpointState ?? metadata.checkpointState),
    failureClass: safeIdentifier(event.failureClass ?? metadata.failureClass),
    disposition: safeIdentifier(event.disposition ?? metadata.disposition),
  }
}

export function projectRuntimeExecutionTruth(truth: unknown): RuntimeTraceProjection[] {
  const seen = new Set<string>()
  return eventCandidates(truth)
    .map(({ value, eventType }) => projectEvent(value, eventType))
    .filter((record): record is RuntimeTraceProjection => {
      if (!record) return false
      const key = `${record.eventType}:${record.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => {
      const timestampOrder = (right.timestamp ?? "").localeCompare(left.timestamp ?? "")
      if (timestampOrder !== 0) return timestampOrder
      return (right.sequence ?? -1) - (left.sequence ?? -1)
    })
}

export function RuntimeTracePanel({ truth }: { truth: unknown }) {
  const records = projectRuntimeExecutionTruth(truth)
  const checkpoints = records.filter((record) => record.eventType === CHECKPOINT_EVENT)
  const failureEvals = records.filter((record) => record.eventType === FAILURE_EVAL_EVENT)

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-success" aria-hidden />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Persisted runtime trace
            </p>
          </div>
          <h2 className="mt-2 text-base font-semibold">Hermes execution truth</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Read-only projections from persisted runtime governance events. No evaluator, replay,
            command, or mutation is available from this surface.
          </p>
        </div>
        <Badge variant="outline">read-only persisted truth</Badge>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <RuntimeEventList
          title="Runtime checkpoints"
          eventType={CHECKPOINT_EVENT}
          records={checkpoints}
          icon={Database}
          emptyText="No persisted Hermes runtime checkpoints were returned."
        />
        <RuntimeEventList
          title="Failure evaluations"
          eventType={FAILURE_EVAL_EVENT}
          records={failureEvals}
          icon={TriangleAlert}
          emptyText="No persisted Hermes runtime failure evaluations were returned."
        />
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        Only provenance, sequence, attempt, timestamp, state classification, and validated evidence
        digests are projected. Raw metadata and checkpoint detail are not rendered.
      </div>
    </section>
  )
}

function RuntimeEventList({
  title,
  eventType,
  records,
  icon: Icon,
  emptyText,
}: {
  title: string
  eventType: RuntimeEventType
  records: RuntimeTraceProjection[]
  icon: typeof Database
  emptyText: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant="outline">{records.length}</Badge>
      </div>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{eventType}</p>

      <div className="mt-3 grid gap-3">
        {records.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : records.map((record) => (
          <article key={`${record.eventType}-${record.id}`} className="rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs font-medium">{record.id}</p>
              <Badge variant="outline">
                {record.state ?? record.failureClass ?? "recorded"}
              </Badge>
            </div>
            <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
              <RuntimeField label="Provenance" value={`${record.provenance.actor} · ${record.provenance.entity}`} />
              <RuntimeField label="Timestamp" value={formatTimestamp(record.timestamp)} />
              <RuntimeField label="Sequence" value={formatNumber(record.sequence)} />
              <RuntimeField label="Attempt" value={formatNumber(record.attempt)} />
              <RuntimeField label="Evidence digest" value={record.evidenceDigest ?? "not recorded"} mono />
              <RuntimeField
                label={record.eventType === FAILURE_EVAL_EVENT ? "Disposition" : "Checkpoint state"}
                value={record.disposition ?? record.state ?? "not recorded"}
              />
              {record.provenance.sourceCheckpoint ? (
                <RuntimeField label="Source checkpoint" value={record.provenance.sourceCheckpoint} mono />
              ) : null}
            </dl>
          </article>
        ))}
      </div>
    </div>
  )
}

function RuntimeField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-all text-xs text-muted-foreground ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  )
}

function formatNumber(value: number | null) {
  return value === null ? "not recorded" : String(value)
}

function formatTimestamp(value: string | null) {
  if (!value) return "not recorded"
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value))
}
