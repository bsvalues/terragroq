import Link from "next/link"
import { Activity, AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react"
import type {
  HomeWorkRadar,
  HomeWorkRadarLane,
} from "@/components/dashboard/home-command-center"

const TONE_STYLES: Record<
  HomeWorkRadarLane["tone"],
  { border: string; icon: string; rail: string; badge: string }
> = {
  active: {
    border: "border-primary/25",
    icon: "text-primary",
    rail: "bg-primary",
    badge: "border-primary/20 bg-primary/10 text-primary",
  },
  blocked: {
    border: "border-warning/30",
    icon: "text-warning",
    rail: "bg-warning",
    badge: "border-warning/25 bg-warning/10 text-warning",
  },
  complete: {
    border: "border-success/30",
    icon: "text-success",
    rail: "bg-success",
    badge: "border-success/25 bg-success/10 text-success",
  },
}

function LaneIcon({ tone }: { tone: HomeWorkRadarLane["tone"] }) {
  if (tone === "blocked") return <AlertTriangle className="h-4 w-4" aria-hidden />
  if (tone === "complete") return <CheckCircle2 className="h-4 w-4" aria-hidden />
  return <Activity className="h-4 w-4" aria-hidden />
}

function resultTone(result: string) {
  if (result === "PASS") return "border-success/25 bg-success/10 text-success"
  if (result === "FAIL") return "border-destructive/25 bg-destructive/10 text-destructive"
  if (result === "PARTIAL") return "border-warning/25 bg-warning/10 text-warning"
  return "border-border bg-muted/40 text-muted-foreground"
}

export function HomeWorkRadarPanel({ radar }: { radar: HomeWorkRadar }) {
  const lanes = [radar.activeWork, radar.blockers, radar.recentOutcomes]

  return (
    <section
      aria-labelledby="home-work-radar-heading"
      className="overflow-hidden rounded-3xl border border-border bg-card"
    >
      <div className="flex flex-col gap-5 border-b border-border bg-muted/20 p-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            {radar.eyebrow}
          </p>
          <h2 id="home-work-radar-heading" className="mt-2 text-2xl font-semibold tracking-tight">
            {radar.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {radar.description}
          </p>
        </div>

        <div className="grid w-full max-w-xs grid-cols-3 gap-1" aria-hidden>
          <span className="h-1.5 rounded-full bg-primary" />
          <span className="h-1.5 rounded-full bg-warning" />
          <span className="h-1.5 rounded-full bg-success" />
        </div>
      </div>

      <div className="grid lg:grid-cols-3">
        {lanes.map((lane, index) => {
          const tone = TONE_STYLES[lane.tone]
          return (
            <article
              key={lane.label}
              className={`relative p-5 ${index > 0 ? "border-t border-border lg:border-l lg:border-t-0" : ""}`}
            >
              <div className={`absolute inset-x-5 top-0 h-0.5 ${tone.rail}`} aria-hidden />
              <div className="flex items-start justify-between gap-4 pt-2">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 rounded-lg border bg-background p-2 ${tone.border} ${tone.icon}`}>
                    <LaneIcon tone={lane.tone} />
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {lane.label}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold tracking-tight">{lane.title}</h3>
                  </div>
                </div>
                <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] ${tone.badge}`}>
                  {lane.count}
                </span>
              </div>

              <p className="mt-3 min-h-10 text-xs leading-relaxed text-muted-foreground">
                {lane.description}
              </p>

              <div className="mt-4 grid gap-2">
                {lane.items.length > 0 ? (
                  lane.items.map((item) => (
                    <Link
                      key={`${lane.label}-${item.ref}`}
                      href={item.href}
                      className="group rounded-xl border border-border bg-background p-3 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {item.ref}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium leading-snug">{item.title}</p>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {item.detail}
                        </p>
                        {item.result ? (
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${resultTone(item.result)}`}>
                            {item.result}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-background/60 p-4">
                    <p className="text-xs leading-relaxed text-muted-foreground">{lane.emptyState}</p>
                  </div>
                )}
              </div>

              <Link
                href="/work-orders"
                className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Review Work Orders
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </article>
          )
        })}
      </div>
    </section>
  )
}
