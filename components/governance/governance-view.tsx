"use client"

import { useMemo, useState, useTransition } from "react"
import type {
  AuthorityGrant,
  LockRecord,
  ConflictRecord,
  ParkedIdea,
  AgentClaim,
} from "@/lib/db/schema"
import type { TruthClaimView } from "@/app/actions/truth"
import { revokeAuthorityGrant } from "@/app/actions/authority"
import { releaseLock, createLock } from "@/app/actions/locks"
import { resolveConflict, recordConflict } from "@/app/actions/conflicts"
import { markTruthStale, recordTruthClaim } from "@/app/actions/truth"
import { promoteIdea, dropIdea, parkIdea } from "@/app/actions/vault"
import { ingestAgentClaim } from "@/app/actions/agent-claims"
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
import { BrainCouncilStatusPanel } from "@/components/brain-council/brain-council-status-panel"
import { StatusBadge } from "@/components/status-badge"
import {
  KeyRound,
  Lock,
  AlertTriangle,
  Clock,
  Bot,
  Archive,
  Plus,
  Ban,
  Unlock,
  CheckCircle2,
  ArrowUpCircle,
} from "lucide-react"
import { toast } from "sonner"

type Tab = "authority" | "locks" | "conflicts" | "truth" | "claims" | "vault"

const TRUTH_TYPES = ["STATIC", "SESSION", "VOLATILE", "EVIDENCE", "LOCK", "ASSUMED", "UNKNOWN"]
const LOCK_KINDS = ["HOLD", "STOP", "FREEZE"]
const SEVERITIES = ["low", "medium", "high", "critical"]

