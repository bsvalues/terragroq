"use client"

import Link from "next/link"
import { ArrowUpRight, ShieldCheck, X } from "lucide-react"

import type { PrimaryHomeModel } from "@/components/primary-home/primary-home-model"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

type TechnicalDetails = PrimaryHomeModel["technicalDetails"]

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function PrimaryHomeTechnicalDetails({ details }: { details: TechnicalDetails }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="grid size-8 place-items-center border border-[#3c4745] text-[#8e9994] hover:text-[#edf1ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#59b8df]"
          aria-label="Open technical details"
          title="Technical details"
        >
          <ShieldCheck className="size-4" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="left-auto right-0 top-0 h-screen w-[min(24rem,92vw)] max-w-none translate-x-0 translate-y-0 content-start gap-0 overflow-y-auto rounded-none border-y-0 border-l border-r-0 border-[#3c4745] bg-[#131718] p-6 text-[#edf1ed] shadow-[-30px_0_80px_rgba(0,0,0,0.48)] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#2a3232] pb-5">
          <div>
            <p className="text-[10px] uppercase text-[#8e9994]">Technical details</p>
            <DialogTitle className="mt-1 text-lg">Current execution</DialogTitle>
            <DialogDescription className="sr-only">
              Queue, timeline, Goal, Work Order, and generated-at details for the current Home state.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="grid size-8 place-items-center border border-[#3c4745] text-[#8e9994] hover:text-[#edf1ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#59b8df]"
              aria-label="Close technical details"
            >
              <X className="size-4" aria-hidden />
            </button>
          </DialogClose>
        </header>
        <dl className="mt-5 grid gap-y-4 border-l border-[#3c4745] pl-4 text-xs">
          <TechnicalDetail label="Queue" value={`${details.queueState} · ${details.queueReason}`} />
          <TechnicalDetail label="Timeline truth" value={details.timelineTruth} />
          <TechnicalDetail label="Goal" value={details.currentGoalId?.toString() ?? "Not recorded"} />
          <TechnicalDetail label="Work Order" value={details.currentWorkOrderId?.toString() ?? "Not recorded"} />
          <TechnicalDetail label="Decision Goal" value={details.decisionGoalId?.toString() ?? "None"} />
          <TechnicalDetail label="Generated" value={formatWhen(details.generatedAt)} />
        </dl>
        <Link href="/runtime" className="mt-7 inline-flex items-center gap-2 text-xs font-medium text-[#59b8df]">
          Open full evidence <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </DialogContent>
    </Dialog>
  )
}

function TechnicalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#8e9994]">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[#edf1ed]">{value}</dd>
    </div>
  )
}
