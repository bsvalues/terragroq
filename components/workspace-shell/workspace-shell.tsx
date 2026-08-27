"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AppWindow, Braces, Command, FlaskConical, GitCompare, Grid2X2, TerminalSquare, Users, X } from "lucide-react"

import type { SummonedSurface } from "@/lib/environment/summon"
import { EMPTY_SPINE, type WorldSpine } from "@/lib/environment/working-world"
import { isExecutionLive } from "@/lib/environment/world-execution"
import { EditorSurface } from "./editor-surface"
import { BrainCouncilSurface, REFERENCE_COUNCIL_SESSION, type CouncilAdvisoryAction } from "./brain-council-surface"
import { InspectorSurfaceView, type InspectorSurface } from "./inspector-surface"
import { MissionControlSurface, type MissionControlSpaceProjection } from "./mission-control-surface"
import { WindowFrame } from "./window-frame"
import { defaultSpace, nextSpaceRevision, normalizeSpace, spaceInViewport, spaceToServer, type SpaceEnvelope, type WindowGeometry, type WindowId, type WorkspaceProject, type WorkspaceSpace } from "./types"
import bridge from "./experience-token-bridge.module.css"
import spatial from "./experience-spatial.module.css"

type LineReply = Readonly<{
  worldId?: string
  say?: string
  surfaces?: readonly Omit<InspectorSurface, "id">[]
  dismiss?: "all" | string
  spine?: WorldSpine
}>

type ConversationEntry = Readonly<{
  id: number
  role: "owner" | "williamos"
  text: string
}>

type PersistJob = Readonly<{ worldId: string; revision: number; body: string }>
type SpaceStorage = "server" | "browser"
type EnvironmentOverlay = "council" | "mission-control" | null

const windowName: Record<WindowId, string> = {
  editor: "Source",
  "running-app": "Developer preview",
  tests: "Tests",
  diff: "Changes",
  terminal: "Terminal",
}

const referenceAgents = [
  { id: "builder", glyph: "B", role: "Builder", provider: "Codex", status: "implementing", assignment: "Workspace interaction", truth: "fixture" },
  { id: "reviewer", glyph: "R", role: "Reviewer", provider: "Claude", status: "reviewing", assignment: "Product criticism", truth: "fixture" },
  { id: "local", glyph: "L", role: "Local", provider: "HERMES", status: "idle", assignment: "Tests and preview", truth: "fixture" },
] as const

const browserSpaceKey = (opaque: string) => `williamos:space:${opaque}`

function inspectorId(surface: Pick<InspectorSurface, "kind" | "subject">): string {
  const source = `${surface.kind}\0${surface.subject}`
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `inspector-${(hash >>> 0).toString(36)}`
}

