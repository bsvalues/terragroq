"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowUpRight, ShieldCheck, X } from "lucide-react"

import type { PrimaryHomeModel } from "@/components/primary-home/primary-home-model"

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
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [open])

  return (
    <>
      <button
        type="button"
        className="grid size-8 place-items-center border border-[#3c4745] text-[#8e9994] hover:text-[#edf1ed]"
        aria-label="Open technical details"
        title="Technical details"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <ShieldCheck className="size-4" aria-hidden />
      </button>
      {open && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/55"
            aria-label="Close technical details"
            onClick={() => setOpen(false)}
          />
          <aside
            className="absolute inset-y-0 right-0 w-[min(24rem,92vw)] overflow-y-auto border-l border-[#3c4745] bg-[#131718] p-6 shadow-[-30px_0_80px_rgba(0,0,0,0.48)]"
            aria-label="Technical details"
          >
            <header className="flex items-start justify-between gap-4 border-b border-[#2a3232] pb-5">
              <div>
                <p className="text-[10px] uppercase text-[#626c68]">Technical details</p>
                <h2 className="mt-1 text-lg font-semibold">Current execution</h2>
              </div>
              <button
                type="button"
                className="grid size-8 place-items-center border border-[#3c4745] text-[#8e9994] hover:text-[#edf1ed]"
                aria-label="Close technical details"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" aria-hidden />
              </button>
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
          </aside>
        </div>
      )}
    </>
  )
}

function TechnicalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#626c68]">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[#edf1ed]">{value}</dd>
    </div>
  )
}
