"use client"

import { useMemo, useState, useTransition } from "react"
import type { Doctrine } from "@/lib/db/schema"
import {
  createDoctrine,
  deleteDoctrine,
  linkDoctrineEvidence,
  seedGovernanceDoctrine,
  supersedeDoctrine,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  Power,
  Paperclip,
  Ban,
  Check,
  KeyRound,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const CATEGORIES = ["principle", "policy", "guardrail"]

type Tab = "active" | "superseded" | "all"

function splitInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function DoctrineView({ initial }: { initial: Doctrine[] }) {
  const [rows, setRows] = useState(initial)
  const [tab, setTab] = useState<Tab>("active")
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // create form
  const [title, setTitle] = useState("")
  const [statement, setStatement] = useState("")
  const [category, setCategory] = useState("principle")
  const [scope, setScope] = useState("")
  const [priority, setPriority] = useState("0")
  const [allowed, setAllowed] = useState("")
  const [forbidden, setForbidden] = useState("")
  const [requiresApproval, setRequiresApproval] = useState("")

  // supersede form
  const [supersedeTarget, setSupersedeTarget] = useState<Doctrine | null>(null)
  const [sTitle, setSTitle] = useState("")
  const [sStatement, setSStatement] = useState("")
  const [sForbidden, setSForbidden] = useState("")
  const [sEvidence, setSEvidence] = useState("")

  // evidence form
  const [evidenceTarget, setEvidenceTarget] = useState<Doctrine | null>(null)
  const [evidenceText, setEvidenceText] = useState("")

  const hasSeeds = rows.some((r) => r.locked)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      const inTab =
        tab === "all"
          ? true
          : tab === "active"
            ? r.status === "active"
            : r.status === "superseded"
      if (!inTab) return false
      if (!q) return true
      return (
        r.title.toLowerCase().includes(q) ||
        r.statement.toLowerCase().includes(q) ||
        (r.ref ?? "").toLowerCase().includes(q) ||
        (r.scope ?? "").toLowerCase().includes(q) ||
        r.forbidden.some((f) => f.toLowerCase().includes(q)) ||
        r.allowed.some((a) => a.toLowerCase().includes(q))
      )
    })
  }, [rows, tab, search])

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.status === "active").length,
      superseded: rows.filter((r) => r.status === "superseded").length,
      all: rows.length,
    }),
    [rows],
  )

  function resetCreate() {
    setTitle("")
    setStatement("")
    setCategory("principle")
    setScope("")
    setPriority("0")
    setAllowed("")
    setForbidden("")
    setRequiresApproval("")
  }

  async function handleCreate() {
    if (!title.trim() || !statement.trim()) return
    try {
      const row = await createDoctrine({
        title,
        statement,
        category,
        scope: scope || undefined,
        priority: Number(priority) || 0,
        allowed: splitInput(allowed),
        forbidden: splitInput(forbidden),
        requiresApproval: splitInput(requiresApproval),
      })
      setRows((prev) =>
        [row, ...prev].sort((a, b) => b.priority - a.priority),
      )
      toast.success(`Doctrine ratified (${row.ref})`)
      resetCreate()
      setCreateOpen(false)
    } catch {
      toast.error("Failed to ratify doctrine")
    }
  }

  function handleToggle(row: Doctrine) {
    if (row.status === "superseded") {
      toast.error("Superseded doctrine cannot be reactivated")
      return
    }
    const active = !row.active
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, active } : r)),
    )
    startTransition(() => toggleDoctrine(row.id, active))
  }

  function handleDelete(row: Doctrine) {
    if (row.locked) {
      toast.error("Locked governance doctrine cannot be deleted — supersede it")
      return
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    startTransition(async () => {
      try {
        await deleteDoctrine(row.id)
        toast.success("Doctrine removed")
      } catch {
        toast.error("Failed to delete")
        setRows((prev) => [row, ...prev])
      }
    })
  }

  function openSupersede(row: Doctrine) {
    setSupersedeTarget(row)
    setSTitle(row.title)
    setSStatement(row.statement)
    setSForbidden(row.forbidden.join(", "))
    setSEvidence("")
  }

  async function handleSupersede() {
    if (!supersedeTarget || !sTitle.trim() || !sStatement.trim()) return
    try {
      const next = await supersedeDoctrine(supersedeTarget.id, {
        title: sTitle,
        statement: sStatement,
        forbidden: sForbidden ? splitInput(sForbidden) : undefined,
        evidence: sEvidence ? splitInput(sEvidence) : undefined,
      })
      setRows((prev) =>
        [
          next,
          ...prev.map((r) =>
            r.id === supersedeTarget.id
              ? { ...r, status: "superseded", active: false, supersededById: next.id }
              : r,
          ),
        ].sort((a, b) => b.priority - a.priority),
      )
      toast.success(`${next.ref} supersedes ${supersedeTarget.ref ?? "rule"}`)
      setSupersedeTarget(null)
    } catch {
      toast.error("Failed to supersede")
    }
  }

  async function handleLinkEvidence() {
    if (!evidenceTarget || !evidenceText.trim()) return
    try {
      await linkDoctrineEvidence(evidenceTarget.id, evidenceText)
      setRows((prev) =>
        prev.map((r) =>
          r.id === evidenceTarget.id
            ? { ...r, evidence: [...r.evidence, evidenceText.trim()] }
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

  function handleSeed() {
    startTransition(async () => {
      try {
        const { created } = await seedGovernanceDoctrine()
        if (created === 0) {
          toast.info("Governance doctrine already seeded")
          return
        }
        toast.success(`Seeded ${created} doctrine rule${created === 1 ? "" : "s"}`)
        window.location.reload()
      } catch {
        toast.error("Failed to seed doctrine")
      }
    })
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rules, refs, forbidden actions…"
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
                Ratify doctrine
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Ratify doctrine</DialogTitle>
                <DialogDescription>
                  A machine-readable rule. Allowed / forbidden / requires-approval
                  clauses are matched against agent actions.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-2">
                <div className="flex flex-col gap-2">
                  <Label>Title</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="No silent model fallback"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Statement</Label>
                  <Textarea
                    value={statement}
                    onChange={(e) => setStatement(e.target.value)}
                    rows={2}
                    placeholder="Model runtime selection is explicit and visible…"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1 flex flex-col gap-2">
                    <Label>Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c} className="capitalize">
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 flex flex-col gap-2">
                    <Label>Priority</Label>
                    <Input
                      type="number"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      min={0}
                      max={10}
                    />
                  </div>
                  <div className="col-span-1 flex flex-col gap-2">
                    <Label>Scope</Label>
                    <Input
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                      placeholder="runtime/model"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="flex items-center gap-1.5 text-destructive">
                    <Ban className="h-3.5 w-3.5" /> Forbidden
                  </Label>
                  <Textarea
                    value={forbidden}
                    onChange={(e) => setForbidden(e.target.value)}
                    rows={2}
                    placeholder="silent fallback, auto-switch (comma or newline separated)"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="flex items-center gap-1.5 text-warning">
                    <KeyRound className="h-3.5 w-3.5" /> Requires approval
                  </Label>
                  <Textarea
                    value={requiresApproval}
                    onChange={(e) => setRequiresApproval(e.target.value)}
                    rows={2}
                    placeholder="change runtime, enable cloud"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="flex items-center gap-1.5 text-success">
                    <Check className="h-3.5 w-3.5" /> Allowed
                  </Label>
                  <Textarea
                    value={allowed}
                    onChange={(e) => setAllowed(e.target.value)}
                    rows={2}
                    placeholder="explicit runtime selection, show provenance"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreate}
                  disabled={!title.trim() || !statement.trim()}
                >
                  Ratify {title ? "" : "doctrine"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="active">Active ({counts.active})</TabsTrigger>
          <TabsTrigger value="superseded">
            Superseded ({counts.superseded})
          </TabsTrigger>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* List */}
      {filtered.length === 0 ? (
        <Empty seeded={hasSeeds} />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((d) => (
            <DoctrineCard
              key={d.id}
              row={d}
              refs={rows}
              onToggle={() => handleToggle(d)}
              onSupersede={() => openSupersede(d)}
              onEvidence={() => setEvidenceTarget(d)}
              onDelete={() => handleDelete(d)}
            />
          ))}
        </div>
      )}

      {/* Supersede dialog */}
      <Dialog
        open={!!supersedeTarget}
        onOpenChange={(o) => !o && setSupersedeTarget(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Supersede {supersedeTarget?.ref ?? "doctrine"}
            </DialogTitle>
            <DialogDescription>
              Creates a new rule and retires the old one. Lineage is preserved —
              nothing is deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label>New title</Label>
              <Input value={sTitle} onChange={(e) => setSTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>New statement</Label>
              <Textarea
                value={sStatement}
                onChange={(e) => setSStatement(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Forbidden</Label>
              <Textarea
                value={sForbidden}
                onChange={(e) => setSForbidden(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Evidence for change</Label>
              <Textarea
                value={sEvidence}
                onChange={(e) => setSEvidence(e.target.value)}
                rows={2}
                placeholder="Why is this rule being replaced?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleSupersede}
              disabled={!sTitle.trim() || !sStatement.trim()}
            >
              Supersede
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Evidence dialog */}
      <Dialog
        open={!!evidenceTarget}
        onOpenChange={(o) => !o && setEvidenceTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Link evidence to {evidenceTarget?.ref ?? "doctrine"}
            </DialogTitle>
            <DialogDescription>
              Attach a reference, URL, or note that backs this rule.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              value={evidenceText}
              onChange={(e) => setEvidenceText(e.target.value)}
              rows={3}
              placeholder="e.g. ADR-0008, runtime-smoke report, playbook §Track A"
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

function DoctrineCard({
  row,
  refs,
  onToggle,
  onSupersede,
  onEvidence,
  onDelete,
}: {
  row: Doctrine
  refs: Doctrine[]
  onToggle: () => void
  onSupersede: () => void
  onEvidence: () => void
  onDelete: () => void
}) {
  const supersededBy = row.supersededById
    ? refs.find((r) => r.id === row.supersededById)
    : null
  const supersedes = row.supersedesId
    ? refs.find((r) => r.id === row.supersedesId)
    : null
  const isSuperseded = row.status === "superseded"

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-lg border bg-card p-4",
        isSuperseded || !row.active
          ? "border-border/50 opacity-65"
          : "border-border",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs">
          {row.priority}
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {row.ref && (
              <span className="font-mono text-xs text-muted-foreground">
                {row.ref}
              </span>
            )}
            <h3 className="font-medium">{row.title}</h3>
            <StatusBadge value={row.category} />
            {row.active && !isSuperseded ? (
              <StatusBadge value="active" />
            ) : isSuperseded ? (
              <StatusBadge value="superseded" />
            ) : (
              <StatusBadge value="inactive" label="inactive" />
            )}
            {row.locked && (
              <Lock className="h-3 w-3 text-muted-foreground" aria-label="Locked" />
            )}
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {row.statement}
          </p>

          {/* Machine-readable clauses */}
          <div className="flex flex-col gap-1.5 pt-0.5">
            {row.forbidden.length > 0 && (
              <ClauseRow
                icon={<Ban className="h-3.5 w-3.5 text-destructive" />}
                label="Forbidden"
                items={row.forbidden}
                tone="text-destructive"
              />
            )}
            {row.requiresApproval.length > 0 && (
              <ClauseRow
                icon={<KeyRound className="h-3.5 w-3.5 text-warning" />}
                label="Requires approval"
                items={row.requiresApproval}
                tone="text-warning"
              />
            )}
            {row.allowed.length > 0 && (
              <ClauseRow
                icon={<Check className="h-3.5 w-3.5 text-success" />}
                label="Allowed"
                items={row.allowed}
                tone="text-success"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-muted-foreground">
            <span>Owner: {row.owner}</span>
            {row.scope && <span className="font-mono">{row.scope}</span>}
            {supersedes && (
              <span className="inline-flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                supersedes {supersedes.ref ?? `#${supersedes.id}`}
              </span>
            )}
            {supersededBy && (
              <span className="inline-flex items-center gap-1 text-warning">
                <GitBranch className="h-3 w-3" />
                superseded by {supersededBy.ref ?? `#${supersededBy.id}`}
              </span>
            )}
          </div>

          {row.evidence.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {row.evidence.map((e, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <Paperclip className="h-3 w-3" />
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{row.ref ?? "Doctrine"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {!isSuperseded && (
            <DropdownMenuItem onClick={onToggle}>
              <Power className="h-4 w-4" />
              {row.active ? "Deactivate" : "Activate"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onEvidence}>
            <Paperclip className="h-4 w-4" />
            Link evidence
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSupersede} disabled={isSuperseded}>
            <GitBranch className="h-4 w-4" />
            Supersede
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            disabled={row.locked}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ClauseRow({
  icon,
  label,
  items,
  tone,
}: {
  icon: React.ReactNode
  label: string
  items: string[]
  tone: string
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className={cn("shrink-0 font-medium", tone)}>{label}:</span>
      <span className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <code
            key={i}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
          >
            {it}
          </code>
        ))}
      </span>
    </div>
  )
}

function Empty({ seeded }: { seeded: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <ShieldCheck className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">No doctrine here</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {seeded
          ? "No rules match this view. Try a different tab or clear the search."
          : "Ratify rules or seed the governance baseline to define how your operator and its workers must behave."}
      </p>
    </div>
  )
}
