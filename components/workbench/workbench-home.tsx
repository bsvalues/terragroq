"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2, Pause, Send, Sparkles } from "lucide-react"
import type { UniversalIntentRoute } from "@/lib/intent/router"
import { storeIntentHandoff } from "@/components/intent/intent-handoff"
import type { WorkbenchProject, WorkbenchThread } from "@/lib/workbench/workbench-model"

function timeLabel(value: string | null) {
  if (!value) return "No recorded activity"
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

function IntentComposer({ thread }: { thread: WorkbenchThread | null }) {
  const [input, setInput] = useState("")
  const [result, setResult] = useState<UniversalIntentRoute | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!input.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch("/api/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: input }),
      })
      if (!response.ok) throw new Error("WilliamOS could not route that request.")
      setResult((await response.json()) as UniversalIntentRoute)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Intent routing failed.")
    } finally {
      setLoading(false)
    }
  }

  const destination = result?.destination?.href ?? null
  return (
    <div className="border-t border-border bg-background px-4 py-3 sm:px-6">
      <form onSubmit={submit} className="mx-auto max-w-3xl">
        <label htmlFor="workbench-intent" className="sr-only">Ask WilliamOS or direct the current thread</label>
        <div className="flex items-end gap-2 border border-border bg-muted/20 p-2 focus-within:border-primary/70">
          <textarea
            id="workbench-intent"
            value={input}
            onChange={(event) => { setInput(event.target.value); setResult(null); setError(null) }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder={thread ? `Ask, steer, or do something in ${thread.ref}…` : "What do you want WilliamOS to help you do?"}
            className="min-h-12 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" disabled={loading || !input.trim()} className="grid size-9 shrink-0 place-items-center bg-primary text-primary-foreground disabled:opacity-40" aria-label="Route intent">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
          <span>Enter to send · Shift+Enter for a new line</span><span>Ask · Do · Inspect · Steer · Stop</span>
        </div>
      </form>
      {error ? <p role="alert" className="mx-auto mt-2 max-w-3xl text-sm text-destructive">{error}</p> : null}
      {result ? (
        <div role="status" className="mx-auto mt-2 flex max-w-3xl items-center justify-between gap-4 border-l-2 border-primary bg-muted/20 px-3 py-2 text-sm">
          <div><span className="font-medium">{result.state === "authority_required" ? "Authority required" : result.state === "clarification_required" ? "Clarify request" : `Ready to ${result.intent}`}</span><span className="ml-2 text-muted-foreground">{result.reason}</span></div>
          {destination ? <Link href={destination} onClick={() => { if (result.intent !== "navigation") storeIntentHandoff(destination, input) }} className="shrink-0 text-primary hover:underline">Continue <ArrowRight className="inline size-3" /></Link> : null}
        </div>
      ) : null}
    </div>
  )
}

export function WorkbenchHome({ thread, project }: { thread: WorkbenchThread | null; project: WorkbenchProject | null }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {thread ? (
          <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
            <div className="mb-8 border-b border-border pb-5">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <span>{thread.ref}</span><span>·</span><span>{thread.state}</span><span>·</span><span>{timeLabel(thread.latestAt)}</span>
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">{thread.title}</h1>
            </div>
            <div className="space-y-6" aria-label="Thread timeline">
              {thread.activity.length ? thread.activity.map((item) => (
                <article key={item.id} className="grid gap-2 border-l border-border pl-4 sm:grid-cols-[8rem_1fr]">
                  <time className="font-mono text-[11px] text-muted-foreground">{timeLabel(item.at)}</time>
                  <div><p className="text-sm font-medium">{item.label}</p>{item.detail ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</p> : null}</div>
                </article>
              )) : (
                <div className="py-16 text-center">
                  <Sparkles className="mx-auto size-5 text-muted-foreground" />
                  <h2 className="mt-3 text-base font-medium">Thread context is ready</h2>
                  <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">No meaningful timeline events are linked to this work order yet. Ask about it, inspect its contract, or direct the next move below.</p>
                </div>
              )}
            </div>
          </div>
        ) : project ? (
          <div className="mx-auto max-w-3xl px-6 py-12">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Project context</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">No thread is proven to belong to this project yet. WilliamOS will not infer membership from repository or machine names.</p>
            <div className="mt-8 border-t border-border">
              {project.resources.map((resource) => <div key={`${resource.type}:${resource.canonicalIdentity}`} className="grid gap-1 border-b border-border py-3 sm:grid-cols-[8rem_1fr]"><span className="font-mono text-[11px] uppercase text-muted-foreground">{resource.type}</span><span className="text-sm">{resource.label} <span className="text-muted-foreground">· {resource.relationship}</span></span></div>)}
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-[24rem] place-items-center px-6 text-center">
            <div><div className="mx-auto grid size-10 place-items-center border border-border"><Pause className="size-4 text-muted-foreground" /></div><h1 className="mt-4 text-xl font-semibold">WilliamOS is ready</h1><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Select a thread from the explorer or tell WilliamOS what you want to accomplish. This is the work surface—not a dashboard.</p></div>
          </div>
        )}
      </div>
      <IntentComposer thread={thread} />
    </div>
  )
}
