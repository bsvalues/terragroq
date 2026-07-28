"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  Check,
  CirclePause,
  CirclePlay,
  GitBranch,
  Loader2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import {
  mutateOutcomeQueue,
} from "@/app/actions/outcome-queue"
import type { OutcomeQueueMutationInput } from "@/lib/outcome-queue/operator-mutations"
import type {
  OutcomeQueueOperatorRow,
  OutcomeQueueOperatorSurface,
} from "@/lib/outcome-queue/operator-surface"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/status-badge"

function actionInput(
  row: OutcomeQueueOperatorRow,
  action: OutcomeQueueMutationInput["action"],
  extra: Partial<OutcomeQueueMutationInput> = {},
): OutcomeQueueMutationInput {
  return {
    action,
    outcomeKey: row.outcomeKey,
    expectedVersion: row.version,
    idempotencyKey: crypto.randomUUID(),
    ...extra,
  }
}

function reorderInput(
  surface: OutcomeQueueOperatorSurface,
  row: OutcomeQueueOperatorRow,
  direction: -1 | 1,
): OutcomeQueueMutationInput | null {
  const ordered = surface.rows.filter((item) => (
    ["suggested", "approved", "blocked"].includes(item.lifecycleState)
  ))
  const currentIndex = ordered.findIndex((item) => item.outcomeKey === row.outcomeKey)
  const destination = currentIndex + direction
  if (currentIndex < 0 || destination < 0 || destination >= ordered.length) return null
  const next = [...ordered]
  ;[next[currentIndex], next[destination]] = [next[destination], next[currentIndex]]
  return actionInput(row, "reorder", {
    orderedOutcomes: next.map((item) => ({
      outcomeKey: item.outcomeKey,
      expectedVersion: item.version,
    })),
  })
}

