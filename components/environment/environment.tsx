"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * The Environment, slice one (#762): the Line is universal input, surfaces are the real thing, the
 * world assembles from intent. This screen starts almost empty — no project selection, no thread
 * list, no navigation — and becomes what the work needs.
 *
 * Breathing, as bound by the owner: surfaces materialize and are appended; nothing reshuffles
 * existing surfaces; nothing recedes without being asked. In dialog-shape the Line is the widest
 * thing on screen; when surfaces exist, it becomes the strip along the bottom and stays one
 * keystroke away — typing anywhere focuses it.
 */

type Turn = Readonly<{ id: string; role: "owner" | "williamos"; content: string }>
type Surface = Readonly<{
  id: string
  kind: "browser" | "trace"
  subject: string
  title: string
  payload?: unknown
}>

type ProbeStep = Readonly<{
  url: string
  status?: number
  location?: string
  setsSessionCookie?: boolean
  error?: string
}>

export function Environment() {
  const [worldId, setWorldId] = useState<string | null>(null)
  const [turns, setTurns] = useState<readonly Turn[]>([])
  const [surfaces, setSurfaces] = useState<readonly Surface[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" })
  }, [turns, busy])

  // The Line is universal input: typing anywhere in the environment reaches it.
  useEffect(() => {
    function focusLine(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return
      if (event.key.length === 1) inputRef.current?.focus()
    }
    window.addEventListener("keydown", focusLine)
    return () => window.removeEventListener("keydown", focusLine)
  }, [])

  async function send() {
    // The textarea's live DOM value is the source of truth: rapid type-then-Enter can outrun the
    // controlled state by a frame, and a send that silently no-ops on that race is the five-goal
    // lesson wearing a new face. Found by this slice's own abuse pass.
    const text = (inputRef.current?.value ?? input).trim()
    if (!text || busy) return
    setInput("")
    setFailed(false)
    setBusy(true)
    setTurns((current) => [...current, { id: crypto.randomUUID(), role: "owner", content: text }])
    try {
      const response = await fetch("/api/env/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId, text }),
      })
      if (!response.ok) throw new Error(String(response.status))
      const reply = (await response.json()) as {
        worldId: string
        say: string
        surfaces: readonly Omit<Surface, "id">[]
      }
      if (reply.worldId) setWorldId(reply.worldId)
      setTurns((current) => [...current, { id: crypto.randomUUID(), role: "williamos", content: reply.say }])
      if (reply.surfaces.length > 0) {
        // Materialize by appending: existing surfaces keep their place. Spatial memory survives.
        setSurfaces((current) => [
          ...current,
          ...reply.surfaces.map((surface) => ({ ...surface, id: crypto.randomUUID() })),
        ])
      }
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const dialogShape = surfaces.length === 0

  const line = (
    <div className={cn("flex min-h-0 flex-col", dialogShape ? "mx-auto w-full max-w-2xl flex-1 justify-end pb-10" : "h-full")}>
      <div className={cn("min-h-0 overflow-y-auto", dialogShape ? "" : "flex-1")}>
        {turns.length === 0 && dialogShape ? (
          <p className="pb-8 text-center text-lg text-neutral-500">What are we working on?</p>
        ) : null}
        <ol className="flex flex-col gap-3 px-1 py-2">
          {turns.map((turn) => (
            <li key={turn.id} className={cn("flex", turn.role === "owner" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[92%] whitespace-pre-wrap rounded-md px-4 py-2.5 text-[13.5px] leading-relaxed",
                  turn.role === "owner" ? "bg-sky-950/60 text-sky-100" : "bg-neutral-800/70 text-neutral-100",
                )}
              >
                {turn.content}
              </div>
            </li>
          ))}
        </ol>
        {busy ? <p className="px-2 py-1 text-xs text-neutral-500">working…</p> : null}
        {failed ? (
          <p className="px-2 py-1 text-xs text-red-400" role="alert">
            That didn&rsquo;t reach me — your words are still yours; send them again.
          </p>
        ) : null}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
        className="pt-2"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          rows={dialogShape ? 3 : 2}
          placeholder={dialogShape ? "Say it the way you'd say it out loud…" : "Keep talking — the environment is listening…"}
          className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900/90 px-4 py-3 text-[13.5px] leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
          aria-label="The Line"
          autoFocus
        />
      </form>
    </div>
  )

  if (dialogShape) {
    return <div className="flex h-dvh flex-col bg-neutral-950 px-6 text-neutral-100">{line}</div>
  }

  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_minmax(180px,26dvh)] bg-neutral-950 text-neutral-100">
      <div className="grid min-h-0 auto-cols-fr grid-flow-col gap-2 p-3">
        {surfaces.map((surface) => (
          <section key={surface.id} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-925 bg-neutral-900">
            <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
              <span className="truncate text-xs text-neutral-400">{surface.title}</span>
              <span className="text-[10px] uppercase tracking-wide text-neutral-600">{surface.kind}</span>
            </header>
            {surface.kind === "browser" ? (
              // The real thing: the running application itself, framed. Not a screenshot, not a card.
              <iframe src={surface.subject} title={surface.title} className="min-h-0 w-full flex-1 bg-white" />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed text-neutral-300">
                {(surface.payload as readonly ProbeStep[] | undefined)?.map((step, index) => (
                  <div key={index} className="mb-2 rounded border border-neutral-800 bg-neutral-950/60 p-2">
                    <div className="text-neutral-400">{step.url}</div>
                    {step.error ? (
                      <div className="text-red-400">{step.error}</div>
                    ) : (
                      <div>
                        <span className={cn(step.status && step.status >= 400 ? "text-red-400" : "text-emerald-400")}>
                          {step.status}
                        </span>
                        {step.location ? <span className="text-neutral-500"> → {step.location}</span> : null}
                        {step.setsSessionCookie ? <span className="text-sky-400"> · sets session cookie</span> : null}
                      </div>
                    )}
                  </div>
                )) ?? <span className="text-neutral-600">no data</span>}
              </div>
            )}
          </section>
        ))}
      </div>
      <div className="border-t border-neutral-800 px-4 pb-3 pt-1">{line}</div>
    </div>
  )
}
