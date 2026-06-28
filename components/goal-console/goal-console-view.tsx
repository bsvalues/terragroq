"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { Goal } from "@/lib/db/schema"
import {
  submitGoal,
  runLoop,
  convertGoalToWorkOrder,
  dismissGoal,
} from "@/app/actions/goals"
import type { LoopReport } from "@/lib/goal/loop"
import type { CurrentTruth } from "@/lib/goal/current-truth"
import { truthLines } from "@/lib/goal/current-truth"
import { MISTAKE_PATTERNS } from "@/lib/goal/mistake-patterns"
import { AGENTS } from "@/lib/goal/agent-matrix"
import { lane as findLane, mode as findMode, authority as findAuthority } from "@/lib/goal/taxonomy"
import { getGoalEmptyStatePrompts } from "@/components/goal-console/goal-empty-state"
import { getGoalJourneyStep } from "@/components/goal-console/goal-journey"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  ShieldAlert,
  Crosshair,
  ScanSearch,
  ClipboardCheck,
  Ban,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  CircleDot,
  Lock,
  ArrowRight,
  Bot,
} from "lucide-react"

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function verdictTone(verdict: string) {
  if (verdict === "refuse") return "danger"
  if (verdict === "requires_approval") return "warning"
  return "success"
}

function verdictLabel(verdict: string) {
  if (verdict === "refuse") return "refuse"
  if (verdict === "requires_approval") return "needs approval"
  return "allow"
}

const toneText: Record<string, string> = {
  neutral: "text-muted-foreground",
  info: "text-primary",
  success: "text-success",
  warn: "text-warning",
  danger: "text-destructive",
}

/* ------------------------------------------------------------------ */
/* Main view                                                         */
/* ------------------------------------------------------------------ */

