"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AppWindow, Braces, Command, FlaskConical, GitCompare, Grid2X2, TerminalSquare, Users, X } from "lucide-react"

import type { SummonedSurface } from "@/lib/environment/summon"
import { EMPTY_SPINE, type WilliamJudgment, type WorldSpine } from "@/lib/environment/working-world"
import { isExecutionLive } from "@/lib/environment/world-execution"
import { EditorSurface } from "./editor-surface"
import { DeveloperToolsSurface } from "./developer-tools-surface"
import { type ChangeRefreshResult, useSelectedFileChange } from "./use-selected-file-change"
import { AgentSessionStrip, useExperienceAgentSessions } from "./agent-sessions"
import { BrainCouncilSurface, type BrainCouncilSession, type CouncilAdvisoryAction } from "./brain-council-surface"
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
type LineTarget = "william" | "agent"
type LineMode = "default" | "change"
type ChangeRefresh = Readonly<{ path: string | null; key: number }>
type ChangeRefreshWaiter = {
  path: string
  resolve: (result: ChangeRefreshResult) => void
  editor?: ChangeRefreshResult
  diff?: "refreshed" | "failed"
}

const windowName: Record<WindowId, string> = {
  editor: "Source",
  "running-app": "Developer preview",
  tests: "Tests",
  diff: "Changes",
  terminal: "Terminal",
}

const browserSpaceKey = (opaque: string) => `williamos:space:${opaque}`

function williamJudgmentContextKey(space: WorkspaceSpace, spine: WorldSpine): string {
  return JSON.stringify({
    project: spine.projectName,
    execution: spine.execution,
    selectedPath: space.selectedPath,
    runningAppUrl: space.runningAppUrl,
    evidence: spine.evidence.at(-1) ?? null,
  })
}

