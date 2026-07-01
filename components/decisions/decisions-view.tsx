"use client"

import { useMemo, useState, useTransition } from "react"
import type { Decision } from "@/lib/db/schema"
import {
  createDecision,
  deleteDecision,
  linkEvidence,
  seedGovernanceDecisions,
  setDecisionAuthority,
  supersedeDecision,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DECISION_EMPTY_STATE_STEPS } from "@/components/decisions/decision-empty-state"
import { getDecisionReviewFlow } from "@/components/decisions/decision-review-flow"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusBadge } from "@/components/status-badge"
import {
  Plus,
  Trash2,
  GitBranch,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Lock,
  Link2,
  ArrowRight,
  Paperclip,
} from "lucide-react"
import { toast } from "sonner"

const STATUSES = ["proposed", "accepted", "superseded", "rejected"]
const AUTHORITIES = ["binding", "advisory", "informational"]

type Tab = "active" | "proposed" | "superseded" | "all"

export function DecisionsView({ initial }: { initial: Decision[] }) {
  const [rows, setRows] = useState(initial)
  const [tab, setTab] = useState<Tab>("active")
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // create form
  const [title, setTitle] = useState("")
  const [context, setContext] = useState("")
  const [decisionText, setDecisionText] = useState("")
  const [rationale, setRationale] = useState("")
  const [consequences, setConsequences] = useState("")
  const [authority, setAuthority] = useState("advisory")
  const [status, setStatus] = useState("proposed")
  const [scope, setScope] = useState("")
  const [evidence, setEvidence] = useState("")
  const [tags, setTags] = useState("")

  // supersede form
  const [supersedeTarget, setSupersedeTarget] = useState<Decision | null>(null)
  const [sTitle, setSTitle] = useState("")
  const [sDecision, setSDecision] = useState("")
  const [sRationale, setSRationale] = useState("")
  const [sEvidence, setSEvidence] = useState("")

  // evidence form
  const [evidenceTarget, setEvidenceTarget] = useState<Decision | null>(null)
  const [evidenceText, setEvidenceText] = useState("")

  const hasSeeds = rows.some((r) => r.locked)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      const inTab =
        tab === "all"
          ? true
          : tab === "active"
            ? r.status === "accepted"
            : tab === "proposed"
              ? r.status === "proposed"
              : r.status === "superseded"
      if (!inTab) return false
      if (!q) return true
      return (
        r.title.toLowerCase().includes(q) ||
        r.decision.toLowerCase().includes(q) ||
        (r.rationale ?? "").toLowerCase().includes(q) ||
        (r.ref ?? "").toLowerCase().includes(q) ||
        (r.scope ?? "").toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [rows, tab, search])

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.status === "accepted").length,
      proposed: rows.filter((r) => r.status === "proposed").length,
      superseded: rows.filter((r) => r.status === "superseded").length,
      all: rows.length,
    }),
    [rows],
  )
  const reviewFlow = useMemo(() => getDecisionReviewFlow(counts), [counts])

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])

  function resetCreate() {
    setTitle("")
    setContext("")
    setDecisionText("")
    setRationale("")
    setConsequences("")
    setAuthority("advisory")
    setStatus("proposed")
    setScope("")
    setEvidence("")
    setTags("")
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
        authority,
        status,
        scope: scope || undefined,
        evidence: evidence || undefined,
        tags: tags || undefined,
      })
      setRows((prev) => [row, ...prev])
      toast.success(`Logged ${row.ref}`)
      resetCreate()
      setCreateOpen(false)
    } catch {
      toast.error("Failed to log decision")
    }
  }

  function handleSeed() {
    startTransition(async () => {
      try {
        const { created } = await seedGovernanceDecisions()
        if (created === 0) {
          toast.info("Governance decisions already seeded")
          return
        }
        toast.success(`Seeded ${created} governance decision${created === 1 ? "" : "s"}`)
        // Reload to pull the freshly seeded rows with their generated refs.
        window.location.reload()
      } catch {
        toast.error("Failed to seed governance decisions")
      }
    })
  }

  function handleStatus(id: number, next: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: next, decidedAt: next === "accepted" ? new Date() : null }
          : r,
      ),
    )
    startTransition(() => updateDecisionStatus(id, next))
  }

  function handleAuthority(id: number, next: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, authority: next } : r)))
    startTransition(() => setDecisionAuthority(id, next))
  }

  function handleDelete(id: number) {
    const row = byId.get(id)
    if (row?.locked) {
      toast.error("Locked governance decision — cannot delete")
      return
    }
    setRows((prev) => prev.filter((r) => r.id !== id))
    startTransition(async () => {
      try {
        await deleteDecision(id)
        toast.success("Decision removed")
      } catch {
        toast.error("Could not delete decision")
        if (row) setRows((prev) => [row, ...prev])
      }
    })
  }

  async function handleLinkEvidence() {
    if (!evidenceTarget || !evidenceText.trim()) return
    const id = evidenceTarget.id
    try {
      await linkEvidence(id, evidenceText)
      const added = evidenceText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, evidence: Array.from(new Set([...r.evidence, ...added])) }
            : r,
        ),
      )
      toast.success("Evidence linked")
      setEvidenceTarget(null)
      setEvidenceText("")
    } catch {
      toast.error("Failed to link evidence")
    }
  }

  async function handleSupersede() {
    if (!supersedeTarget || !sTitle.trim() || !sDecision.trim()) return
    const oldId = supersedeTarget.id
    try {
      const replacement = await supersedeDecision(oldId, {
        title: sTitle,
        decision: sDecision,
        rationale: sRationale || undefined,
        evidence: sEvidence || undefined,
      })
      setRows((prev) => [
        replacement,
        ...prev.map((r) =>
          r.id === oldId
            ? { ...r, status: "superseded", supersededById: replacement.id }
            : r,
        ),
      ])
      toast.success(`${supersedeTarget.ref ?? "Decision"} superseded by ${replacement.ref}`)
      setSupersedeTarget(null)
      setSTitle("")
      setSDecision("")
      setSRationale("")
      setSEvidence("")
    } catch {
      toast.error("Failed to supersede decision")
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search decisions, refs, tags…"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          {!hasSeeds && (
            <Button variant="outline" onClick={handleSeed} disabled={pending}>
              <ShieldCheck className="h-4 w-4" />
              Seed governance
            </Button>
          )}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                  ADR-style record: what was decided, why, its authority, and evidence.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-2">
                <Field label="Title">
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Adopt pgvector for retrieval" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Authority">
                    <Select value={authority} onValueChange={setAuthority}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AUTHORITIES.map((a) => (
                          <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Status">
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.filter((s) => s !== "superseded").map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
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
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Scope">
                    <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="runtime, memory, global…" />
                  </Field>
                  <Field label="Tags (comma-separated)">
                    <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="runtime, model" />
                  </Field>
                </div>
                <Field label="Evidence (comma-separated)">
                  <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="commit hash, doc title, tag…" />
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
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Command Center decision gate
            </p>
          </div>
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-lg font-semibold tracking-tight">{reviewFlow.title}</p>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {reviewFlow.description}
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setTab(reviewFlow.tab)}>
              {reviewFlow.action}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-4">
          <DecisionFlowStep
            label="From Home"
            value={reviewFlow.homeSignal}
            detail="Attention moves here before a new objective is classified."
          />
          <DecisionFlowStep
            label="Current Queue"
            value={reviewFlow.queueLabel}
            detail={`${counts.proposed} proposed · ${counts.active} accepted · ${counts.superseded} superseded`}
          />
          <DecisionFlowStep
            label="After Decision"
            value={reviewFlow.nextMove}
            detail="Return to Home when the authority question is resolved."
          />
          <DecisionFlowStep
            label="Boundary"
            value="Authority record only"
            detail={reviewFlow.boundary}
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="active">Active ({counts.active})</TabsTrigger>
          <TabsTrigger value="proposed">Proposed ({counts.proposed})</TabsTrigger>
          <TabsTrigger value="superseded">Superseded ({counts.superseded})</TabsTrigger>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {filtered.length === 0 ? (
            <Empty seeded={hasSeeds} onSeed={handleSeed} pending={pending} />
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map((d) => (
                <DecisionCard
                  key={d.id}
                  d={d}
                  byId={byId}
                  onStatus={handleStatus}
                  onAuthority={handleAuthority}
                  onDelete={handleDelete}
                  onSupersede={(row) => {
                    setSupersedeTarget(row)
                    setSTitle("")
                    setSDecision("")
                    setSRationale("")
                    setSEvidence("")
                  }}
                  onEvidence={(row) => {
                    setEvidenceTarget(row)
                    setEvidenceText("")
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Supersede dialog */}
      <Dialog open={!!supersedeTarget} onOpenChange={(o) => !o && setSupersedeTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Supersede {supersedeTarget?.ref}</DialogTitle>
            <DialogDescription>
              Create a replacement decision. The original is preserved and marked superseded — provenance is never lost.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <Field label="New title">
              <Input value={sTitle} onChange={(e) => setSTitle(e.target.value)} placeholder="Revised decision title" />
            </Field>
            <Field label="New decision">
              <Textarea value={sDecision} onChange={(e) => setSDecision(e.target.value)} rows={2} placeholder="We will now…" />
            </Field>
            <Field label="Rationale">
              <Textarea value={sRationale} onChange={(e) => setSRationale(e.target.value)} rows={2} placeholder="Why this replaces the prior call" />
            </Field>
            <Field label="Evidence (comma-separated)">
              <Input value={sEvidence} onChange={(e) => setSEvidence(e.target.value)} placeholder="commit hash, doc title…" />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={handleSupersede} disabled={!sTitle.trim() || !sDecision.trim()}>
              Supersede
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Evidence dialog */}
      <Dialog open={!!evidenceTarget} onOpenChange={(o) => !o && setEvidenceTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link evidence</DialogTitle>
            <DialogDescription>
              Attach evidence references to {evidenceTarget?.ref}. Comma-separated.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={evidenceText}
              onChange={(e) => setEvidenceText(e.target.value)}
              placeholder="commit 4676792, release report, doc title…"
            />
          </div>
          <DialogFooter>
            <Button onClick={handleLinkEvidence} disabled={!evidenceText.trim()}>
              Link evidence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DecisionCard({
  d,
  byId,
  onStatus,
  onAuthority,
  onDelete,
  onSupersede,
  onEvidence,
}: {
  d: Decision
  byId: Map<number, Decision>
  onStatus: (id: number, status: string) => void
  onAuthority: (id: number, authority: string) => void
  onDelete: (id: number) => void
  onSupersede: (d: Decision) => void
  onEvidence: (d: Decision) => void
}) {
  const supersededBy = d.supersededById ? byId.get(d.supersededById) : null
  const supersedes = d.supersedesId ? byId.get(d.supersedesId) : null

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {d.ref && (
              <span className="font-mono text-[11px] text-muted-foreground">{d.ref}</span>
            )}
            {d.locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Locked governance decision" />}
            <h3 className="font-medium">{d.title}</h3>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{d.decision}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge value={d.authority} />
          <StatusBadge value={d.status} />
          <ActionsMenu
            d={d}
            onStatus={onStatus}
            onAuthority={onAuthority}
            onDelete={onDelete}
            onSupersede={onSupersede}
            onEvidence={onEvidence}
          />
        </div>
      </div>

      {(supersededBy || supersedes) && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {supersedes && (
            <span className="inline-flex items-center gap-1">
              <ArrowRight className="h-3 w-3" /> Supersedes {supersedes.ref ?? `#${supersedes.id}`}
            </span>
          )}
          {supersededBy && (
            <span className="inline-flex items-center gap-1 text-warning">
              <ArrowRight className="h-3 w-3" /> Superseded by {supersededBy.ref ?? `#${supersededBy.id}`}
            </span>
          )}
        </div>
      )}

      {(d.context || d.rationale || d.consequences) && (
        <dl className="grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-3">
          {d.context && <Meta k="Context" v={d.context} />}
          {d.rationale && <Meta k="Rationale" v={d.rationale} />}
          {d.consequences && <Meta k="Consequences" v={d.consequences} />}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>Owner: <span className="text-foreground">{d.owner}</span></span>
        {d.scope && <span>Scope: <span className="text-foreground">{d.scope}</span></span>}
        {d.tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {d.tags.map((t) => (
              <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                {t}
              </span>
            ))}
          </span>
        )}
      </div>

      {d.evidence.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Evidence
          </span>
          <ul className="flex flex-col gap-1">
            {d.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <Paperclip className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="leading-relaxed">{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ActionsMenu({
  d,
  onStatus,
  onAuthority,
  onDelete,
  onSupersede,
  onEvidence,
}: {
  d: Decision
  onStatus: (id: number, status: string) => void
  onAuthority: (id: number, authority: string) => void
  onDelete: (id: number) => void
  onSupersede: (d: Decision) => void
  onEvidence: (d: Decision) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        {STATUSES.filter((s) => s !== "superseded").map((s) => (
          <DropdownMenuItem
            key={s}
            className="capitalize"
            disabled={d.status === s}
            onClick={() => onStatus(d.id, s)}
          >
            {s}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Authority</DropdownMenuLabel>
        {AUTHORITIES.map((a) => (
          <DropdownMenuItem
            key={a}
            className="capitalize"
            disabled={d.authority === a}
            onClick={() => onAuthority(d.id, a)}
          >
            {a}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onEvidence(d)}>
          <Link2 className="h-3.5 w-3.5" /> Link evidence
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSupersede(d)} disabled={d.status === "superseded"}>
          <GitBranch className="h-3.5 w-3.5" /> Supersede
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          disabled={d.locked}
          onClick={() => onDelete(d.id)}
        >
          <Trash2 className="h-3.5 w-3.5" /> {d.locked ? "Locked" : "Delete"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

function DecisionFlowStep({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium leading-snug">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
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

function Empty({
  seeded,
  onSeed,
  pending,
}: {
  seeded: boolean
  onSeed: () => void
  pending: boolean
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-6">
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-3 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">No decisions recorded here</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Record consequential calls as structured objects so rationale, authority,
          and evidence survive. Decisions document governance; they do not execute
          changes or bypass work-order gates.
        </p>
      </div>
      <div className="mx-auto mt-6 grid max-w-4xl gap-3 md:grid-cols-3">
        {DECISION_EMPTY_STATE_STEPS.map((step) => (
          <div key={step.id} className="rounded-md border border-border bg-background px-4 py-3 text-left">
            <p className="text-sm font-medium">{step.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {step.description}
            </p>
          </div>
        ))}
      </div>
      {!seeded && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={onSeed} disabled={pending}>
            <ShieldCheck className="h-4 w-4" />
            Seed governance decisions
          </Button>
        </div>
      )}
    </div>
  )
}
