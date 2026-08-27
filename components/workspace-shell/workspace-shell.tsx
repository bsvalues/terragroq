"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AppWindow, Braces, Command, Layers3 } from "lucide-react"

import type { SummonedSurface } from "@/lib/environment/summon"
import { EMPTY_SPINE, type WorldSpine } from "@/lib/environment/working-world"
import { isExecutionLive } from "@/lib/environment/world-execution"
import { EditorSurface } from "./editor-surface"
import { InspectorSurfaceView, type InspectorSurface } from "./inspector-surface"
import { WindowFrame } from "./window-frame"
import { defaultSpace, nextSpaceRevision, normalizeSpace, spaceInViewport, spaceToServer, type SpaceEnvelope, type WindowGeometry, type WindowId, type WorkspaceProject, type WorkspaceSpace } from "./types"
import styles from "./workspace-shell.module.css"

const windowName: Record<WindowId, string> = { editor: "Source", "running-app": "TerraFusion" }

type LineReply = Readonly<{
  worldId?: string
  say?: string
  surfaces?: readonly Omit<InspectorSurface, "id">[]
  dismiss?: "all" | string
  spine?: WorldSpine
}>

type PersistJob = Readonly<{ worldId: string; revision: number; body: string }>
type SpaceStorage = "server" | "browser"

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
  const [lastLineSay, setLastLineSay] = useState<string | null>(null)
  const [lineBusy, setLineBusy] = useState(false)
  const [inspectors, setInspectors] = useState<readonly InspectorSurface[]>([])
  const [spine, setSpine] = useState<WorldSpine>(EMPTY_SPINE)
  const [project, setProject] = useState<WorkspaceProject | null>(null)
  const [storage, setStorage] = useState<SpaceStorage>("server")
  const stateRef = useRef(space)
  const worldRef = useRef(worldId)
  const storageRef = useRef<SpaceStorage>(storage)
  const browserStorageKeyRef = useRef<string | null>(null)
  const lineRef = useRef<HTMLInputElement>(null)
  // Strict Mode replays mount effects. Both passes attach to the same arrival promises so cleanup
  // cannot strand the surviving pass in an opening/working state after the first response arrives.
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

  const materializeSurfaces = useCallback((reply: LineReply) => {
    if (reply.dismiss) {
      setInspectors((current) => reply.dismiss === "all" ? [] : current.filter((surface) => surface.kind !== reply.dismiss))
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
      if (active && inspectorWindows[active]) inspectorWindows[active] = { ...inspectorWindows[active], minimized: false, z: highest + incoming.length }
      return { ...current, inspectorWindows, inspectorSeeds, activeWindowId: active }
    })
  }, [inspectors])

  const acceptLineReply = useCallback((reply: LineReply) => {
    if (typeof reply.worldId === "string") setWorldId(reply.worldId)
    if (reply.spine) setSpine(reply.spine)
    const say = typeof reply.say === "string" ? reply.say : ""
    setLastLineSay(say || null)
    setLineReply(null)
    materializeSurfaces(reply)
    setLineOpen(false)
  }, [materializeSurfaces])

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
            // A damaged browser record is discarded in favor of the admitted default Space.
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
        // Geometry and identity remain persisted. A failed current read never becomes fabricated payload.
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
      // A lower request can finish after a critical higher-revision keepalive. The server correctly
      // refuses it; that superseded refusal is not the current Space failing to persist.
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
      // Capture an immutable body now. A later drag, selection, or save cannot mutate an in-flight
      // request into a state carrying the wrong revision.
      body: JSON.stringify({ worldId: id, space: spaceToServer(stateRef.current, revision) }),
    }
    if (keepalive) {
      // Critical lifecycle flushes may overlap an older normal write. Revision ordering makes that
      // safe: once this higher state lands, the server rejects the lower late arrival.
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

  const updateWindow = useCallback((id: WindowId, geometry: WindowGeometry) => {
    setSpace((current) => ({ ...current, windows: { ...current.windows, [id]: geometry } }))
  }, [])

  const activate = useCallback((id: WindowId) => {
    setSpace((current) => {
      const highest = Math.max(...Object.values(current.windows).map((window) => window.z), ...Object.values(current.inspectorWindows).map((window) => window.z))
      const chosen = current.windows[id]
      if (current.activeWindowId === id && chosen.z === highest && !chosen.minimized) return current
      return {
        ...current,
        activeWindowId: id,
        windows: { ...current.windows, [id]: { ...chosen, minimized: false, z: highest + 1 } },
      }
    })
  }, [])

  const updateInspector = useCallback((id: string, geometry: WindowGeometry) => {
    setSpace((current) => ({ ...current, inspectorWindows: { ...current.inspectorWindows, [id]: geometry } }))
  }, [])

  const activateInspector = useCallback((id: string) => {
    setSpace((current) => {
      const chosen = current.inspectorWindows[id]
      if (!chosen) return current
      const highest = Math.max(...Object.values(current.windows).map((window) => window.z), ...Object.values(current.inspectorWindows).map((window) => window.z))
      return { ...current, activeWindowId: id, inspectorWindows: { ...current.inspectorWindows, [id]: { ...chosen, minimized: false, z: highest + 1 } } }
    })
  }, [])

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

  const minimize = useCallback((id: WindowId) => {
    setSpace((current) => ({
      ...current,
      activeWindowId: current.activeWindowId === id ? null : current.activeWindowId,
      windows: { ...current.windows, [id]: { ...current.windows[id], minimized: true } },
    }))
  }, [])

  async function submitLine(event: React.FormEvent) {
    event.preventDefault()
    const text = lineInput.trim()
    if (!text || lineBusy) return
    setLineBusy(true)
    setLineReply(null)
    try {
      const response = await fetch("/api/environment/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId, text }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? `LINE_${response.status}`)
      acceptLineReply(payload as LineReply)
      setLineInput("")
    } catch (error) {
      setLineReply(error instanceof Error ? error.message : "LINE_UNAVAILABLE")
    } finally {
      setLineBusy(false)
    }
  }

  return (
    <main className={styles.environment} aria-label={`${project?.name ?? "Workspace"} Space`}>
      <div className={styles.atmosphere} aria-hidden />
      <menu className={styles.menuBar}>
        <span className={styles.wordmark}>W</span>
        <span
          className={styles.spaceName}
          aria-label="Workspace project"
          title={project?.identity ?? "Resolving configured workspace"}
        >
          <Layers3 size={13} aria-hidden /> {project?.name ?? "Opening workspace"}
        </span>
        <button type="button" className={styles.lineSummon} onClick={() => { setLineOpen(true); requestAnimationFrame(() => lineRef.current?.focus()) }}>
          <Command size={12} aria-hidden /> Line <kbd>Ctrl+K</kbd>
        </button>
      </menu>

      <div className={styles.windowLayer}>
        <WindowFrame
          id="editor"
          title="Source"
          geometry={space.windows.editor}
          active={space.activeWindowId === "editor"}
          onActivate={() => activate("editor")}
          onGeometry={(geometry) => updateWindow("editor", geometry)}
          onMinimize={() => minimize("editor")}
        >
          <EditorSurface
            space={space}
            onEditorChange={(editor, selectedPath) => setSpace((current) => ({ ...current, editor, selectedPath }))}
          />
        </WindowFrame>

        <WindowFrame
          id="running-app"
          title="TerraFusion"
          geometry={space.windows["running-app"]}
          active={space.activeWindowId === "running-app"}
          onActivate={() => activate("running-app")}
          onGeometry={(geometry) => updateWindow("running-app", geometry)}
          onMinimize={() => minimize("running-app")}
        >
          {space.runningAppUrl ? (
            <iframe
              src={space.runningAppUrl}
              title="Running TerraFusion application"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"
              className={styles.runningApp}
            />
          ) : (
            <div className={styles.appRefusal} role="status">
              <AppWindow size={20} aria-hidden />
              <span>Developer preview unavailable. Start or attach the TerraFusion development runtime to preview it here.</span>
            </div>
          )}
        </WindowFrame>

        {inspectors.map((surface) => {
          const geometry = space.inspectorWindows[surface.id]
          if (!geometry) return null
          return (
            <WindowFrame
              key={surface.id}
              id={surface.id}
              title={`Inspector · ${surface.subject}`}
              geometry={geometry}
              active={space.activeWindowId === surface.id}
              onActivate={() => activateInspector(surface.id)}
              onGeometry={(next) => updateInspector(surface.id, next)}
              onClose={() => dismissInspector(surface.id)}
            >
              <InspectorSurfaceView surface={surface} />
            </WindowFrame>
          )
        })}
      </div>

      {lineOpen ? (
        <div className={styles.lineBackdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) setLineOpen(false) }}>
          <form className={styles.line} onSubmit={submitLine} aria-label="The Line">
            <Command size={16} aria-hidden />
            <div className={styles.lineContent}>
              <input
                ref={lineRef}
                value={lineInput}
                onChange={(event) => setLineInput(event.target.value)}
                placeholder={space.selectedPath ? `Act on ${space.selectedPath}` : "Ask or direct WilliamOS"}
                aria-label="The Line"
                autoFocus
              />
              {lineReply ? <output className={styles.lineReply}>{lineReply}</output> : null}
            </div>
            <span className={styles.lineState}>{lineBusy ? "working" : "↵"}</span>
          </form>
        </div>
      ) : null}

      <footer className={styles.presenceRail}>
        <div className={styles.railContext}>
          <span className={styles.railSpace}>
            {spine.projectName ?? project?.name ?? "WORKSPACE"}
            {spine.outcomeKey ? ` · ${spine.outcomeKey} · ${spine.execution}` : ""}
            {spine.worker ? ` · worker: ${spine.worker.lane} lane` : ""}
          </span>
          {lastLineSay ? (
            <button type="button" className={styles.lineRecall} onClick={() => { setLineReply(lastLineSay); setLineOpen(true) }} title={lastLineSay}>
              {lastLineSay}
            </button>
          ) : null}
        </div>
        <div className={styles.dock} aria-label="Dock">
          {space.dock.map((id) => (
            <button
              key={id}
              type="button"
              className={`${styles.dockItem} ${space.activeWindowId === id && !space.windows[id].minimized ? styles.dockItemActive : ""}`}
              onClick={() => activate(id)}
              aria-label={`${space.windows[id].minimized ? "Restore" : "Focus"} ${windowName[id]}`}
              title={windowName[id]}
            >
              {id === "editor" ? <Braces size={15} /> : <AppWindow size={15} />}
            </button>
          ))}
        </div>
        <span
          className={persistenceError ? styles.railError : styles.railSaved}
          title={persistenceError ?? (storage === "browser" ? "Space saved in this browser" : "Space persisted server-side")}
        >
          {persistenceError ? persistenceError : hydrated ? storage === "browser" ? "space saved locally" : "space saved" : "opening space"}
        </span>
      </footer>
    </main>
  )
}
