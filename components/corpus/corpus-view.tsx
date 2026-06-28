"use client"

import { useState, useTransition } from "react"
import type { Document } from "@/lib/db/schema"
import { ingestDocument, deleteDocument } from "@/app/actions/documents"
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
import { StatusBadge } from "@/components/status-badge"
import {
  CORPUS_EMPTY_STATE_DESCRIPTION,
  CORPUS_EMPTY_STATE_TITLE,
  getCorpusEmptyStateSteps,
} from "@/components/corpus/corpus-empty-state"
import { Plus, Trash2, Library, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"

export function CorpusView({ initial }: { initial: Document[] }) {
  const [docs, setDocs] = useState(initial)
  const [open, setOpen] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [, startTransition] = useTransition()

  const [title, setTitle] = useState("")
  const [source, setSource] = useState("")
  const [content, setContent] = useState("")

  function reset() {
    setTitle("")
    setSource("")
    setContent("")
  }

  async function handleIngest() {
    if (!title.trim() || !content.trim()) return
    setIngesting(true)
    try {
      const doc = await ingestDocument({
        title,
        content,
        source: source || undefined,
      })
      setDocs((prev) => [doc, ...prev])
      toast.success(`Indexed "${doc.title}" into ${doc.chunkCount} chunks`)
      reset()
      setOpen(false)
    } catch {
      toast.error("Failed to ingest document")
    } finally {
      setIngesting(false)
    }
  }

  function handleDelete(id: number) {
    setDocs((prev) => prev.filter((d) => d.id !== id))
    startTransition(() => deleteDocument(id))
    toast.success("Document removed from corpus")
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Ingest document
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Ingest document</DialogTitle>
              <DialogDescription>
                Text is chunked, embedded, and stored for retrieval-augmented answers with citations.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Q2 strategy memo" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Source (optional)</Label>
                <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="notion://memos/q2" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Content</Label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                  placeholder="Paste the full document text here…"
                />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {content.length.toLocaleString()} chars
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleIngest} disabled={ingesting || !title.trim() || !content.trim()}>
                {ingesting && <Loader2 className="h-4 w-4 animate-spin" />}
                {ingesting ? "Embedding…" : "Ingest & embed"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {docs.length === 0 ? (
        <Empty />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Document</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Chunks</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {docs.map((d) => (
                <tr key={d.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{d.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {d.source ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums">{d.chunkCount}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={d.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(d.id)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Empty() {
  const steps = getCorpusEmptyStateSteps()

  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-6">
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-3 text-center">
        <Library className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">{CORPUS_EMPTY_STATE_TITLE}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {CORPUS_EMPTY_STATE_DESCRIPTION}
        </p>
      </div>
      <div className="mx-auto mt-6 grid max-w-4xl gap-3 md:grid-cols-3">
        {steps.map((step) => (
          <div key={step.id} className="rounded-md border border-border bg-background px-4 py-3 text-left">
            <p className="text-sm font-medium">{step.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
