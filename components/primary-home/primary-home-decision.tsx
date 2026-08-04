"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, ShieldAlert, X } from "lucide-react"
import { toast } from "sonner"

import { recordGoalAuthorityDecision } from "@/app/actions/goal-authority-decision"
import type {
  GoalAuthorityDecisionChoice,
  GoalTimelineDecisionRequest,
} from "@/components/goal-console/goal-timeline-read-model"
import type { PrimaryHomeDecision } from "@/components/primary-home/primary-home-model"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function PrimaryHomeDecisionPanel({
  decision,
  request,
}: {
  decision: PrimaryHomeDecision
  request: GoalTimelineDecisionRequest
}) {
  const router = useRouter()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [selected, setSelected] = useState<GoalAuthorityDecisionChoice | null>(null)
  const [pending, startTransition] = useTransition()
  const option = decision.choices.find((choice) => choice.choice === selected) ?? null

  function submit() {
    if (selected === null) return
    startTransition(async () => {
      try {
        const result = await recordGoalAuthorityDecision({ request, choice: selected })
        if (result.status === "RECORDED" || result.status === "REPLAYED") {
          toast.success(result.message)
          setSelected(null)
          router.refresh()
          window.setTimeout(() => headingRef.current?.focus(), 0)
        } else {
          toast.error(result.message)
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Authority decision failed")
      }
    })
  }

  return (
    <section
      className="border-y border-warning/40 bg-warning/[0.06] px-5 py-6 sm:px-7"
      aria-labelledby="needs-william-title"
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning">
            <ShieldAlert className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase text-warning">Needs William</p>
            <h2
              ref={headingRef}
              tabIndex={-1}
              id="needs-william-title"
              className="mt-2 max-w-3xl text-xl font-semibold leading-snug outline-none sm:text-2xl"
            >
              {decision.question}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {decision.whyNow ?? "This outcome has reached a recorded authority boundary."}
            </p>
            {decision.recommendation && (
              <div className="mt-4 max-w-3xl border-l-2 border-warning pl-3">
                <p className="text-xs font-medium text-warning">WilliamOS recommendation</p>
                <p className="mt-1 text-sm leading-6">{decision.recommendation.statement}</p>
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">Technical evidence basis</summary>
                  <p className="mt-1 font-mono">{decision.recommendation.evidenceRefs.join(", ")}</p>
                </details>
              </div>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {decision.choices.map((choice) => (
                <Button
                  key={choice.choice}
                  type="button"
                  variant={choice.choice === "APPROVE" ? "default" : "outline"}
                  className="h-auto min-h-10 whitespace-normal px-4 py-2 text-left"
                  onClick={() => setSelected(choice.choice)}
                >
                  {choice.choice === "APPROVE" ? <Check aria-hidden /> : <X aria-hidden />}
                  {choice.label}
                </Button>
              ))}
            </div>
            <details className="mt-5 max-w-3xl text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Decision consequences
              </summary>
              <dl className="mt-3 grid gap-3 border-l border-border pl-4 sm:grid-cols-2">
                {decision.choices.map((choice) => (
                  <div key={choice.choice}>
                    <dt className="font-medium">{choice.label}</dt>
                    <dd className="mt-1 text-muted-foreground">
                      {choice.consequence ?? "No consequence was recorded."}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        </div>
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            cancelRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirm this authority decision</DialogTitle>
            <DialogDescription>
              This records a binding owner choice for the active request. WilliamOS will follow the recorded consequence.
            </DialogDescription>
          </DialogHeader>
          <div className="border-l-2 border-warning pl-3 text-sm">
            <p className="font-medium">{option?.label}</p>
            <p className="mt-1 text-muted-foreground">
              {option?.consequence ?? "No consequence was recorded."}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button ref={cancelRef} type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant={selected === "DENY" ? "destructive" : "default"}
              disabled={pending}
              onClick={submit}
            >
              {pending ? "Recording..." : option?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
