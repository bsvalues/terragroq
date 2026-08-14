"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { UniversalIntentRoute } from "@/lib/intent/router"
import { storeIntentHandoff } from "@/components/intent/intent-handoff"

export function UniversalIntent() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [result, setResult] = useState<UniversalIntentRoute | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    function openIntent(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true) }
    }
    window.addEventListener("keydown", openIntent)
    return () => window.removeEventListener("keydown", openIntent)
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!input.trim() || loading) return
    setLoading(true); setError(null); setResult(null)
    try {
      const response = await fetch("/api/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: input }) })
      if (!response.ok) throw new Error("WilliamOS could not classify that intent.")
      setResult((await response.json()) as UniversalIntentRoute)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Intent routing failed.")
    } finally { setLoading(false) }
  }

  const destinationHref = result?.destination?.href ?? null
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" size="sm" className="h-8 gap-2 rounded-none border-border bg-transparent" aria-label="Open universal intent"><Search className="size-3.5" /><span className="hidden sm:inline">Intent</span><kbd className="hidden border border-border px-1 font-mono text-[9px] text-muted-foreground md:inline">Ctrl K</kbd></Button></DialogTrigger>
    <DialogContent className="rounded-none">
      <DialogHeader><DialogTitle>Universal intent</DialogTitle><DialogDescription>Ask, do, inspect, steer, stop, or open any WilliamOS capability. Routing never grants execution authority.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="flex gap-2"><Input value={input} onChange={(event) => { setInput(event.target.value); setResult(null); setError(null) }} maxLength={2000} autoFocus placeholder="What do you need?" aria-label="Intent" /><Button type="submit" size="icon" disabled={loading || !input.trim()} aria-label="Route intent">{loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}</Button></form>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {result ? <div role="status" aria-live="polite" className="border-l-2 border-primary bg-muted/20 p-3 text-sm"><p className="font-medium">{result.state === "authority_required" ? "Execution remains gated" : result.state === "clarification_required" ? "Clarification required" : `Route to ${result.intent}`}</p><p className="mt-1 text-muted-foreground">{result.reason}</p>{result.destination && destinationHref ? <Button asChild size="sm" className="mt-3 rounded-none"><Link href={destinationHref} onClick={() => { if (result.intent !== "navigation") storeIntentHandoff(result.destination!.href, input); setOpen(false) }}>Continue in workbench <ArrowRight className="ml-2 size-3.5" /></Link></Button> : null}</div> : null}
    </DialogContent>
  </Dialog>
}
