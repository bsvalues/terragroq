"use client"

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react"
import { useRouter } from "next/navigation"

import type { EnvironmentLineResponse, EnvironmentWorldDto } from "@/lib/environment/api-contract"
import { EnvironmentSurface } from "@/components/environment-root/environment-surface"

export function EnvironmentRoot({ initialWorld }: { initialWorld: EnvironmentWorldDto | null }) {
  const router = useRouter()
  const [world, setWorld] = useState<EnvironmentWorldDto | null>(initialWorld)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lineRef = useRef<HTMLTextAreaElement>(null)
  const conversationEndRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [world?.conversation])

  useEffect(() => {
    function focusLine(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return
      const target = event.target as HTMLElement | null
      if (target?.matches("input, textarea, select, button, a, [contenteditable='true']")) return
      lineRef.current?.focus()
    }
    window.addEventListener("keydown", focusLine)
    return () => window.removeEventListener("keydown", focusLine)
  }, [])

  useEffect(() => {
    const worldId = world?.worldId
    if (!worldId) return
    const exactWorldId = worldId
    let disposed = false
    let inFlight = false
    let queued = false

    async function refreshWorld() {
      if (disposed) return
      if (inFlight) {
        queued = true
        return
      }
      inFlight = true
      try {
        const response = await fetch(`/api/environment/world?worldId=${encodeURIComponent(exactWorldId)}`, {
          headers: { accept: "application/json" },
        })
        if (response.status === 401) {
          router.replace("/environment/sign-in")
          return
        }
        if (!response.ok) return
        const reply = (await response.json()) as { world?: EnvironmentWorldDto | null }
        const next = reply.world
        if (!next || next.worldId !== exactWorldId || !Array.isArray(next.conversation) || !Array.isArray(next.surfaces)) return
        setWorld((current) => {
          if (!current || current.worldId !== next.worldId) return current
          return next.lastUpdatedAt >= current.lastUpdatedAt ? next : current
        })
      } catch {
        // A transient refresh must retain the restored world, draft, and focus.
      } finally {
        inFlight = false
        if (queued && !disposed) {
          queued = false
          void refreshWorld()
        }
      }
    }

    const interval = window.setInterval(() => void refreshWorld(), 15_000)
    const online = () => void refreshWorld()
    const visible = () => {
      if (document.visibilityState === "visible") void refreshWorld()
    }
    window.addEventListener("online", online)
    document.addEventListener("visibilitychange", visible)
    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener("online", online)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [router, world?.worldId])

  async function send() {
    const text = (lineRef.current?.value ?? draft).trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)

    try {
      const response = await fetch("/api/environment/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, ...(world?.worldId ? { worldId: world.worldId } : {}) }),
      })
      if (response.status === 401) {
        router.replace("/environment/sign-in")
        return
      }
      if (!response.ok) throw new Error(`LINE_${response.status}`)
      const reply = (await response.json()) as EnvironmentLineResponse
      if (!reply.world?.worldId || !Array.isArray(reply.world.conversation) || !Array.isArray(reply.world.surfaces)) {
        throw new Error("LINE_REPLY_MALFORMED")
      }
      setWorld(reply.world)
      setDraft("")
    } catch {
      setError("That did not reach the environment. Your words and working context are unchanged.")
    } finally {
      setBusy(false)
      lineRef.current?.focus()
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send()
  }

  function lineKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  const surfaces = world?.surfaces ?? []
  const conversation = world?.conversation ?? []
  const hasSurfaces = surfaces.length > 0
  const browserCount = surfaces.filter((surface) => surface.kind === "browser").length
  const hasComparison = browserCount >= 2 && surfaces.some((surface) => surface.kind === "compare" || surface.kind === "conflict")

  return (
    <main className="flex min-h-dvh flex-col bg-[#090b0f] text-neutral-100">
      {world ? (
        <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/[0.06] px-4 py-3 sm:px-7">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium tracking-[-0.01em]">{world.intent}</h1>
          <span className="text-xs text-neutral-500">{worldStatusLabel(world.status)}</span>
          <time className="text-xs text-neutral-600" dateTime={world.lastUpdatedAt}>Restored {formatInstant(world.lastUpdatedAt)}</time>
        </header>
      ) : null}

      <div className={`min-h-0 flex-1 ${hasSurfaces ? "p-3 sm:p-5 lg:p-7" : "flex items-center justify-center px-5 py-12"}`}>
        {hasSurfaces && world ? (
          <section
            className={`mx-auto grid w-full max-w-[112rem] gap-3 sm:gap-4 ${
              hasComparison
                ? "environment-comparison-grid lg:grid-cols-2"
                : surfaces.length === 1
                  ? "grid-cols-1"
                  : "md:grid-cols-2 xl:grid-cols-3"
            }`}
            aria-label="Working surfaces"
          >
            {surfaces.map((surface) => (
              <div
                className={
                  hasComparison && (surface.kind === "compare" || surface.kind === "conflict")
                    ? "lg:col-span-2"
                    : surface.kind === "browser" && !hasComparison
                      ? "md:col-span-2 xl:col-span-2"
                      : ""
                }
                key={surface.id}
              >
                <EnvironmentSurface surface={surface} endpoints={world.endpoints} execution={world.execution} />
              </div>
            ))}
          </section>
        ) : (
          <section className="w-full max-w-2xl" aria-labelledby="environment-empty-title">
            {conversation.length === 0 ? (
              <div className="py-14 text-center">
                <div className="mx-auto mb-6 h-px w-20 bg-gradient-to-r from-transparent via-sky-300/80 to-transparent" aria-hidden />
                <h1 id="environment-empty-title" className="text-balance text-2xl font-medium tracking-[-0.025em] text-neutral-200 sm:text-3xl">
                  What are we working on?
                </h1>
              </div>
            ) : (
              <Conversation turns={conversation} endRef={conversationEndRef} />
            )}
          </section>
        )}
      </div>

      <section className="sticky bottom-0 border-t border-white/[0.07] bg-[#090b0f]/95 px-3 py-3 backdrop-blur sm:px-6" aria-label="The Line">
        {hasSurfaces && conversation.length > 0 ? (
          <details className="mx-auto mb-2 max-w-4xl text-xs text-neutral-500">
            <summary className="cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-sky-300/60">Conversation</summary>
            <Conversation turns={conversation} endRef={conversationEndRef} compact />
          </details>
        ) : null}
        <form className="mx-auto max-w-4xl" onSubmit={submit}>
          <label className="sr-only" htmlFor="environment-line">The Line</label>
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-2 shadow-[0_16px_60px_-34px_rgba(56,189,248,0.7)] focus-within:border-sky-300/50 focus-within:ring-2 focus-within:ring-sky-300/10">
            <textarea
              id="environment-line"
              ref={lineRef}
              className="max-h-40 min-h-12 w-full resize-none bg-transparent px-3 py-2 text-base leading-6 text-neutral-100 outline-none placeholder:text-neutral-600"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={lineKeyDown}
              rows={hasSurfaces ? 1 : 2}
              placeholder="Say it the way you would out loud…"
              aria-describedby={error ? "environment-line-error" : undefined}
              autoFocus
            />
            <div className="flex items-center justify-between gap-4 px-2 pb-1">
              <span className="text-[11px] text-neutral-600" aria-live="polite">{busy ? "Listening…" : "Enter to send · Shift+Enter for a new line"}</span>
              <button
                className="rounded-lg bg-sky-200 px-3 py-1.5 text-xs font-medium text-slate-950 transition hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:ring-offset-2 focus:ring-offset-[#11141a] disabled:cursor-wait disabled:opacity-50"
                type="submit"
                disabled={busy || !draft.trim()}
              >
                Send
              </button>
            </div>
          </div>
          {error ? <p className="mt-2 px-2 text-sm text-red-200" id="environment-line-error" role="alert">{error}</p> : null}
        </form>
      </section>
    </main>
  )
}

function Conversation({
  turns,
  endRef,
  compact = false,
}: {
  turns: EnvironmentWorldDto["conversation"]
  endRef: RefObject<HTMLLIElement | null>
  compact?: boolean
}) {
  return (
    <ol className={`space-y-3 overflow-auto ${compact ? "mt-2 max-h-52 py-2" : "max-h-[45dvh] py-6"}`} aria-label="Conversation">
      {turns.map((turn) => (
        <li className={`flex ${turn.role === "owner" ? "justify-end" : "justify-start"}`} key={turn.id}>
          <p className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-6 ${turn.role === "owner" ? "bg-sky-300/10 text-sky-50" : "bg-white/[0.045] text-neutral-200"}`}>
            {turn.content}
          </p>
        </li>
      ))}
      <li ref={endRef} aria-hidden />
    </ol>
  )
}

function formatInstant(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

function worldStatusLabel(status: EnvironmentWorldDto["status"]): string {
  switch (status) {
    case "waiting_for_resource": return "Finding the right place"
    case "waiting_for_execution_endpoint": return "Preparing the working world"
    case "ready": return "Ready"
    case "paused": return "Paused"
    case "settled": return "Complete"
  }
}
