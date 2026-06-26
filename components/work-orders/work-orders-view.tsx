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
  updateWorkOrderContract,
} from "@/app/actions/work-orders"
import { recordEvidence } from "@/app/actions/evidence"
import { runGovernedLoop } from "@/app/actions/loops"
import {
  canTransition,
  checkApprovalReadiness,
  requiresExplicitApproval,
  WO_STATUSES,
  type WoStatus,
} from "@/lib/work-orders/lifecycle"
import { AUTHORITY_LEVELS, authority as findAuthority } from "@/lib/goal/taxonomy"
import { AGENTS, agent as findAgent } from "@/lib/goal/agent-matrix"
import { LOOP_TYPES, type LoopTypeId } from "@/lib/goal/loop-engine"
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
  ShieldCheck,
  Paperclip,
  FileText,
  Copy,
  Repeat,
  Bot,
  CheckCircle2,
  CircleAlert,
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
  const emptyForm = {
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
    acceptanceCriteria: "",
    loop: "",
    priority: "medium",
    assignee: "",
    authorityLevel: "A0_READ_ONLY",
    agent: "none",
  }
  const [form, setForm] = useState(emptyForm)
  const set = (k: keyof typeof form, v: string) =>
    setForm((p) => ({ ...p, [k]: v }))

  function reset() {
    setForm(emptyForm)
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
        acceptanceCriteria: form.acceptanceCriteria || undefined,
        loop: form.loop || undefined,
        priority: form.priority,
        assignee: form.assignee || undefined,
        authorityLevel: form.authorityLevel,
        agent: form.agent === "none" ? undefined : form.agent,
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
    opts: { approveDoctrine?: boolean; grantAuthority?: boolean } = {},
  ) {
    const res = await transitionWorkOrder(wo.id, to, opts)
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
              onClick: () => handleTransition(wo, to, { ...opts, approveDoctrine: true }),
            },
          },
        )
      } else if (
        to === "approved" &&
        res.missing &&
        requiresExplicitApproval(wo.authorityLevel) &&
        res.missing.length === 1 &&
        res.missing[0].startsWith("Grant ")
      ) {
        // Contract is complete; only the explicit authority grant remains.
        toast.warning(`Authorize ${wo.authorityLevel}? This grants elevated authority.`, {
          action: {
            label: "Grant & authorize",
            onClick: () => handleTransition(wo, to, { ...opts, grantAuthority: true }),
          },
        })
      } else if (res.missing && res.missing.length > 0) {
        toast.error(`Not ready to authorize: ${res.missing.join("; ")}`)
      } else {
        toast.error(res.reason)
      }
      return
    }
    const now = new Date()
    const terminal = to === "closed" || to === "aborted"
    const granting = to === "approved"
    patch({
      ...wo,
      status: to,
      authorityGranted: granting ? wo.authorityLevel : wo.authorityGranted,
      approvedAt: granting ? now : wo.approvedAt,
      closedAt: terminal ? now : wo.closedAt,
      completedAt: to === "closed" ? now : wo.completedAt,
    })
    toast.success(
      granting
        ? `${wo.ref ?? `#${wo.id}`} AUTHORIZED at ${wo.authorityLevel}`
        : `${wo.ref ?? `#${wo.id}`} → ${COLUMN_LABEL[to]}`,
    )
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
                <Field
                  label="Acceptance criteria"
                  hint="Required to authorize. One per line."
                >
                  <Textarea
                    value={form.acceptanceCriteria}
                    onChange={(e) => set("acceptanceCriteria", e.target.value)}
                    rows={2}
                    placeholder="p95 latency < 50ms&#10;all validators green"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Authority requested" hint="A0–A9 (§6).">
                    <Select
                      value={form.authorityLevel}
                      onValueChange={(v) => set("authorityLevel", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTHORITY_LEVELS.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Agent" hint="Permission matrix (§14).">
                    <Select value={form.agent} onValueChange={(v) => set("agent", v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {AGENTS.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
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
  // Contract completion (draft/proposed only)
  const [contract, setContract] = useState({
    authorityLevel: wo?.authorityLevel ?? "A0_READ_ONLY",
    agent: wo?.agent ?? "none",
    acceptanceCriteria: wo?.acceptanceCriteria.join("\n") ?? "",
    validators: wo?.validators.join("\n") ?? "",
    forbiddenFiles: wo?.forbiddenFiles.join("\n") ?? "",
  })
  // Governed loop runner
  const [loopTypeId, setLoopTypeId] = useState<LoopTypeId>("read")
  const [loopAuthority, setLoopAuthority] = useState("A0_READ_ONLY")
  const [loopResult, setLoopResult] = useState<Awaited<ReturnType<typeof runGovernedLoop>> | null>(
    null,
  )
  // Structured evidence record (§11)
  const [ev, setEv] = useState({
    result: "PASS",
    filesChanged: "",
    validators: "",
    knownFailures: "",
    nextValidMove: "",
  })

  if (!wo) return null

  const nextStates = WO_STATUSES.filter((s) => canTransition(wo.status, s))
  const readiness = checkApprovalReadiness(wo)
  const isEditable = wo.status === "draft" || wo.status === "proposed"

  async function addEvidence() {
    if (!wo || !evidence.trim()) return
    await linkWorkOrderEvidence(wo.id, evidence)
    onPatch({ ...wo, evidence: [...wo.evidence, evidence.trim()] })
    setEvidence("")
    toast.success("Evidence linked")
  }

  async function saveContract() {
    if (!wo) return
    try {
      await updateWorkOrderContract(wo.id, {
        authorityLevel: contract.authorityLevel,
        agent: contract.agent === "none" ? null : contract.agent,
        acceptanceCriteria: contract.acceptanceCriteria,
        validators: contract.validators,
        forbiddenFiles: contract.forbiddenFiles,
      })
      onPatch({
        ...wo,
        authorityLevel: contract.authorityLevel,
        agent: contract.agent === "none" ? null : contract.agent,
        acceptanceCriteria: splitLines(contract.acceptanceCriteria),
        validators: splitLines(contract.validators),
        forbiddenFiles: splitLines(contract.forbiddenFiles),
      })
      toast.success("Contract updated")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update contract")
    }
  }

  async function runLoop() {
    if (!wo) return
    try {
      const row = await runGovernedLoop({
        loopTypeId,
        authority: loopAuthority as never,
        workOrderId: wo.id,
      })
      setLoopResult(row)
      toast[row.status === "completed" ? "success" : "warning"](
        `${row.ref}: ${row.status === "completed" ? "completed" : "STOPPED"}`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Loop failed")
    }
  }

  async function saveEvidenceRecord() {
    if (!wo) return
    try {
      await recordEvidence({
        workOrderId: wo.id,
        result: ev.result as "PASS" | "FAIL" | "PARTIAL",
        filesChanged: ev.filesChanged,
        validators: ev.validators,
        knownFailures: ev.knownFailures,
        nextValidMove: ev.nextValidMove,
      })
      setEv({ result: "PASS", filesChanged: "", validators: "", knownFailures: "", nextValidMove: "" })
      toast.success("Evidence record saved")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record evidence")
    }
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
            <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {wo.authorityGranted ? (
                <ShieldCheck className="h-2.5 w-2.5 text-success" />
              ) : (
                <ShieldAlert className="h-2.5 w-2.5" />
              )}
              {findAuthority(wo.authorityGranted ?? wo.authorityLevel)?.label ?? wo.authorityLevel}
              {wo.authorityGranted ? " · granted" : " · requested"}
            </span>
            {wo.agent && (
              <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                <Bot className="h-2.5 w-2.5" />
                {findAgent(wo.agent)?.label ?? wo.agent}
              </span>
            )}
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

            {/* Authority & approval readiness (§6, §9) */}
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" />
                Authority &amp; approval
              </Label>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-muted px-2 py-1 font-mono text-[11px]">
                  Requested: {findAuthority(wo.authorityLevel)?.label ?? wo.authorityLevel}
                </span>
                <span className="rounded bg-muted px-2 py-1 font-mono text-[11px]">
                  Granted: {wo.authorityGranted ? findAuthority(wo.authorityGranted)?.label : "—"}
                </span>
              </div>
              {wo.status === "proposed" && (
                <ul className="flex flex-col gap-1">
                  {(readiness.ready
                    ? ["Ready for authorization"]
                    : readiness.missing
                  ).map((item, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 text-[11px] text-muted-foreground"
                    >
                      {readiness.ready ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                      ) : (
                        <CircleAlert className="h-3 w-3 shrink-0 text-warning" />
                      )}
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Complete the contract (draft/proposed only) */}
            {isEditable && (
              <>
                <Separator />
                <div className="flex flex-col gap-3">
                  <Label className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" />
                    Complete contract
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Authority</span>
                      <Select
                        value={contract.authorityLevel}
                        onValueChange={(v) => setContract((p) => ({ ...p, authorityLevel: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AUTHORITY_LEVELS.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Agent (§14)</span>
                      <Select
                        value={contract.agent}
                        onValueChange={(v) => setContract((p) => ({ ...p, agent: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {AGENTS.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Textarea
                    value={contract.acceptanceCriteria}
                    onChange={(e) =>
                      setContract((p) => ({ ...p, acceptanceCriteria: e.target.value }))
                    }
                    rows={2}
                    placeholder="Acceptance criteria (one per line)"
                    className="text-xs"
                  />
                  <Textarea
                    value={contract.validators}
                    onChange={(e) => setContract((p) => ({ ...p, validators: e.target.value }))}
                    rows={2}
                    placeholder="Validators (one per line)"
                    className="text-xs"
                  />
                  <Textarea
                    value={contract.forbiddenFiles}
                    onChange={(e) => setContract((p) => ({ ...p, forbiddenFiles: e.target.value }))}
                    rows={2}
                    placeholder="Blocked actions / forbidden files (one per line)"
                    className="text-xs"
                  />
                  <Button size="sm" variant="secondary" onClick={saveContract}>
                    Save contract
                  </Button>
                </div>
              </>
            )}

            <Separator />

            {/* Governed loop runner (§8) */}
            <div className="flex flex-col gap-3">
              <Label className="flex items-center gap-2">
                <Repeat className="h-3.5 w-3.5" />
                Run governed loop
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <Select value={loopTypeId} onValueChange={(v) => setLoopTypeId(v as LoopTypeId)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOOP_TYPES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={loopAuthority} onValueChange={setLoopAuthority}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTHORITY_LEVELS.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="secondary" onClick={runLoop}>
                <Repeat className="h-3 w-3" />
                Run loop
              </Button>
              {loopResult && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-3 text-[11px]">
                  <div className="flex items-center gap-2 font-mono">
                    <StatusBadge
                      value={loopResult.status === "completed" ? "active" : "blocked"}
                      label={loopResult.status === "completed" ? "COMPLETED" : "STOPPED"}
                    />
                    <span className="text-muted-foreground">
                      {loopResult.ref} · {loopResult.loopType}
                    </span>
                  </div>
                  {loopResult.stopReason && (
                    <p className="text-warning">STOP: {loopResult.stopReason}</p>
                  )}
                  {loopResult.actionsTaken.length > 0 && (
                    <p className="text-muted-foreground">
                      Actions: {loopResult.actionsTaken.join("; ")}
                    </p>
                  )}
                  {loopResult.evidenceCollected.length > 0 && (
                    <p className="text-muted-foreground">
                      Evidence: {loopResult.evidenceCollected.join("; ")}
                    </p>
                  )}
                  <p className="text-muted-foreground">Next: {loopResult.nextValidMove}</p>
                </div>
              )}
            </div>

            <Separator />

            {/* Structured evidence record (§11) */}
            <div className="flex flex-col gap-3">
              <Label className="flex items-center gap-2">
                <Paperclip className="h-3.5 w-3.5" />
                Evidence record (§11)
              </Label>
              <Select value={ev.result} onValueChange={(v) => setEv((p) => ({ ...p, result: v }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PASS">PASS</SelectItem>
                  <SelectItem value="PARTIAL">PARTIAL</SelectItem>
                  <SelectItem value="FAIL">FAIL</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                value={ev.filesChanged}
                onChange={(e) => setEv((p) => ({ ...p, filesChanged: e.target.value }))}
                rows={2}
                placeholder="Files changed (one per line)"
                className="text-xs"
              />
              <Textarea
                value={ev.validators}
                onChange={(e) => setEv((p) => ({ ...p, validators: e.target.value }))}
                rows={2}
                placeholder="Validator results (one per line)"
                className="text-xs"
              />
              <Input
                value={ev.knownFailures}
                onChange={(e) => setEv((p) => ({ ...p, knownFailures: e.target.value }))}
                placeholder="Known failures (comma-separated)"
                className="h-8 text-xs"
              />
              <Input
                value={ev.nextValidMove}
                onChange={(e) => setEv((p) => ({ ...p, nextValidMove: e.target.value }))}
                placeholder="Next valid move"
                className="h-8 text-xs"
              />
              <Button size="sm" variant="secondary" onClick={saveEvidenceRecord}>
                Save evidence record
              </Button>
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

function splitLines(v: string): string[] {
  return v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
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
