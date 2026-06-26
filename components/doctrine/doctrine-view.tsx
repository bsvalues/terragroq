"use client"

import { useState, useTransition } from "react"
import type { Doctrine } from "@/lib/db/schema"
import {
  createDoctrine,
  deleteDoctrine,
  toggleDoctrine,
} from "@/app/actions/doctrine"
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
import { Plus, Trash2, ScrollText, Power } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export function DoctrineView({ initial }: { initial: Doctrine[] }) {
  const [rows, setRows] = useState(initial)
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()

  const [title, setTitle] = useState("")
  const [statement, setStatement] = useState("")
  const [category, setCategory] = useState("principle")
  const [priority, setPriority] = useState("0")

  function reset() {
    setTitle("")
    setStatement("")
    setCategory("principle")
    setPriority("0")
  }

  async function handleCreate() {
    if (!title.trim() || !statement.trim()) return
    try {
      const row = await createDoctrine({
        title,
        statement,
        category,
        priority: Number(priority) || 0,
      })
      setRows((prev) =>
        [row, ...prev].sort((a, b) => b.priority - a.priority),
      )
      toast.success("Doctrine ratified")
      reset()
      setOpen(false)
    } catch {
      toast.error("Failed to ratify doctrine")
    }
  }

  function handleToggle(id: number, active: boolean) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, active } : r)))
    startTransition(() => toggleDoctrine(id, active))
  }

  function handleDelete(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id))
    startTransition(() => deleteDoctrine(id))
    toast.success("Doctrine removed")
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Active doctrine is injected into Operator Chat as governing rules.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Ratify doctrine
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ratify doctrine</DialogTitle>
              <DialogDescription>
                A principle, policy, or guardrail that governs how the operator acts.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bias to reversible actions" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Statement</Label>
                <Textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={3} placeholder="Prefer decisions that are cheap to undo. Escalate only the irreversible." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="principle">Principle</SelectItem>
                      <SelectItem value="policy">Policy</SelectItem>
                      <SelectItem value="guardrail">Guardrail</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Priority</Label>
                  <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} min={0} max={10} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!title.trim() || !statement.trim()}>
                Ratify
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
            <div
              key={d.id}
              className={cn(
                "flex items-start justify-between gap-4 rounded-lg border bg-card p-4",
                d.active ? "border-border" : "border-border/50 opacity-60",
              )}
            >
              <div className="flex items-start gap-3 min-w-0">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs">
                  {d.priority}
                </span>
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium">{d.title}</h3>
                    <StatusBadge value={d.category} />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{d.statement}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", d.active && "text-success")}
                  onClick={() => handleToggle(d.id, !d.active)}
                  aria-label={d.active ? "Deactivate" : "Activate"}
                >
                  <Power className="h-3.5 w-3.5" />
                </Button>
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

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <ScrollText className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">No doctrine ratified</p>
      <p className="text-sm text-muted-foreground">Define the principles that govern how your operator behaves.</p>
    </div>
  )
}
