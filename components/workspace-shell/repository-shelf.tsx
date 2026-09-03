"use client"

import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"

import styles from "./repository-shelf.module.css"

export type RepositoryRole =
  | "integrated-runtime"
  | "sovereign-planning-and-promotion"
  | "suite-source"
  | "attached-source"

export type RepositoryMountStatus = "ready" | "stale" | "missing" | "unavailable"
export type RepositoryCleanliness = "clean" | "modified" | "unknown"
export type RepositoryPreviewState = "source" | "assimilated" | "not-assimilated" | "none" | "unavailable"

export type RepositoryMountView = Readonly<{
  id: string
  repositoryMountId?: number
  node: string
  label: string
  branch: string
  revision: string
  status: RepositoryMountStatus
  cleanliness: RepositoryCleanliness
  worktreeId?: string
}>

export type RepositoryAgentView = Readonly<{
  id: string
  name: string
  role: string
  activity: string
  state: "working" | "reviewing" | "waiting" | "blocked"
}>

export type RepositoryShelfEntry = Readonly<{
  id: string
  label: string
  kind: "file" | "directory"
  changed?: boolean
  reservedByAgentId?: string
}>

export type RepositoryShelfRepository = Readonly<{
  /** Stable catalog identity; deliberately separate from database, mount, and worktree ids. */
  repositoryKey: string
  repositoryResourceId?: number
  name: string
  canonicalIdentity: string
  role: RepositoryRole
  suite?: string
  attachmentReason?: string
  workingSet: boolean
  active: boolean
  readOnly: boolean
  preview: RepositoryPreviewState
  mounts: readonly RepositoryMountView[]
  entries: readonly RepositoryShelfEntry[]
  agents: readonly RepositoryAgentView[]
}>

type ShelfView = "working-set" | "core-seven" | "attached-sources"

export type RepositoryShelfProps = Readonly<{
  repositories: readonly RepositoryShelfRepository[]
  projectKey?: string
  initialView?: ShelfView
  onSelectRepository?: (repositoryKey: string) => void
  onOpenEntry?: (repositoryKey: string, entryId: string) => void
  onViewChange?: (view: ShelfView) => void
}>

type WorkingSetSearchResult = Readonly<{
  repositoryKey: string
  repositoryIdentity: string
  repositoryMountKey: string
  observedRevision: string
  path: string
  line: number
  excerpt: string
}>

type WorkingSetSearchUnavailable = Readonly<{
  repositoryKey: string
  reason: string
}>

type WorkingSetSearchState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{
    status: "ready"
    results: readonly WorkingSetSearchResult[]
    unavailable: readonly WorkingSetSearchUnavailable[]
    partial: readonly WorkingSetSearchUnavailable[]
    truncated: boolean
  }>
  | Readonly<{ status: "error" }>

type RoleGroup = Readonly<{
  role: Exclude<RepositoryRole, "attached-source">
  heading: string
  regionLabel: string
}>

const CORE_GROUPS: readonly RoleGroup[] = [
  { role: "integrated-runtime", heading: "Integrated product", regionLabel: "Integrated product repositories" },
  {
    role: "sovereign-planning-and-promotion",
    heading: "Sovereign line",
    regionLabel: "Sovereign planning and promotion repositories",
  },
  { role: "suite-source", heading: "Suites", regionLabel: "Suite source repositories" },
]

const VIEW_ORDER: readonly ShelfView[] = ["working-set", "core-seven", "attached-sources"]

function pluralize(count: number): string {
  return `${count} ${count === 1 ? "repository" : "repositories"}`
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("-", " ")
}

function previewLabel(repository: RepositoryShelfRepository): string {
  if (repository.role === "integrated-runtime") return repository.preview === "source"
    ? "Runnable · Preview source"
    : "Runnable · Preview unavailable"
  if (repository.role === "sovereign-planning-and-promotion") return "Non-runnable · No Preview"
  if (repository.role === "attached-source") return "Attached reference · No Preview"
  if (repository.preview === "assimilated") return "Suite source · Assimilated"
  if (repository.preview === "not-assimilated") return "Suite source · Not assimilated"
  return "Suite source · No Preview evidence"
}

function mountTruth(mount: RepositoryMountView): string {
  return `${titleCase(mount.status)} · ${titleCase(mount.cleanliness)}`
}

