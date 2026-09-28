import styles from "./preview-composition.module.css"

export type PreviewRuntimeIdentity = Readonly<{
  repositoryName: string
  revision: string
  instance: string
}>

export type ConsumedSuiteArtifact = Readonly<{
  suite: string
  repositoryKey: string
  artifactIdentity: string
  sourceRevision: string
}>

export type PendingSuiteChange = Readonly<{
  suite: string
  repositoryKey: string
  revision: string
  state: "repository-changed" | "pr-merged" | "delivery-sealed" | "artifact-produced" | "os-consumer-updated"
  detail: string
}>

export type SovereignContextIdentity = Readonly<{
  repositoryName: string
  revision: string
}>

export type PreviewCompositionProps = Readonly<{
  state: "running" | "starting" | "unverified" | "unavailable"
  runtime: PreviewRuntimeIdentity | null
  consumedArtifacts: readonly ConsumedSuiteArtifact[]
  pendingSuiteChanges?: readonly PendingSuiteChange[]
  sovereignContext: SovereignContextIdentity | null
  onDismiss?: () => void
}>

const PREVIEW_LABELS: Record<PreviewCompositionProps["state"], string> = {
  running: "Preview actually running",
  starting: "Preview starting",
  unverified: "Composition unverified",
  unavailable: "Preview unavailable",
}

const PENDING_LABELS: Record<PendingSuiteChange["state"], string> = {
  "repository-changed": "Repository changed · not assimilated",
  "pr-merged": "PR merged · not assimilated",
  "delivery-sealed": "Delivery sealed · not running",
  "artifact-produced": "Artifact produced · not assimilated",
  "os-consumer-updated": "OS consumer updated · not running",
}

export function PreviewComposition({
  state,
  runtime,
  consumedArtifacts,
  pendingSuiteChanges = [],
  sovereignContext,
  onDismiss,
}: PreviewCompositionProps) {
  return (
    <section className={styles.surface} aria-label="TerraFusion Preview composition">
      <header className={styles.header}>
        <span>
          <small>TerraFusion Preview</small>
          <strong>Runtime composition</strong>
        </span>
        <span className={styles.headerActions}>
          <span className={styles.previewState} data-state={state}>
            <i aria-hidden="true" />{PREVIEW_LABELS[state]}
          </span>
          {onDismiss ? <button type="button" onClick={onDismiss} aria-label="Dismiss Preview composition">Dismiss</button> : null}
        </span>
      </header>

      <div className={styles.body}>
        <section className={styles.runtime} role="region" aria-label="Running OS 1.0 composition">
          <h2>OS 1.0 runtime</h2>
          {runtime ? (
            <div className={styles.runtimeIdentity}>
              <span className={styles.runtimeMark} aria-hidden="true">OS</span>
              <dl>
                <div><dt>Repository</dt><dd>{runtime.repositoryName}</dd></div>
                <div><dt>Exact revision</dt><dd><code>{runtime.revision}</code></dd></div>
                <div><dt>Runtime instance</dt><dd>{runtime.instance}</dd></div>
              </dl>
            </div>
          ) : <p className={styles.empty}>No runtime identity is attached.</p>}

          <section className={styles.composition} aria-label="Suite artifacts consumed by this runtime">
            <div className={styles.sectionHeading}>
              <h3>Consumed suite composition</h3>
              <span>Evidence from the running application</span>
            </div>
            {consumedArtifacts.length > 0 ? (
              <ul aria-label="Consumed suite composition">
                {consumedArtifacts.map((artifact) => (
                  <li key={`${artifact.repositoryKey}:${artifact.artifactIdentity}`}>
                    <span className={styles.suiteName}>{artifact.suite}</span>
                    <span className={styles.consumed}>Consumed</span>
                    <code>{artifact.artifactIdentity}</code>
                    <small>Source <code>{artifact.sourceRevision}</code></small>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.empty}>No consumed suite artifact evidence is available.</p>}
          </section>
        </section>

        <aside className={styles.truthPane}>
          <section className={styles.pending} aria-label="Suite changes outside this runtime">
            <div className={styles.sectionHeading}>
              <h3>Pending suite changes</h3>
              <span>Not part of this Preview</span>
            </div>
            {pendingSuiteChanges.length > 0 ? (
              <ul aria-label="Pending suite changes">
                {pendingSuiteChanges.map((change) => (
                  <li key={`${change.repositoryKey}:${change.revision}`}>
                    <span><strong>{change.suite}</strong><small>{PENDING_LABELS[change.state]}</small></span>
                    <code>{change.revision}</code>
                    <p>{change.detail}</p>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.empty}>No pending suite change is recorded.</p>}
          </section>

          <section className={styles.sovereign} role="region" aria-label="Sovereign planning context">
            <h3>Sovereign context</h3>
            {sovereignContext ? (
              <dl>
                <div><dt>Repository</dt><dd>{sovereignContext.repositoryName}</dd></div>
                <div><dt>Exact revision</dt><dd><code>{sovereignContext.revision}</code></dd></div>
                <div><dt>Runtime dependency</dt><dd>Runtime dependency: none</dd></div>
              </dl>
            ) : <p className={styles.empty}>No Sovereign OS context is attached.</p>}
          </section>
        </aside>
      </div>
    </section>
  )
}
