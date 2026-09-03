"use client"

import type { RepositoryShelfRepository } from "./repository-shelf"
import styles from "./repository-map-surface.module.css"

export type RepositoryRelationshipKind = "consumed-by" | "informs" | "produces" | "promotes-to"
export type RepositoryRelationshipStatus = "ready" | "waiting" | "blocked" | "reference"

export type RepositoryRelationship = Readonly<{
  id: string
  fromRepositoryKey: string
  toRepositoryKey: string
  label: string
  kind: RepositoryRelationshipKind
  status: RepositoryRelationshipStatus
  detail: string
}>

export type RepositoryMapSurfaceProps = Readonly<{
  repositories: readonly RepositoryShelfRepository[]
  relationships: readonly RepositoryRelationship[]
  onSelectRepository?: (repositoryKey: string) => void
  onDismiss?: () => void
}>

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("-", " ")
}

function roleCopy(repository: RepositoryShelfRepository): Readonly<{ title: string; detail: string }> {
  if (repository.role === "integrated-runtime") return { title: "Integrated runtime", detail: "Runnable · Preview source" }
  if (repository.role === "sovereign-planning-and-promotion") return { title: "Planning and promotion", detail: "Non-runnable · No Preview" }
  if (repository.role === "attached-source") return { title: "Attached reference", detail: "No Preview" }
  return { title: `${repository.suite ?? repository.name} suite`, detail: repository.preview === "assimilated" ? "Assimilated" : "Not assimilated" }
}

function mountStatus(repository: RepositoryShelfRepository): string {
  if (repository.mounts.length === 0) return "No mount"
  if (repository.mounts.some((mount) => mount.status === "unavailable")) return "Unavailable"
  if (repository.mounts.some((mount) => mount.status === "missing")) return "Missing"
  if (repository.mounts.some((mount) => mount.status === "stale")) return "Stale"
  return "Ready"
}

function repositoryOrder(repository: RepositoryShelfRepository): number {
  if (repository.role === "integrated-runtime") return 0
  if (repository.role === "sovereign-planning-and-promotion") return 1
  if (repository.role === "suite-source") return 2
  return 3
}

export function RepositoryMapSurface({ repositories, relationships, onSelectRepository, onDismiss }: RepositoryMapSurfaceProps) {
  const coreRepositories = repositories.filter((repository) => repository.role !== "attached-source")
  const attachedRepositories = repositories.filter((repository) => repository.role === "attached-source")
  const sortedRepositories = [...repositories].sort((left, right) => repositoryOrder(left) - repositoryOrder(right))
  const byKey = new Map(repositories.map((repository) => [repository.repositoryKey, repository]))

  return (
    <section className={styles.map} role="region" aria-label="Repository map">
      <header className={styles.header}>
        <span>
          <strong>Source relationships</strong>
          <small>{pluralize(coreRepositories.length, "Core Seven repository", "Core Seven repositories")} · {pluralize(attachedRepositories.length, "attached source")}</small>
        </span>
        <p>One TerraFusion Project. Independent source and delivery boundaries.</p>
        {onDismiss ? <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss Repository Map">Dismiss</button> : null}
      </header>

      <div className={styles.body}>
        <div className={styles.repositories} aria-label="Repository sources">
          {sortedRepositories.map((repository) => {
            const role = roleCopy(repository)
            const firstAgent = repository.agents[0]
            return (
              <button
                key={repository.repositoryKey}
                type="button"
                className={styles.repositoryNode}
                data-role={repository.role}
                data-active={repository.active || undefined}
                onClick={() => onSelectRepository?.(repository.repositoryKey)}
                aria-label={`Repository ${repository.name}, ${role.title}, ${role.detail}${repository.readOnly ? ", read only" : ""}`}
              >
                <span className={styles.nodeRail} aria-hidden="true" />
                <span className={styles.nodeCopy}>
                  <span className={styles.nodeHeading}>
                    <strong>{repository.name}</strong>
                    {repository.readOnly ? <small>Read only</small> : null}
                  </span>
                  <span>{role.title}</span>
                  <small>{role.detail}</small>
                </span>
                <span className={styles.nodeState}>
                  <strong data-status={mountStatus(repository).toLowerCase()}>{mountStatus(repository)}</strong>
                  {firstAgent ? <span>{firstAgent.name} · {firstAgent.activity}</span> : <span>No active agent</span>}
                  {repository.agents.length > 1 ? <small>+{repository.agents.length - 1} more</small> : null}
                </span>
              </button>
            )
          })}
        </div>

        <div className={styles.relationships}>
          <div className={styles.relationshipHeading}>
            <h3>Integration path</h3>
            <span>Evidence, not inferred proximity</span>
          </div>
          {relationships.length === 0 ? (
            <p className={styles.emptyTruth}>No repository relationship evidence is available.</p>
          ) : (
            <ol className={styles.relationshipList}>
              {relationships.map((relationship) => {
                const from = byKey.get(relationship.fromRepositoryKey)
                const to = byKey.get(relationship.toRepositoryKey)
                if (!from || !to) return null
                const relationLabel = relationship.kind === "consumed-by"
                  ? "consumed by"
                  : relationship.kind.replaceAll("-", " ")
                return (
                  <li
                    key={relationship.id}
                    className={styles.relationship}
                    data-status={relationship.status}
                    aria-label={`${from.name} ${relationLabel} ${to.name}`}
                  >
                    <span className={styles.flow} aria-hidden="true">
                      <i />
                      <b>⌄</b>
                    </span>
                    <span className={styles.relationshipCopy}>
                      <span className={styles.relationshipTitle}>
                        <strong>{relationship.label}</strong>
                        <small>{titleCase(relationship.status)}</small>
                      </span>
                      <span>{from.name} <em>{relationLabel}</em> {to.name}</span>
                      <p>{relationship.detail}</p>
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectRepository?.(to.repositoryKey)}
                      aria-label={`Focus ${to.name} from ${relationship.label}`}
                    >
                      Focus target
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}
