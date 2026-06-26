"use client"

import { useState, useTransition } from "react"
import type { WorkOrder } from "@/lib/db/schema"
import {
  createWorkOrder,
  deleteWorkOrder,
  transitionWorkOrder,
  linkWorkOrderEvidence,
  recordWorkOrderResult,
  setWorkOrderGate,
  getClosureReport,
} from "@/app/actions/work-orders"
import {
  canTransition,
  WO_STATUSES,
  type WoStatus,
} from "@/lib/work-orders/lifecycle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { StatusBadge } from "@/components/status-badge"
import {
  Plus,
  Trash2,
  ClipboardList,
  ArrowRight,
  ShieldAlert,
  Paperclip,
  FileText,
  Copy,
} from "lucide-react"
import { toast } from "sonner"

const COLUMNS: { key: WoStatus; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "proposed", label: "Proposed" },
  { key: "approved", label: "Approved" },
  { key: "active", label: "Active" },
  { key: "blocked", label: "Blocked" },
  { key: "review", label: "Review" },
  { key: "closed", label: "Closed" },
  { key: "aborted", label: "Aborted" },
]

const COLUMN_LABEL: Record<string, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.label]),
)

export function WorkOrdersView({ initial }: { initial: WorkOrder[] }) {
  const [rows, setRows] = useState(initial)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<WorkOrder | null>(null)
  const [, startTransition] = useTransition()

  // create form
  const [form, setForm] = useState({
    title: "",
    goal: "",
    lane: "",
    phase: "",
    scope: "",
    nonGoals: "",
    allowedFiles: "",
    forbiddenFiles: "",
    validators: "",
    stopConditions: "",
    loop: "",
    priority: "medium",
    assignee: "",
  })
  const set = (k: keyof typeof form, v: string) =>
    setForm((p) => ({ ...p, [k]: v }))

  function reset() {
    setForm({
      title: "",
      goal: "",
      lane: "",
      phase: "",
      scope: "",
      nonGoals: "",
      allowedFiles: "",
      forbiddenFiles: "",
      validators: "",
      stopConditions: "",
      loop: "",
      priority: "medium",
      assignee: "",
    })
  }

  async function handleCreate() {
    if (!form.title.trim()) return
    try {
      const row = await createWorkOrder({
        title: form.title,
        goal: form.goal || undefined,
        lane: form.lane || undefined,
        phase: form.phase || undefined,
        scope: form.scope || undefined,
        nonGoals: form.nonGoals || undefined,
        allowedFiles: form.allowedFiles || undefined,
        forbiddenFiles: form.forbiddenFiles || undefined,
        validators: form.validators || undefined,
        stopConditions: form.stopConditions || undefined,
        loop: form.loop || undefined,
        priority: form.priority,
        assignee: form.assignee || undefined,
      })
      setRows((prev) => [row, ...prev])
      toast.success(`Drafted ${row.ref ?? "work order"}`)
      reset()
      setOpen(false)
    } catch {
      toast.error("Failed to draft work order")
    }
  }

  function patch(updated: WorkOrder) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    if (selected?.id === updated.id) setSelected(updated)
  }

  async function handleTransition(
    wo: WorkOrder,
    to: WoStatus,
    approveDoctrine = false,
  ) {
    const res = await transitionWorkOrder(wo.id, to, { approveDoctrine })
    if (!res.ok) {
      if (res.verdict && res.verdict.verdict === "forbidden") {
        const m = res.verdict.matches[0]
        toast.error(
          `Blocked by doctrine ${m?.ref ?? ""}: ${m?.title ?? res.reason}`,
        )
      } else if (res.verdict && res.verdict.verdict === "requires_approval") {
        const m = res.verdict.matches[0]
        toast.warning(
          `${m?.ref ?? "Doctrine"} requires approval — confirm to activate`,
          {
            action: {
              label: "Approve & activate",
              onClick: () => handleTransition(wo, to, true),
            },
          },
        )
      } else {
        toast.error(res.reason)
      }
      return
    }
    const now = new Date()
    const terminal = to === "closed" || to === "aborted"
    patch({
      ...wo,
      status: to,
      closedAt: terminal ? now : wo.closedAt,
      completedAt: to === "closed" ? now : wo.completedAt,
    })
    toast.success(`${wo.ref ?? `#${wo.id}`} → ${COLUMN_LABEL[to]}`)
  }

  function handleDelete(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id))
    if (selected?.id === id) setSelected(null)
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
              Draft work order
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Draft work order</DialogTitle>
              <DialogDescription>
                A governed unit of work. Define the contract up front — goal,
                scope, file boundaries, validators, and stop conditions.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="flex flex-col gap-4 py-2">
                <Field label="Title">
                  <Input
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder="Add HNSW index to retrieval"
                  />
                </Field>
                <Field label="Goal" hint="The single outcome this WO delivers.">
                  <Textarea
                    value={form.goal}
                    onChange={(e) => set("goal", e.target.value)}
                    rows={2}
                    placeholder="Cut p95 retrieval latency below 50ms…"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Lane">
                    <Input
                      value={form.lane}
                      onChange={(e) => set("lane", e.target.value)}
                      placeholder="A — docs only"
                    />
                  </Field>
                  <Field label="Phase">
                    <Input
                      value={form.phase}
                      onChange={(e) => set("phase", e.target.value)}
                      placeholder="Phase 5"
                    />
                  </Field>
                </div>
                <Field label="Scope">
                  <Textarea
                    value={form.scope}
                    onChange={(e) => set("scope", e.target.value)}
                    rows={2}
                  />
                </Field>
                <Field
                  label="Non-goals"
                  hint="One per line or comma-separated."
                >
                  <Textarea
                    value={form.nonGoals}
                    onChange={(e) => set("nonGoals", e.target.value)}
                    rows={2}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Allowed files">
                    <Textarea
                      value={form.allowedFiles}
                      onChange={(e) => set("allowedFiles", e.target.value)}
                      rows={3}
                      placeholder="lib/ai/**&#10;app/api/**"
                    />
                  </Field>
                  <Field label="Forbidden files">
                    <Textarea
                      value={form.forbiddenFiles}
                      onChange={(e) => set("forbiddenFiles", e.target.value)}
                      rows={3}
                      placeholder="lib/db/schema.ts"
                    />
                  </Field>
                </div>
                <Field label="Validators" hint="Commands that must pass.">
                  <Textarea
                    value={form.validators}
                    onChange={(e) => set("validators", e.target.value)}
                    rows={2}
                    placeholder="tsc --noEmit&#10;pnpm build"
                  />
                </Field>
                <Field label="Stop conditions">
                  <Textarea
                    value={form.stopConditions}
                    onChange={(e) => set("stopConditions", e.target.value)}
                    rows={2}
                    placeholder="Any schema change required&#10;Phase 6 work implied"
                  />
                </Field>
                <Field label="Loop">
                  <Input
                    value={form.loop}
                    onChange={(e) => set("loop", e.target.value)}
                    placeholder="preflight → implement → verify → report"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Priority">
                    <Select
                      value={form.priority}
                      onValueChange={(v) => set("priority", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Assignee">
                    <Input
                      value={form.assignee}
                      onChange={(e) => set("assignee", e.target.value)}
                      placeholder="optional"
                    />
                  </Field>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!form.title.trim()}>
                Draft
              </Button>
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
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <StatusBadge value={col.key} label={col.label} />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setSelected(w)}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {w.ref ?? `#${w.id}`}
                        </span>
                        <StatusBadge value={w.priority} />
                      </div>
                      <span className="text-sm font-medium leading-snug">
                        {w.title}
                      </span>
                      {w.goal && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {w.goal}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {w.lane && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {w.lane}
                          </span>
                        )}
                        {w.evidence.length > 0 && (
                          <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                            <Paperclip className="h-2.5 w-2.5" />
                            {w.evidence.length}
                          </span>
                        )}
                        {w.result && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {w.result}
                          </span>
                        )}
                      </div>
                    </button>
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

      <DetailDialog
        wo={selected}
        onClose={() => setSelected(null)}
        onTransition={handleTransition}
        onDelete={handleDelete}
        onPatch={patch}
      />
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function DetailDialog({
  wo,
  onClose,
  onTransition,
  onDelete,
  onPatch,
}: {
  wo: WorkOrder | null
  onClose: () => void
  onTransition: (wo: WorkOrder, to: WoStatus) => void
  onDelete: (id: number) => void
  onPatch: (wo: WorkOrder) => void
}) {
  const [evidence, setEvidence] = useState("")
  const [report, setReport] = useState<string | null>(null)

  if (!wo) return null

  const nextStates = WO_STATUSES.filter((s) => canTransition(wo.status, s))

  async function addEvidence() {
    if (!wo || !evidence.trim()) return
    await linkWorkOrderEvidence(wo.id, evidence)
    onPatch({ ...wo, evidence: [...wo.evidence, evidence.trim()] })
    setEvidence("")
    toast.success("Evidence linked")
  }

  async function toggleGate(gate: "commit" | "tag" | "push", open: boolean) {
    if (!wo) return
    await setWorkOrderGate(wo.id, gate, open)
    onPatch({
      ...wo,
      commitAllowed: gate === "commit" ? open : wo.commitAllowed,
      tagAllowed: gate === "tag" ? open : wo.tagAllowed,
      pushAllowed: gate === "push" ? open : wo.pushAllowed,
    })
    toast.success(`${gate} gate ${open ? "opened" : "closed"}`)
  }

  async function mark(result: "PASS" | "FAIL" | "PARTIAL") {
    if (!wo) return
    await recordWorkOrderResult(wo.id, { result })
    onPatch({ ...wo, result })
    toast.success(`Result: ${result}`)
  }

  async function showReport() {
    if (!wo) return
    const r = await getClosureReport(wo.id)
    setReport(r)
  }

  return (
    <Dialog open={!!wo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              {wo.ref ?? `#${wo.id}`}
            </span>
            {wo.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            <StatusBadge value={wo.status} label={COLUMN_LABEL[wo.status]} />
            <StatusBadge value={wo.priority} />
            {wo.result && (
              <span className="font-mono text-xs text-muted-foreground">
                {wo.result}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh] pr-4">
          <div className="flex flex-col gap-4 py-1 text-sm">
            {wo.goal && <Block label="Goal">{wo.goal}</Block>}
            {wo.scope && <Block label="Scope">{wo.scope}</Block>}
            <ListBlock label="Non-goals" items={wo.nonGoals} />
            <ListBlock label="Allowed files" items={wo.allowedFiles} mono />
            <ListBlock label="Forbidden files" items={wo.forbiddenFiles} mono />
            <ListBlock label="Validators" items={wo.validators} mono />
            <ListBlock label="Stop conditions" items={wo.stopConditions} />
            {wo.loop && <Block label="Loop">{wo.loop}</Block>}

            <Separator />

            {/* Evidence */}
            <div className="flex flex-col gap-2">
              <Label>Evidence</Label>
              {wo.evidence.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {wo.evidence.map((e, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 font-mono text-xs text-muted-foreground"
                    >
                      <Paperclip className="h-3 w-3 shrink-0" />
                      <span className="truncate">{e}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No evidence linked yet.
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="commit sha, screenshot path, validator output…"
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={addEvidence}
                  disabled={!evidence.trim()}
                >
                  Link
                </Button>
              </div>
            </div>

            <Separator />

            {/* Release gates */}
            <div className="flex flex-col gap-3">
              <Label className="flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5 text-warning" />
                Release gates
              </Label>
              <Gate
                label="Commit"
                desc="Allow recording a commit ref"
                checked={wo.commitAllowed}
                onChange={(v) => toggleGate("commit", v)}
              />
              <Gate
                label="Tag"
                desc="Allow recording a tag / release"
                checked={wo.tagAllowed}
                onChange={(v) => toggleGate("tag", v)}
              />
              <Gate
                label="Push"
                desc="Allow pushing to remote"
                checked={wo.pushAllowed}
                onChange={(v) => toggleGate("push", v)}
              />
            </div>

            {report && (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" />
                      Closure report
                    </Label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard.writeText(report)
                        toast.success("Copied")
                      }}
                    >
                      <Copy className="h-3 w-3" />
                      Copy
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                    {report}
                  </pre>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-col gap-3 sm:flex-col sm:items-stretch">
          {/* Result marking */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Result:</span>
            <Button size="sm" variant="secondary" onClick={() => mark("PASS")}>
              PASS
            </Button>
            <Button size="sm" variant="secondary" onClick={() => mark("PARTIAL")}>
              PARTIAL
            </Button>
            <Button size="sm" variant="secondary" onClick={() => mark("FAIL")}>
              FAIL
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={showReport}
            >
              <FileText className="h-3 w-3" />
              Closure report
            </Button>
          </div>

          <Separator />

          {/* Transitions */}
          <div className="flex flex-wrap items-center gap-2">
            {nextStates.length > 0 ? (
              nextStates.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === "aborted" ? "outline" : "default"}
                  onClick={() => onTransition(wo, s)}
                >
                  {s !== "aborted" && <ArrowRight className="h-3 w-3" />}
                  {COLUMN_LABEL[s]}
                </Button>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">
                Terminal state — no transitions.
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(wo.id)}
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <p className="leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

function ListBlock({
  label,
  items,
  mono,
}: {
  label: string
  items: string[]
  mono?: boolean
}) {
  if (!items || items.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <ul className="flex flex-col gap-0.5">
        {items.map((it, i) => (
          <li
            key={i}
            className={
              mono
                ? "font-mono text-xs text-muted-foreground"
                : "text-xs text-muted-foreground"
            }
          >
            {mono ? it : `• ${it}`}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Gate({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
      <div className="flex flex-col">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[11px] text-muted-foreground">{desc}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <ClipboardList className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">No work orders</p>
      <p className="text-sm text-muted-foreground">
        Draft a governed unit of work — define its contract and run it through
        the lifecycle.
      </p>
    </div>
  )
}