function repositoryDisplayLabel(repository: RepositoryShelfRepository | undefined, repositoryKey: string): string {
  if (!repository) return repositoryKey
  if (repository.role === "suite-source" && repository.suite) return repository.suite
  if (repository.role === "integrated-runtime") return "OS 1.0"
  if (repository.role === "sovereign-planning-and-promotion") return "Sovereign OS"
  return repository.name
}

function searchPartialMessage(label: string, reason: string): string {
  if (reason === "WORKSPACE_SEARCH_TIMEOUT") {
    return `${label} search stopped before completion; results may be incomplete.`
  }
  if (reason === "WORKSPACE_SEARCH_UNREADABLE_PATHS") {
    return `${label} search skipped unreadable paths; results may be incomplete.`
  }
  return `${label} search returned partial results.`
}

function RepositoryRow({
  repository,
  expanded,
  onToggle,
  onOpenEntry,
}: Readonly<{
  repository: RepositoryShelfRepository
  expanded: boolean
  onToggle: () => void
  onOpenEntry?: (repositoryKey: string, entryId: string) => void
}>) {
  const detailsId = `repository-${repository.repositoryKey}-details`
  const roleLabel = repository.role === "suite-source" && repository.suite
    ? repository.suite
    : repository.role === "integrated-runtime"
      ? "OS 1.0"
      : repository.role === "sovereign-planning-and-promotion"
        ? "Sovereign OS"
        : "Attached source"

  return (
    <li className={styles.repository} data-role={repository.role} data-active={repository.active || undefined}>
      <button
        type="button"
        className={styles.repositoryToggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={`Repository ${repository.name}, ${roleLabel}, ${previewLabel(repository)}${repository.readOnly ? ", read only" : ""}`}
        onClick={onToggle}
      >
        <span className={styles.disclosure} aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        <span className={styles.repositoryCopy}>
          <span className={styles.repositoryHeading}>
            <strong>{repository.name}</strong>
            {repository.active ? <span className={styles.activeLabel}>Active</span> : null}
            {repository.readOnly ? <span className={styles.readOnlyLabel}>Read only</span> : null}
          </span>
          <span className={styles.repositoryRole}>{roleLabel}</span>
          <span className={styles.repositoryTruth}>{previewLabel(repository)}</span>
          {repository.attachmentReason ? <span className={styles.attachmentReason}>{repository.attachmentReason}</span> : null}
        </span>
        <span className={styles.repositoryActivity}>
          {repository.agents.length > 0 ? `${repository.agents.length} active` : "No active agent"}
        </span>
      </button>

      {expanded ? (
        <div id={detailsId} className={styles.details} role="group" aria-label={`${repository.name} repository details`}>
          <p className={styles.identity}>{repository.canonicalIdentity}</p>

          <div className={styles.detailSection}>
            <h4>Verified mounts</h4>
            {repository.mounts.length === 0 ? (
              <p className={styles.emptyTruth}>No verified mount is available.</p>
            ) : (
              <ul className={styles.mountList}>
                {repository.mounts.map((mount) => (
                  <li key={mount.id} className={styles.mount} data-status={mount.status}>
                    <span className={styles.mountHeader}>
                      <strong>{mount.node}</strong>
                      <span>{mount.label}</span>
                      <span className={styles.mountTruth} title={mountTruth(mount)}>
                        <span>{titleCase(mount.status)}</span><span aria-hidden="true"> · </span><span>{titleCase(mount.cleanliness)}</span>
                      </span>
                    </span>
                    <span className={styles.mountBranch}>{mount.branch}</span>
                    <code className={styles.revision}>{mount.revision}</code>
                    {mount.worktreeId ? <span className={styles.worktree}>Worktree <code>{mount.worktreeId}</code></span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {repository.agents.length > 0 ? (
            <div className={styles.detailSection}>
              <h4>Agent sessions</h4>
              <ul className={styles.agentList}>
                {repository.agents.map((agent) => (
                  <li key={agent.id} className={styles.agent} data-state={agent.state}>
                    <span aria-hidden="true" className={styles.agentState} />
                    <span><strong>{agent.name} · {agent.role}</strong><small>{agent.activity}</small></span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {repository.entries.length > 0 ? (
            <div className={styles.detailSection}>
              <h4>Source</h4>
              <ul className={styles.entryList}>
                {repository.entries.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={styles.entry}
                      onClick={() => onOpenEntry?.(repository.repositoryKey, entry.id)}
                      aria-label={`Open ${entry.label} in ${repository.name}`}
                    >
                      <span aria-hidden="true">{entry.kind === "directory" ? "⌞" : "―"}</span>
                      <span>{entry.label}</span>
                      {entry.changed ? <small>Changed</small> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export function RepositoryShelf({
  repositories,
  projectKey = "terrafusion",
  initialView = "working-set",
  onSelectRepository,
  onOpenEntry,
  onViewChange,
}: RepositoryShelfProps) {
  const id = useId()
  const [view, setView] = useState<ShelfView>(initialView)
  const [expandedRepositoryKey, setExpandedRepositoryKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchState, setSearchState] = useState<WorkingSetSearchState>({ status: "idle" })
  const tabRefs = useRef<Partial<Record<ShelfView, HTMLButtonElement | null>>>({})
  const coreRepositories = useMemo(
    () => repositories.filter((repository) => repository.role !== "attached-source"),
    [repositories],
  )
  const attachedRepositories = useMemo(
    () => repositories.filter((repository) => repository.role === "attached-source"),
    [repositories],
  )
  const workingSet = useMemo(
    () => coreRepositories.filter((repository) => repository.workingSet),
    [coreRepositories],
  )

  const counts: Record<ShelfView, number> = {
    "working-set": workingSet.length,
    "core-seven": coreRepositories.length,
    "attached-sources": attachedRepositories.length,
  }
  const labels: Record<ShelfView, string> = {
    "working-set": "Working Set",
    "core-seven": "Core Seven",
    "attached-sources": "Attached Sources",
  }

  function selectView(next: ShelfView) {
    setView(next)
    onViewChange?.(next)
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: ShelfView) {
    const currentIndex = VIEW_ORDER.indexOf(current)
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % VIEW_ORDER.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + VIEW_ORDER.length) % VIEW_ORDER.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? VIEW_ORDER.length - 1
            : -1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextView = VIEW_ORDER[nextIndex]
    selectView(nextView)
    tabRefs.current[nextView]?.focus()
  }

  function toggleRepository(repositoryKey: string) {
    setExpandedRepositoryKey((current) => current === repositoryKey ? null : repositoryKey)
    onSelectRepository?.(repositoryKey)
  }

  async function searchWorkingSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = searchQuery.trim()
    if (query.length < 2 || workingSet.length === 0) return

    const parameters = new URLSearchParams({ projectKey, query })
    for (const repository of workingSet) parameters.append("repositoryKey", repository.repositoryKey)
    setSearchState({ status: "loading" })
    try {
      const response = await fetch(`/api/loom/search?${parameters.toString()}`, { cache: "no-store" })
      const payload = await response.json() as Partial<{
        results: WorkingSetSearchResult[]
        unavailable: WorkingSetSearchUnavailable[]
        partial?: WorkingSetSearchUnavailable[]
        truncated: boolean
      }>
      if (!response.ok || !Array.isArray(payload.results) || !Array.isArray(payload.unavailable)) {
        setSearchState({ status: "error" })
        return
      }
      setSearchState({
        status: "ready",
        results: payload.results,
        unavailable: payload.unavailable,
        partial: Array.isArray(payload.partial) ? payload.partial : [],
        truncated: payload.truncated === true,
      })
    } catch {
      setSearchState({ status: "error" })
    }
  }

  function renderWorkingSetSearch() {
    return (
      <section className={styles.searchSection} aria-label="Working Set source search">
        <form className={styles.searchForm} role="search" onSubmit={searchWorkingSet}>
          <label className={styles.srOnly} htmlFor={`${id}-working-set-search`}>Search Working Set</label>
          <input
            id={`${id}-working-set-search`}
            type="search"
            aria-label="Search Working Set"
            value={searchQuery}
            placeholder="Search working set"
            onChange={(event) => {
              setSearchQuery(event.currentTarget.value)
              if (searchState.status !== "idle") setSearchState({ status: "idle" })
            }}
          />
          <button
            type="submit"
            aria-label={`Search ${workingSet.length} Working Set ${workingSet.length === 1 ? "repository" : "repositories"}`}
            disabled={searchQuery.trim().length < 2 || workingSet.length === 0 || searchState.status === "loading"}
          >
            {searchState.status === "loading" ? "Searching" : "Search"}
          </button>
        </form>

        {searchState.status === "error" ? (
          <div className={styles.searchFeedback} role="status">Working Set search is unavailable.</div>
        ) : null}
        {searchState.status === "ready" ? (
          <div className={styles.searchResults} role="region" aria-label="Working Set search results">
            {searchState.results.length === 0 ? (
              <p>No matches in the available Working Set repositories.</p>
            ) : (
              <ul>
                {searchState.results.map((result) => {
                  const repository = workingSet.find((candidate) => candidate.repositoryKey === result.repositoryKey)
                  const label = repositoryDisplayLabel(repository, result.repositoryKey)
                  return (
                    <li key={`${result.repositoryMountKey}:${result.observedRevision}:${result.path}:${result.line}`}>
                      <button
                        type="button"
                        aria-label={`Open ${result.path} in ${label} at line ${result.line}`}
                        onClick={() => onOpenEntry?.(result.repositoryKey, result.path)}
                      >
                        <span><strong>{label}</strong><code>{result.path}:{result.line}</code></span>
                        <small>{result.excerpt}</small>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {searchState.unavailable.map((item) => (
              <p key={item.repositoryKey} title={item.reason}>
                {repositoryDisplayLabel(
                  workingSet.find((candidate) => candidate.repositoryKey === item.repositoryKey),
                  item.repositoryKey,
                )} unavailable for this search.
              </p>
            ))}
            {searchState.partial.map((item) => (
              <p key={item.repositoryKey} title={item.reason}>
                {searchPartialMessage(repositoryDisplayLabel(
                  workingSet.find((candidate) => candidate.repositoryKey === item.repositoryKey),
                  item.repositoryKey,
                ), item.reason)}
              </p>
            ))}
            {searchState.truncated ? <p>More matches exist. Refine the query to narrow this bounded view.</p> : null}
          </div>
        ) : null}
      </section>
    )
  }

  function renderRows(rows: readonly RepositoryShelfRepository[]) {
    if (rows.length === 0) return <p className={styles.emptyTruth}>No repositories are present in this view.</p>
    return (
      <ul className={styles.repositoryList}>
        {rows.map((repository) => (
          <RepositoryRow
            key={repository.repositoryKey}
            repository={repository}
            expanded={expandedRepositoryKey === repository.repositoryKey}
            onToggle={() => toggleRepository(repository.repositoryKey)}
            onOpenEntry={onOpenEntry}
          />
        ))}
      </ul>
    )
  }

  return (
    <nav className={styles.shelf} aria-label="TerraFusion sources">
      <header className={styles.header}>
        <span>
          <strong>Sources</strong>
          <small>{pluralize(workingSet.length)} in this Space</small>
        </span>
        <span className={styles.scopeTruth}>One project · real repository boundaries</span>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Source scope">
        {VIEW_ORDER.map((option) => (
          <button
            key={option}
            ref={(node) => { tabRefs.current[option] = node }}
            id={`${id}-${option}-tab`}
            type="button"
            role="tab"
            aria-label={`${labels[option]}, ${pluralize(counts[option])}`}
            aria-selected={view === option}
            aria-controls={`${id}-${option}-panel`}
            tabIndex={view === option ? 0 : -1}
            onClick={() => selectView(option)}
            onKeyDown={(event) => handleTabKeyDown(event, option)}
          >
            <span>{labels[option]}</span>
            <small>{counts[option]}</small>
            <span className={styles.srOnly}>, {pluralize(counts[option])}</span>
          </button>
        ))}
      </div>

      <div
        id={`${id}-${view}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${view}-tab`}
        className={styles.panel}
      >
        {view === "working-set" ? <>{renderWorkingSetSearch()}{renderRows(workingSet)}</> : null}
        {view === "core-seven" ? CORE_GROUPS.map((group) => {
          const rows = coreRepositories.filter((repository) => repository.role === group.role)
          if (rows.length === 0) return null
          return (
            <section key={group.role} className={styles.group} role="region" aria-label={group.regionLabel}>
              <h3>{group.heading}</h3>
              {renderRows(rows)}
            </section>
          )
        }) : null}
        {view === "attached-sources" ? (
          <section className={styles.group}>
            <p className={styles.attachedBoundary}>Reference by default. Visibility does not grant mutation authority.</p>
            {renderRows(attachedRepositories)}
          </section>
        ) : null}
      </div>
    </nav>
  )
}
