import type { OperatorState, ExecutionAttempt } from "@/lib/operator/operator-state"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

/*
 * The Home operator surface, projected entirely from getOperatorState().
 * Idle-but-not-empty: NOW / projects at a glance / what was delivered / continuity / fabric.
 * No hardcoded state — every number is derived from the read-model.
 */

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
        <Separator className="flex-1" />
        {meta ? <span className="font-mono text-xs text-muted-foreground">{meta}</span> : null}
      </div>
      {children}
    </section>
  )
}

type DeliveredRow = {
  outcomeId: number
  identity: string
  workOrderRef: string
  prNumber: number | null
  mergeSha: string | null
  attempts: number
  abandoned: number
  node: string
  worker: string
}

function deliveredRows(executions: ExecutionAttempt[]): DeliveredRow[] {
  const byOutcome = new Map<number, ExecutionAttempt[]>()
  for (const e of executions) {
    const list = byOutcome.get(e.outcomeId) ?? []
    list.push(e)
    byOutcome.set(e.outcomeId, list)
  }
  const rows: DeliveredRow[] = []
  for (const [outcomeId, attempts] of byOutcome) {
    const deliveredAttempt = attempts.find((a) => a.attemptStatus === "delivered")
    if (!deliveredAttempt) continue
    const delivery = deliveredAttempt.delivery ?? null
    rows.push({
      outcomeId,
      identity: deliveredAttempt.outcomeIdentity,
      workOrderRef: deliveredAttempt.workOrderRef,
      prNumber: delivery?.prNumber ?? null,
      mergeSha: delivery?.mergeSha ?? null,
      attempts: attempts.length,
      abandoned: attempts.filter((a) => a.attemptStatus === "abandoned").length,
      node: deliveredAttempt.node,
      worker: deliveredAttempt.worker,
    })
  }
  return rows.sort((a, b) => (b.prNumber ?? 0) - (a.prNumber ?? 0))
}

function AttemptBadge({ attempts, abandoned }: { attempts: number; abandoned: number }) {
  if (abandoned === 0)
    return (
      <Badge variant="outline">
        {attempts} attempt{attempts === 1 ? "" : "s"} · clean
      </Badge>
    )
  if (abandoned >= 10)
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
        {attempts} attempts · {abandoned} abandoned
      </Badge>
    )
  return (
    <Badge variant="secondary">
      {attempts} attempts · {abandoned} abandoned
    </Badge>
  )
}

export function OperatorHome({ state }: { state: OperatorState }) {
  const activeCount = state.now.value.activeExecutions
  const idle = state.now.value.queueDepth === 0 && activeCount === 0
  const delivered = deliveredRows(state.executions.value)
  const closedWorkOrders = state.work.value.filter((w) => w.status === "closed").length

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* state line */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{idle ? "Ready." : "Working."}</h1>
        <Badge variant="outline" className="font-mono">
          {idle ? "idle · queue 0" : `active · queue ${state.now.value.queueDepth}`}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {idle ? "Nothing is executing." : "An outcome is in flight."}
        </span>
      </div>

      {/* NEEDS YOU — surfaced prominently when the runtime has an owner decision */}
      {state.needsWilliam.value.length > 0 ? (
        <Card className="border-amber-500/50">
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="font-medium">
              {state.needsWilliam.value.length} decision{state.needsWilliam.value.length === 1 ? "" : "s"} need you
            </div>
            <div className="flex flex-col gap-1">
              {state.needsWilliam.value.map((d) => (
                <div key={d.timelineId} className="flex flex-wrap items-center gap-x-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    {d.goalRef}
                    {d.workOrderRef ? ` · ${d.workOrderRef}` : ""}
                  </span>
                  {d.expectedNextState ? <span className="text-muted-foreground">→ {d.expectedNextState}</span> : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* NOW */}
      <Section title="Now">
        {idle ? (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4">
              <div className="flex-1">
                <div className="font-medium">No active outcome</div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  The runtime is idle and the queue is empty. Start something, or pick up a project.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <div className="font-medium">
                {state.now.value.activeExecutions} execution
                {state.now.value.activeExecutions === 1 ? "" : "s"} running
              </div>
            </CardContent>
          </Card>
        )}
      </Section>

      {/* PROJECTS */}
      <Section title="Projects" meta={`${state.projects.value.length} · what each is doing`}>
        <div className="grid gap-3 sm:grid-cols-3">
          {state.projects.value.map((p) => {
            const isActive = p.lifecycle === "active"
            return (
              <Card key={p.key}>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Badge variant={isActive ? "secondary" : "outline"} className="ml-auto font-mono text-[10px]">
                      {p.lifecycle}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {isActive ? "Active" : "Bound · no work yet"}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {p.resources.map((r) => (
                      <span
                        key={r.canonicalIdentity}
                        className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        <span className="uppercase opacity-70">{r.type}</span>
                        {r.canonicalIdentity}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </Section>

      {/* RECENTLY DELIVERED */}
      {delivered.length > 0 ? (
        <Section title="Recently delivered" meta={`${delivered.length} outcomes · merged`}>
          <div className="flex flex-col gap-1.5">
            {delivered.map((d) => (
              <Card key={d.outcomeId} className="py-0">
                <CardContent className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {d.identity} · {d.workOrderRef}
                    </span>
                    {d.prNumber ? (
                      <span className="shrink-0 font-mono text-xs text-primary">
                        PR #{d.prNumber}
                        {d.mergeSha ? <span className="text-muted-foreground"> {d.mergeSha.slice(0, 7)}</span> : null}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm">
                      Delivered by {d.worker} on {d.node}
                      {d.abandoned > 0 ? ` · recovered after ${d.attempts} attempts` : ""}
                    </span>
                    <AttemptBadge attempts={d.attempts} abandoned={d.abandoned} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {/* CONTINUITY */}
      <Section title="Continuity" meta="what WilliamOS has accumulated">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { n: closedWorkOrders, l: "Work Orders closed" },
            { n: state.knowledge.value.evidence, l: "Evidence records" },
            { n: state.knowledge.value.governance, l: "Governance events" },
            { n: delivered.length, l: "Outcomes delivered" },
          ].map((t) => (
            <Card key={t.l}>
              <CardContent className="py-4">
                <div className="text-2xl font-semibold tabular-nums">{t.n}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t.l}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {/* SYSTEM */}
      <Section title="System" meta={`${state.systems.value.length} nodes · ${state.systems.truthState}`}>
        <div className="grid gap-3 sm:grid-cols-3">
          {state.systems.value.map((s) => {
            // Colour by grounding, not by an asserted up/down we can't probe in-process:
            // green = live signal, amber = inferred, red only when genuinely unreachable.
            const dot = s.status === "unreachable" ? "bg-destructive" : s.detail.startsWith("live") ? "bg-emerald-500" : "bg-amber-500"
            return (
              <Card key={s.node}>
                <CardContent className="flex flex-col gap-1 py-4">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${dot}`} aria-hidden />
                    <span className="font-mono font-semibold">{s.node}</span>
                    <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                      {s.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{s.role}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{s.detail}</div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </Section>

      {/* provenance */}
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        projected from getOperatorState() · {state.installation} · observed{" "}
        {new Date(state.now.observedAt).toISOString().slice(0, 19).replace("T", " ")} · truthState {state.now.truthState}
      </p>
    </div>
  )
}
