"use client"

import { useState, useTransition } from "react"
import type { Decision } from "@/lib/db/schema"
import {
  createDecision,
  deleteDecision,
  updateDecisionStatus,
} from "@/app/actions/decisions"
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
import { Plus, Trash2, GitBranch } from "lucide-react"
import { toast } from "sonner"

const STATUSES = ["proposed", "accepted", "superseded", "rejected"]

export function DecisionsView({ initial }: { initial: Decision[] }) {
  const [rows, setRows] = useState(initial)
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()

  const [title, setTitle] = useState("")
  const [context, setContext] = useState("")
  const [decisionText, setDecisionText] = useState("")
  const [rationale, setRationale] = useState("")
  const [consequences, setConsequences] = useState("")

  function reset() {
    setTitle("")
    setContext("")
    setDecisionText("")
    setRationale("")
    setConsequences("")
  }

  async function handleCreate() {
    if (!title.trim() || !decisionText.trim()) return
    try {
      const row = await createDecision({
        title,
        context: context || undefined,
        decision: decisionText,
        rationale: rationale || undefined,
        consequences: consequences || undefined,
      })
      setRows((prev) => [row, ...prev])
      toast.success("Decision logged")
      reset()
      setOpen(false)
    } catch {
      toast.error("Failed to log decision")
    }
  }

  function handleStatus(id: number, status: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status, decidedAt: status === "accepted" ? new Date() : null }
          : r,
      ),
    )
    startTransition(() => updateDecisionStatus(id, status))
  }

  function handleDelete(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id))
    startTransition(() => deleteDecision(id))
    toast.success("Decision removed")
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Log decision
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Log a decision</DialogTitle>
              <DialogDescription>
                ADR-style record: what was decided, why, and what follows.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <Field label="Title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Adopt pgvector for retrieval" />
              </Field>
              <Field label="Context">
                <Textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} placeholder="What situation prompted this?" />
              </Field>
              <Field label="Decision">
                <Textarea value={decisionText} onChange={(e) => setDecisionText(e.target.value)} rows={2} placeholder="We will…" />
              </Field>
              <Field label="Rationale">
                <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} placeholder="Because…" />
              </Field>
              <Field label="Consequences">
                <Textarea value={consequences} onChange={(e) => setConsequences(e.target.value)} rows={2} placeholder="As a result…" />
              </Field>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!title.trim() || !decisionText.trim()}>
                Log decision
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((d) => (
            <div key={d.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <h3 className="font-medium">{d.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{d.decision}</p>
                </div>
                <StatusBadge value={d.status} />
              </div>

              {(d.context || d.rationale || d.consequences) && (
                <dl className="grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-3">
                  {d.context && <Meta k="Context" v={d.context} />}
                  {d.rationale && <Meta k="Rationale" v={d.rationale} />}
                  {d.consequences && <Meta k="Consequences" v={d.consequences} />}
                </dl>
              )}

              <div className="flex items-center justify-between border-t border-border pt-2">
                <Select value={d.status} onValueChange={(v) => handleStatus(d.id, v)}>
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(d.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
      <dd className="text-sm leading-relaxed">{v}</dd>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <GitBranch className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">No decisions logged</p>
      <p className="text-sm text-muted-foreground">Record consequential calls so the rationale survives.</p>
    </div>
  )
}