export function GoalConsoleView({
  initialGoals,
  truth,
}: {
  initialGoals: Goal[]
  truth: CurrentTruth
}) {
  const router = useRouter()
  const [goals, setGoals] = useState<Goal[]>(initialGoals)
  const [command, setCommand] = useState("")
  const [latest, setLatest] = useState<Goal | null>(initialGoals[0] ?? null)
  const [loopReport, setLoopReport] = useState<LoopReport | null>(null)
  const [loopGoalId, setLoopGoalId] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  const emptyStatePrompts = getGoalEmptyStatePrompts()

  function handleSubmit() {
    const text = command.trim()
    if (!text) return
    startTransition(async () => {
      try {
        const g = await submitGoal(text)
        setGoals((prev) => [g, ...prev])
        setLatest(g)
        setLoopReport(null)
        setLoopGoalId(null)
        setCommand("")
        toast.success(`${g.ref} classified: ${g.lane}/${g.mode}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Classification failed")
      }
    })
  }

  function handleLoop(goalId: number) {
    startTransition(async () => {
      try {
        const report = await runLoop(goalId)
        setLoopReport(report)
        setLoopGoalId(goalId)
        toast.success(report.clearToProceed ? "Loop clear to proceed" : "Loop reported blockers")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Loop failed")
      }
    })
  }

  function handleConvert(goalId: number) {
    startTransition(async () => {
      try {
        const { workOrderId } = await convertGoalToWorkOrder(goalId)
        setGoals((prev) =>
          prev.map((g) => (g.id === goalId ? { ...g, status: "converted", linkedWorkOrderId: workOrderId } : g)),
        )
        if (latest?.id === goalId) setLatest({ ...latest, status: "converted", linkedWorkOrderId: workOrderId })
        toast.success("Draft work order created")
        router.push("/work-orders")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Conversion failed")
      }
    })
  }

  function handleDismiss(goalId: number) {
    startTransition(async () => {
      try {
        await dismissGoal(goalId)
        setGoals((prev) => prev.map((g) => (g.id === goalId ? { ...g, status: "dismissed" } : g)))
        if (latest?.id === goalId) setLatest({ ...latest, status: "dismissed" })
        toast.success("Goal dismissed")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Dismiss failed")
      }
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Slice 5: Handoff Authority Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Handoff authority</span>
            <StatusBadge value="active" label="A0 · read-only" />
          </div>
          <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
            This console classifies, verifies, and drafts work orders. It does <strong>not</strong> execute changes,
            run migrations, commit, push, or deploy. Anything above draft authority must be approved by the operator on
            the work order itself.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left / main column */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Slice 1: Command bar */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                /goal — state the objective
              </h2>
            </div>
            <Textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. Add an index to the work_order table to speed up the dashboard"
              className="min-h-20 resize-none font-mono text-sm"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSubmit()
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to classify</span>
              <Button onClick={handleSubmit} disabled={pending || !command.trim()} size="sm">
                Classify goal
              </Button>
            </div>
          </section>

          {/* Slice 1 (cont): Classification card */}
          {latest && <ClassificationCard goal={latest} />}

          {/* Slice 2: Read-only loop verifier */}
          {latest && (
            <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ScanSearch className="h-4 w-4 text-primary" aria-hidden />
                  <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    /loop — read-only verifier
                  </h2>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleLoop(latest.id)}
                  disabled={pending || latest.status === "dismissed"}
                >
                  Run loop
                </Button>
              </div>
              {loopReport && loopGoalId === latest.id ? (
                <LoopReportPanel report={loopReport} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Run the loop to verify this goal against current truth. The loop reads state and reports — it never
                  acts.
                </p>
              )}
            </section>
          )}

          {/* Recent goals register */}
          <section className="flex flex-col gap-3">
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Goal register
            </h2>
            {goals.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card p-5">
                <div className="mx-auto max-w-2xl text-center">
                  <p className="text-sm font-medium">No goals classified yet</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Start with a goal statement. The console classifies intent, verifies
                    current truth, and can draft a work order; it does not execute work.
                  </p>
                </div>
                <div className="mt-4 grid gap-2">
                  {emptyStatePrompts.map((item) => (
                    <button
                      key={item.prompt}
                      type="button"
                      onClick={() => setCommand(item.prompt)}
                      className="rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40"
                    >
                      <span className="block text-xs font-medium">{item.prompt}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {item.intent}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {goals.map((g) => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    active={latest?.id === g.id}
                    pending={pending}
                    onSelect={() => {
                      setLatest(g)
                      setLoopReport(null)
                      setLoopGoalId(null)
                    }}
                    onConvert={() => handleConvert(g.id)}
                    onDismiss={() => handleDismiss(g.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Slice 3: Current Truth Panel */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Current truth
              </h2>
            </div>
            <dl className="flex flex-col divide-y divide-border">
              {truthLines(truth).map((line) => (
                <div key={line.label} className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-sm text-muted-foreground">{line.label}</dt>
                  <dd className={cn("text-sm font-medium text-right", toneText[line.tone])}>{line.value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[11px] text-muted-foreground">
              Captured {new Date(truth.capturedAt).toLocaleString()}
            </p>
          </section>

          {/* Slice 4: Mistake Pattern Registry */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Mistake patterns
              </h2>
            </div>
            <ul className="flex flex-col gap-2.5">
              {MISTAKE_PATTERNS.map((mp) => {
                const triggered = latest?.mistakePatterns?.includes(mp.id)
                return (
                  <li
                    key={mp.id}
                    className={cn(
                      "rounded-md border px-3 py-2",
                      triggered
                        ? mp.severity === "block"
                          ? "border-destructive/40 bg-destructive/10"
                          : "border-warning/40 bg-warning/10"
                        : "border-border",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">{mp.id}</span>
                      <span className="text-sm font-medium">{mp.title}</span>
                      {mp.severity === "block" ? (
                        <Ban className="ml-auto h-3.5 w-3.5 text-destructive" aria-label="blocking" />
                      ) : (
                        <AlertTriangle className="ml-auto h-3.5 w-3.5 text-warning" aria-label="warning" />
                      )}
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{mp.description}</p>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* Agent Permission Matrix (§14) */}
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Agent permission matrix
              </h2>
            </div>
            <ul className="flex flex-col gap-2.5">
              {AGENTS.map((a) => (
                <li key={a.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{a.label}</span>
                    <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      max {findAuthority(a.maxAuthority)?.label ?? a.maxAuthority}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {a.description}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Caps the authority each agent may be granted on a work order.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Classification card                                               */
/* ------------------------------------------------------------------ */

function ClassificationCard({ goal }: { goal: Goal }) {
  const laneDef = findLane(goal.lane)
  const modeDef = findMode(goal.mode)
  const authDef = findAuthority(goal.authority)
  const journey = getGoalJourneyStep(goal)

  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-lg border bg-card p-4",
        goal.verdict === "refuse"
          ? "border-destructive/40"
          : goal.verdict === "requires_approval"
            ? "border-warning/40"
            : "border-success/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-muted-foreground">{goal.ref}</span>
          <p className="text-sm font-medium text-pretty">{goal.command}</p>
        </div>
        <StatusBadge value={verdictTone(goal.verdict)} label={verdictLabel(goal.verdict)} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Facet label="Lane" value={laneDef?.label ?? goal.lane} />
        <Facet label="Mode" value={modeDef?.label ?? goal.mode} />
        <Facet label="Risk" value={goal.risk} badge />
        <Facet label="Authority" value={authDef?.label ?? goal.authority} />
      </div>

      {goal.rationale && (
        <div className="rounded-md bg-muted/40 p-3">
          <p className="text-[12px] leading-relaxed text-muted-foreground">{goal.rationale}</p>
        </div>
      )}

      {goal.recommendedMove && (
        <div className="flex items-start gap-2">
          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-sm">{goal.recommendedMove}</p>
        </div>
      )}

      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-start gap-2">
          <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-sm font-medium">{journey.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {journey.description}
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Next: {journey.action}
            </p>
          </div>
        </div>
      </div>

      {goal.matchedRules.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden /> Doctrine:
          </span>
          {goal.matchedRules.map((r) => (
            <span key={r} className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px]">
              {r}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function Facet({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {badge ? <StatusBadge value={value} /> : <span className="text-sm font-medium">{value}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Loop report                                                       */
/* ------------------------------------------------------------------ */

function LoopReportPanel({ report }: { report: LoopReport }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
          report.clearToProceed
            ? "border-success/40 bg-success/10 text-success"
            : "border-warning/40 bg-warning/10 text-warning",
        )}
      >
        {report.clearToProceed ? (
          <CheckCircle2 className="h-4 w-4" aria-hidden />
        ) : (
          <AlertTriangle className="h-4 w-4" aria-hidden />
        )}
        {report.clearToProceed ? "Clear to proceed" : report.blockedReason}
      </div>
      <ul className="flex flex-col gap-2">
        {report.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2.5">
            {c.status === "pass" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            ) : c.status === "warn" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            )}
            <div className="flex flex-col">
              <span className="text-sm font-medium">{c.label}</span>
              <span className="text-[12px] text-muted-foreground">{c.detail}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden />
        Loops never execute. Convert to a work order to act.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Goal row                                                          */
/* ------------------------------------------------------------------ */

function GoalRow({
  goal,
  active,
  pending,
  onSelect,
  onConvert,
  onDismiss,
}: {
  goal: Goal
  active: boolean
  pending: boolean
  onSelect: () => void
  onConvert: () => void
  onDismiss: () => void
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors",
        active ? "border-primary/40" : "border-border hover:border-muted-foreground/30",
      )}
    >
      <button onClick={onSelect} className="flex flex-1 items-center gap-3 text-left">
        <CircleDot
          className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-mono text-[10px] text-muted-foreground">{goal.ref}</span>
          <span className="truncate text-sm">{goal.command}</span>
        </div>
      </button>
      <div className="flex items-center gap-2">
        <StatusBadge value={verdictTone(goal.verdict)} label={verdictLabel(goal.verdict)} />
        <StatusBadge value={goal.status} />
        {goal.status === "classified" && goal.verdict !== "refuse" && (
          <Button variant="outline" size="sm" disabled={pending} onClick={onConvert}>
            Draft WO
          </Button>
        )}
        {goal.status === "classified" && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={onDismiss}>
            Dismiss
          </Button>
        )}
        {goal.linkedWorkOrderId && (
          <span className="font-mono text-[10px] text-muted-foreground">WO #{goal.linkedWorkOrderId}</span>
        )}
      </div>
    </li>
  )
}