export function WorkspaceShell({ initialSummon = null }: { initialSummon?: SummonedSurface | null }) {
  const [space, setSpace] = useState<WorkspaceSpace>(() => defaultSpace())
  const [worldId, setWorldId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const [lineOpen, setLineOpen] = useState(Boolean(initialSummon))
  const [lineInput, setLineInput] = useState("")
  const [lineReply, setLineReply] = useState<string | null>(null)
  const [lineBusy, setLineBusy] = useState(false)
  const [inspectors, setInspectors] = useState<readonly InspectorSurface[]>([])
  const [conversation, setConversation] = useState<readonly ConversationEntry[]>([])
  const [overlay, setOverlay] = useState<EnvironmentOverlay>(null)
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null)
  const [councilQuestion, setCouncilQuestion] = useState<string | null>(null)
  const [spine, setSpine] = useState<WorldSpine>(EMPTY_SPINE)
  const [project, setProject] = useState<WorkspaceProject | null>(null)
  const [storage, setStorage] = useState<SpaceStorage>("server")
  const stateRef = useRef(space)
  const worldRef = useRef(worldId)
  const storageRef = useRef<SpaceStorage>(storage)
  const browserStorageKeyRef = useRef<string | null>(null)
  const lineRef = useRef<HTMLInputElement>(null)
  const messageSequence = useRef(0)
  const spaceArrival = useRef<Promise<SpaceEnvelope> | null>(null)
  const summonArrival = useRef<Readonly<{ key: string; request: Promise<LineReply> }> | null>(null)
  const restorationStarted = useRef(false)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revisionRef = useRef(0)
  const acknowledgedRevisionRef = useRef(0)
  const pendingPersistRef = useRef<PersistJob | null>(null)
  const drainingPersistRef = useRef(false)
  stateRef.current = space
  worldRef.current = worldId
  storageRef.current = storage

  const appendConversation = useCallback((role: ConversationEntry["role"], text: string) => {
    const normalized = text.trim()
    if (!normalized) return
    messageSequence.current += 1
    const entry: ConversationEntry = { id: messageSequence.current, role, text: normalized }
    setConversation((current) => [...current, entry])
  }, [])

  const materializeSurfaces = useCallback((reply: LineReply) => {
    if (reply.dismiss) {
      setInspectors((current) => {
        const next = reply.dismiss === "all" ? [] : current.filter((surface) => surface.kind !== reply.dismiss)
        return next
      })
      setSpace((current) => {
        const removedIds = new Set(inspectors.filter((surface) => reply.dismiss === "all" || surface.kind === reply.dismiss).map((surface) => surface.id))
        return {
          ...current,
          inspectorWindows: Object.fromEntries(Object.entries(current.inspectorWindows).filter(([id]) => !removedIds.has(id))),
          inspectorSeeds: Object.fromEntries(Object.entries(current.inspectorSeeds).filter(([id]) => !removedIds.has(id))),
          activeWindowId: current.activeWindowId && removedIds.has(current.activeWindowId) ? null : current.activeWindowId,
        }
      })
    }
    const incoming = (reply.surfaces ?? []).map((surface) => ({ ...surface, id: inspectorId(surface) }))
    if (incoming.length === 0) return
    setInspectors((current) => {
      const byId = new Map(current.map((surface) => [surface.id, surface]))
      incoming.forEach((surface) => byId.set(surface.id, surface))
      return [...byId.values()]
    })
    setSpace((current) => {
      const highest = Math.max(
        ...Object.values(current.windows).map((window) => window.z),
        ...Object.values(current.inspectorWindows).map((window) => window.z),
      )
      const inspectorWindows = { ...current.inspectorWindows }
      const inspectorSeeds = { ...current.inspectorSeeds }
      incoming.forEach((surface, index) => {
        inspectorWindows[surface.id] ??= {
          x: 104 + index * 34,
          y: 72 + index * 30,
          width: 560,
          height: 480,
          z: highest + index + 1,
          minimized: false,
        }
        inspectorSeeds[surface.id] = { kind: surface.kind, subject: surface.subject }
      })
      const active = incoming.at(-1)?.id ?? current.activeWindowId
      return { ...current, inspectorWindows, inspectorSeeds, activeWindowId: active }
    })
  }, [inspectors])

  const acceptLineReply = useCallback((reply: LineReply) => {
    if (typeof reply.worldId === "string") setWorldId(reply.worldId)
    if (reply.spine) setSpine(reply.spine)
    const say = typeof reply.say === "string" ? reply.say : ""
    if (say) appendConversation("williamos", say)
    setLineReply(null)
    materializeSurfaces(reply)
  }, [appendConversation, materializeSurfaces])

  useEffect(() => {
    let cancelled = false
    const fallback = defaultSpace(window.innerWidth, window.innerHeight)
    const request = (spaceArrival.current ??= (async () => {
      const response = await fetch("/api/environment/space", { cache: "no-store" })
      const payload = (await response.json()) as Partial<SpaceEnvelope> & { error?: string }
      if (!response.ok || typeof payload.worldId !== "string" || !payload.space) {
        throw new Error(payload.error ?? `SPACE_${response.status}`)
      }
      return {
        worldId: payload.worldId,
        space: payload.space,
        spine: payload.spine,
        project: payload.project,
        storage: payload.storage,
        browserStorageKey: payload.browserStorageKey,
      }
    })())
    void request
      .then((payload) => {
        if (cancelled) return
        const storageMode = payload.storage === "browser" ? "browser" : "server"
        const key = storageMode === "browser" && typeof payload.browserStorageKey === "string"
          && payload.browserStorageKey.length > 0
          ? browserSpaceKey(payload.browserStorageKey)
          : null
        if (storageMode === "browser" && !key) throw new Error("BROWSER_SPACE_KEY_UNAVAILABLE")
        let storedSpace = payload.space
        if (storageMode === "browser" && key) {
          browserStorageKeyRef.current = key
          try {
            const saved = window.localStorage.getItem(key)
            if (saved) storedSpace = (JSON.parse(saved) as { space?: unknown }).space ?? payload.space
          } catch {
            window.localStorage.removeItem(key)
          }
        }
        const restored = normalizeSpace(storedSpace, fallback, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
        revisionRef.current = restored.revision
        acknowledgedRevisionRef.current = restored.revision
        setWorldId(payload.worldId)
        setSpace(restored)
        setStorage(storageMode)
        if (payload.project) setProject(payload.project)
        if (payload.spine) setSpine(payload.spine)
      })
      .catch((error) => {
        if (!cancelled) {
          setSpace(fallback)
          setPersistenceError(error instanceof Error ? error.message : "SPACE_UNAVAILABLE")
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let frame: number | null = null
    const recontain = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        setSpace((current) => spaceInViewport(current, { width: window.innerWidth, height: window.innerHeight }))
      })
    }
    window.addEventListener("resize", recontain)
    return () => {
      window.removeEventListener("resize", recontain)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!hydrated || !worldId || restorationStarted.current) return
    restorationStarted.current = true
    for (const seed of Object.values(stateRef.current.inspectorSeeds)) {
      void fetch("/api/environment/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId, summon: seed.kind }),
      }).then(async (response) => {
        if (!response.ok) return
        const reply = await response.json() as LineReply
        if (reply.spine) setSpine(reply.spine)
        materializeSurfaces(reply)
      }).catch(() => {
        // Identity remains persisted. A failed current read never becomes fabricated payload.
      })
    }
  }, [hydrated, materializeSurfaces, worldId])

  useEffect(() => {
    const outcomeKey = spine.outcomeKey
    if (!outcomeKey || !isExecutionLive(spine.execution)) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/environment/execution?outcomeKey=${encodeURIComponent(outcomeKey)}`, { cache: "no-store" })
        if (!response.ok) return
        const live = await response.json() as Pick<WorldSpine, "execution" | "worker" | "evidence">
        if (cancelled) return
        setSpine((current) => current.outcomeKey === outcomeKey
          ? { ...current, execution: live.execution, worker: live.worker, evidence: live.evidence }
          : current)
      } catch {
        // Preserve the last canonical observation until the next successful read.
      }
    }, 4000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [spine.execution, spine.outcomeKey])

  const sendPersist = useCallback(async (job: PersistJob, keepalive = false) => {
    try {
      if (storageRef.current === "browser") {
        const key = browserStorageKeyRef.current
        if (!key) throw new Error("BROWSER_SPACE_KEY_UNAVAILABLE")
        window.localStorage.setItem(key, job.body)
        acknowledgedRevisionRef.current = job.revision
        revisionRef.current = Math.max(revisionRef.current, job.revision)
        setSpace((current) => job.revision > current.revision ? { ...current, revision: job.revision } : current)
        setPersistenceError(null)
        return
      }
      const response = await fetch("/api/environment/space", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: job.body,
        keepalive,
      })
      const payload = await response.json().catch(() => ({})) as { error?: string; space?: unknown }
      if (!response.ok) throw new Error(payload.error ?? `SPACE_SAVE_${response.status}`)
      const record = payload.space && typeof payload.space === "object" ? payload.space as Record<string, unknown> : null
      const acknowledged = record && Number.isSafeInteger(record.revision) ? record.revision as number : job.revision
      if (acknowledged >= acknowledgedRevisionRef.current) {
        acknowledgedRevisionRef.current = acknowledged
        revisionRef.current = Math.max(revisionRef.current, acknowledged)
        setSpace((current) => acknowledged > current.revision ? { ...current, revision: acknowledged } : current)
        setPersistenceError(null)
      }
    } catch (error) {
      if (!keepalive && job.revision >= revisionRef.current) {
        setPersistenceError(error instanceof Error ? error.message : "SPACE_SAVE_REFUSED")
      }
    }
  }, [])

  const persist = useCallback((keepalive = false) => {
    const id = worldRef.current
    if (!id) return
    const revision = nextSpaceRevision(revisionRef.current)
    revisionRef.current = revision
    const job: PersistJob = {
      worldId: id,
      revision,
      body: JSON.stringify({ worldId: id, space: spaceToServer(stateRef.current, revision) }),
    }
    if (keepalive) {
      void sendPersist(job, true)
      return
    }
    pendingPersistRef.current = job
    if (drainingPersistRef.current) return
    drainingPersistRef.current = true
    void (async () => {
      try {
        while (pendingPersistRef.current) {
          const next = pendingPersistRef.current
          pendingPersistRef.current = null
          await sendPersist(next)
        }
      } finally {
        drainingPersistRef.current = false
      }
    })()
  }, [sendPersist])

  useEffect(() => {
    if (!hydrated || !worldId) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => void persist(), 420)
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [
    space.windows, space.inspectorWindows, space.inspectorSeeds, space.activeWindowId,
    space.runningAppUrl, space.selectedPath, space.editor, worldId, hydrated, persist,
  ])

  useEffect(() => {
    const flush = () => void persist(true)
    const visibility = () => { if (document.visibilityState === "hidden") flush() }
    window.addEventListener("pagehide", flush)
    window.addEventListener("blur", flush)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      window.removeEventListener("pagehide", flush)
      window.removeEventListener("blur", flush)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [persist])

  useEffect(() => {
    const summonLine = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setLineReply(null)
        setLineOpen(true)
        requestAnimationFrame(() => lineRef.current?.focus())
      } else if (event.key === "Escape") {
        setLineOpen(false)
      }
    }
    window.addEventListener("keydown", summonLine)
    return () => window.removeEventListener("keydown", summonLine)
  }, [])

  useEffect(() => {
    if (!initialSummon || !hydrated) return
    let cancelled = false
    const key = `${worldId ?? "new"}\0${initialSummon}`
    const existing = summonArrival.current
    const request = existing?.key === key
      ? existing.request
      : (async () => {
          const response = await fetch("/api/environment/line", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ worldId, summon: initialSummon }),
          })
          const payload = await response.json()
          if (!response.ok) throw new Error(payload.error ?? `LINE_${response.status}`)
          return payload as LineReply
        })()
    summonArrival.current = { key, request }
    setLineOpen(true)
    setLineBusy(true)
    void request
      .then((payload) => { if (!cancelled) acceptLineReply(payload) })
      .catch((error) => { if (!cancelled) setLineReply(error instanceof Error ? error.message : "LINE_UNAVAILABLE") })
      .finally(() => { if (!cancelled) setLineBusy(false) })
    return () => { cancelled = true }
  }, [acceptLineReply, hydrated, initialSummon, worldId])

  const dismissInspector = useCallback((id: string) => {
    setInspectors((current) => current.filter((surface) => surface.id !== id))
    setSpace((current) => {
      const inspectorWindows = { ...current.inspectorWindows }
      const inspectorSeeds = { ...current.inspectorSeeds }
      delete inspectorWindows[id]
      delete inspectorSeeds[id]
      return { ...current, inspectorWindows, inspectorSeeds, activeWindowId: current.activeWindowId === id ? null : current.activeWindowId }
    })
  }, [])

  const updateWindow = useCallback((id: WindowId, geometry: WindowGeometry) => {
    setSpace((current) => ({ ...current, windows: { ...current.windows, [id]: geometry } }))
  }, [])

  const activate = useCallback((id: WindowId) => {
    setFocusedAgentId(null)
    setSpace((current) => {
      const highest = Math.max(
        ...Object.values(current.windows).map((window) => window.z),
        ...Object.values(current.inspectorWindows).map((window) => window.z),
      )
      const chosen = current.windows[id]
      if (current.activeWindowId === id && chosen.z === highest && !chosen.minimized) return current
      return {
        ...current,
        activeWindowId: id,
        windows: { ...current.windows, [id]: { ...chosen, minimized: false, z: highest + 1 } },
      }
    })
  }, [])

  const minimize = useCallback((id: WindowId) => {
    setSpace((current) => ({
      ...current,
      activeWindowId: current.activeWindowId === id ? null : current.activeWindowId,
      windows: { ...current.windows, [id]: { ...current.windows[id], minimized: true } },
    }))
  }, [])

  const updateInspector = useCallback((id: string, geometry: WindowGeometry) => {
    setSpace((current) => ({ ...current, inspectorWindows: { ...current.inspectorWindows, [id]: geometry } }))
  }, [])

  const activateInspector = useCallback((id: string) => {
    setSpace((current) => {
      const chosen = current.inspectorWindows[id]
      if (!chosen) return current
      const highest = Math.max(
        ...Object.values(current.windows).map((window) => window.z),
        ...Object.values(current.inspectorWindows).map((window) => window.z),
      )
      return {
        ...current,
        activeWindowId: id,
        inspectorWindows: { ...current.inspectorWindows, [id]: { ...chosen, minimized: false, z: highest + 1 } },
      }
    })
  }, [])

  const openLine = useCallback((prompt = "") => {
    setLineInput(prompt)
    setLineReply(null)
    setLineOpen(true)
    requestAnimationFrame(() => lineRef.current?.focus())
  }, [])

  async function submitLine(event: React.FormEvent) {
    event.preventDefault()
    const text = lineInput.trim()
    if (!text || lineBusy) return
    appendConversation("owner", text)
    setLineInput("")
    const councilRequest = text.match(/^\/?council\b[\s:—-]*(.*)$/i)
    if (councilRequest) {
      setCouncilQuestion(councilRequest[1]?.trim() || `Challenge the current direction for ${selectedLabel}.`)
      setOverlay("council")
      setLineOpen(false)
      return
    }
    setLineBusy(true)
    setLineReply(null)
    try {
      const contextualText = `Selected ${selectedKind}: ${selectedLabel}\nOwner request: ${text}`
      const response = await fetch("/api/environment/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId, text: contextualText }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? `LINE_${response.status}`)
      acceptLineReply(payload as LineReply)
    } catch (error) {
      setLineReply(error instanceof Error ? error.message : "LINE_UNAVAILABLE")
    } finally {
      setLineBusy(false)
    }
  }

  const savedLabel = persistenceError
    ? persistenceError
    : hydrated
      ? storage === "browser" ? "space saved locally" : "space saved"
      : "opening space"
  const selectedAgent = referenceAgents.find((agent) => agent.id === focusedAgentId)
  const selectedKind = selectedAgent ? "agent" as const
    : space.activeWindowId === "running-app" ? "preview" as const
    : space.activeWindowId === "diff" ? "diff" as const
    : space.activeWindowId === "editor" && space.selectedPath ? "file" as const
    : "space" as const
  const selectedLabel = selectedAgent ? `${selectedAgent.role} · ${selectedAgent.provider}`
    : selectedKind === "preview" ? "TerraFusion developer preview"
    : selectedKind === "diff" ? "Current changes"
    : selectedKind === "file" ? space.selectedPath!
    : `${project?.name ?? space.name} Space`
  const selectedKindLabel = selectedKind === "file" ? "file"
    : selectedKind === "preview" ? "preview"
    : selectedKind === "diff" ? "changes"
    : selectedKind === "agent" ? "agent session"
    : "Space"
  const selectedActions = selectedKind === "file" ? ["Ask", "Change", "Delegate", "Review"] as const
    : selectedKind === "preview" ? ["Inspect", "Debug", "Explain", "Delegate"] as const
    : selectedKind === "diff" ? ["Review", "Improve", "Challenge", "Merge"] as const
    : selectedKind === "agent" ? ["Talk", "Redirect", "Pause", "Fork", "Review work"] as const
    : ["Summarize", "Continue", "Delegate", "Council"] as const
  const worldLine = spine.outcomeKey ? ` · ${spine.outcomeKey} · ${spine.execution}` : ""
  const workerLine = spine.worker ? ` · worker: ${spine.worker.lane} lane` : ""
  const williamJudgment = persistenceError
    ? `Space persistence is refusing writes (${persistenceError}). Inspect that before trusting re-entry.`
    : !space.runningAppUrl
      ? "The developer preview is not attached. I would not call the visual loop accepted yet."
      : space.selectedPath
        ? `${space.selectedPath} is selected. Review or delegate against that file without restating context.`
        : "No source object is selected. Choose the work before delegating it."

  const missionWindowKind: Record<WindowId, MissionControlSpaceProjection["windows"][number]["kind"]> = {
    editor: "source", "running-app": "preview", tests: "tests", diff: "diff", terminal: "terminal",
  }
  const currentMissionSpace: MissionControlSpaceProjection = {
    id: space.id,
    name: project?.name ?? space.name,
    focus: space.selectedPath ?? "Development Space",
    state: space.runningAppUrl ? "live" : "unavailable",
    truth: "live",
    windows: (Object.entries(space.windows) as [WindowId, WindowGeometry][]).map(([id, geometry]) => ({
      id, title: windowName[id], kind: missionWindowKind[id],
      frame: geometry, minimized: geometry.minimized, active: space.activeWindowId === id,
      detail: id === "running-app" ? space.runningAppUrl ? "Target runtime attached" : "Runtime unavailable" : undefined,
    })),
    agents: spine.worker ? [{
      id: "live-worker", name: "Resident worker", role: spine.worker.lane,
      activity: spine.execution, state: isExecutionLive(spine.execution) ? "working" : "idle",
    }] : [],
    selectedObject: space.selectedPath,
    changed: savedLabel,
  }
  const missionSpaces: readonly MissionControlSpaceProjection[] = [currentMissionSpace,
    {
      id: "fixture-research", name: "Research & Evidence", focus: "Reference projection", state: "paused", truth: "fixture",
      windows: [
        { id: "evidence", title: "Evidence", kind: "evidence", frame: { x: 20, y: 30, width: 520, height: 340 }, detail: "3 cited sources" },
        { id: "document", title: "Investigation", kind: "document", frame: { x: 410, y: 70, width: 620, height: 420 }, detail: "Causal link under review" },
      ], agents: [], changed: "Illustrative Space · not live runtime state",
    },
    {
      id: "fixture-agents", name: "Agent Operations", focus: "Reference projection", state: "paused", truth: "fixture",
      windows: [{ id: "sessions", title: "Durable sessions", kind: "agent", frame: { x: 80, y: 50, width: 850, height: 420 }, detail: "Role-first session view" }],
      agents: referenceAgents.map((agent) => ({ id: agent.id, name: agent.provider, role: agent.role, activity: agent.status, state: agent.status === "idle" ? "idle" : "working" })),
      changed: "Illustrative Space · sessions are fixtures",
    },
  ]

  const utilityContent = (id: "tests" | "diff" | "terminal") => (
    <div className={spatial.utilitySurface}>
      <div className={spatial.utilityMeta}>
        <span>{id === "tests" ? "Focused validation" : id === "diff" ? "Current change" : "Project terminal"}</span>
        <span>Reference surface · no live adapter attached</span>
      </div>
      <div className={spatial.utilityBody}>
        {id === "tests" ? <>
          <div className={spatial.utilityRow}><span className={spatial.pass}>✓</span><span>editor save and restore</span><span className={spatial.muted}>passed</span></div>
          <div className={spatial.utilityRow}><span className={spatial.pass}>✓</span><span>spatial window persistence</span><span className={spatial.muted}>passed</span></div>
          <div className={spatial.utilityRow}><span className={spatial.fail}>×</span><span>browser owner acceptance</span><span className={spatial.muted}>not run</span></div>
        </> : id === "diff" ? <>
          <div className={spatial.removed}>- fixed three-column shell</div>
          <div className={spatial.added}>+ durable spatial work surfaces</div>
          <div className={spatial.added}>+ selected-object AI actions</div>
        </> : <>
          <div><span className={spatial.terminalPrompt}>terra@workspace %</span> project runtime not attached</div>
          <div className={spatial.muted}>This developer surface is interactive UI reference state, not fabricated execution.</div>
        </>}
      </div>
    </div>
  )

  function openObjectAction(action: string) {
    if (action === "Council") {
      setCouncilQuestion(`Challenge the current direction for ${selectedLabel}.`)
      setOverlay("council")
      return
    }
    openLine(`${action} this selected ${selectedKindLabel}: `)
  }

  function handleCouncilAction(action: CouncilAdvisoryAction) {
    setOverlay(null)
    openLine(`Council recommendation · ${action.replaceAll("-", " ")}: `)
  }

  function inspectWilliamJudgment() {
    if (persistenceError) {
      openLine(`Inspect Space persistence error (${persistenceError}): `)
    } else if (!space.runningAppUrl) {
      activate("running-app")
    } else if (space.selectedPath) {
      activate("editor")
    } else {
      openLine(`Inspect William's recommendation for ${selectedLabel}: `)
    }
  }

  return (
    <main className={`${spatial.environment} ${bridge.tokens}`} aria-label={`${project?.name ?? "Workspace"} Space`}>
      <header className={spatial.topBar}>
        <div className={spatial.identity}>
          <span className={spatial.mark} aria-label="WilliamOS">W</span>
          <span className={spatial.spaceIdentity} aria-label="Workspace project" title={project?.identity ?? "Resolving configured workspace"}>
            <strong>{project?.name ?? "Opening workspace"}</strong>
            <span className={spatial.spacePath}>{project?.identity ?? ""}</span>
          </span>
        </div>
        <nav className={spatial.sessionStrip} aria-label="Durable agent sessions">
          {referenceAgents.map((agent) => (
            <button key={agent.id} type="button" className={spatial.sessionButton} aria-pressed={focusedAgentId === agent.id} onClick={() => { setFocusedAgentId(agent.id); openLine(`Redirect ${agent.role} · ${agent.provider} on ${selectedLabel}: `) }}>
              <span className={spatial.sessionGlyph}>{agent.glyph}</span>
              <span><strong>{agent.role} · {agent.provider}</strong><small>{agent.status} · <em className={spatial.fixtureTag}>reference session</em></small></span>
            </button>
          ))}
        </nav>
        <div className={spatial.status}><span className={spatial.statusDot} aria-hidden /><span>{worldLine || "Space ready"}{workerLine}</span></div>
      </header>

      <div className={spatial.objectBar} aria-label="Selected object actions">
        <span className={spatial.objectLabel}><strong>Selected {selectedKindLabel}</strong> · {selectedLabel}</span>
        <div className={spatial.objectActions}>
          {selectedActions.map((action) => (
            <button key={action} type="button" className={`${spatial.action} ${action === "Delegate" || action === "Council" ? spatial.primaryAction : ""}`} onClick={() => openObjectAction(action)}>{action}</button>
          ))}
        </div>
      </div>

      <div className={spatial.windowLayer} aria-label="Spatial work surfaces">
        <WindowFrame id="editor" title="Source" geometry={space.windows.editor} active={space.activeWindowId === "editor"} onActivate={() => activate("editor")} onGeometry={(geometry) => updateWindow("editor", geometry)} onMinimize={() => minimize("editor")}>
          <EditorSurface space={space} onEditorChange={(editor, selectedPath) => setSpace((current) => ({ ...current, editor, selectedPath }))} />
        </WindowFrame>
        <WindowFrame id="running-app" title="Developer preview · TerraFusion" geometry={space.windows["running-app"]} active={space.activeWindowId === "running-app"} onActivate={() => activate("running-app")} onGeometry={(geometry) => updateWindow("running-app", geometry)} onMinimize={() => minimize("running-app")}>
          {space.runningAppUrl ? <iframe src={space.runningAppUrl} title="Running TerraFusion application" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads" className="h-full w-full border-0" /> : (
            <div className="grid h-full place-content-center gap-3 p-8 text-center" role="status"><AppWindow className="mx-auto text-[#91a48c]" size={26} aria-hidden /><strong>Developer preview unavailable</strong><span className="max-w-md text-xs text-[#8e998b]">Attach the TerraFusion development runtime when you want the real target beside source. WilliamOS remains fully usable; no business workflow is being simulated.</span></div>
          )}
        </WindowFrame>
        {(["tests", "diff", "terminal"] as const).map((id) => (
          <WindowFrame key={id} id={id} title={windowName[id]} geometry={space.windows[id]} active={space.activeWindowId === id} onActivate={() => activate(id)} onGeometry={(geometry) => updateWindow(id, geometry)} onMinimize={() => minimize(id)}>
            {utilityContent(id)}
          </WindowFrame>
        ))}
        {inspectors.map((surface) => {
          const geometry = space.inspectorWindows[surface.id]
          if (!geometry) return null
          return <WindowFrame key={surface.id} id={surface.id} title={`Inspector · ${surface.subject}`} geometry={geometry} active={space.activeWindowId === surface.id} onActivate={() => activateInspector(surface.id)} onGeometry={(next) => updateInspector(surface.id, next)} onMinimize={() => updateInspector(surface.id, { ...geometry, minimized: true })} onClose={() => dismissInspector(surface.id)}><InspectorSurfaceView surface={surface} /></WindowFrame>
        })}
      </div>

      <nav className={spatial.dock} aria-label="Surface dock">
        {space.dock.map((id) => (
          <button key={id} type="button" className={`${spatial.dockButton} ${space.activeWindowId === id && !space.windows[id].minimized ? spatial.dockButtonActive : ""}`} onClick={() => activate(id)} aria-label={`${space.windows[id].minimized ? "Restore" : "Focus"} ${windowName[id]}`} title={windowName[id]}>
            {id === "editor" ? <Braces size={15} /> : id === "running-app" ? <AppWindow size={15} /> : id === "tests" ? <FlaskConical size={15} /> : id === "diff" ? <GitCompare size={15} /> : <TerminalSquare size={15} />}
          </button>
        ))}
        <button type="button" className={spatial.dockButton} onClick={() => setOverlay("mission-control")} aria-label="Open Mission Control" title="Mission Control"><Grid2X2 size={15} /></button>
        <button type="button" className={spatial.dockButton} onClick={() => setOverlay("council")} aria-label="Summon Brain Council" title="Brain Council"><Users size={15} /></button>
      </nav>

      <footer className={spatial.williamRail} aria-label="William intelligence presence">
        <span className={spatial.williamOrb} aria-hidden>W</span>
        <div className={spatial.judgment}><strong>William</strong><p>{williamJudgment}</p></div>
        <div className={spatial.williamActions}>
          <button type="button" className={spatial.overlayButton} onClick={inspectWilliamJudgment}>Inspect</button>
          <button type="button" className={spatial.overlayButton} onClick={() => openLine(`Override William's recommendation for ${selectedLabel}: `)}>Override</button>
          <button type="button" className={spatial.overlayButton} onClick={() => { setCouncilQuestion(`Challenge William's recommendation: ${williamJudgment}`); setOverlay("council") }}>Ask Council</button>
          <button type="button" className={spatial.overlayButton} onClick={() => openLine()}>The Line · Ctrl+K</button>
        </div>
        <span className={`${spatial.persistence} ${persistenceError ? spatial.persistenceError : ""}`} title={persistenceError ?? undefined}>{savedLabel}</span>
      </footer>

      {lineOpen ? (
        <div className={spatial.lineBackdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) setLineOpen(false) }}>
          <form className={spatial.line} onSubmit={submitLine} aria-label="The Line">
            <Command size={16} aria-hidden />
            <div><span className={spatial.lineContext}>{selectedKind} · {selectedLabel}</span><input ref={lineRef} className={spatial.lineInput} value={lineInput} onChange={(event) => setLineInput(event.target.value)} placeholder="Ask, change, delegate, or review" aria-label="The Line" autoComplete="off" />{lineReply ? <output className={spatial.lineReply}>{lineReply}</output> : conversation.at(-1) ? <span className={spatial.lineReply}>{conversation.at(-1)?.role === "williamos" ? "William" : "You"} · {conversation.at(-1)?.text}</span> : null}</div>
            <div className={spatial.lineControls}><button type="submit" className={spatial.lineSend} disabled={lineBusy || !lineInput.trim()}>{lineBusy ? "Working" : "Send"}</button><button type="button" className={spatial.lineClose} onClick={() => setLineOpen(false)} aria-label="Close The Line"><X size={14} /></button></div>
          </form>
        </div>
      ) : null}

      {overlay === "council" ? <div className={spatial.councilHost}><BrainCouncilSurface selectedContext={{ spaceName: project?.name ?? space.name, kind: selectedKind, label: selectedLabel, detail: "Reference advisory roles bound to the current real Space context and owner question" }} session={{ ...REFERENCE_COUNCIL_SESSION, question: councilQuestion ?? `Challenge the current direction for ${selectedLabel}.` }} onDismiss={() => setOverlay(null)} onAdvisoryAction={(action) => handleCouncilAction(action)} /></div> : null}
      {overlay === "mission-control" ? <MissionControlSurface spaces={missionSpaces} currentSpaceId={space.id} onEnterSpace={() => setOverlay(null)} onDismiss={() => setOverlay(null)} williamOverview={{ summary: williamJudgment, attention: persistenceError || !space.runningAppUrl ? "One visible acceptance condition still needs attention." : null, truth: "live" }} /> : null}
    </main>
  )
}
