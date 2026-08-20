"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * The replacement environment's root (#762). Greenfield: this tree imports nothing from the legacy
 * shell and reproduces none of its navigation model — see docs/product/environment-refusals.md, and
 * the acceptance test that enforces it.
 *
 * Two primitives, nothing else: the Line (exactly one conversational input, ever) and Surfaces (real
 * working things the work materializes). The two rules that govern every pixel: a region that needs
 * explanatory text to justify existing gets removed, and the UI shows work, not descriptions of work.
 */

type Turn = Readonly<{ id: string; role: "owner" | "williamos"; content: string }>
type Surface = Readonly<{
  id: string
  kind: "browser" | "trace" | "source" | "diff" | "tests"
  subject: string
  payload?: unknown
}>

type ProbeStep = Readonly<{
  url: string
  status?: number
  location?: string
  setsSessionCookie?: boolean
  error?: string
}>

export function Desk() {
  const [worldId, setWorldId] = useState<string | null>(null)
  const [intent, setIntent] = useState<string | null>(null)
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
    // The textarea's live DOM value is the source of truth: type-then-Enter can outrun controlled
    // state by a frame, and a silent no-op on that race is the five-goal lesson in a new face.
    const text = (inputRef.current?.value ?? input).trim()
    if (!text || busy) return
    setInput("")
    setFailed(false)
    setBusy(true)
    if (!intent) setIntent(text)
    setTurns((current) => [...current, { id: crypto.randomUUID(), role: "owner", content: text }])
    try {
      const response = await fetch("/api/environment/line", {
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
        // Materialize by appending: existing surfaces keep their place; spatial memory survives.
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
        <ol className={cn("flex flex-col px-1", dialogShape ? "gap-3 py-2" : "gap-1 py-1.5")}>
          {turns.map((turn) => (
            <li key={turn.id} className={cn("flex", turn.role === "owner" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[92%] whitespace-pre-wrap leading-relaxed",
                  dialogShape
                    ? cn(
                        "rounded-md px-4 py-2.5 text-[13.5px]",
                        turn.role === "owner" ? "bg-sky-950/60 text-sky-100" : "bg-neutral-800/70 text-neutral-100",
                      )
                    : cn("px-1 py-0.5 text-[12.5px]", turn.role === "owner" ? "text-sky-300/90" : "text-neutral-300"),
                )}
              >
                {turn.content}
              </div>
            </li>
          ))}
        </ol>
        {busy ? <p className="px-2 py-1 text-xs text-neutral-600">working…</p> : null}
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
        className="pt-1.5"
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
          rows={dialogShape ? 3 : 1}
          placeholder={dialogShape ? "Say it the way you'd say it out loud…" : "Ask or tell WilliamOS anything…"}
          className={cn(
            "w-full resize-none rounded-md border border-neutral-800/80 bg-neutral-900/70 text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-600",
            dialogShape ? "px-4 py-3 text-[13.5px] leading-relaxed" : "px-3 py-2 text-[12.5px] leading-snug",
          )}
          aria-label="The Line"
          autoFocus
        />
      </form>
    </div>
  )

  if (dialogShape) {
    return <div className="flex h-dvh flex-col bg-neutral-950 px-6 text-neutral-100">{line}</div>
  }

  // Desk-shape: the first surface is the subject and holds the most space; later surfaces stack
  // beside it. Nothing is labeled — the work identifies itself.
  const [subject, ...rest] = surfaces

  return (
    <div className="grid h-dvh grid-rows-[26px_minmax(0,1fr)_minmax(130px,20dvh)] bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between px-4 text-[11.5px] text-neutral-600">
        <span className="truncate">{intent}</span>
        <span>{busy ? "working" : "listening"}</span>
      </div>
      <div className={cn("grid min-h-0 gap-px bg-neutral-900", rest.length > 0 ? "grid-cols-[2fr_1fr]" : "grid-cols-1")}>
        <SurfaceView surface={subject} />
        {rest.length > 0 ? (
          <div className="grid min-h-0 gap-px" style={{ gridTemplateRows: `repeat(${rest.length}, minmax(0, 1fr))` }}>
            {rest.map((surface) => (
              <SurfaceView key={surface.id} surface={surface} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="border-t border-neutral-900 px-4 pb-2 pt-0.5">{line}</div>
    </div>
  )
}

function SurfaceView({ surface }: { surface: Surface }) {
  if (surface.kind === "browser") {
    // Anonymity is a server guarantee: the document comes from the environment's own cookieless
    // proxy, so every browser shows what an anonymous visitor sees. Scripts are refused in-frame so
    // the page cannot use the parent's session to navigate itself back into the legacy shell.
    return (
      <iframe
        src={`/api/environment/anon${surface.subject}`}
        title={surface.subject}
        sandbox=""
        className="h-full min-h-0 w-full bg-white"
      />
    )
  }
  if (surface.kind === "trace") {
    return (
      <div className="min-h-0 overflow-y-auto bg-neutral-950 p-3 font-mono text-[12px] leading-relaxed text-neutral-400">
        {(surface.payload as readonly ProbeStep[] | undefined)?.map((step, index) => (
          <div key={index} className="mb-1.5">
            <span className="text-neutral-500">{step.url}</span>{" "}
            {step.error ? (
              <span className="text-red-400">{step.error}</span>
            ) : (
              <>
                <span className={cn(step.status && step.status >= 400 ? "text-red-400" : "text-emerald-500")}>{step.status}</span>
                {step.location ? <span className="text-neutral-600"> → {step.location}</span> : null}
                {step.setsSessionCookie ? <span className="text-sky-500"> · cookie</span> : null}
              </>
            )}
          </div>
        )) ?? null}
      </div>
    )
  }
  if (surface.kind === "diff") {
    const text = String(surface.payload ?? "")
    return (
      <div className="min-h-0 overflow-auto bg-neutral-950 p-3 font-mono text-[12px] leading-relaxed">
        {text.split("\n").map((line, index) => (
          <div
            key={index}
            className={cn(
              "whitespace-pre",
              line.startsWith("+") && !line.startsWith("+++")
                ? "bg-emerald-950/40 text-emerald-300"
                : line.startsWith("-") && !line.startsWith("---")
                  ? "bg-red-950/40 text-red-300"
                  : line.startsWith("@@")
                    ? "text-sky-400"
                    : "text-neutral-500",
            )}
          >
            {line || " "}
          </div>
        ))}
      </div>
    )
  }
  // source and tests: the real text, monospace, untitled — the content is its own identity.
  return (
    <pre className="min-h-0 overflow-auto whitespace-pre-wrap bg-neutral-950 p-3 font-mono text-[11.5px] leading-relaxed text-neutral-400">
      {String(surface.payload ?? "")}
    </pre>
  )
}