export function GovernanceView({
  grants,
  locks,
  conflicts,
  truth,
  ideas,
  claims,
}: {
  grants: AuthorityGrant[]
  locks: LockRecord[]
  conflicts: ConflictRecord[]
  truth: TruthClaimView[]
  ideas: ParkedIdea[]
  claims: AgentClaim[]
}) {
  const [tab, setTab] = useState<Tab>("authority")

  const counts = useMemo(
    () => ({
      authority: grants.filter((g) => g.status === "active").length,
      locks: locks.filter((l) => l.status === "active").length,
      conflicts: conflicts.filter((c) => c.status === "open").length,
      truth: truth.filter((t) => t.computedFreshness !== "fresh").length,
      claims: claims.filter((c) => c.status === "open").length,
      vault: ideas.filter((i) => i.status === "parked").length,
    }),
    [grants, locks, conflicts, truth, ideas, claims],
  )

  return (
    <div className="flex flex-col gap-4 p-6">
      <BrainCouncilStatusPanel />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="authority">
            <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Authority ({counts.authority})
          </TabsTrigger>
          <TabsTrigger value="locks">
            <Lock className="mr-1.5 h-3.5 w-3.5" /> Locks ({counts.locks})
          </TabsTrigger>
          <TabsTrigger value="conflicts">
            <AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> Conflicts ({counts.conflicts})
          </TabsTrigger>
          <TabsTrigger value="truth">
            <Clock className="mr-1.5 h-3.5 w-3.5" /> Truth ({counts.truth})
          </TabsTrigger>
          <TabsTrigger value="claims">
            <Bot className="mr-1.5 h-3.5 w-3.5" /> Claims ({counts.claims})
          </TabsTrigger>
          <TabsTrigger value="vault">
            <Archive className="mr-1.5 h-3.5 w-3.5" /> Not-Now ({counts.vault})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="authority" className="mt-4">
          <AuthorityTab grants={grants} />
        </TabsContent>
        <TabsContent value="locks" className="mt-4">
          <LocksTab locks={locks} />
        </TabsContent>
        <TabsContent value="conflicts" className="mt-4">
          <ConflictsTab conflicts={conflicts} />
        </TabsContent>
        <TabsContent value="truth" className="mt-4">
          <TruthTab truth={truth} />
        </TabsContent>
        <TabsContent value="claims" className="mt-4">
          <ClaimsTab claims={claims} />
        </TabsContent>
        <TabsContent value="vault" className="mt-4">
          <VaultTab ideas={ideas} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Authority grants                                                    */
/* ------------------------------------------------------------------ */

function AuthorityTab({ grants }: { grants: AuthorityGrant[] }) {
  const [rows, setRows] = useState(grants)
  const [pending, startTransition] = useTransition()

  function handleRevoke(id: number) {
    const reason = window.prompt("Reason for revoking this authority grant?")
    if (!reason?.trim()) return
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "revoked", revokeReason: reason } : r)),
    )
    startTransition(async () => {
      try {
        await revokeAuthorityGrant(id, reason)
        toast.success("Authority grant revoked")
      } catch {
        toast.error("Failed to revoke grant")
      }
    })
  }

  if (rows.length === 0) {
    return <Empty text="No authority has been granted. Approval is not authority — grants are minted when a work order is authorized above A0." />
  }

  return (
    <div className="flex flex-col gap-3">
      <Note text="A mutating loop is blocked unless an active, unexpired, unrevoked grant covers its requested authority." />
      {rows.map((g) => (
        <Card key={g.id}>
          <CardHead
            ref_={g.ref}
            title={`${g.authorityLevel} → ${g.grantedTo}`}
            badges={
              <>
                <StatusBadge value={g.authorityLevel} />
                <StatusBadge value={g.status} />
              </>
            }
            action={
              g.status === "active" ? (
                <Button size="sm" variant="outline" onClick={() => handleRevoke(g.id)} disabled={pending}>
                  <Ban className="h-3.5 w-3.5" /> Revoke
                </Button>
              ) : null
            }
          />
          <Meta items={[
            ["Scope", g.scope],
            ["Reason", g.reason],
            ["Work order", g.workOrderId ? `#${g.workOrderId}` : null],
            ["Expires", g.expiresAt ? new Date(g.expiresAt).toLocaleString() : "no expiry"],
            ["Revoke reason", g.revokeReason],
          ]} />
          {(g.allowedActions.length > 0 || g.blockedActions.length > 0) && (
            <Chips allowed={g.allowedActions} blocked={g.blockedActions} />
          )}
        </Card>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Locks                                                               */
/* ------------------------------------------------------------------ */

function LocksTab({ locks }: { locks: LockRecord[] }) {
  const [rows, setRows] = useState(locks)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [kind, setKind] = useState("HOLD")
  const [title, setTitle] = useState("")
  const [scope, setScope] = useState("")
  const [reason, setReason] = useState("")

  function handleCreate() {
    if (!title.trim()) return
    startTransition(async () => {
      try {
        const row = await createLock({ kind: kind as "HOLD" | "STOP" | "FREEZE", title, scope: scope || undefined, reason: reason || undefined })
        setRows((prev) => [row, ...prev])
        toast.success(`${row.ref} active`)
        setOpen(false)
        setTitle("")
        setScope("")
        setReason("")
      } catch {
        toast.error("Failed to create lock")
      }
    })
  }

  function handleRelease(id: number) {
    const reason = window.prompt("Why release this lock? (required)")
    if (!reason?.trim()) return
    const newPosture = window.prompt("New posture after release? (e.g. 'resume read-only', 'execute under GRANT-0003')")
    if (!newPosture?.trim()) {
      toast.error("A release requires an explicit new posture")
      return
    }
    startTransition(async () => {
      const res = await releaseLock(id, { reason, newPosture })
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "released", newPosture } : r)))
        toast.success("Lock released")
      } else {
        toast.error(res.reason)
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Set lock</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set a lock</DialogTitle>
              <DialogDescription>HOLD pauses, STOP forbids, FREEZE pins a baseline. A lock can only be released with an explicit reason and new posture.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <Field label="Kind">
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOCK_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Hold all execution on payments" /></Field>
              <Field label="Scope"><Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="payments, global, runtime…" /></Field>
              <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!title.trim() || pending}>Set lock</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {rows.length === 0 ? (
        <Empty text="No locks recorded." />
      ) : (
        rows.map((l) => (
          <Card key={l.id}>
            <CardHead
              ref_={l.ref}
              title={l.title}
              badges={<><StatusBadge value={l.kind} /><StatusBadge value={l.status} /></>}
              action={
                l.status === "active" ? (
                  <Button size="sm" variant="outline" onClick={() => handleRelease(l.id)} disabled={pending}>
                    <Unlock className="h-3.5 w-3.5" /> Release
                  </Button>
                ) : null
              }
            />
            <Meta items={[
              ["Scope", l.scope],
              ["Reason", l.reason],
              ["New posture", l.newPosture],
              ["Release reason", l.releaseReason],
            ]} />
          </Card>
        ))
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Conflicts                                                           */
/* ------------------------------------------------------------------ */

function ConflictsTab({ conflicts }: { conflicts: ConflictRecord[] }) {
  const [rows, setRows] = useState(conflicts)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [detectedBetween, setDetectedBetween] = useState("")
  const [severity, setSeverity] = useState("medium")
  const [description, setDescription] = useState("")

  function handleCreate() {
    if (!detectedBetween.trim()) return
    startTransition(async () => {
      try {
        const row = await recordConflict({ detectedBetween, severity: severity as "low" | "medium" | "high" | "critical", description: description || undefined })
        setRows((prev) => [row, ...prev])
        toast.success(`${row.ref} logged`)
        setOpen(false)
        setDetectedBetween("")
        setDescription("")
      } catch {
        toast.error("Failed to log conflict")
      }
    })
  }

  function handleResolve(id: number) {
    const resolution = window.prompt("How was this conflict resolved?")
    if (!resolution?.trim()) return
    startTransition(async () => {
      await resolveConflict(id, resolution, "resolved")
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "resolved", resolution } : r)))
      toast.success("Conflict resolved")
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Note text="Unresolved high-risk or critical conflicts block execution loops on the affected work order." />
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Log conflict</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log a conflict</DialogTitle>
              <DialogDescription>Record a contradiction between claims, doctrine, or evidence.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <Field label="Detected between"><Input value={detectedBetween} onChange={(e) => setDetectedBetween(e.target.value)} placeholder="CLAIM-0007 vs EV-0003" /></Field>
              <Field label="Severity">
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!detectedBetween.trim() || pending}>Log conflict</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {rows.length === 0 ? (
        <Empty text="No conflicts recorded." />
      ) : (
        rows.map((c) => (
          <Card key={c.id}>
            <CardHead
              ref_={c.ref}
              title={c.detectedBetween}
              badges={<><StatusBadge value={c.severity} /><StatusBadge value={c.status} /></>}
              action={
                c.status === "open" ? (
                  <Button size="sm" variant="outline" onClick={() => handleResolve(c.id)} disabled={pending}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                  </Button>
                ) : null
              }
            />
            <Meta items={[
              ["Description", c.description],
              ["Work order", c.workOrderId ? `#${c.workOrderId}` : null],
              ["Resolution", c.resolution],
            ]} />
          </Card>
        ))
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Truth                                                               */
/* ------------------------------------------------------------------ */

function TruthTab({ truth }: { truth: TruthClaimView[] }) {
  const [rows, setRows] = useState(truth)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [claim, setClaim] = useState("")
  const [truthType, setTruthType] = useState("VOLATILE")
  const [system, setSystem] = useState("")
  const [source, setSource] = useState("")

  function handleCreate() {
    if (!claim.trim()) return
    startTransition(async () => {
      try {
        await recordTruthClaim({ claim, truthType, system: system || undefined, source: source || undefined })
        toast.success("Truth claim recorded")
        setOpen(false)
        setClaim("")
        setSystem("")
        setSource("")
        window.location.reload()
      } catch {
        toast.error("Failed to record truth claim")
      }
    })
  }

  function handleStale(id: number) {
    const reason = window.prompt("Why is this truth stale?")
    if (!reason?.trim()) return
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, truthType: "STALE", computedFreshness: "stale" } : r)))
    startTransition(() => markTruthStale(id, reason))
  }

  return (
    <div className="flex flex-col gap-3">
      <Note text="Volatile truth must be rechecked before mutation, commit, push, tag, or release. Stale truth cannot back a mutating action." />
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Record truth</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record a truth claim</DialogTitle>
              <DialogDescription>Capture a fact with its type, source, and freshness obligations.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <Field label="Claim"><Textarea value={claim} onChange={(e) => setClaim(e.target.value)} rows={2} placeholder="Worktree is clean at 9516e07" /></Field>
              <Field label="Type">
                <Select value={truthType} onValueChange={setTruthType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRUTH_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="System"><Input value={system} onChange={(e) => setSystem(e.target.value)} placeholder="git, db, runtime…" /></Field>
              <Field label="Source"><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="git status, query, agent report…" /></Field>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!claim.trim() || pending}>Record</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {rows.length === 0 ? (
        <Empty text="No truth claims recorded." />
      ) : (
        rows.map((t) => (
          <Card key={t.id}>
            <CardHead
              ref_={t.ref}
              title={t.claim}
              badges={<><StatusBadge value={t.truthType} /><StatusBadge value={t.computedFreshness} /></>}
              action={
                t.truthType !== "STALE" ? (
                  <Button size="sm" variant="outline" onClick={() => handleStale(t.id)} disabled={pending}>
                    Mark stale
                  </Button>
                ) : null
              }
            />
            <Meta items={[
              ["System", t.system],
              ["Source", t.source],
              ["Confidence", t.confidence],
              ["Captured", new Date(t.capturedAt).toLocaleString()],
              ["Recheck before", t.verificationRequiredBefore.join(", ") || null],
            ]} />
          </Card>
        ))
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Agent claims                                                        */
/* ------------------------------------------------------------------ */

function ClaimsTab({ claims }: { claims: AgentClaim[] }) {
  const [rows, setRows] = useState(claims)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [agent, setAgent] = useState("")
  const [claim, setClaim] = useState("")
  const [command, setCommand] = useState("")

  function handleCreate() {
    if (!agent.trim() || !claim.trim()) return
    startTransition(async () => {
      try {
        const res = await ingestAgentClaim({ agent, claim, command: command || undefined })
        setRows((prev) => [res.claim, ...prev])
        toast.success(`Classified ${res.classification}`)
        setOpen(false)
        setAgent("")
        setClaim("")
        setCommand("")
      } catch {
        toast.error("Failed to ingest claim")
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Note text="Agent claims are untrusted by default. An unsupported claim cannot update current truth; a conflicting claim opens a conflict record." />
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Ingest claim</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ingest an agent claim</DialogTitle>
              <DialogDescription>Record what an agent asserted. The system classifies it by evidence backing.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <Field label="Agent"><Input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="codex, claude…" /></Field>
              <Field label="Claim"><Textarea value={claim} onChange={(e) => setClaim(e.target.value)} rows={2} placeholder="All tests pass on the feature branch" /></Field>
              <Field label="Command (if any)"><Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="pnpm test" /></Field>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!agent.trim() || !claim.trim() || pending}>Ingest</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {rows.length === 0 ? (
        <Empty text="No agent claims recorded." />
      ) : (
        rows.map((c) => (
          <Card key={c.id}>
            <CardHead
              ref_={c.ref}
              title={c.claim}
              badges={<><StatusBadge value={c.classification} /><StatusBadge value={c.status} /></>}
            />
            <Meta items={[
              ["Agent", c.agent],
              ["Command", c.command],
              ["Conflict", c.conflictId ? `#${c.conflictId}` : null],
            ]} />
          </Card>
        ))
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Not-Now Vault                                                       */
/* ------------------------------------------------------------------ */

function VaultTab({ ideas }: { ideas: ParkedIdea[] }) {
  const [rows, setRows] = useState(ideas)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [idea, setIdea] = useState("")
  const [whyNotNow, setWhyNotNow] = useState("")
  const [unlockCondition, setUnlockCondition] = useState("")

  function handlePark() {
    if (!idea.trim()) return
    startTransition(async () => {
      try {
        const row = await parkIdea({ idea, whyNotNow: whyNotNow || undefined, unlockCondition: unlockCondition || undefined })
        setRows((prev) => [row, ...prev])
        toast.success(`${row.ref} parked`)
        setOpen(false)
        setIdea("")
        setWhyNotNow("")
        setUnlockCondition("")
      } catch {
        toast.error("Failed to park idea")
      }
    })
  }

  function handlePromote(id: number) {
    const decisionRationale = window.prompt("Promotion requires a decision. Why activate this now?")
    if (!decisionRationale?.trim()) return
    startTransition(async () => {
      const res = await promoteIdea(id, { decisionRationale })
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "promoted" } : r)))
        toast.success(res.reason)
      } else {
        toast.error(res.reason)
      }
    })
  }

  function handleDrop(id: number) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "dropped" } : r)))
    startTransition(() => dropIdea(id))
  }

  return (
    <div className="flex flex-col gap-3">
      <Note text="Parked ideas preserve vision without activating it. They cannot spawn a loop or work order until promoted via an explicit decision." />
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Park idea</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Park an idea</DialogTitle>
              <DialogDescription>Capture it for later without committing to it now.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <Field label="Idea"><Textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={2} placeholder="Multi-tenant workspaces" /></Field>
              <Field label="Why not now"><Textarea value={whyNotNow} onChange={(e) => setWhyNotNow(e.target.value)} rows={2} placeholder="Single-tenant must be stable first" /></Field>
              <Field label="Unlock condition"><Input value={unlockCondition} onChange={(e) => setUnlockCondition(e.target.value)} placeholder="After V1 ships and is verified" /></Field>
            </div>
            <DialogFooter>
              <Button onClick={handlePark} disabled={!idea.trim() || pending}>Park idea</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {rows.length === 0 ? (
        <Empty text="The vault is empty." />
      ) : (
        rows.map((i) => (
          <Card key={i.id}>
            <CardHead
              ref_={i.ref}
              title={i.idea}
              badges={<><StatusBadge value={i.maturity} /><StatusBadge value={i.status} /></>}
              action={
                i.status === "parked" ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handlePromote(i.id)} disabled={pending}>
                      <ArrowUpCircle className="h-3.5 w-3.5" /> Promote
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDrop(i.id)} disabled={pending}>
                      Drop
                    </Button>
                  </div>
                ) : null
              }
            />
            <Meta items={[
              ["Why not now", i.whyNotNow],
              ["Unlock condition", i.unlockCondition],
              ["Promoted WO", i.promotedWorkOrderId ? `#${i.promotedWorkOrderId}` : null],
            ]} />
          </Card>
        ))
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

function Card({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">{children}</div>
}

function CardHead({
  ref_,
  title,
  badges,
  action,
}: {
  ref_: string | null
  title: string
  badges: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {ref_ && <span className="font-mono text-[11px] text-muted-foreground">{ref_}</span>}
          {badges}
        </div>
        <h3 className="text-pretty font-medium leading-relaxed">{title}</h3>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function Meta({ items }: { items: [string, string | null | undefined][] }) {
  const visible = items.filter(([, v]) => Boolean(v))
  if (visible.length === 0) return null
  return (
    <dl className="grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-2">
      {visible.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
          <dd className="text-sm leading-relaxed">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Chips({ allowed, blocked }: { allowed: string[]; blocked: string[] }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs">
      {allowed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-success">Allowed</span>
          {allowed.map((a) => (
            <span key={a} className="rounded bg-success/15 px-1.5 py-0.5 font-mono text-[10px] text-success">{a}</span>
          ))}
        </div>
      )}
      {blocked.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-destructive">Blocked</span>
          {blocked.map((b) => (
            <span key={b} className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] text-destructive">{b}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function Note({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {text}
    </p>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
      <p className="max-w-md text-pretty text-sm text-muted-foreground">{text}</p>
    </div>
  )
}
