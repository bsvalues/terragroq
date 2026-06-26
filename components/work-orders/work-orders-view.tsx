"use client"

import { useState, useTransition } from "react"
import type { WorkOrder } from "@/lib/db/schema"
import {
  createWorkOrder,
  deleteWorkOrder,
  updateWorkOrderStatus,
} from "@/app/actions/work-orders"
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
import { Plus, Trash2, ClipboardList } from "lucide-react"
import { toast } from "sonner"

const COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
]

export function WorkOrdersView({ initial }: { initial: WorkOrder[] }) {
  const [rows, setRows] = useState(initial)
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("medium")
  const [assignee, setAssignee] = useState("")

  function reset() {
    setTitle("")
    setDescription("")
    setPriority("medium")
    setAssignee("")
  }

  async function handleCreate() {
    if (!title.trim()) return
    try {
      const row = await createWorkOrder({
        title,
        description: description || undefined,
        priority,
        assignee: assignee || undefined,
      })
      setRows((prev) => [row, ...prev])
      toast.success("Work order opened")
      reset()
      setOpen(false)
    } catch {
      toast.error("Failed to open work order")
    }
  }

  function handleStatus(id: number, status: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status, completedAt: status === "done" ? new Date() : null }
          : r,
      ),
    )
    startTransition(() => updateWorkOrderStatus(id, status))
  }

  function handleDelete(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id))
    startTransition(() => deleteWorkOrder(id))
    toast.success("Work order removed")
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Open work order
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Open work order</DialogTitle>
              <DialogDescription>A governed unit of work to track to completion.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Migrate retrieval to HNSW index" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Scope, acceptance criteria…" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Assignee</Label>
                  <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="optional" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!title.trim()}>Open</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = rows.filter((r) => r.status === col.key)
            return (
              <div key={col.key} className="flex flex-col gap-3">
                <div className="flex items-center justify-between px-1">
                  <span className="text-sm font-medium">{col.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((w) => (
                    <div key={w.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug">{w.title}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(w.id)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      {w.description && (
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{w.description}</p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge value={w.priority} />
                        {w.assignee && (
                          <span className="font-mono text-[10px] text-muted-foreground truncate">@{w.assignee}</span>
                        )}
                      </div>
                      <Select value={w.status} onValueChange={(v) => handleStatus(w.id, v)}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COLUMNS.map((c) => (
                            <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <ClipboardList className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">No work orders</p>
      <p className="text-sm text-muted-foreground">Open governed units of work and track them across the board.</p>
    </div>
  )
}
