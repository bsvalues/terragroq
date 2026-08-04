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
      className="relative isolate min-h-[34rem] overflow-hidden border-y-2 border-[#ff725f] bg-[#090b0c] px-5 py-10 text-[#edf1ed] sm:px-7 sm:py-14 lg:px-10"
      aria-labelledby="needs-william-title"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-[#ff725f]" aria-hidden />
      <div
        className="pointer-events-none absolute right-[-5rem] top-1/2 size-56 -translate-y-1/2 rotate-45 border border-[#ff725f]/20 sm:size-80"
        aria-hidden
      />

      <div className="relative mx-auto grid max-w-[90rem] gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)] lg:items-end lg:gap-16">
        <div className="min-w-0">
          <div className="flex items-center gap-3 text-[#ff725f]">
            <span className="grid size-9 shrink-0 place-items-center border border-[#ff725f]">
              <ShieldAlert className="size-4" aria-hidden />
            </span>
            <p className="text-xs font-semibold">Authority boundary reached</p>
            <span className="h-px min-w-8 flex-1 bg-[#ff725f]/50" aria-hidden />
          </div>

          <div className="mt-9 border-l-2 border-[#ff725f] pl-5 sm:pl-7">
            <p className="font-mono text-[11px] text-[#ff725f]">Needs William</p>
            <h2
              ref={headingRef}
              tabIndex={-1}
              id="needs-william-title"
              className="mt-4 max-w-4xl text-3xl font-medium leading-tight outline-none sm:text-5xl sm:leading-[1.08]"
            >
              {decision.question}
            </h2>
            <p className="mt-6 max-w-3xl text-sm leading-6 text-[#9aa49f] sm:text-base sm:leading-7">
              {decision.whyNow ?? "This outcome has reached a recorded authority boundary."}
            </p>
          </div>

          {decision.recommendation && (
            <div className="mt-8 max-w-3xl border-t border-[#343b39] pt-5">
              <p className="text-xs font-semibold text-[#ff725f]">WilliamOS recommendation</p>
              <p className="mt-2 text-sm leading-6 text-[#d8dfd9]">{decision.recommendation.statement}</p>
              <details className="mt-3 text-xs text-[#7f8985]">
                <summary className="cursor-pointer hover:text-[#edf1ed]">Technical evidence basis</summary>
                <p className="mt-2 break-words font-mono leading-5">
                  {decision.recommendation.evidenceRefs.join(", ")}
                </p>
              </details>
            </div>
          )}
        </div>

        <div className="min-w-0 border-t border-[#ff725f]">
          <p className="py-4 font-mono text-[11px] text-[#ff725f]">Decision consequences</p>
          <div className="border-t border-[#343b39]">
            {decision.choices.map((choice) => (
              <Button
                key={choice.choice}
                type="button"
                variant="ghost"
                className={decision.recommendation?.choice === choice.choice
                  ? "group h-auto min-h-24 w-full justify-start rounded-none border-b border-l-2 border-[#ff725f] bg-[#321b19]/55 px-4 py-5 text-left text-[#edf1ed] hover:bg-[#321b19]/80 hover:text-[#edf1ed] focus-visible:ring-[#ff725f]/40"
                  : "group h-auto min-h-24 w-full justify-start rounded-none border-b border-[#343b39] px-0 py-5 text-left text-[#edf1ed] hover:bg-[#15191a] hover:text-[#edf1ed] focus-visible:border-[#ff725f] focus-visible:ring-[#ff725f]/40"}
                onClick={() => setSelected(choice.choice)}
              >
                <span className="grid size-9 shrink-0 place-items-center border border-[#59625e] text-[#ff725f] group-hover:border-[#ff725f]">
                  {choice.choice === "APPROVE" ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <X className="size-4" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1 whitespace-normal">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {choice.label}
                    {decision.recommendation?.choice === choice.choice && (
                      <span className="font-mono text-[9px] font-normal uppercase text-[#ff725f]">Recommended</span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs font-normal leading-5 text-[#8e9994]">
                    {choice.consequence ?? "No consequence was recorded."}
                  </span>
                </span>
              </Button>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-[#a2aca7]">
            Your confirmed choice becomes the binding authority record for this outcome.
          </p>
        </div>
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent
          className="border-[#ff725f] bg-[#0c0f10] text-[#edf1ed] shadow-[0_30px_100px_rgba(0,0,0,0.65)]"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            cancelRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirm this authority decision</DialogTitle>
            <DialogDescription className="text-[#8e9994]">
              This records a binding owner choice for the active request. WilliamOS will follow the recorded consequence.
            </DialogDescription>
          </DialogHeader>
          <div className="border-l-2 border-[#ff725f] pl-4 text-sm">
            <p className="font-medium">{option?.label}</p>
            <p className="mt-1 leading-6 text-[#8e9994]">
              {option?.consequence ?? "No consequence was recorded."}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                ref={cancelRef}
                type="button"
                variant="outline"
                className="border-[#59625e] bg-transparent hover:bg-[#1a1f20] hover:text-[#edf1ed]"
                disabled={pending}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant={selected === "DENY" ? "destructive" : "default"}
              className="bg-[#ff725f] text-[#090b0c] hover:bg-[#ff8b7b]"
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
