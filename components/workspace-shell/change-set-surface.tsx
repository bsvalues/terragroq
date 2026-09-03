"use client"

import styles from "./change-set-surface.module.css"

export type ChangeSetDeliveryState =
  | "work-active"
  | "evidence-pending"
  | "delivery-sealed"
  | "repository-changed"
  | "pr-merged"
  | "artifact-produced"
  | "os-consumer-updated"
  | "artifact-assimilated"
  | "preview-running"

export type ChangeSetEvidenceStatus = "pending" | "running" | "passed" | "failed" | "approved" | "changes-requested"

export type ChangeSetDeliveryUnit = Readonly<{
  id: string
  repositoryKey: string
  repositoryName: string
  repositoryRole: string
  branch: string | null
  revision: string | null
  state: ChangeSetDeliveryState
  pullRequest?: Readonly<{
    number: number
    status: "recorded" | "draft" | "open" | "merged" | "closed"
    url?: string
  }>
  tests: Readonly<{ status: ChangeSetEvidenceStatus; label: string }>
  review: Readonly<{ status: ChangeSetEvidenceStatus; label: string }>
  produces?: string
  consumes?: readonly string[]
  dependsOn?: readonly string[]
  limitations?: readonly string[]
}>

export type ChangeSetPreviewState = Readonly<{
  state: "waiting" | "running" | "accepted" | "blocked"
  label: string
}>

export type ChangeSetSurfaceProps = Readonly<{
  outcome: string
  units: readonly ChangeSetDeliveryUnit[]
  preview?: ChangeSetPreviewState
  onSelectRepository?: (repositoryKey: string) => void
  onDismiss?: () => void
}>

const STATE_LABELS: Record<ChangeSetDeliveryState, string> = {
  "work-active": "Work in progress",
  "evidence-pending": "Delivery evidence pending",
  "delivery-sealed": "Delivery sealed",
  "repository-changed": "Repository changed",
  "pr-merged": "PR merged",
  "artifact-produced": "Artifact produced",
  "os-consumer-updated": "OS consumer updated",
  "artifact-assimilated": "Artifact assimilated",
  "preview-running": "Preview actually running",
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("-", " ")
}

function PullRequestLink({ pullRequest }: Readonly<{ pullRequest: NonNullable<ChangeSetDeliveryUnit["pullRequest"]> }>) {
  return (
    <a
      className={styles.pullRequest}
      href={pullRequest.url ?? `#pr-${pullRequest.number}`}
      aria-label={`PR #${pullRequest.number} · ${titleCase(pullRequest.status)}`}
    >
      <span>PR #{pullRequest.number}</span>
      <strong data-status={pullRequest.status}>{titleCase(pullRequest.status)}</strong>
    </a>
  )
}

