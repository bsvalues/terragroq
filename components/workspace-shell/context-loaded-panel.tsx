"use client"

import { useId } from "react"

import type {
  AssignmentContextManifest,
  AssignmentContextSource,
  RepositoryRole,
} from "@/lib/loom/assignment-context-manifest"

import styles from "./context-loaded-panel.module.css"

export type ContextLoadedPanelProps = Readonly<{
  manifest: AssignmentContextManifest
  initiallyOpen?: boolean
}>

const ROLE_LABELS: Readonly<Record<RepositoryRole, string>> = {
  "integrated-runtime": "Integrated runtime",
  "sovereign-planning-and-promotion": "Sovereign planning and promotion",
  "suite-source": "Suite source",
  "attached-source": "Attached source",
}

const SOURCE_KIND_LABELS: Readonly<Record<AssignmentContextSource["kind"], string>> = {
  instruction: "Instruction",
  "project-knowledge": "Project knowledge",
  "cross-repository-contract": "Cross-repository contract",
}

function repositoryRoleLabel(role: RepositoryRole, suite?: string): string {
  const roleLabel = ROLE_LABELS[role]
  if (role !== "suite-source" || !suite) return roleLabel
  return `${roleLabel} · ${suite.slice(0, 1).toUpperCase()}${suite.slice(1)}`
}

function repositoryCountLabel(count: number): string {
  return `${count} read-only ${count === 1 ? "reference" : "references"}`
}

function sourceCountLabel(count: number): string {
  return `${count} loaded ${count === 1 ? "source" : "sources"}`
}

export function ContextLoadedPanel({ manifest, initiallyOpen = false }: ContextLoadedPanelProps) {
  const { checkout, mutationPosture, project, sources, targetRepository, workOrder } = manifest
  const headingId = useId()
  const writePostureId = `${headingId}-write-posture`
  const referenceRepositoriesId = `${headingId}-reference-repositories`
  const requiredSourcesId = `${headingId}-required-sources`

  return (
    <details
      className={styles.panel}
      open={initiallyOpen || undefined}
      aria-label={`Context loaded for ${targetRepository.repositoryIdentity}`}
    >
      <summary className={styles.summary}>
        <span className={styles.summaryCopy}>
          <strong>Context loaded</strong>
          <small>{targetRepository.repositoryKey} · {sourceCountLabel(sources.length)}</small>
        </span>
        <span className={styles.evidenceLabel}>Evidence only</span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>

      <div className={styles.body}>
        <p className={styles.authorityBoundary}>Context evidence · does not grant authority.</p>

        <dl className={styles.facts}>
          <div>
            <dt>Project</dt>
            <dd>{project.name} · {project.key} · Project {project.id}</dd>
          </div>
          {workOrder ? (
            <>
              <div>
                <dt>Active Work Order</dt>
                <dd>{workOrder.ref ?? "Unnumbered"} · Work Order {workOrder.id}</dd>
              </div>
              <div>
                <dt>Work Order content</dt>
                <dd><code>{workOrder.contentHash}</code></dd>
              </div>
            </>
          ) : null}
          <div>
            <dt>Target repository</dt>
            <dd><code>{targetRepository.repositoryIdentity}</code></dd>
          </div>
          <div>
            <dt>Repository role</dt>
            <dd>{repositoryRoleLabel(targetRepository.role, targetRepository.suite)}</dd>
          </div>
          <div>
            <dt>Verified mount</dt>
            <dd>{checkout.repositoryMountKey} · {checkout.nodeIdentity}</dd>
          </div>
          <div>
            <dt>Worktree</dt>
            <dd><code>{checkout.worktreeKey}</code></dd>
          </div>
          <div>
            <dt>Base revision</dt>
            <dd><code>{checkout.baseRevision}</code></dd>
          </div>
          <div>
            <dt>Authority effect</dt>
            <dd><code>{manifest.authorityEffect}</code></dd>
          </div>
        </dl>

        <section className={styles.section} aria-labelledby={writePostureId}>
          <header className={styles.sectionHeader}>
            <h3 id={writePostureId}>Write posture</h3>
            <span>write under exact assignment reservation</span>
          </header>
          <ul className={styles.pathList} aria-label="Exact writable paths">
            {mutationPosture.target.writablePaths.map((path) => (
              <li key={path}><code>{path}</code></li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby={referenceRepositoriesId}>
          <header className={styles.sectionHeader}>
            <h3 id={referenceRepositoriesId}>Reference repositories</h3>
            <span>{repositoryCountLabel(mutationPosture.references.length)}</span>
          </header>
          {mutationPosture.references.length > 0 ? (
            <ul className={styles.referenceList} aria-label="Read-only reference repositories">
              {mutationPosture.references.map((repository) => (
                <li key={repository.repositoryResourceId}>
                  <span className={styles.lineHeading}>
                    <code>{repository.repositoryIdentity}</code>
                    <span className={styles.readOnly}>Read only</span>
                  </span>
                  <span className={styles.lineMeta}>
                    {repositoryRoleLabel(repository.role, repository.suite)}
                    <code>{repository.revisionIdentity}</code>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyTruth}>No read-only reference repositories were loaded.</p>
          )}
        </section>

        <section className={styles.section} aria-labelledby={requiredSourcesId}>
          <header className={styles.sectionHeader}>
            <h3 id={requiredSourcesId}>Required loaded sources</h3>
            <span>{sourceCountLabel(sources.length)}</span>
          </header>
          <ul className={styles.sourceList} aria-label="Required loaded sources">
            {sources.map((source) => (
              <li key={`${source.repositoryResourceId}:${source.kind}:${source.path}:${source.blobHash}`}>
                <span className={styles.sourceLead}>
                  <span>{SOURCE_KIND_LABELS[source.kind]}</span>
                  <code>{source.repositoryKey}</code>
                </span>
                <code className={styles.sourcePath}>{source.path}</code>
                <span className={styles.blobIdentity}>
                  <span>Blob</span>
                  <code>{source.blobHash}</code>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  )
}
