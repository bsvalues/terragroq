"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Activity, Bot, ChevronDown, ChevronLeft, ChevronRight, ChevronsUp, CircleStop, FolderKanban, Gauge, ListTree, Menu, PanelBottom, PanelRight, Search, Wrench } from "lucide-react"
import { UniversalIntent } from "@/components/intent/universal-intent"
import { UserMenu } from "@/components/shell/user-menu"
import type { WorkbenchModel, WorkbenchProject, WorkbenchThread } from "@/lib/workbench/workbench-model"
import { cn } from "@/lib/utils"
import { WorkbenchHome } from "./workbench-home"

type Lens = "threads" | "projects" | "activity" | "system"
type InspectorTab = "Overview" | "Changes" | "Proof" | "Decision" | "Technical"
type ExecutionTab = "Execution" | "Tests" | "Logs" | "Agents"

const STORAGE = {
  lens: "williamos:workbench:lens",
  thread: "williamos:workbench:thread",
  project: "williamos:workbench:project",
  explorer: "williamos:workbench:explorer",
  inspector: "williamos:workbench:inspector",
  inspectorTab: "williamos:workbench:inspector-tab",
  execution: "williamos:workbench:execution",
  executionTab: "williamos:workbench:execution-tab",
} as const

function useStoredState<T extends string>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial)
  useEffect(() => { const stored = window.localStorage.getItem(key); if (stored) setValue(stored as T) }, [key])
  useEffect(() => { window.localStorage.setItem(key, value) }, [key, value])
  return [value, setValue] as const
}

function stateDot(state: WorkbenchThread["state"]) {
  return state === "working" ? "bg-emerald-400" : state === "waiting" ? "bg-amber-400" : state === "stopped" ? "bg-red-400" : state === "completed" ? "bg-sky-400" : "bg-muted-foreground"
}

