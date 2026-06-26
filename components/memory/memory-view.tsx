"use client"

import { useState, useTransition } from "react"
import type { MemoryFact } from "@/lib/db/schema"
import {
  createMemoryFact,
  deleteMemoryFact,
  togglePinMemory,
} from "@/app/actions/memory"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge } from "@/components/status-badge"
import { Plus, Pin, PinOff, Trash2, BrainCircuit } from "lucide-react"
import { toast } from "sonner"

export function MemoryView({ initial }: { initial: MemoryFact[] }) {
  const [facts, setFacts] = useState(initial)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [content, setContent] = useState("")
  const [kind, setKind] = useState("fact")
  const [confidence, setConfidence] = useState("medium")
  const [tags, setTags] = useState("")
  const [source, setSource] = useState("")

  function reset() {
    setContent("")
    setKind("fact")
    setConfidence("medium")
    setTags("")
    setSource("")
  }

  async function handleCreate() {
    if (!content.trim()) return
    try {
      const row = await createMemoryFact({
        content,
        kind,
        confidence,
        source: source || undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      })
      setFacts((prev) => [row, ...prev])
      toast.success("Memory committed and embedded")
      reset()
      setOpen(false)
    } catch {
      toast.error("Failed to commit memory")
    }
  }

  function handlePin(fact: MemoryFact) {
    const next = !fact.pinned
    setFacts((prev) =>
      prev
        .map((f) => (f.id === fact.id ? { ...f, pinned: next } : f))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    )
    startTransition(() => togglePinMemory(fact.id, next))
  }

  function handleDelete(id: number) {
    setFacts((prev) => prev.filter((f) => f.id !== id))
    startTransition(() => deleteMemoryFact(id))
    toast.success("Memory removed")
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Commit memory
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Commit memory fact</DialogTitle>
              <DialogDescription>
                Durable knowledge is embedded for semantic recall in Operator Chat.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="content">Fact</Label>
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="e.g. The team ships on Thursdays and freezes deploys on Fridays."
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Kind</Label>
                  <Select value={kind} onValueChange={setKind}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fact">Fact</SelectItem>
                      <SelectItem value="preference">Preference</SelectItem>
                      <SelectItem value="identity">Identity</SelectItem>
                      <SelectItem value="relationship">Relationship</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Confidence</Label>
                  <Select value={confidence} onValueChange={setConfidence}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tags">Tags (comma separated)</Label>
                <Input
                  id="tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="ops, cadence"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="source">Source (optional)</Label>
                <Input
                  id="source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="standup 2026-06-20"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={pending || !content.trim()}>
                Commit & embed
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {facts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {facts.map((fact) => (
            <div
              key={fact.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
            >
              <p className="text-sm leading-relaxed">{fact.content}</p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={fact.kind} />
                <StatusBadge value={fact.confidence} label={`${fact.confidence} confidence`} />
                {fact.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    #{t}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {fact.source ? `src: ${fact.source}` : `#${fact.id}`}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handlePin(fact)}
                    aria-label={fact.pinned ? "Unpin" : "Pin"}
                  >
                    {fact.pinned ? (
                      <Pin className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <PinOff className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(fact.id)}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <BrainCircuit className="h-8 w-8 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No memory committed yet</p>
        <p className="text-sm text-muted-foreground">
          Capture durable facts so Operator Chat can recall them with citations.
        </p>
      </div>
    </div>
  )
}
