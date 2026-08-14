"use client"

import { useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Activity,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Cpu,
  FolderKanban,
  Home,
  PanelLeft,
  PanelRight,
  TerminalSquare,
} from "lucide-react"

import { getWorkbenchThreads } from "@/app/actions/workbench-threads"
import { UniversalIntent } from "@/components/intent/universal-intent"
import { UserMenu } from "@/components/shell/user-menu"
import { supportingCapabilities } from "@/components/workbench/supporting-capabilities"
import { WorkbenchContextProvider } from "@/components/workbench/workbench-context"
import type { AuthReadiness } from "@/lib/auth-readiness"
import type { RuntimeStatus } from "@/lib/ai/runtime"
import type { ProjectView } from "@/lib/operator/operator-state"
import type { Thread, ThreadItem } from "@/lib/workbench/thread-projection"
import {
  createInitialWorkbenchState,
  parseWorkbenchRestoration,
  reduceWorkbenchState,
  serializeWorkbenchRestoration,
  type WorkbenchInspectorTab,
  type WorkbenchMobilePane,
  type WorkbenchViewMode,
} from "@/lib/workbench/workbench-state"
import { cn } from "@/lib/utils"

const modes: ReadonlyArray<{
  mode: WorkbenchViewMode
  href: string
  label: string
  icon: typeof Home
}> = [
  { mode: "home", href: "/", label: "Home", icon: Home },
  { mode: "projects", href: "/projects", label: "Projects", icon: FolderKanban },
  { mode: "activity", href: "/activity", label: "Activity", icon: Activity },
  { mode: "system", href: "/system", label: "System", icon: Cpu },
]

const inspectorTabs: ReadonlyArray<{ id: WorkbenchInspectorTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "changes", label: "Changes" },
  { id: "proof", label: "Proof" },
  { id: "decision", label: "Decision" },
  { id: "technical", label: "Technical" },
]

const WORKBENCH_RESTORATION_KEY = "williamos.workbench.layout.v1"

function restorationKey(userId: string): string {
  return `${WORKBENCH_RESTORATION_KEY}:${userId}`
}

function viewMode(pathname: string): WorkbenchViewMode | null {
  if (pathname === "/") return "home"
  if (pathname.startsWith("/projects")) return "projects"
  if (pathname.startsWith("/activity")) return "activity"
  if (pathname.startsWith("/system")) return "system"
  if (pathname.startsWith("/runtime")) return "system"
  return null
}

function stamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ")
}