function agentReplyText(payload: Readonly<Record<string, unknown>>): readonly string[] {
  if (payload.type !== "event" || !payload.event || typeof payload.event !== "object") return []
  const event = payload.event as Record<string, unknown>
  if (event.type === "result" && typeof event.result === "string") return [event.result]
  const message = event.message as { content?: unknown } | undefined
  if (event.type !== "assistant" || !Array.isArray(message?.content)) return []
  return message.content.flatMap((block) => {
    if (!block || typeof block !== "object") return []
    const record = block as Record<string, unknown>
    return record.type === "text" && typeof record.text === "string" ? [record.text] : []
  })
}

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
  const [lineTarget, setLineTarget] = useState<LineTarget>("william")
  const [lineMode, setLineMode] = useState<LineMode>("default")
  const [changeTarget, setChangeTarget] = useState<string | null>(null)
  const [dirtyPaths, setDirtyPaths] = useState<Readonly<Record<string, boolean>>>({})
  const [changeRefresh, setChangeRefresh] = useState<ChangeRefresh>({ path: null, key: 0 })
  const changeRefreshKey = useRef(0)
  const changeRefreshWaiters = useRef(new Map<number, ChangeRefreshWaiter>())
  const [inspectors, setInspectors] = useState<readonly InspectorSurface[]>([])
  const [conversation, setConversation] = useState<readonly ConversationEntry[]>([])
  const [overlay, setOverlay] = useState<EnvironmentOverlay>(null)
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null)
  const [councilQuestion, setCouncilQuestion] = useState<string | null>(null)
  const [councilSession, setCouncilSession] = useState<BrainCouncilSession | null>(null)
  const [councilBusy, setCouncilBusy] = useState(false)
  const [councilError, setCouncilError] = useState<string | null>(null)
  const [spine, setSpine] = useState<WorldSpine>(EMPTY_SPINE)
  const [judgment, setJudgment] = useState<WilliamJudgment | null>(null)
  const [judgmentBusy, setJudgmentBusy] = useState(false)
  const [judgmentError, setJudgmentError] = useState<string | null>(null)
  const [project, setProject] = useState<WorkspaceProject | null>(null)
  const [storage, setStorage] = useState<SpaceStorage>("server")
  const agentSessions = useExperienceAgentSessions({
    ownerScope: worldId ?? "unhydrated-owner-world",
    worldScope: project?.identity ?? worldId ?? "unhydrated-project",
    worker: spine.worker ?? null,
  })
  const stateRef = useRef(space)
  const spineRef = useRef(spine)
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
  const drainPromiseRef = useRef<Promise<void> | null>(null)
  const persistBarrierRef = useRef<() => Promise<void>>(async () => {})
  const judgmentRequestedRef = useRef<string | null>(null)
  const judgmentContextRef = useRef<string | null>(null)
  stateRef.current = space
  spineRef.current = spine
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
    // A Line turn can change server-only judgment facts (validation marks, concerns, failures,
    // intent). Clear the active opinion until it is regenerated from the newly persisted world.
    judgmentRequestedRef.current = null
    setJudgment(null)
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
        judgment: payload.judgment,
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
        setJudgment(payload.judgment ?? null)
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

  const refreshWilliamJudgment = useCallback(async () => {
    const id = worldRef.current
    if (!id || storageRef.current !== "server" || judgmentBusy) return
    setJudgmentBusy(true)
    setJudgmentError(null)
    try {
      await persistBarrierRef.current()
      const requestContext = williamJudgmentContextKey(stateRef.current, spineRef.current)
      const response = await fetch("/api/environment/judgment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId: id }),
        cache: "no-store",
      })
      const payload = await response.json() as { error?: string; judgment?: WilliamJudgment }
      if (!response.ok || !payload.judgment) throw new Error(payload.error ?? `JUDGMENT_${response.status}`)
      if (worldRef.current !== id || williamJudgmentContextKey(stateRef.current, spineRef.current) !== requestContext) {
        judgmentRequestedRef.current = null
        return
      }
      setJudgment(payload.judgment)
    } catch (error) {
      setJudgmentError(error instanceof Error ? error.message : "JUDGMENT_UNAVAILABLE")
    } finally {
      setJudgmentBusy(false)
    }
  }, [judgmentBusy])

  useEffect(() => {
    if (!hydrated || !worldId || storage !== "server" || judgment || judgmentRequestedRef.current === worldId) return
    judgmentRequestedRef.current = worldId
    void refreshWilliamJudgment()
  }, [hydrated, judgment, refreshWilliamJudgment, storage, worldId])

  const judgmentContextKey = williamJudgmentContextKey(space, spine)
  useEffect(() => {
    if (!hydrated) return
    if (judgmentContextRef.current === null) {
      judgmentContextRef.current = judgmentContextKey
      return
    }
    if (judgmentContextRef.current === judgmentContextKey) return
    judgmentContextRef.current = judgmentContextKey
    judgmentRequestedRef.current = null
    setJudgment(null)
  }, [hydrated, judgmentContextKey])

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

  const persist = useCallback((keepalive = false): Promise<void> => {
    const id = worldRef.current
    if (!id) return Promise.resolve()
    const revision = nextSpaceRevision(revisionRef.current)
    revisionRef.current = revision
    const job: PersistJob = {
      worldId: id,
      revision,
      body: JSON.stringify({ worldId: id, space: spaceToServer(stateRef.current, revision) }),
    }
    if (keepalive) {
      return sendPersist(job, true)
    }
    pendingPersistRef.current = job
    if (drainingPersistRef.current) return drainPromiseRef.current ?? Promise.resolve()
    drainingPersistRef.current = true
    const drain = (async () => {
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
    drainPromiseRef.current = drain
    void drain.finally(() => {
      if (drainPromiseRef.current === drain) drainPromiseRef.current = null
    })
    return drain
  }, [sendPersist])
  persistBarrierRef.current = async () => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    await persist()
    if (storageRef.current !== "server" || acknowledgedRevisionRef.current < revisionRef.current) {
      throw new Error("The current Space must be saved before grounded reasoning can begin.")
    }
  }

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

  const openLine = useCallback((prompt = "", target: LineTarget = "william") => {
    setLineTarget(target)
    setLineMode("default")
    setLineInput(prompt)
    setLineReply(null)
    setLineOpen(true)
    requestAnimationFrame(() => lineRef.current?.focus())
  }, [])

  const onSelectedFileDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyPaths((current) => current[path] === dirty ? current : { ...current, [path]: dirty })
  }, [])

  const settleChangeRefresh = useCallback((surface: "editor" | "diff", path: string, key: number, result: ChangeRefreshResult | "failed") => {
    const waiter = changeRefreshWaiters.current.get(key)
    if (!waiter || waiter.path !== path) return
    if (surface === "editor") waiter.editor = result as ChangeRefreshResult
    else waiter.diff = result === "refreshed" ? "refreshed" : "failed"
    if (!waiter.editor || !waiter.diff) return
    changeRefreshWaiters.current.delete(key)
    setChangeRefresh((current) => current.key === key ? { path: null, key } : current)
    waiter.resolve(waiter.editor === "dirty-conflict" ? "dirty-conflict" : waiter.editor === "refreshed" && waiter.diff === "refreshed" ? "refreshed" : "failed")
  }, [])

  const refreshVerifiedChange = useCallback((path: string) => new Promise<ChangeRefreshResult>((resolve) => {
    const key = changeRefreshKey.current + 1
    changeRefreshKey.current = key
    changeRefreshWaiters.current.set(key, { path, resolve })
    setChangeRefresh({ path, key })
    activate("editor")
    activate("diff")
  }), [activate])

  const change = useSelectedFileChange({
    path: changeTarget,
    dirty: Boolean(changeTarget && dirtyPaths[changeTarget]),
    onVerifiedSuccess: refreshVerifiedChange,
  })

  const openChange = useCallback(() => {
    if (change.running) return
    const target = space.selectedPath
    setChangeTarget(target)
    change.reset(target)
    setLineTarget("william")
    setLineMode("change")
    setLineInput("")
    setLineReply(null)
    setLineOpen(true)
    requestAnimationFrame(() => lineRef.current?.focus())
  }, [change.reset, change.running, space.selectedPath])

  useEffect(() => {
    const summonLine = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        if (!change.running) {
          setLineTarget("william")
          setLineMode("default")
          setLineReply(null)
        }
        setLineOpen(true)
        requestAnimationFrame(() => lineRef.current?.focus())
      } else if (event.key === "Escape" && !change.running) {
        setLineOpen(false)
      }
    }
    window.addEventListener("keydown", summonLine)
    return () => window.removeEventListener("keydown", summonLine)
  }, [change.running])

  async function summonCouncil(question: string) {
    setCouncilQuestion(question)
    setCouncilSession(null)
    setCouncilError(null)
    setCouncilBusy(true)
    setOverlay("council")
    if (!worldId) {
      setCouncilError("Council needs an open persistent Space.")
      setCouncilBusy(false)
      return
    }
    if (selectedAgent?.kind === "durable-session") {
      setCouncilError("Council cannot ground this browser-saved Claude session yet. Select a persisted Space object or live world worker.")
      setCouncilBusy(false)
      return
    }
    try {
      await persistBarrierRef.current()
      const response = await fetch("/api/environment/council", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          worldId,
          question,
          selectedContext: { kind: selectedKind, label: selectedLabel },
        }),
        cache: "no-store",
      })
      const payload = await response.json() as { error?: string; detail?: string; session?: BrainCouncilSession }
      if (!response.ok || !payload.session) throw new Error(payload.detail ?? payload.error ?? `COUNCIL_${response.status}`)
      setCouncilSession(payload.session)
    } catch (error) {
      setCouncilError(error instanceof Error ? error.message : "Council inference is unavailable.")
    } finally {
      setCouncilBusy(false)
    }
  }

  async function submitLine(event: React.FormEvent) {
    event.preventDefault()
    const text = lineInput.trim()
    if (!text || lineBusy || change.running) return
    if (lineMode === "change") {
      void change.start(text)
      return
    }
    appendConversation("owner", text)
    setLineInput("")
    const councilRequest = lineTarget === "william" ? text.match(/^\/?council\b[\s:—-]*(.*)$/i) : null
    if (councilRequest) {
      void summonCouncil(councilRequest[1]?.trim() || `Challenge the current direction for ${selectedLabel}.`)
      setLineOpen(false)
      return
    }
    setLineBusy(true)
    setLineReply(null)
    try {
      const contextualText = `Selected ${selectedKind}: ${selectedLabel}\nOwner request: ${text}`
      if (lineTarget === "agent") {
        const role = selectedAgent?.kind === "durable-session" ? selectedAgent.role : "Builder"
        const assignment = selectedAgent?.kind === "durable-session" ? selectedAgent.assignment : selectedLabel
        await agentSessions.runClaudeTurn({
          role,
          assignment,
          prompt: contextualText,
          onEvent: (payload) => agentReplyText(payload).forEach((reply) => appendConversation("williamos", reply)),
        })
        return
      }
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
  const selectedAgent = agentSessions.sessions.find((agent) => agent.id === focusedAgentId)
  const selectedKind = selectedAgent ? "agent" as const
    : space.activeWindowId === "running-app" ? "preview" as const
    : space.activeWindowId === "diff" ? "diff" as const
    : space.activeWindowId === "editor" && space.selectedPath ? "file" as const
    : "space" as const
  const selectedLabel = selectedAgent ? `${selectedAgent.role} · ${selectedAgent.providerLabel}`
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
  const williamSafetyFact = persistenceError
    ? `Space persistence is refusing writes (${persistenceError}).`
    : !space.runningAppUrl
      ? "The developer preview is not attached."
      : space.selectedPath
        ? `${space.selectedPath} is selected.`
        : "No source object is selected."
  const williamJudgment = judgment?.recommendation
    ?? (judgmentBusy
      ? "William is forming a grounded judgment from the current Space."
      : `System fact: ${williamSafetyFact} ${judgmentError ? `William judgment unavailable (${judgmentError}).` : "William has not formed a judgment yet."}`)

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
    agents: agentSessions.sessions.map((agent) => ({
      id: agent.id, name: agent.providerLabel, role: agent.role,
      activity: agent.assignment, state: agent.status === "working" ? "working" : "idle",
    })),
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
  ]

  function openObjectAction(action: string) {
    if (action === "Change" && selectedKind === "file") {
      openChange()
      return
    }
    if (action === "Council") {
      void summonCouncil(`Challenge the current direction for ${selectedLabel}.`)
      return
    }
    if (action === "Delegate" || (selectedAgent?.kind === "durable-session" && (action === "Talk" || action === "Redirect"))) {
      openLine(`${action} ${selectedLabel}: `, "agent")
      return
    }
    openLine(`${action} this selected ${selectedKindLabel}: `)
  }

  function handleCouncilAction(action: CouncilAdvisoryAction) {
    const session = councilSession
    setOverlay(null)
    if (!session) return
    if (action === "ask-dissent" || action === "run-another-pass") {
      const challenge = action === "ask-dissent"
        ? `Challenge this recommendation with the strongest credible dissent: ${session.recommendation}`
        : `Run another independent pass on this question, explicitly testing the prior recommendation: ${session.question}`
      void summonCouncil(challenge)
      return
    }
    openLine(`Council recommendation · ${action.replaceAll("-", " ")} · ${session.recommendation}\nOwner direction: `)
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
        <AgentSessionStrip sessions={agentSessions.sessions} activeSessionId={focusedAgentId} runningSessionId={agentSessions.activeSessionId} onStop={agentSessions.stop} className={spatial.sessionStrip} onSelect={(agent) => {
          setFocusedAgentId(agent.id)
          if (agent.kind === "durable-session") openLine(`Redirect ${agent.role} · ${agent.providerLabel} on ${selectedLabel}: `, "agent")
        }} />
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
          <EditorSurface space={space} onEditorChange={(editor, selectedPath) => setSpace((current) => ({ ...current, editor, selectedPath }))} onSelectedFileDirtyChange={onSelectedFileDirtyChange} reloadPath={changeRefresh.path} reloadKey={changeRefresh.key} onReloadSettled={(path, key, result) => settleChangeRefresh("editor", path, key, result)} />
        </WindowFrame>
        <WindowFrame id="running-app" title="Developer preview · TerraFusion" geometry={space.windows["running-app"]} active={space.activeWindowId === "running-app"} onActivate={() => activate("running-app")} onGeometry={(geometry) => updateWindow("running-app", geometry)} onMinimize={() => minimize("running-app")}>
          {space.runningAppUrl ? <iframe src={space.runningAppUrl} title="Running TerraFusion application" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads" className="h-full w-full border-0" /> : (
            <div className="grid h-full place-content-center gap-3 p-8 text-center" role="status"><AppWindow className="mx-auto text-[#91a48c]" size={26} aria-hidden /><strong>Developer preview unavailable</strong><span className="max-w-md text-xs text-[#8e998b]">Attach the TerraFusion development runtime when you want the real target beside source. WilliamOS remains fully usable; no business workflow is being simulated.</span></div>
          )}
        </WindowFrame>
        {(["tests", "diff", "terminal"] as const).map((id) => (
          <WindowFrame key={id} id={id} title={windowName[id]} geometry={space.windows[id]} active={space.activeWindowId === id} onActivate={() => activate(id)} onGeometry={(geometry) => updateWindow(id, geometry)} onMinimize={() => minimize(id)}>
            <DeveloperToolsSurface kind={id} selectedPath={space.selectedPath} refreshKey={id === "diff" ? changeRefresh.key : 0} refreshPath={id === "diff" ? changeRefresh.path : null} onRefreshSettled={id === "diff" ? (path, key, result) => settleChangeRefresh("diff", path, key, result) : undefined} />
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
        <button type="button" className={spatial.dockButton} onClick={() => void summonCouncil(`Challenge the current direction for ${selectedLabel}.`)} aria-label="Summon Brain Council" title="Brain Council"><Users size={15} /></button>
      </nav>

      <footer className={spatial.williamRail} aria-label="William intelligence presence">
        <span className={spatial.williamOrb} aria-hidden>W</span>
        <div className={spatial.judgment}><strong>William</strong><p>{williamJudgment}</p></div>
        <div className={spatial.williamActions}>
          <button type="button" className={spatial.overlayButton} onClick={inspectWilliamJudgment}>Inspect</button>
          <button type="button" className={spatial.overlayButton} disabled={judgmentBusy || storage !== "server"} onClick={() => void refreshWilliamJudgment()}>{judgmentBusy ? "Reasoning" : "Think again"}</button>
          <button type="button" className={spatial.overlayButton} onClick={() => openLine(`Override William's recommendation for ${selectedLabel}: `)}>Override</button>
          <button type="button" className={spatial.overlayButton} onClick={() => void summonCouncil(`Challenge William's recommendation: ${williamJudgment}`)}>Ask Council</button>
          <button type="button" className={spatial.overlayButton} onClick={() => openLine()}>The Line · Ctrl+K</button>
        </div>
        <span className={`${spatial.persistence} ${persistenceError ? spatial.persistenceError : ""}`} title={persistenceError ?? undefined}>{savedLabel}</span>
      </footer>

      {lineOpen ? (
        <div className={spatial.lineBackdrop} onPointerDown={(event) => { if (event.target === event.currentTarget && !change.running) setLineOpen(false) }}>
          <form className={spatial.line} onSubmit={submitLine} aria-label={lineMode === "change" ? "Change" : "The Line"}>
            <Command size={16} aria-hidden />
            <div><span className={spatial.lineContext}>{lineMode === "change" ? `Change · ${change.path ?? "no file selected"}` : `${selectedKind} · ${selectedLabel}`}</span><input ref={lineRef} className={spatial.lineInput} value={lineInput} onChange={(event) => setLineInput(event.target.value)} disabled={lineMode === "change" && change.running} placeholder={lineMode === "change" ? "Describe the change to make" : "Ask, change, delegate, or review"} aria-label={lineMode === "change" ? "Change instruction" : "The Line"} autoComplete="off" />{lineMode === "change" ? (change.progress ? <output className={spatial.lineReply}>{change.progress}</output> : change.outcome ? <output className={spatial.lineReply}>{change.outcome}</output> : null) : lineReply ? <output className={spatial.lineReply}>{lineReply}</output> : conversation.at(-1) ? <span className={spatial.lineReply}>{conversation.at(-1)?.role === "williamos" ? "William" : "You"} · {conversation.at(-1)?.text}</span> : null}</div>
            <div className={spatial.lineControls}><span className={spatial.lineContext}>{lineMode === "change" ? "Structured edit" : lineTarget === "agent" ? "Claude session" : "William"}</span><button type="submit" className={spatial.lineSend} disabled={lineBusy || change.running || !lineInput.trim()}>{lineMode === "change" ? change.running ? "Changing" : "Start change" : lineBusy ? "Working" : lineTarget === "agent" ? "Delegate" : "Send"}</button>{lineMode === "change" && change.canStop ? <button type="button" className={spatial.lineClose} onClick={change.stop}>Stop change</button> : null}<button type="button" className={spatial.lineClose} onClick={() => { if (change.running) { if (change.canStop) change.stop(); return } setLineOpen(false) }} aria-label="Close The Line"><X size={14} /></button></div>
          </form>
        </div>
      ) : null}

      {overlay === "council" ? <div className={spatial.councilHost}>{councilSession ? <BrainCouncilSurface session={councilSession} onDismiss={() => setOverlay(null)} onAdvisoryAction={(action) => handleCouncilAction(action)} /> : <section className={spatial.utilitySurface} aria-label="Brain Council"><header className={spatial.utilityMeta}><span>Brain Council</span><button type="button" className={spatial.utilityButton} onClick={() => setOverlay(null)}>Dismiss</button></header><div className={spatial.utilityBody}><strong>{councilBusy ? "Convening five real advisory perspectives…" : "Council unavailable"}</strong><p className={spatial.muted}>{councilError ?? councilQuestion ?? "Preparing the current question."}</p>{councilError && councilQuestion ? <button type="button" className={spatial.utilityButton} onClick={() => void summonCouncil(councilQuestion)}>Try again</button> : null}</div></section>}</div> : null}
      {overlay === "mission-control" ? <MissionControlSurface spaces={missionSpaces} currentSpaceId={space.id} onEnterSpace={() => setOverlay(null)} onDismiss={() => setOverlay(null)} williamOverview={{ summary: williamJudgment, attention: persistenceError || !space.runningAppUrl ? "One visible acceptance condition still needs attention." : null, truth: "live" }} /> : null}
    </main>
  )
}
