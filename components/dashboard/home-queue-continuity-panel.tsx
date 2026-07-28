import Link from "next/link"
import { ArrowRight } from "lucide-react"

import type { HomeQueueContinuity } from "@/components/dashboard/home-queue-continuity"

export function HomeQueueContinuityPanel({
  continuity,
}: {
  continuity: HomeQueueContinuity
}) {
  return (
    <section
      aria-labelledby="home-queue-continuity-title"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Queue continuity
          </p>
          <h2 id="home-queue-continuity-title" className="mt-1 text-base font-semibold">
            Outcome handoff
          </h2>
        </div>
        <span className="w-fit rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {continuity.stateLabel}
        </span>
      </div>

      <div className="grid md:grid-cols-3">
        <article
          aria-label="Active outcome"
          className="border-b border-border p-5 md:border-b-0 md:border-r"
        >
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Active outcome
          </p>
          {continuity.active ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{continuity.active.identity}</h3>
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
                  {continuity.active.status}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {continuity.active.title}
              </p>
              {continuity.active.staleLease ? (
                <p className="mt-2 text-[11px] font-medium text-warning">
                  Lease is stale
                </p>
              ) : null}
              {continuity.active.context ? (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {continuity.active.context}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-2 text-sm font-semibold">No active outcome</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                No outcome currently holds the active queue position.
              </p>
            </>
          )}
        </article>

        <article
          aria-label="Next eligible outcome"
          className="border-b border-border p-5 md:border-b-0 md:border-r"
        >
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Next eligible
          </p>
          {continuity.next ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{continuity.next.identity}</h3>
                <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-success">
                  {continuity.next.mode}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {continuity.next.title}
              </p>
              {continuity.next.context ? (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {continuity.next.context}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-2 text-sm font-semibold">No eligible outcome</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                The queue has not identified a separate eligible next outcome.
              </p>
            </>
          )}
        </article>

        <article aria-label="Current blocker" className="p-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Current blocker
          </p>
          {continuity.blockerReason ? (
            <p className="mt-2 text-sm font-medium leading-relaxed">
              {continuity.blockerReason}
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm font-semibold">No current blocker</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Queue continuity is not currently blocked.
              </p>
            </>
          )}
          <nav
            aria-label="Queue continuity destinations"
            className="mt-4 flex flex-wrap gap-x-4 gap-y-2"
          >
            {continuity.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {link.label}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            ))}
          </nav>
        </article>
      </div>
    </section>
  )
}