function Explorer({ model, lens, selectedThreadId, selectedProjectKey, onThread, onProject, onClose }: { model: WorkbenchModel; lens: Lens; selectedThreadId: string; selectedProjectKey: string; onThread: (id: string) => void; onProject: (key: string) => void; onClose: () => void }) {
  const groups = useMemo(() => {
    const states: WorkbenchThread["state"][] = ["working", "waiting", "idle", "completed", "stopped"]
    return states.map((state) => ({ state, threads: model.threads.filter((thread) => thread.state === state) })).filter((group) => group.threads.length)
  }, [model.threads])
  const title = lens === "threads" ? "Threads" : lens === "projects" ? "Projects" : lens === "activity" ? "Activity" : "System"
  return <aside className="flex h-full min-h-0 w-[18rem] shrink-0 flex-col border-r border-border bg-sidebar">
    <div className="flex h-12 items-center justify-between border-b border-border px-3"><span className="font-mono text-xs font-semibold uppercase tracking-widest">{title}</span><button onClick={onClose} className="grid size-7 place-items-center text-muted-foreground hover:text-foreground" aria-label="Close explorer"><ChevronLeft className="size-4" /></button></div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {lens === "threads" ? <>
        <div className="border-b border-border px-3 py-3"><button onClick={() => onProject("unassigned")} className={cn("flex w-full items-center justify-between px-2 py-1.5 text-left text-xs", selectedProjectKey === "unassigned" && "bg-sidebar-accent text-sidebar-accent-foreground")}><span>Unassigned work</span><span className="font-mono text-[10px] text-muted-foreground">{model.threads.length}</span></button></div>
        {groups.map((group) => <section key={group.state} className="border-b border-border py-2"><h3 className="px-4 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{group.state}</h3>{group.threads.map((thread) => <button key={thread.id} onClick={() => onThread(thread.id)} className={cn("flex w-full gap-2 border-l-2 border-transparent px-4 py-2 text-left hover:bg-sidebar-accent/60", selectedThreadId === thread.id && "border-l-primary bg-sidebar-accent")}><span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", stateDot(thread.state))} /><span className="min-w-0"><span className="block truncate text-xs font-medium">{thread.title}</span><span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{thread.ref}</span></span></button>)}</section>)}
      </> : null}
      {lens === "projects" ? <div className="py-2">{model.projects.length ? model.projects.map((project) => <button key={project.key} onClick={() => onProject(project.key)} className={cn("w-full border-l-2 border-transparent px-4 py-3 text-left hover:bg-sidebar-accent/60", selectedProjectKey === project.key && "border-l-primary bg-sidebar-accent")}><span className="block text-sm font-medium">{project.name}</span><span className="mt-1 block font-mono text-[10px] uppercase text-muted-foreground">{project.lifecycle} · {project.resources.length} resources</span></button>) : <p className="px-4 py-8 text-sm leading-6 text-muted-foreground">No durable projects are registered.</p>}<button onClick={() => onProject("unassigned")} className="w-full border-t border-border px-4 py-3 text-left text-sm">Unassigned work <span className="ml-2 font-mono text-[10px] text-muted-foreground">{model.threads.length}</span></button></div> : null}
      {lens === "activity" ? <div>{model.activity.length ? model.activity.map((item) => <div key={item.id} className="border-b border-border px-4 py-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{item.label}</span><span className="font-mono text-[9px] text-muted-foreground">{new Date(item.at).toLocaleDateString()}</span></div>{item.detail ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.detail}</p> : null}</div>) : <p className="px-4 py-8 text-sm text-muted-foreground">No persisted activity yet.</p>}</div> : null}
      {lens === "system" ? <div>{model.systems.value.map((system) => <div key={system.node} className="border-b border-border px-4 py-3"><div className="flex items-center gap-2"><span className={cn("size-1.5 rounded-full", system.detail.startsWith("live") ? "bg-emerald-400" : "bg-amber-400")} /><span className="font-mono text-xs font-semibold">{system.node}</span><span className="ml-auto text-[10px] text-muted-foreground">{system.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{system.role} · {system.detail}</p></div>)}<div className="px-2 py-2">{model.tools.filter((tool) => tool.verb === "System").map((tool) => <Link key={tool.href} href={tool.href} className="block px-2 py-2 text-xs hover:bg-sidebar-accent">{tool.label}</Link>)}</div></div> : null}
    </div>
    <details className="border-t border-border"><summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs text-muted-foreground hover:text-foreground"><Wrench className="size-3.5" /> All tools <ChevronDown className="ml-auto size-3" /></summary><div className="max-h-64 overflow-y-auto border-t border-border py-1">{model.tools.map((tool) => <Link key={tool.href} href={tool.href} title={tool.description} className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-sidebar-accent"><span className="w-11 font-mono text-[9px] uppercase text-muted-foreground">{tool.verb}</span>{tool.label}</Link>)}</div></details>
  </aside>
}

function Inspector({ thread, project, tab, onTab, open, onOpen }: { thread: WorkbenchThread | null; project: WorkbenchProject | null; tab: InspectorTab; onTab: (tab: InspectorTab) => void; open: boolean; onOpen: (open: boolean) => void }) {
  if (!open) return <button onClick={() => onOpen(true)} className="hidden w-9 shrink-0 place-items-center border-l border-border text-muted-foreground hover:text-foreground xl:grid" aria-label="Open inspector"><PanelRight className="size-4" /></button>
  const tabs: InspectorTab[] = ["Overview", "Changes", "Proof", "Decision", "Technical"]
  return <aside className="hidden h-full min-h-0 w-[21rem] shrink-0 flex-col border-l border-border bg-background xl:flex">
    <div className="flex h-12 items-center justify-between border-b border-border px-3"><span className="font-mono text-xs font-semibold uppercase tracking-widest">Inspector</span><button onClick={() => onOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close inspector"><ChevronRight className="size-4" /></button></div>
    <div className="flex overflow-x-auto border-b border-border px-2">{tabs.map((item) => <button key={item} onClick={() => onTab(item)} className={cn("border-b-2 border-transparent px-2 py-2.5 text-[10px] text-muted-foreground", item === tab && "border-b-primary text-foreground")}>{item}</button>)}</div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
      {tab === "Overview" ? <>{thread ? <><p className="font-medium">{thread.title}</p><dl className="mt-4 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 text-xs"><dt className="text-muted-foreground">Reference</dt><dd className="font-mono">{thread.ref}</dd><dt className="text-muted-foreground">State</dt><dd>{thread.state}</dd><dt className="text-muted-foreground">Status</dt><dd>{thread.status}</dd><dt className="text-muted-foreground">Attempts</dt><dd>{thread.attempts.length}</dd></dl></> : project ? <><p className="font-medium">{project.name}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{project.lifecycle} · {project.resources.length} bound resources</p></> : <p className="text-muted-foreground">Select a project or thread to inspect it.</p>}</> : null}
      {tab === "Changes" ? <>{thread?.artifacts.length ? thread.artifacts.map((artifact) => <div key={artifact.id} className="border-b border-border py-3"><p>{artifact.label}</p>{artifact.detail ? <p className="mt-1 font-mono text-[10px] text-muted-foreground">{artifact.detail}</p> : null}</div>) : <p className="text-muted-foreground">No recorded changes are linked to this context.</p>}</> : null}
      {tab === "Proof" ? <><p className="text-muted-foreground">Evidence remains authoritative in ATLAS and is opened in context.</p><Link href="/audit" className="mt-4 inline-block text-primary hover:underline">Open evidence</Link><Link href="/trace" className="ml-4 text-primary hover:underline">Open trace</Link></> : null}
      {tab === "Decision" ? <><p className="text-muted-foreground">Review owner choices and governing doctrine for this work.</p><Link href="/decisions" className="mt-4 inline-block text-primary hover:underline">Open decisions</Link><Link href="/brain-council" className="ml-4 text-primary hover:underline">Ask Council</Link></> : null}
      {tab === "Technical" ? <><pre className="whitespace-pre-wrap font-mono text-[10px] leading-5 text-muted-foreground">{JSON.stringify(thread ? { id: thread.id, workOrderId: thread.workOrderId, attempts: thread.attempts.map((attempt) => ({ id: attempt.id, node: attempt.node, worker: attempt.worker, status: attempt.attemptStatus })) } : project ? { key: project.key, resources: project.resources } : {}, null, 2)}</pre></> : null}
    </div>
  </aside>
}

function ExecutionPanel({ thread, open, onOpen, tab, onTab }: { thread: WorkbenchThread | null; open: boolean; onOpen: (open: boolean) => void; tab: ExecutionTab; onTab: (tab: ExecutionTab) => void }) {
  const tabs: ExecutionTab[] = ["Execution", "Tests", "Logs", "Agents"]
  const active = thread?.attempts.some((attempt) => attempt.attemptStatus === "active") ?? false
  return <section className="shrink-0 border-t border-border bg-[#0b0e0f]">
    <div className="flex h-9 items-center px-3"><button onClick={() => onOpen(!open)} className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest"><PanelBottom className="size-3.5" /> Execution <ChevronsUp className={cn("size-3 transition-transform", open && "rotate-180")} /></button><span className="ml-3 text-[10px] text-muted-foreground">{thread ? `${thread.attempts.length} attempts · ${thread.state}` : "No thread selected"}</span><Link href="/work-orders" className={cn("ml-auto flex items-center gap-1 text-[10px]", active ? "text-amber-300" : "text-muted-foreground")}><CircleStop className="size-3" /> {active ? "Stop / steer" : "Execution controls"}</Link></div>
    {open ? <div className="h-36 border-t border-border"><div className="flex h-8 border-b border-border px-2">{tabs.map((item) => <button key={item} onClick={() => onTab(item)} className={cn("border-b-2 border-transparent px-3 text-[10px] text-muted-foreground", item === tab && "border-b-primary text-foreground")}>{item}</button>)}</div><div className="h-[6.5rem] overflow-y-auto px-4 py-2 font-mono text-[10px] leading-5 text-muted-foreground">{tab === "Execution" ? (thread?.attempts.length ? thread.attempts.map((attempt) => <div key={attempt.id}>{attempt.id} · {attempt.attemptStatus} · {attempt.events} events</div>) : "No execution attempts are linked to this thread.") : null}{tab === "Tests" ? "Test results are shown when linked evidence records are available." : null}{tab === "Logs" ? "Runtime churn stays collapsed here. Open Trace for full lineage." : null}{tab === "Agents" ? (thread?.attempts.length ? [...new Set(thread.attempts.map((attempt) => `${attempt.worker}@${attempt.node}`))].join("\n") : "No agent is assigned to this thread.") : null}</div></div> : null}
  </section>
}

export function WorkbenchShell({ user, model, children }: { user: { name: string; email: string }; model: WorkbenchModel; children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter()
  const firstThread = model.threads[0]?.id ?? ""
  const [lens, setLens] = useStoredState<Lens>(STORAGE.lens, "threads")
  const [selectedThreadId, setSelectedThreadId] = useStoredState<string>(STORAGE.thread, firstThread)
  const [selectedProjectKey, setSelectedProjectKey] = useStoredState<string>(STORAGE.project, "unassigned")
  const [explorer, setExplorer] = useStoredState<"open" | "closed">(STORAGE.explorer, "open")
  const [inspector, setInspector] = useStoredState<"open" | "closed">(STORAGE.inspector, "open")
  const [inspectorTab, setInspectorTab] = useStoredState<InspectorTab>(STORAGE.inspectorTab, "Overview")
  const [execution, setExecution] = useStoredState<"open" | "closed">(STORAGE.execution, "closed")
  const [executionTab, setExecutionTab] = useStoredState<ExecutionTab>(STORAGE.executionTab, "Execution")
  const [mobileExplorer, setMobileExplorer] = useState(false)
  const selectedThread = model.threads.find((thread) => thread.id === selectedThreadId) ?? null
  const selectedProject = model.projects.find((project) => project.key === selectedProjectKey) ?? null
  const selectThread = (id: string) => { setSelectedThreadId(id); setSelectedProjectKey("unassigned"); router.push("/"); setMobileExplorer(false) }
  const selectProject = (key: string) => { setSelectedProjectKey(key); setSelectedThreadId(""); router.push("/"); setMobileExplorer(false) }
  const rail = [{ id: "threads" as const, label: "Threads", icon: ListTree }, { id: "projects" as const, label: "Projects", icon: FolderKanban }, { id: "activity" as const, label: "Activity", icon: Activity }, { id: "system" as const, label: "System", icon: Gauge }]
  const pageName = model.tools.find((tool) => tool.href === pathname)?.label ?? "Workbench"
  return <div className="flex h-screen min-h-[34rem] overflow-hidden bg-background text-foreground">
    <aside className="hidden w-[4.25rem] shrink-0 flex-col border-r border-border bg-[#0b0e0f] lg:flex"><Link href="/" aria-label="WilliamOS workbench" className="grid h-12 place-items-center border-b border-border"><span className="grid size-7 place-items-center border border-foreground/60 font-mono text-xs font-bold">W</span></Link><nav className="flex flex-1 flex-col items-center gap-1 py-3" aria-label="Workbench lenses">{rail.map((item) => <button key={item.id} onClick={() => { setLens(item.id); setExplorer("open"); router.push("/") }} title={item.label} aria-label={item.label} className={cn("flex h-12 w-full flex-col items-center justify-center gap-1 border-l-2 border-transparent text-muted-foreground hover:text-foreground", lens === item.id && "border-l-primary text-primary")}><item.icon className="size-4" /><span className="text-[9px]">{item.label}</span></button>)}</nav><div className="grid h-10 place-items-center border-t border-border"><Bot className="size-4 text-muted-foreground" /></div></aside>
    <div className={cn("fixed inset-y-0 left-0 z-40 lg:static lg:z-auto", mobileExplorer ? "block" : "hidden lg:block", explorer === "closed" && "lg:hidden")}><Explorer model={model} lens={lens} selectedThreadId={selectedThreadId} selectedProjectKey={selectedProjectKey} onThread={selectThread} onProject={selectProject} onClose={() => { setExplorer("closed"); setMobileExplorer(false) }} /></div>{mobileExplorer ? <button className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileExplorer(false)} aria-label="Close explorer overlay" /> : null}
    <div className="flex min-w-0 flex-1 flex-col"><header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3"><button onClick={() => { if (explorer === "closed") setExplorer("open"); else setMobileExplorer(true) }} className="grid size-8 place-items-center text-muted-foreground hover:text-foreground" aria-label="Open explorer">{explorer === "closed" ? <Menu className="size-4" /> : <Search className="size-4 lg:hidden" />}</button><div className="min-w-0 text-xs"><span className="font-medium">WilliamOS</span><span className="mx-2 text-muted-foreground">/</span><span className="truncate text-muted-foreground">{pathname === "/" ? selectedThread?.title ?? selectedProject?.name ?? "Workbench" : pageName}</span></div><div className="ml-auto flex items-center gap-2"><UniversalIntent /><UserMenu name={user.name} email={user.email} /></div></header>
      <div className="flex min-h-0 flex-1"><main className="min-w-0 flex-1 overflow-y-auto">{pathname === "/" ? <WorkbenchHome thread={selectedThread} project={selectedProject} /> : children}</main><Inspector thread={selectedThread} project={selectedProject} tab={inspectorTab} onTab={setInspectorTab} open={inspector === "open"} onOpen={(open) => setInspector(open ? "open" : "closed")} /></div>
      <ExecutionPanel thread={selectedThread} open={execution === "open"} onOpen={(open) => setExecution(open ? "open" : "closed")} tab={executionTab} onTab={setExecutionTab} />
      <footer className="flex h-6 shrink-0 items-center gap-3 overflow-x-auto border-t border-border bg-[#080a0b] px-3 font-mono text-[9px] text-muted-foreground">{model.systems.value.map((system) => <span key={system.node} className="flex shrink-0 items-center gap-1" title={system.detail}><span className={cn("size-1.5 rounded-full", system.detail.startsWith("live") ? "bg-emerald-400" : "bg-amber-400")} />{system.node}</span>)}<span className="shrink-0">queue {model.now.value.queueDepth}</span><span className="shrink-0">agents {model.now.value.activeExecutions}</span>{model.needsWilliam.value.length ? <Link href="/goal-console" className="shrink-0 text-amber-300">needs you {model.needsWilliam.value.length}</Link> : <span className="shrink-0">needs you 0</span>}<span className="ml-auto shrink-0">{model.installation}</span></footer>
    </div>
  </div>
}
