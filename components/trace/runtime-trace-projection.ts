import {
  projectRuntimeExecutionQuery,
  type RuntimeExecutionQueryResult,
  type RuntimeExecutionTraceEvent,
  type RuntimeExecutionTruth,
} from "@/components/runtime/runtime-execution-model"

export interface RuntimeTraceProjection {
  id: string
  eventType: RuntimeExecutionTraceEvent["eventType"]
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

function traceProjection(event: RuntimeExecutionTraceEvent): RuntimeTraceProjection {
  const sourceCheckpoint = event.metadata.sourceCheckpointKey
    ?? (event.metadata.sourceCheckpointId === undefined
      ? null
      : String(event.metadata.sourceCheckpointId))
  return {
    id: `GEV-${event.id}`,
    eventType: event.eventType,
    provenance: {
      actor: event.actor,
      entity: `${event.entityType}:${event.entityId}`,
      sourceCheckpoint,
    },
    sequence: event.metadata.checkpointSequence,
    attempt: event.metadata.attempt,
    timestamp: event.createdAt.toISOString(),
    evidenceDigest: event.metadata.evidenceDigest ?? event.metadata.payloadDigest ?? null,
    state: event.metadata.checkpointState,
    failureClass: event.metadata.failureClass ?? null,
    disposition: event.metadata.disposition ?? null,
  }
}

export function projectRuntimeExecutionTruth(
  truth: RuntimeExecutionTruth[] | RuntimeExecutionQueryResult,
): RuntimeTraceProjection[] {
  const query = Array.isArray(truth) ? projectRuntimeExecutionQuery(truth) : truth
  return query.events
    .map(traceProjection)
    .sort((left, right) => {
      const timestampOrder = (right.timestamp ?? "").localeCompare(left.timestamp ?? "")
      if (timestampOrder !== 0) return timestampOrder
      return (right.sequence ?? -1) - (left.sequence ?? -1)
    })
}