function ProjectExplorer({
  projects,
  projectState,
  selectedProject,
  threads,
  selectedThread,
  loading,
  error,
  onProject,
  onThread,
}: {
  projects: ProjectView[]
  projectState: "available" | "degraded"
  selectedProject: ProjectView | null
  threads: Thread[]
  selectedThread: Thread | null
  loading: boolean
  error: string | null
  onProject: (project: ProjectView) => void
  onThread: (thread: Thread) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--workbench-panel)]">
      <div className="border-b border-[var(--workbench-hairline)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">Projects</p>
      </div>
      <div className="workbench-scroll min-h-0 flex-1 overflow-y-auto">
        {projectState === "degraded" ? (
          <p role="status" className="border-b border-[var(--workbench-hairline)] px-4 py-3 text-xs leading-5 text-[var(--workbench-warning)]">
            Project context unavailable. The durable Project projection could not be read.
          </p>
        ) : projects.length === 0 ? (
          <p role="status" className="border-b border-[var(--workbench-hairline)] px-4 py-3 text-xs leading-5 text-[var(--workbench-muted)]">
            No durable Projects are registered.
          </p>
        ) : null}
        <div role="listbox" aria-label="Projects" className="py-2">
          {projects.map((project) => {
            const selected = selectedProject?.id === project.id
            return (
              <button
                key={project.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onProject(project)}
                className={cn(
                  "workbench-focus flex w-full items-start gap-3 border-l-2 border-transparent px-4 py-2.5 text-left",
                  selected
                    ? "border-l-[var(--workbench-copper)] bg-[var(--workbench-raised)] text-[var(--workbench-text)]"
                    : "text-[var(--workbench-muted)] hover:bg-[var(--workbench-raised)] hover:text-[var(--workbench-text)]",
                )}
              >
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{project.name}</span>
                  <span className="block truncate font-mono text-[10px] uppercase tracking-wider opacity-70">
                    {project.lifecycle} · {project.resources.length} resources
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="border-t border-[var(--workbench-hairline)]">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">Threads</p>
            {loading ? <span role="status" className="text-[10px] text-[var(--workbench-muted)]">Reading…</span> : null}
          </div>
          {error ? <p role="alert" className="px-4 pb-3 text-xs text-[var(--workbench-fault)]">{error}</p> : null}
          {!selectedProject ? (
            <p className="px-4 pb-4 text-xs leading-5 text-[var(--workbench-muted)]">Choose a Project to load its durable Threads.</p>
          ) : !loading && threads.length === 0 ? (
            <p className="px-4 pb-4 text-xs leading-5 text-[var(--workbench-muted)]">No explicitly bound Threads. Repository names and labels are not used to invent membership.</p>
          ) : (
            <div role="listbox" aria-label="Threads" className="pb-3">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  role="option"
                  aria-selected={selectedThread?.id === thread.id}
                  onClick={() => onThread(thread)}
                  className={cn(
                    "workbench-focus w-full border-l-2 border-transparent px-4 py-2 text-left",
                    selectedThread?.id === thread.id
                      ? "border-l-[var(--workbench-copper)] bg-[var(--workbench-raised)]"
                      : "hover:bg-[var(--workbench-raised)]",
                  )}
                >
                  <span className="block truncate text-sm">{thread.title}</span>
                  <span className="mt-0.5 block font-mono text-[10px] text-[var(--workbench-muted)]">{stamp(thread.lastActivityAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ThreadTimeline({ thread, onSelectItem }: { thread: Thread; onSelectItem: (item: ThreadItem) => void }) {
  return (
    <article className="mx-auto w-full max-w-4xl px-5 py-6 md:px-8">
      <header className="border-b border-[var(--workbench-hairline)] pb-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">{thread.project.name} / Thread</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-[var(--workbench-text)]">{thread.title}</h1>
        <p className="mt-2 text-xs text-[var(--workbench-muted)]">Last persisted activity {stamp(thread.lastActivityAt)} UTC</p>
      </header>
      {thread.items.length === 0 ? (
        <p className="py-8 text-sm text-[var(--workbench-muted)]">This Thread exists, but no durable timeline items are available yet.</p>
      ) : (
        <ol className="ml-2 border-l border-[var(--workbench-copper)]/60 py-5">
          {thread.items.map((item) => (
            <li key={item.id} className="relative pb-6 pl-6 last:pb-0">
              <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-[var(--workbench-canvas)] bg-[var(--workbench-copper)]" aria-hidden />
              <button type="button" onClick={() => onSelectItem(item)} className="workbench-focus block w-full text-left">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--workbench-text)]">{item.title}</span>
                  <span className="font-mono text-[10px] text-[var(--workbench-muted)]">{stamp(item.occurredAt)} UTC</span>
                </span>
                <span className="mt-1 block text-sm leading-6 text-[var(--workbench-muted)]">{item.summary}</span>
                <span className="mt-2 block font-mono text-[10px] uppercase tracking-wider text-[var(--workbench-muted)]">
                  {item.kind.replaceAll("_", " ")} · {item.truth.basis.toLowerCase()} · {item.truth.state.toLowerCase()}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

function EmptyThread({ project }: { project: ProjectView | null }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl items-center px-6 py-12">
      <div className="max-w-xl border-l border-[var(--workbench-copper)] pl-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">Current Thread</p>
        <h1 className="mt-3 text-xl font-semibold text-[var(--workbench-text)]">
          {project ? `${project.name} has no selected Thread` : "Choose a Project to establish context"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--workbench-muted)]">
          {project
            ? "No durable Thread is selected. Ask or do something in this Project, or choose an existing Thread from the Explorer."
            : "Project context controls Threads, artifacts, decisions, memory, and activity together. Nothing is assigned from repository names."}
        </p>
      </div>
    </div>
  )
}

function Inspector({
  tab,
  project,
  thread,
  item,
  onTab,
}: {
  tab: WorkbenchInspectorTab
  project: ProjectView | null
  thread: Thread | null
  item: ThreadItem | null
  onTab: (tab: WorkbenchInspectorTab) => void
}) {
  const relevantItems = thread?.items.filter((candidate) => {
    if (tab === "changes") return candidate.kind === "ARTIFACT_DELIVERY" || candidate.kind === "REMEDIATION"
    if (tab === "proof") return candidate.kind === "VALIDATION" || candidate.kind === "REVIEW"
    if (tab === "decision") return candidate.kind === "DECISION"
    return true
  }) ?? []

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? inspectorTabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + inspectorTabs.length) % inspectorTabs.length
    const next = inspectorTabs[nextIndex]
    onTab(next.id)
    window.requestAnimationFrame(() => document.getElementById(`workbench-inspector-tab-${next.id}`)?.focus())
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--workbench-panel)]">
      <div role="tablist" aria-label="Inspector" className="workbench-scroll flex overflow-x-auto border-b border-[var(--workbench-hairline)] px-2">
        {inspectorTabs.map((candidate, index) => (
          <button
            key={candidate.id}
            id={`workbench-inspector-tab-${candidate.id}`}
            type="button"
            role="tab"
            aria-selected={tab === candidate.id}
            aria-controls="workbench-inspector-panel"
            tabIndex={tab === candidate.id ? 0 : -1}
            onClick={() => onTab(candidate.id)}
            onKeyDown={(event) => moveTab(event, index)}
            className={cn(
              "workbench-focus border-b-2 border-transparent px-2 py-3 text-[11px]",
              tab === candidate.id ? "border-b-[var(--workbench-copper)] text-[var(--workbench-text)]" : "text-[var(--workbench-muted)]",
            )}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <div id="workbench-inspector-panel" role="tabpanel" aria-labelledby={`workbench-inspector-tab-${tab}`} className="workbench-scroll min-h-0 flex-1 overflow-y-auto p-4 text-sm">
        {tab === "overview" ? (
          <div className="space-y-5">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">Context</p>
              <p className="mt-2 font-semibold">{thread?.title ?? project?.name ?? "No Project selected"}</p>
              {item ? <p className="mt-2 leading-6 text-[var(--workbench-muted)]">{item.summary}</p> : null}
            </div>
            {project ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">Explicit resources</p>
                <ul className="mt-2 space-y-2">
                  {project.resources.length ? project.resources.map((resource) => (
                    <li key={`${resource.type}:${resource.canonicalIdentity}:${resource.relationship}`} className="border-l border-[var(--workbench-hairline)] pl-3">
                      <span className="block text-xs font-medium">{resource.label}</span>
                      <span className="block break-all font-mono text-[10px] text-[var(--workbench-muted)]">{resource.type} · {resource.relationship}</span>
                    </li>
                  )) : <li className="text-xs text-[var(--workbench-muted)]">No explicit resources bound.</li>}
                </ul>
              </div>
            ) : null}
          </div>
        ) : tab === "technical" ? (
          <div className="space-y-4">
            <p className="text-xs leading-5 text-[var(--workbench-muted)]">Technical detail remains read-only and cannot grant execution authority.</p>
            {item ? (
              <dl className="space-y-2 font-mono text-[10px]">
                <div><dt className="text-[var(--workbench-muted)]">Source</dt><dd>{item.source.kind}:{item.source.id}</dd></div>
                <div><dt className="text-[var(--workbench-muted)]">Truth</dt><dd>{item.truth.basis} / {item.truth.state}</dd></div>
              </dl>
            ) : null}
            <nav aria-label="Supporting capabilities" className="border-t border-[var(--workbench-hairline)] pt-3">
              {supportingCapabilities.map((capability) => (
                <Link key={capability.href} href={capability.href} className="workbench-focus block py-1.5 text-xs text-[var(--workbench-muted)] hover:text-[var(--workbench-text)]">{capability.label}</Link>
              ))}
            </nav>
          </div>
        ) : relevantItems.length ? (
          <ul className="space-y-3">
            {relevantItems.map((candidate) => <li key={candidate.id} className="border-l border-[var(--workbench-hairline)] pl-3"><span className="block text-xs font-medium">{candidate.title}</span><span className="mt-1 block text-xs leading-5 text-[var(--workbench-muted)]">{candidate.summary}</span></li>)}
          </ul>
        ) : (
          <p className="text-xs leading-5 text-[var(--workbench-muted)]">No {tab} records are explicitly bound to this Thread.</p>
        )}
      </div>
    </div>
  )
}

export function WorkbenchShell({
  user,
  projects,
  projectState,
  pulse,
  readiness,
  runtime,
  observedAt,
  children,
}: {
  user: { id: string; name: string; email: string }
  projects: ProjectView[]
  projectState: "available" | "degraded"
  pulse: { working: number | null; needsYou: number | null; queueDepth: number | null }
  readiness: AuthReadiness
  runtime: RuntimeStatus
  observedAt: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [state, dispatch] = useReducer(reduceWorkbenchState, undefined, createInitialWorkbenchState)
  const [threads, setThreads] = useState<Thread[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<ThreadItem | null>(null)
  const [pendingThreadFocus, setPendingThreadFocus] = useState<string | null>(null)
  const [loadedProjectId, setLoadedProjectId] = useState<number | null>(null)
  const [loadGeneration, setLoadGeneration] = useState(0)
  const [restorationRead, setRestorationRead] = useState(false)
  const [pendingDomFocus, setPendingDomFocus] = useState(false)
  const [isPending, startTransition] = useTransition()
  const threadMainRef = useRef<HTMLElement>(null)
  const restoredRouteRef = useRef<WorkbenchViewMode | null>(null)
  const routeMode = viewMode(pathname)
  const currentMode = routeMode ?? state.viewMode
  const selectedProject = projects.find((project) => String(project.id) === state.selectedProjectId) ?? null
  const selectedThread = threads.find((thread) => thread.id === state.selectedThreadId) ?? null

  useEffect(() => {
    if (restorationRead) return
    let serialized: string | null = null
    try {
      serialized = window.localStorage.getItem(restorationKey(user.id))
    } catch {
      // Spatial restoration is optional. A blocked device store must not take
      // down the authenticated Workbench.
    }
    const restoration = serialized ? parseWorkbenchRestoration(serialized) : null
    if (restoration) {
      const projectOnly = { ...restoration, selectedThreadId: null }
      dispatch({
        type: "USER_RESTORE_STATE",
        serialized: JSON.stringify(projectOnly),
        availableProjectIds: projects.map((project) => String(project.id)),
        availableThreadIdsByProject: {},
      })
      setPendingThreadFocus(restoration.selectedThreadId)
      if (routeMode === "home" && restoration.viewMode !== "home") {
        restoredRouteRef.current = restoration.viewMode
        const destination = modes.find((candidate) => candidate.mode === restoration.viewMode)
        if (destination) router.replace(destination.href)
      }
    }
    setRestorationRead(true)
  }, [projects, restorationRead, routeMode, router, user.id])

  useEffect(() => {
    if (!restorationRead) return
    try {
      window.localStorage.setItem(restorationKey(user.id), serializeWorkbenchRestoration(state))
    } catch {
      // Quota and policy failures only disable restoration; they do not alter
      // current authenticated state or authority.
    }
  }, [restorationRead, state, user.id])

  useEffect(() => {
    if (!restorationRead || !routeMode) return
    const restoredRoute = restoredRouteRef.current
    if (restoredRoute) {
      if (routeMode === restoredRoute) {
        restoredRouteRef.current = null
        dispatch({ type: "USER_SET_VIEW_MODE", viewMode: routeMode })
      } else if (routeMode !== "home") {
        // Home is the launch route while router.replace settles. Any other
        // route is an explicit or otherwise settled destination and wins.
        restoredRouteRef.current = null
        dispatch({ type: "USER_SET_VIEW_MODE", viewMode: routeMode })
      }
      return
    }
    dispatch({ type: "USER_SET_VIEW_MODE", viewMode: routeMode })
  }, [restorationRead, routeMode])

  useEffect(() => {
    if (!selectedProject) {
      setThreads([])
      setLoadedProjectId(null)
      setLoadError(null)
      return
    }
    let active = true
    startTransition(async () => {
      try {
        const next = await getWorkbenchThreads(selectedProject.id)
        if (!active) return
        setThreads(next)
        setLoadedProjectId(selectedProject.id)
        setLoadError(null)
        dispatch({ type: "BACKGROUND_REFRESH", version: Date.now(), observedAt: new Date().toISOString() })
      } catch {
        if (!active) return
        setThreads([])
        setLoadError("Thread history could not be read. Project context was not changed.")
      }
    })
    return () => { active = false }
  }, [loadGeneration, selectedProject])

  useEffect(() => {
    if (!pendingThreadFocus) return
    if (!selectedProject || loadedProjectId !== selectedProject.id) return
    const target = threads.find((thread) => thread.id === pendingThreadFocus)
    if (!target) {
      setPendingThreadFocus(null)
      return
    }
    dispatch({ type: "USER_SELECT_THREAD", threadId: target.id, availableThreadIds: threads.map((thread) => thread.id) })
    dispatch({ type: "USER_SET_MOBILE_PANE", pane: "thread" })
    dispatch({ type: "USER_SET_FOCUS", focus: "thread" })
    setPendingThreadFocus(null)
  }, [loadedProjectId, pendingThreadFocus, selectedProject, threads])

  useEffect(() => {
    if (!pendingDomFocus || state.mobilePane !== "thread") return
    threadMainRef.current?.focus({ preventScroll: true })
    setPendingDomFocus(false)
  }, [pendingDomFocus, selectedThread, state.mobilePane])

  const center = useMemo(() => {
    if (routeMode === null) return children
    if (currentMode === "activity" || currentMode === "system") return children
    if (selectedThread) return <ThreadTimeline thread={selectedThread} onSelectItem={setSelectedItem} />
    return <EmptyThread project={selectedProject} />
  }, [children, currentMode, routeMode, selectedProject, selectedThread])

  function selectProject(project: ProjectView) {
    setSelectedItem(null)
    setThreads([])
    setLoadedProjectId(null)
    setLoadGeneration((generation) => generation + 1)
    dispatch({ type: "USER_SELECT_PROJECT", projectId: String(project.id), availableProjectIds: projects.map((candidate) => String(candidate.id)) })
    dispatch({ type: "USER_SET_FOCUS", focus: "thread" })
    dispatch({ type: "USER_SET_MOBILE_PANE", pane: "thread" })
    setPendingDomFocus(true)
  }

  function selectThread(thread: Thread) {
    setSelectedItem(null)
    dispatch({ type: "USER_SELECT_THREAD", threadId: thread.id, availableThreadIds: threads.map((candidate) => candidate.id) })
    dispatch({ type: "USER_SET_FOCUS", focus: "thread" })
    dispatch({ type: "USER_SET_MOBILE_PANE", pane: "thread" })
    setPendingDomFocus(true)
  }

  function focusThread(target: { projectId: number; threadId: string }) {
    const project = projects.find((candidate) => candidate.id === target.projectId)
    if (!project) return
    setPendingThreadFocus(target.threadId)
    setPendingDomFocus(true)
    selectProject(project)
  }

  const explorer = <ProjectExplorer projects={projects} projectState={projectState} selectedProject={selectedProject} threads={threads} selectedThread={selectedThread} loading={isPending} error={loadError} onProject={selectProject} onThread={selectThread} />
  const inspector = <Inspector tab={state.inspectorTab} project={selectedProject} thread={selectedThread} item={selectedItem} onTab={(tab) => dispatch({ type: "USER_SET_INSPECTOR_TAB", inspectorTab: tab })} />

  const mobilePanes: Array<{ id: WorkbenchMobilePane; label: string; icon: typeof PanelLeft }> = [
    { id: "explorer", label: "Explorer", icon: PanelLeft },
    { id: "thread", label: "Thread", icon: CircleDot },
    { id: "inspector", label: "Inspect", icon: PanelRight },
    { id: "execution", label: "Execution", icon: TerminalSquare },
  ]

  return (
    <WorkbenchContextProvider value={{ focusThread }}>
    <div className="flex h-[100dvh] min-h-0 bg-[var(--workbench-canvas)] text-[var(--workbench-text)]">
      <aside className="hidden w-[4.5rem] shrink-0 flex-col border-r border-[var(--workbench-hairline)] bg-[var(--workbench-canvas)] sm:flex">
        <Link href="/" aria-label="WilliamOS Home" className="workbench-focus grid h-14 place-items-center border-b border-[var(--workbench-hairline)]"><span className="grid size-7 place-items-center bg-[var(--workbench-text)] font-mono text-xs font-bold text-[var(--workbench-canvas)]">W</span></Link>
        <nav aria-label="Workbench views" className="flex flex-1 flex-col items-center gap-1 py-3">
          {modes.map((mode) => <Link key={mode.mode} href={mode.href} aria-current={routeMode === mode.mode ? "page" : undefined} className={cn("workbench-focus flex h-14 w-full flex-col items-center justify-center gap-1 border-l-2 border-transparent text-[var(--workbench-muted)]", routeMode === mode.mode && "border-l-[var(--workbench-copper)] bg-[var(--workbench-raised)] text-[var(--workbench-text)]")}><mode.icon className="size-4" aria-hidden /><span className="text-[9px] uppercase tracking-wide">{mode.label}</span></Link>)}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--workbench-hairline)] bg-[var(--workbench-panel)] px-3 md:px-4">
          <span className="font-mono text-xs font-semibold sm:hidden">W</span>
          <div className="min-w-0 flex-1 truncate text-sm"><span className="text-[var(--workbench-muted)]">{selectedProject?.name ?? "WilliamOS"}</span>{selectedThread ? <span> / {selectedThread.title}</span> : null}</div>
          <UniversalIntent />
          <UserMenu name={user.name} email={user.email} />
        </header>

        <nav aria-label="Compact Workbench views" className="grid shrink-0 grid-cols-4 border-b border-[var(--workbench-hairline)] sm:hidden">
          {modes.map((mode) => (
            <Link
              key={mode.mode}
              href={mode.href}
              aria-current={routeMode === mode.mode ? "page" : undefined}
              className={cn(
                "workbench-focus flex h-11 items-center justify-center gap-1.5 border-b-2 border-transparent text-[10px] uppercase tracking-wide text-[var(--workbench-muted)]",
                routeMode === mode.mode && "border-b-[var(--workbench-copper)] bg-[var(--workbench-raised)] text-[var(--workbench-text)]",
              )}
            >
              <mode.icon className="size-3.5" aria-hidden />
              {mode.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Compact workbench panes" className="grid shrink-0 grid-cols-4 border-b border-[var(--workbench-hairline)] lg:hidden">
          {mobilePanes.map((pane) => <button key={pane.id} type="button" aria-pressed={state.mobilePane === pane.id} onClick={() => dispatch({ type: "USER_SET_MOBILE_PANE", pane: pane.id })} className={cn("workbench-focus flex h-11 items-center justify-center gap-1 text-[10px] text-[var(--workbench-muted)]", state.mobilePane === pane.id && "bg-[var(--workbench-raised)] text-[var(--workbench-text)]")}><pane.icon className="size-3.5" aria-hidden />{pane.label}</button>)}
        </nav>

        <div className="min-h-0 flex-1 sm:grid sm:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
          <aside aria-label="Project and Thread Explorer" className={cn("min-h-0 border-r border-[var(--workbench-hairline)]", state.mobilePane === "explorer" ? "h-full sm:block" : "hidden sm:block")}>{explorer}</aside>
          <main ref={threadMainRef} id="workbench-thread" className={cn("workbench-scroll min-h-0 overflow-y-auto bg-[var(--workbench-canvas)]", state.mobilePane === "thread" ? "h-full" : "hidden lg:block")} tabIndex={-1}>{center}</main>
          <aside aria-label="Inspector" className={cn("min-h-0 border-l border-[var(--workbench-hairline)]", state.mobilePane === "inspector" ? "h-full sm:col-start-2" : "hidden lg:block")}>{inspector}</aside>
          {state.mobilePane === "execution" ? <section className="h-full p-5 sm:col-start-2 lg:hidden"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--workbench-muted)]">Execution</p><p className="mt-3 text-sm">No authorized interrupt or generic terminal protocol is available.</p><p className="mt-2 text-xs leading-5 text-[var(--workbench-muted)]">Tests, logs, and agents remain inspectable through persisted evidence and contextual routes.</p></section> : null}
        </div>

        <section id="workbench-execution" className={cn("hidden shrink-0 border-t border-[var(--workbench-hairline)] bg-[var(--workbench-panel)] sm:block", state.executionExpanded && "h-40")}>
          <button type="button" aria-expanded={state.executionExpanded} aria-controls="workbench-execution-detail" onClick={() => dispatch({ type: "USER_SET_EXECUTION_EXPANDED", expanded: !state.executionExpanded })} className="workbench-focus flex h-9 w-full items-center gap-2 px-4 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--workbench-muted)]"><TerminalSquare className="size-3.5" aria-hidden />Execution <span className="normal-case tracking-normal">agents · tests · logs</span>{state.executionExpanded ? <ChevronDown className="ml-auto size-3.5" /> : <ChevronUp className="ml-auto size-3.5" />}</button>
          {state.executionExpanded ? <div id="workbench-execution-detail" className="grid grid-cols-3 gap-6 border-t border-[var(--workbench-hairline)] px-4 py-3 text-xs"><div><p className="font-medium">Agents</p><p className="mt-1 text-[var(--workbench-muted)]">No live agent stream is bound to this Thread.</p></div><div><p className="font-medium">Tests and logs</p><Link href="/audit" className="mt-1 block text-[var(--workbench-copper)]">Open persisted proof</Link></div><div><p className="font-medium">Terminal</p><p className="mt-1 text-[var(--workbench-muted)]">Read-only unavailable. No generic shell authority.</p></div></div> : null}
        </section>

        <footer aria-label="System status" className="flex h-7 shrink-0 items-center gap-4 overflow-x-auto border-t border-[var(--workbench-hairline)] bg-[var(--workbench-canvas)] px-3 font-mono text-[9px] uppercase tracking-wider text-[var(--workbench-muted)]">
          <span title="Configured application host role; this is not a liveness probe"><b>HERMES</b> inferred</span>
          <span><b className={readiness.databaseReady ? "text-[var(--workbench-live)]" : "text-[var(--workbench-fault)]"}>ATLAS</b> {readiness.databaseReady ? "live" : "offline"}</span>
          <span><b>AEGIS</b> unknown</span>
          <span><b className={pulse.needsYou !== null && pulse.needsYou > 0 ? "text-[var(--workbench-warning)]" : "text-[var(--workbench-muted)]"}>Needs you</b> {pulse.needsYou ?? "unknown"}</span>
          <span><b>Working</b> {pulse.working ?? "unknown"}{pulse.queueDepth !== null && pulse.working !== null && pulse.queueDepth > pulse.working ? ` · queued ${pulse.queueDepth}` : ""}</span>
          <span className="ml-auto hidden normal-case tracking-normal md:inline">model configured: {runtime.chatModel} · observed {observedAt.slice(11, 19)} UTC</span>
        </footer>
      </div>
    </div>
    </WorkbenchContextProvider>
  )
}
