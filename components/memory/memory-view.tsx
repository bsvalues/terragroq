"use client"

import { useMemo, useState, useTransition } from "react"
import type { MemoryFact } from "@/lib/db/schema"
import {
  archiveMemoryFact,
  createMemoryFact,
  deleteMemoryFact,
  demoteFromCanon,
  exportMemory,
  promoteToCanon,
  reviewMemoryFact,
  setMemoryStale,
  togglePinMemory,
  updateMemoryFact,
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusBadge } from "@/components/status-badge"
import {
  Plus,
  Pin,
  PinOff,
  Trash2,
  BrainCircuit,
  MoreVertical,
  ShieldCheck,
  CheckCircle2,
  ArrowDownCircle,
  AlertTriangle,
  Archive,
  Pencil,
  Download,
} from "lucide-react"
import { toast } from "sonner"

type Tab = "queue" | "working" | "canon" | "stale" | "archive"

const QUEUE_STATES = ["intake", "unreviewed"]
const WORKING_STATES = ["working", "reviewed"]
const ARCHIVE_STATES = ["deprecated", "superseded", "archived"]

export function MemoryView({ initial }: { initial: MemoryFact[] }) {
  const [facts, setFacts] = useState(initial)
  const [tab, setTab] = useState<Tab>("queue")
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Commit form
  const [content, setContent] = useState("")
  const [kind, setKind] = useState("fact")
  const [confidence, setConfidence] = useState("medium")
  const [tags, setTags] = useState("")
  const [source, setSource] = useState("")

  // Edit dialog
  const [editing, setEditing] = useState<MemoryFact | null>(null)

  function reset() {
    setContent("")
    setKind("fact")
    setConfidence("medium")
    setTags("")
    setSource("")
  }

  function upsert(row: MemoryFact) {
    setFacts((prev) => prev.map((f) => (f.id === row.id ? row : f)))
  }

  const buckets = useMemo(() => {
    return {
      queue: facts.filter((f) => QUEUE_STATES.includes(f.authority)),
      working: facts.filter((f) => WORKING_STATES.includes(f.authority)),
      canon: facts.filter((f) => f.authority === "canon"),
      stale: facts.filter((f) => f.stale),
      archive: facts.filter((f) => ARCHIVE_STATES.includes(f.authority)),
    }
  }, [facts])

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
      setTab("queue")
      toast.success("Committed to review queue (unreviewed)")
      reset()
      setOpen(false)
    } catch {
      toast.error("Failed to commit memory")
    }
  }

  async function handleEditSave() {
    if (!editing) return
    try {
      const row = await updateMemoryFact(editing.id, {
        content: editing.content,
        kind: editing.kind,
        confidence: editing.confidence,
        source: editing.source,
        tags: editing.tags,
      })
      upsert(row)
      toast.success("Memory updated")
      setEditing(null)
    } catch {
      toast.error("Failed to update memory")
    }
  }

  function run(label: string, fn: () => Promise<MemoryFact>) {
    startTransition(async () => {
      try {
        const row = await fn()
        upsert(row)
        toast.success(label)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed")
      }
    })
  }

  function handlePin(fact: MemoryFact) {
    const next = !fact.pinned
    upsert({ ...fact, pinned: next })
    startTransition(() => togglePinMemory(fact.id, next))
  }

  function handleDelete(id: number) {
    setFacts((prev) => prev.filter((f) => f.id !== id))
    startTransition(() => deleteMemoryFact(id))
    toast.success("Memory removed")
  }

  async function handleExport() {
    try {
      const data = await exportMemory()
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `williamos-memory-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${data.count} facts`)
    } catch {
      toast.error("Export failed")
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4" />
          Export
        </Button>
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
                New facts enter the review queue as unreviewed. Review and promote to
                canon before they are treated as authoritative.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="content">Fact</Label>
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="e.g. The Primary prefers release notes before merges."
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="queue">
            Review queue
            <Count n={buckets.queue.length} />
          </TabsTrigger>
          <TabsTrigger value="working">
            Working
            <Count n={buckets.working.length} />
          </TabsTrigger>
          <TabsTrigger value="canon">
            Canon
            <Count n={buckets.canon.length} />
          </TabsTrigger>
          <TabsTrigger value="stale">
            Stale
            <Count n={buckets.stale.length} />
          </TabsTrigger>
          <TabsTrigger value="archive">
            Archive
            <Count n={buckets.archive.length} />
          </TabsTrigger>
        </TabsList>

        {(["queue", "working", "canon", "stale", "archive"] as Tab[]).map((t) => (
          <TabsContent key={t} value={t} className="mt-4">
            {buckets[t].length === 0 ? (
              <EmptyState tab={t} />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {buckets[t].map((fact) => (
                  <FactCard
                    key={fact.id}
                    fact={fact}
                    pending={pending}
                    onPin={() => handlePin(fact)}
                    onEdit={() => setEditing(fact)}
                    onDelete={() => handleDelete(fact.id)}
                    onReview={() =>
                      run("Marked reviewed", () => reviewMemoryFact(fact.id))
                    }
                    onPromote={() =>
                      run("Promoted to canon", () => promoteToCanon(fact.id))
                    }
                    onDemote={() =>
                      run("Demoted from canon", () => demoteFromCanon(fact.id))
                    }
                    onStale={() =>
                      run(fact.stale ? "Stale cleared" : "Marked stale", () =>
                        setMemoryStale(fact.id, !fact.stale),
                      )
                    }
                    onArchive={() =>
                      run("Archived", () => archiveMemoryFact(fact.id))
                    }
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Edit / detail dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit memory fact</DialogTitle>
            <DialogDescription>
              Editing the content re-embeds the fact for accurate recall.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-content">Fact</Label>
                <Textarea
                  id="edit-content"
                  value={editing.content}
                  onChange={(e) =>
                    setEditing({ ...editing, content: e.target.value })
                  }
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Kind</Label>
                  <Select
                    value={editing.kind}
                    onValueChange={(v) => setEditing({ ...editing, kind: v })}
                  >
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
                  <Select
                    value={editing.confidence}
                    onValueChange={(v) =>
                      setEditing({ ...editing, confidence: v })
                    }
                  >
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
                <Label htmlFor="edit-tags">Tags (comma separated)</Label>
                <Input
                  id="edit-tags"
                  value={editing.tags.join(", ")}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      tags: e.target.value
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-source">Source</Label>
                <Input
                  id="edit-source"
                  value={editing.source ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, source: e.target.value || null })
                  }
                />
              </div>
              <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground">
                <div>authority: {editing.authority}</div>
                <div>
                  reviewed:{" "}
                  {editing.reviewedAt
                    ? new Date(editing.reviewedAt).toLocaleString()
                    : "never"}
                </div>
                <div>
                  last recalled:{" "}
                  {editing.lastUsedAt
                    ? new Date(editing.lastUsedAt).toLocaleString()
                    : "never"}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={pending}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Count({ n }: { n: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
      {n}
    </span>
  )
}

function FactCard({
  fact,
  pending,
  onPin,
  onEdit,
  onDelete,
  onReview,
  onPromote,
  onDemote,
  onStale,
  onArchive,
}: {
  fact: MemoryFact
  pending: boolean
  onPin: () => void
  onEdit: () => void
  onDelete: () => void
  onReview: () => void
  onPromote: () => void
  onDemote: () => void
  onStale: () => void
  onArchive: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p className="text-sm leading-relaxed">{fact.content}</p>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge value={fact.kind} />
        <StatusBadge value={fact.authority} />
        {fact.stale && <StatusBadge value="stale" />}
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
          {fact.lastUsedAt ? " · recalled" : " · never recalled"}
        </span>
        <div className="flex items-center gap-1">
          {/* Contextual primary action */}
          {(fact.authority === "unreviewed" || fact.authority === "intake") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={pending}
              onClick={onReview}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Review
            </Button>
          )}
          {fact.authority === "reviewed" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-success"
              disabled={pending}
              onClick={onPromote}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Promote
            </Button>
          )}
          {fact.authority === "canon" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={pending}
              onClick={onDemote}
            >
              <ArrowDownCircle className="h-3.5 w-3.5" />
              Demote
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onPin}
            aria-label={fact.pinned ? "Unpin" : "Pin"}
          >
            {fact.pinned ? (
              <Pin className="h-3.5 w-3.5 text-primary" />
            ) : (
              <PinOff className="h-3.5 w-3.5" />
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="More actions"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onStale}>
                <AlertTriangle className="h-3.5 w-3.5" />
                {fact.stale ? "Clear stale" : "Mark stale"}
              </DropdownMenuItem>
              {fact.authority !== "archived" && (
                <DropdownMenuItem onClick={onArchive}>
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

const EMPTY_COPY: Record<Tab, { title: string; body: string }> = {
  queue: {
    title: "Review queue is clear",
    body: "Newly committed facts land here as unreviewed until you review them.",
  },
  working: {
    title: "No working memory",
    body: "Reviewed facts that are not yet canon appear here.",
  },
  canon: {
    title: "No canon facts yet",
    body: "Review a fact, then promote it to canon to make it authoritative.",
  },
  stale: {
    title: "Nothing marked stale",
    body: "Facts you flag as potentially out of date will collect here.",
  },
  archive: {
    title: "Archive is empty",
    body: "Archived, deprecated, and superseded facts are retained here for provenance.",
  },
}

function EmptyState({ tab }: { tab: Tab }) {
  const copy = EMPTY_COPY[tab]
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <BrainCircuit className="h-8 w-8 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
      </div>
    </div>
  )
}
