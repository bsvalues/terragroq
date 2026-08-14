import type { ExecutionDrilldown, ExecutionFacet, WorkbenchExecutionProjection } from "@/lib/workbench/execution-projection"

export type WorkbenchExecutionLoadState = "unselected" | "loading" | "ready" | "error"

function internalHref(drilldown: ExecutionDrilldown): string | null {
  if (drilldown.mode === "UNAVAILABLE" || !drilldown.href?.startsWith("/")) return null
  return drilldown.href
}

function sentenceCase(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`
}

function Facets({ label, items, linkLabel = "Open source" }: {
  label: string
  items: readonly ExecutionFacet[]
  linkLabel?: string
}) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--workbench-muted)]">{label}</h3>
      <ul className="mt-2 space-y-2">
        {items.map((item) => {
          const href = internalHref(item.drilldown)
          return (
            <li key={item.id} className="border-l border-[var(--workbench-hairline)] pl-3">
              <span className="block text-xs font-medium">{item.state}</span>
              {item.summary ? <span className="mt-0.5 block text-xs leading-5 text-[var(--workbench-muted)]">{item.summary}</span> : null}
              <span className="mt-1 block font-mono text-[9px] uppercase tracking-wide text-[var(--workbench-muted)]">{item.truthState} · {item.occurredAt.slice(0, 16).replace("T", " ")} UTC</span>
              {href ? <a href={href} className="workbench-focus mt-1 inline-block text-xs text-[var(--workbench-copper)]">{linkLabel}</a> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function hasExecutionRecords(projection: WorkbenchExecutionProjection): boolean {
  return projection.work.outcomes.length > 0 || projection.work.workOrders.length > 0
    || projection.agents.length > 0 || projection.attempts.length > 0
    || projection.validations.length > 0 || projection.reviews.length > 0
    || projection.remediations.length > 0 || projection.deliveries.length > 0
    || projection.events.length > 0 || projection.evidence.length > 0
    || projection.recoveries.length > 0
}

export function WorkbenchExecution({ loadState, projection = null }: {
  loadState: WorkbenchExecutionLoadState
  projection?: WorkbenchExecutionProjection | null
}) {
  const ready = loadState === "ready" && projection !== null
  return (
    <section aria-label="Selected Thread execution" className="h-full overflow-y-auto p-5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">Execution</h2>
        {ready ? <p className="font-mono text-[10px] text-[var(--workbench-muted)]">{sentenceCase(projection.truthState)} · {projection.freshness.state}</p> : null}
      </div>

      {loadState === "unselected" ? (
        <p className="mt-3 text-sm text-[var(--workbench-muted)]">Select a Thread to inspect execution.</p>
      ) : loadState === "loading" ? (
        <p role="status" className="mt-3 text-sm text-[var(--workbench-muted)]">Reading selected Thread execution…</p>
      ) : loadState === "error" ? (
        <p role="alert" className="mt-3 text-sm text-[var(--workbench-fault)]">Execution evidence could not be read. Thread context was not changed.</p>
      ) : projection === null ? (
        <p role="alert" className="mt-3 text-sm text-[var(--workbench-fault)]">Execution projection is unavailable. Thread context was not changed.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {projection.availability === "unavailable" ? <p role="status" className="text-sm text-[var(--workbench-muted)]">No exact persisted execution membership is available for this Thread.</p> : null}
          {projection.availability === "degraded" ? <p role="alert" className="text-sm text-[var(--workbench-warning)]">Execution evidence is degraded. Only the explicitly bound records below are shown.</p> : null}
          {projection.freshness.detail ? <p className="text-xs leading-5 text-[var(--workbench-muted)]">{projection.freshness.detail}</p> : null}
          {projection.availability !== "unavailable" && !hasExecutionRecords(projection) ? <p role="status" className="text-sm text-[var(--workbench-muted)]">No explicit execution records are bound to this Thread.</p> : null}

          {hasExecutionRecords(projection) ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-4">
                {projection.work.outcomes.length || projection.work.workOrders.length ? (
                  <div>
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--workbench-muted)]">Current work</h3>
                    <ul className="mt-2 space-y-2">
                      {projection.work.outcomes.map((outcome) => {
                        const href = internalHref(outcome.drilldown)
                        return <li key={outcome.id} className="text-xs"><span className="font-medium">{outcome.title}</span><span className="ml-2 text-[var(--workbench-muted)]">{outcome.state}</span>{href ? <a href={href} className="workbench-focus ml-2 text-[var(--workbench-copper)]">Open outcome</a> : null}</li>
                      })}
                      {projection.work.workOrders.map((workOrder) => {
                        const href = internalHref(workOrder.drilldown)
                        return <li key={workOrder.id} className="text-xs"><span className="font-medium">{workOrder.ref ?? `Work Order ${workOrder.id}`}</span><span className="ml-2 text-[var(--workbench-muted)]">{workOrder.state}</span>{href ? <a href={href} className="workbench-focus ml-2 text-[var(--workbench-copper)]">Open Work Order</a> : null}</li>
                      })}
                    </ul>
                  </div>
                ) : null}
                {projection.agents.length ? (
                  <div>
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--workbench-muted)]">Agents and claims</h3>
                    <ul className="mt-2 space-y-2">{projection.agents.map((agent) => <li key={agent.id} className="border-l border-[var(--workbench-hairline)] pl-3 text-xs"><span className="font-medium">{agent.agent ?? "Unknown agent"}</span><span className="ml-2 text-[var(--workbench-muted)]">{agent.state}</span>{agent.summary ? <span className="mt-1 block leading-5 text-[var(--workbench-muted)]">{agent.summary}</span> : null}</li>)}</ul>
                  </div>
                ) : null}
              </div>
              <div className="space-y-4">
                {projection.attempts.length ? (
                  <div>
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--workbench-muted)]">Attempts and checkpoints</h3>
                    <ul className="mt-2 space-y-3">{projection.attempts.map((attempt) => (
                      <li key={attempt.attempt} className="text-xs">
                        <span className="font-medium">Attempt {attempt.attempt} · {attempt.currentState ?? "unknown"}</span>
                        <span className="mt-1 block text-[var(--workbench-muted)]">{attempt.checkpoints.length} persisted checkpoint{attempt.checkpoints.length === 1 ? "" : "s"}</span>
                        {attempt.checkpoints.length ? <ul className="mt-1 space-y-1 border-l border-[var(--workbench-hairline)] pl-3">{attempt.checkpoints.map((checkpoint) => {
                          const href = internalHref(checkpoint.drilldown)
                          return <li key={checkpoint.eventId}><span>{checkpoint.detail ?? checkpoint.state}</span>{href ? <a href={href} className="workbench-focus ml-2 text-[var(--workbench-copper)]">Open checkpoint</a> : null}</li>
                        })}</ul> : null}
                      </li>
                    ))}</ul>
                  </div>
                ) : null}
                <Facets label="Tests and validation" items={projection.validations} />
                <Facets label="Reviews" items={projection.reviews} />
              </div>
              <div className="space-y-4">
                <Facets label="Remediation" items={projection.remediations} />
                <Facets label="Delivery" items={projection.deliveries} />
                <Facets label="Recovery" items={projection.recoveries} />
              </div>
              <div className="space-y-4">
                <Facets label="Persisted proof" items={projection.evidence} linkLabel="Open persisted proof" />
                <Facets label="Bounded events" items={projection.events} />
              </div>
            </div>
          ) : null}

          {projection.coverage.truncated || projection.coverage.missing.length || projection.coverage.conflicts.length ? (
            <div role="status" className="border-t border-[var(--workbench-hairline)] pt-3 text-xs leading-5 text-[var(--workbench-warning)]">
              {projection.coverage.truncated ? <p>Bounded execution history: earlier {projection.coverage.truncatedKinds.join(", ")} records may be omitted.</p> : null}
              {projection.coverage.missing.length ? <p>Missing sources: {projection.coverage.missing.join(", ")}</p> : null}
              {projection.coverage.conflicts.length ? <p>Conflicts: {projection.coverage.conflicts.join(", ")}</p> : null}
            </div>
          ) : null}
        </div>
      )}

      <p className="mt-4 border-t border-[var(--workbench-hairline)] pt-3 text-xs leading-5 text-[var(--workbench-muted)]">No governed terminal protocol is available.</p>
    </section>
  )
}