export function OperatorOutcomeQueuePanel({
  surface,
  compact = false,
}: {
  surface: OutcomeQueueOperatorSurface
  compact?: boolean
}) {
  const router = useRouter()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [superseding, setSuperseding] = useState<OutcomeQueueOperatorRow | null>(null)
  const [replacementTitle, setReplacementTitle] = useState("")
  const [pending, startTransition] = useTransition()
  const visibleRows = compact ? surface.rows.slice(0, 4) : surface.rows

  function run(input: OutcomeQueueMutationInput) {
    setPendingKey(input.outcomeKey)
    startTransition(async () => {
      try {
        const result = await mutateOutcomeQueue(input)
        if (result.status === "RECORDED" || result.status === "REPLAYED") {
          toast.success(result.message)
          router.refresh()
          return
        }
        toast.error(result.message)
        if (result.status === "STALE") router.refresh()
      } catch {
        toast.error("Queue decision could not be recorded.")
      } finally {
        setPendingKey(null)
      }
    })
  }

  function submitSupersede() {
    if (!superseding || replacementTitle.trim() === "") return
    run(actionInput(superseding, "supersede", {
      reason: "Primary Operator replaced this outcome from the queue surface.",
      replacement: {
        title: replacementTitle.trim(),
        objective: replacementTitle.trim(),
      },
    }))
    setSuperseding(null)
    setReplacementTitle("")
  }

  return (
    <section
      aria-labelledby="operator-outcome-queue-title"
      className="border-y border-border bg-card"
    >
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="operator-outcome-queue-title" className="text-sm font-semibold">
            Approved outcome queue
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {surface.reasonLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge value={surface.state.toLowerCase()} label={surface.stateLabel} />
          <span className="font-mono text-[10px] text-muted-foreground">
            {surface.counts.nonTerminal} open / {surface.counts.terminal} terminal
          </span>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted-foreground">
          No durable outcomes are queued.
        </div>
      ) : (
        <ol className="divide-y divide-border">
          {visibleRows.map((row, index) => {
            const rowPending = pending && pendingKey === row.outcomeKey
            const movable = !row.isActive
              && !["completed", "declined", "superseded"].includes(row.lifecycleState)
            const terminal = ["completed", "declined", "superseded"].includes(
              row.lifecycleState,
            )
            const movableRows = surface.rows.filter((item) => (
              ["suggested", "approved", "blocked"].includes(item.lifecycleState)
            ))
            const movableIndex = movableRows.findIndex(
              (item) => item.outcomeKey === row.outcomeKey,
            )
            return (
              <li key={row.outcomeKey} className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-sm font-medium">{row.title}</h3>
                    <StatusBadge value={row.lifecycleState} label={row.lifecycleLabel} />
                    {row.isNextEligible ? <StatusBadge value="approved" label="Next" /> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
                    <span>{row.riskLabel}</span>
                    <span>{row.approvalLabel}</span>
                    <span>{row.authorityLabel}</span>
                    <span>v{row.version}</span>
                  </div>
                  {row.blockerLabels.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Eligibility blockers">
                      {row.blockerLabels.map((blocker) => (
                        <li key={blocker} className="text-xs text-warning">{blocker}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {!terminal ? (
                  <div className="flex min-h-9 flex-wrap items-center justify-end gap-1">
                    {rowPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-label="Recording decision" /> : null}
                    {movable ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={pending || movableIndex <= 0}
                          title="Move outcome earlier"
                          aria-label={`Move ${row.title} earlier`}
                          onClick={() => {
                            const input = reorderInput(surface, row, -1)
                            if (input) run(input)
                          }}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={pending || movableIndex < 0 || movableIndex === movableRows.length - 1}
                          title="Move outcome later"
                          aria-label={`Move ${row.title} later`}
                          onClick={() => {
                            const input = reorderInput(surface, row, 1)
                            if (input) run(input)
                          }}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </>
                    ) : null}
                    {row.lifecycleState === "active" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => run(actionInput(row, "pause", {
                          reason: "Primary Operator paused this outcome.",
                        }))}
                      >
                        <CirclePause className="mr-2 h-4 w-4" />
                        Pause
                      </Button>
                    ) : null}
                    {row.lifecycleState === "blocked" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || row.availableApprovalDecisionId === null || row.availableAuthorityGrantRef === null}
                        title={row.availableApprovalDecisionId === null || row.availableAuthorityGrantRef === null
                          ? "A binding decision and live authority are required"
                          : "Resume outcome"}
                        onClick={() => run(actionInput(row, "resume", {
                          approvalDecisionId: row.availableApprovalDecisionId ?? undefined,
                          authorityGrantRef: row.availableAuthorityGrantRef ?? undefined,
                        }))}
                      >
                        <CirclePlay className="mr-2 h-4 w-4" />
                        Resume
                      </Button>
                    ) : null}
                    {row.lifecycleState === "suggested" ? (
                      <Button
                        size="sm"
                        disabled={pending || row.availableApprovalDecisionId === null || row.availableAuthorityGrantRef === null}
                        title={row.availableApprovalDecisionId === null || row.availableAuthorityGrantRef === null
                          ? "Record a binding decision and scoped authority before approval"
                          : "Approve outcome"}
                        onClick={() => run(actionInput(row, "approve", {
                          approvalDecisionId: row.availableApprovalDecisionId ?? undefined,
                          authorityGrantRef: row.availableAuthorityGrantRef ?? undefined,
                        }))}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Approve
                      </Button>
                    ) : null}
                    {row.lifecycleState !== "active" ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={pending}
                          title="Supersede outcome"
                          aria-label={`Supersede ${row.title}`}
                          onClick={() => {
                            setSuperseding(row)
                            setReplacementTitle("")
                          }}
                        >
                          <GitBranch className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={pending}
                          title="Decline outcome"
                          aria-label={`Decline ${row.title}`}
                          onClick={() => run(actionInput(row, "decline", {
                            reason: "Primary Operator declined this outcome.",
                          }))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}

      {compact && surface.rows.length > visibleRows.length ? (
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          {surface.rows.length - visibleRows.length} more outcomes are visible in Goal Console.
        </p>
      ) : null}

      <Dialog open={superseding !== null} onOpenChange={(open) => {
        if (!open) setSuperseding(null)
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supersede outcome</DialogTitle>
            <DialogDescription>
              Replace this outcome with a new unapproved suggestion. Approval and authority do not carry forward.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="replacement-title">Replacement outcome</Label>
            <Input
              id="replacement-title"
              value={replacementTitle}
              onChange={(event) => setReplacementTitle(event.target.value)}
              placeholder="State the replacement outcome"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuperseding(null)}>Cancel</Button>
            <Button disabled={replacementTitle.trim() === "" || pending} onClick={submitSupersede}>
              Supersede
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
