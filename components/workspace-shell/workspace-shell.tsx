"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AppWindow, ArrowUp, Command, Layers3, PanelRightClose, PanelRightOpen, X } from "lucide-react"

import type { SummonedSurface } from "@/lib/environment/summon"
import { EMPTY_SPINE, type WorldSpine } from "@/lib/environment/working-world"
import { isExecutionLive } from "@/lib/environment/world-execution"
import { EditorSurface } from "./editor-surface"
import { InspectorSurfaceView, type InspectorSurface } from "./inspector-surface"
import { defaultSpace, nextSpaceRevision, normalizeSpace, spaceInViewport, spaceToServer, type SpaceEnvelope, type WorkspaceProject, type WorkspaceSpace } from "./types"
import experience from "./experience-shell.module.css"

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

type ContextView = "conversation" | "inspector"
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
  const [lineBusy, setLineBusy] = useState(false)
  const [inspectors, setInspectors] = useState<readonly InspectorSurface[]>([])
  const [activeInspectorId, setActiveInspectorId] = useState<string | null>(null)
  const [contextView, setContextView] = useState<ContextView>("conversation")
  const [conversation, setConversation] = useState<readonly ConversationEntry[]>([])
  const [spine, setSpine] = useState<WorldSpine>(EMPTY_SPINE)
  const [project, setProject] = useState<WorkspaceProject | null>(null)
  const [storage, setStorage] = useState<SpaceStorage>("server")
  const stateRef = useRef(space)
  const worldRef = useRef(worldId)
  const storageRef = useRef<SpaceStorage>(storage)
  const browserStorageKeyRef = useRef<string | null>(null)
  const lineRef = useRef<HTMLInputElement>(null)
  const messageSequence = useRef(0)
  const workbenchRef = useRef<HTMLDivElement>(null)
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
    const newest = incoming.at(-1)?.id ?? null
    setActiveInspectorId(newest)
    setContextView("inspector")
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
        setContextView("conversation")
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
    setActiveInspectorId((current) => current === id ? null : current)
    setSpace((current) => {
      const inspectorWindows = { ...current.inspectorWindows }
      const inspectorSeeds = { ...current.inspectorSeeds }
      delete inspectorWindows[id]
      delete inspectorSeeds[id]
      return { ...current, inspectorWindows, inspectorSeeds, activeWindowId: current.activeWindowId === id ? null : current.activeWindowId }
    })
  }, [])

  function startWorkbenchResize(event: React.PointerEvent<HTMLDivElement>) {
    const stage = workbenchRef.current
    if (!stage || event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)

    const move = (next: PointerEvent) => {
      const bounds = stage.getBoundingClientRect()
      if (bounds.width < 760) return
      const sourceWidth = Math.round(Math.max(380, Math.min(bounds.width - 340, next.clientX - bounds.left)))
      const previewWidth = Math.round(Math.max(340, bounds.width - sourceWidth - 6))
      setSpace((current) => ({
        ...current,
        windows: {
          ...current.windows,
          editor: { ...current.windows.editor, width: sourceWidth },
          "running-app": { ...current.windows["running-app"], width: previewWidth },
        },
      }))
    }
    const end = (next: PointerEvent) => {
      if (handle.hasPointerCapture(next.pointerId)) handle.releasePointerCapture(next.pointerId)
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }

  async function submitLine(event: React.FormEvent) {
    event.preventDefault()
    const text = lineInput.trim()
    if (!text || lineBusy) return
    appendConversation("owner", text)
    setLineInput("")
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
    } catch (error) {
      setLineReply(error instanceof Error ? error.message : "LINE_UNAVAILABLE")
    } finally {
      setLineBusy(false)
    }
  }

  const editorWeight = Math.max(1, space.windows.editor.width)
  const previewWeight = Math.max(1, space.windows["running-app"].width)
  const sourcePercent = Math.round((editorWeight / (editorWeight + previewWeight)) * 100)
  const activeInspector = inspectors.find((surface) => surface.id === activeInspectorId) ?? inspectors.at(-1) ?? null
  const contextExpanded = lineOpen || inspectors.length > 0
  const savedLabel = persistenceError
    ? persistenceError
    : hydrated
      ? storage === "browser" ? "Saved in this browser" : "Saved"
      : "Opening"

  return (
    <main
      className={`${experience.environment} ${contextExpanded ? experience.environmentContextOpen : experience.environmentContextClosed}`}
      aria-label={`${project?.name ?? "Workspace"} Space`}
    >
      <aside className={experience.worldRail} aria-label="WilliamOS worlds">
        <div className={experience.worldMark} aria-label="WilliamOS">W</div>
        <div className={experience.worldRailBody}>
          <button
            type="button"
            className={`${experience.railButton} ${experience.railButtonActive}`}
            aria-label={project?.name ?? "Current Space"}
            title={project?.identity ?? project?.name ?? "Current Space"}
          >
            <Layers3 size={18} strokeWidth={1.7} />
          </button>
        </div>
      </aside>

      <section className={experience.world}>
        <header className={experience.worldHeader}>
          <div className={experience.worldIdentity}>
            <span className={experience.worldEyebrow}>Space</span>
            <h1 className={experience.worldTitle}>{project?.name ?? "Opening workspace"}</h1>
            <span className={experience.worldPath}>{space.selectedPath ?? project?.identity ?? ""}</span>
          </div>
          <div className={experience.worldStatus} title={persistenceError ?? undefined}>
            <span className={persistenceError ? experience.statusDotError : experience.statusDot} aria-hidden />
            <span>{savedLabel}</span>
            {spine.outcomeKey ? <span>{spine.execution}</span> : null}
          </div>
          <button
            type="button"
            className={experience.contextToggle}
            onClick={() => setLineOpen((current) => !current)}
            aria-label="Toggle conversation and context"
          >
            {contextExpanded ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
        </header>

        <div
          ref={workbenchRef}
          className={experience.workbench}
          style={{ "--source-percent": `${sourcePercent}%` } as React.CSSProperties}
        >
          <section className={experience.sourceRegion} data-window-id="editor" aria-label="Source window">
            <header className={experience.regionHeader}>
              <span className={experience.regionHeaderStrong}>Source</span>
              <span className={experience.regionMeta}>{space.selectedPath ?? "Choose a file from the project"}</span>
            </header>
            <div className={experience.sourceBody}>
              <EditorSurface
                space={space}
                onEditorChange={(editor, selectedPath) => setSpace((current) => ({ ...current, editor, selectedPath }))}
              />
            </div>
          </section>

          <div
            className={experience.splitHandle}
            role="separator"
            aria-label="Resize source and preview"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={startWorkbenchResize}
          />

          <section className={experience.previewRegion} data-window-id="running-app" aria-label="TerraFusion window">
            <header className={experience.regionHeader}>
              <span className={experience.regionHeaderStrong}>Developer preview</span>
              <span className={experience.previewState} data-live={Boolean(space.runningAppUrl)}>
                {space.runningAppUrl ? "Live target" : "Not attached"}
              </span>
            </header>
            <div className={experience.previewBody}>
              {space.runningAppUrl ? (
                <iframe
                  src={space.runningAppUrl}
                  title="Running TerraFusion application"
                  sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"
                  className={experience.runningApp}
                />
              ) : (
                <div className={experience.previewUnavailable} role="status">
                  <AppWindow size={24} strokeWidth={1.5} aria-hidden />
                  <h2>Preview is not attached</h2>
                  <p>The WilliamOS workspace remains fully usable. Attach the TerraFusion development runtime when you want the live target beside the source.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>

      <aside className={experience.contextRail} data-open={contextExpanded} aria-label="Conversation and context">
        <header className={experience.contextHeader}>
          <button
            type="button"
            className={experience.contextRailSummon}
            onClick={() => {
              setContextView("conversation")
              setLineOpen((current) => !current)
              requestAnimationFrame(() => lineRef.current?.focus())
            }}
            aria-label={lineOpen ? "Hide The Line" : "Open The Line"}
            title="The Line · Ctrl+K"
          >
            <Command size={15} strokeWidth={1.6} aria-hidden />
          </button>
          <span className={experience.contextHeaderTitle}>WilliamOS</span>
          <span className={experience.contextHeaderMeta}>{space.selectedPath ? "file context" : "space context"}</span>
          <button
            type="button"
            className={experience.contextToggle}
            onClick={() => setLineOpen(false)}
            aria-label="Close conversation and context"
          >
            <PanelRightClose size={17} />
          </button>
        </header>

        <nav className={experience.contextTabs} aria-label="Context modes">
          <button
            type="button"
            className={`${experience.contextTab} ${contextView === "conversation" ? experience.contextTabActive : ""}`}
            onClick={() => setContextView("conversation")}
          >
            Conversation
          </button>
          {inspectors.length > 0 ? (
            <button
              type="button"
              className={`${experience.contextTab} ${contextView === "inspector" ? experience.contextTabActive : ""}`}
              onClick={() => setContextView("inspector")}
            >
              Context {inspectors.length > 1 ? `· ${inspectors.length}` : ""}
            </button>
          ) : null}
        </nav>

        <div className={experience.contextBody}>
          {contextView === "conversation" ? (
            <div className={experience.conversation}>
              {conversation.length === 0 ? (
                <p className={experience.conversationEmpty}>
                  Conversation stays with the work in front of you. Select a file, inspect the target, or tell WilliamOS what you want to do next.
                </p>
              ) : conversation.map((entry) => (
                <article key={entry.id} className={experience.message} data-role={entry.role}>
                  <span className={experience.messageRole}>{entry.role === "owner" ? "You" : "WilliamOS"}</span>
                  <p className={experience.messageText}>{entry.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className={experience.inspectorPane}>
              <div className={experience.inspectorList}>
                {inspectors.map((surface) => (
                  <button
                    key={surface.id}
                    type="button"
                    className={`${experience.inspectorChoice} ${activeInspector?.id === surface.id ? experience.inspectorChoiceActive : ""}`}
                    onClick={() => setActiveInspectorId(surface.id)}
                    title={surface.subject}
                  >
                    <span>{surface.subject}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className={experience.inspectorDismiss}
                      aria-label={`Close ${surface.subject}`}
                      onClick={(event) => { event.stopPropagation(); dismissInspector(surface.id) }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          event.stopPropagation()
                          dismissInspector(surface.id)
                        }
                      }}
                    >
                      <X size={12} />
                    </span>
                  </button>
                ))}
              </div>
              <div className={experience.inspectorBody}>
                {activeInspector ? <InspectorSurfaceView surface={activeInspector} /> : null}
              </div>
            </div>
          )}
        </div>

        {lineOpen ? (
          <form className={experience.composer} onSubmit={submitLine} aria-label="The Line">
            <div className={experience.composerField}>
              <input
                ref={lineRef}
                value={lineInput}
                onChange={(event) => setLineInput(event.target.value)}
                onFocus={() => { setContextView("conversation"); setLineOpen(true) }}
                placeholder={space.selectedPath ? `Ask or act on ${space.selectedPath}` : "Ask or direct WilliamOS"}
                aria-label="The Line"
                autoComplete="off"
              />
              {lineReply ? <output className={experience.composerError}>{lineReply}</output> : null}
            </div>
            <button
              type="submit"
              className={experience.composerSubmit}
              disabled={lineBusy || lineInput.trim().length === 0}
              aria-label={lineBusy ? "WilliamOS is working" : "Send"}
            >
              <ArrowUp size={15} strokeWidth={1.8} />
            </button>
          </form>
        ) : null}
      </aside>
    </main>
  )
}