function DeliveryUnit({
  unit,
  onSelectRepository,
}: Readonly<{
  unit: ChangeSetDeliveryUnit
  onSelectRepository?: (repositoryKey: string) => void
}>) {
  return (
    <li
      className={styles.deliveryUnit}
      data-state={unit.state}
      aria-label={`${unit.repositoryName} delivery`}
    >
      <span className={styles.stateRail} aria-hidden="true" />
      <div className={styles.deliveryBody}>
        <div className={styles.deliveryHeading}>
          <span>
            <strong>{unit.repositoryName}</strong>
            <small>{unit.repositoryRole}</small>
          </span>
          <span className={styles.state} data-state={unit.state}>{STATE_LABELS[unit.state]}</span>
        </div>

        <dl className={styles.identity}>
          <div><dt>Branch</dt><dd>{unit.branch ?? "Not recorded"}</dd></div>
          <div><dt>Revision</dt><dd>{unit.revision ? <code>{unit.revision}</code> : "Not recorded"}</dd></div>
        </dl>

        <div className={styles.evidence}>
          {unit.pullRequest ? <PullRequestLink pullRequest={unit.pullRequest} /> : <span className={styles.noPr}>No PR recorded</span>}
          <span data-status={unit.tests.status}><i aria-hidden="true" />{unit.tests.label}</span>
          <span data-status={unit.review.status}><i aria-hidden="true" />{unit.review.label}</span>
        </div>

        {unit.produces || (unit.consumes?.length ?? 0) > 0 ? (
          <div className={styles.contracts}>
            {unit.produces ? <span><small>Produces</small><code>{unit.produces}</code></span> : null}
            {unit.consumes?.map((identity) => <span key={identity}><small>Consumes</small><code>{identity}</code></span>)}
          </div>
        ) : null}
        {(unit.limitations?.length ?? 0) > 0 ? (
          <ul className={styles.limitations} aria-label={`${unit.repositoryName} limitations`}>
            {unit.limitations?.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        ) : null}
      </div>

      {onSelectRepository ? (
        <button
          type="button"
          className={styles.openDelivery}
          onClick={() => onSelectRepository(unit.repositoryKey)}
          aria-label={`Open ${unit.repositoryName} delivery`}
        >
          Open
        </button>
      ) : null}
    </li>
  )
}

function DependencyFlow({ units }: Readonly<{ units: readonly ChangeSetDeliveryUnit[] }>) {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const dependencies = units.flatMap((consumer) => (consumer.dependsOn ?? []).flatMap((producerId) => {
    const producer = byId.get(producerId)
    if (!producer) return []
    const artifact = producer.produces && consumer.consumes?.includes(producer.produces)
      ? producer.produces
      : producer.produces ?? consumer.consumes?.[0]
    if (!artifact) return []
    return [{ producer, consumer, artifact }]
  }))

  if (dependencies.length === 0) return null

  return (
    <section className={styles.dependencies} aria-label="Cross-repository dependencies">
      <h3>Delivery dependencies</h3>
      <ul>
        {dependencies.map(({ producer, consumer, artifact }) => (
          <li
            key={`${producer.id}:${consumer.id}:${artifact}`}
            aria-label={`${producer.repositoryName} produces ${artifact} for ${consumer.repositoryName}`}
          >
            <span className={styles.dependencyRepository}>{producer.repositoryName}</span>
            <span className={styles.dependencyState}>{STATE_LABELS[producer.state]}</span>
            <span className={styles.flowLine} aria-hidden="true"><i /><b>↓</b></span>
            <code>{artifact}</code>
            <span className={styles.flowLine} aria-hidden="true"><i /><b>↓</b></span>
            <span className={styles.dependencyRepository}>{consumer.repositoryName}</span>
            <span className={styles.dependencyState}>{STATE_LABELS[consumer.state]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ChangeSetSurface({ outcome, units, preview, limitations = [], onSelectRepository, onDismiss }: ChangeSetSurfaceProps & Readonly<{ limitations?: readonly string[] }>) {
  const repositoryCount = new Set(units.map((unit) => unit.repositoryKey)).size
  return (
    <section className={styles.surface} role="region" aria-label={`Change set for ${outcome}`}>
      <header className={styles.header}>
        <span>
          <small>Change set</small>
          <strong>{outcome}</strong>
        </span>
        <span className={styles.headerActions}>
          <p>{repositoryCount} {repositoryCount === 1 ? "repository" : "repositories"} · {units.length} separate Git {units.length === 1 ? "delivery" : "deliveries"}</p>
          {onDismiss ? <button type="button" onClick={onDismiss} aria-label="Dismiss Change Set">Dismiss</button> : null}
        </span>
      </header>

      <div className={styles.body}>
        <section className={styles.deliveries} aria-label="Repository deliveries">
          <div className={styles.sectionHeading}>
            <h2>Repository deliveries</h2>
            <span>Each branch, diff, test, review, and PR remains independent.</span>
          </div>
          {units.length > 0 ? (
            <ol>
              {units.map((unit) => (
                <DeliveryUnit key={unit.id} unit={unit} onSelectRepository={onSelectRepository} />
              ))}
            </ol>
          ) : <p className={styles.empty}>No repository delivery is recorded for this outcome.</p>}
        </section>

        <aside className={styles.flowPane} aria-label="Change set fan-in">
          <DependencyFlow units={units} />
          {preview ? (
            <section className={styles.previewGate} data-state={preview.state} aria-label="Preview acceptance state">
              <span aria-hidden="true" />
              <div><small>Integrated Preview</small><strong>{preview.label}</strong></div>
            </section>
          ) : null}
        </aside>
      </div>
      {limitations.length > 0 ? (
        <footer className={styles.limitations} aria-label="Change set limitations">
          {limitations.map((limitation) => <span key={limitation}>{limitation}</span>)}
        </footer>
      ) : null}
    </section>
  )
}
