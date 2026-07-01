import { getMemoryFacts } from "@/app/actions/memory"
import { PageHeader } from "@/components/shell/page-header"
import { MemoryView } from "@/components/memory/memory-view"
import { getMemoryWorkspace } from "@/components/memory/memory-workspace"

export default async function MemoryPage() {
  const facts = await getMemoryFacts()
  const workspace = getMemoryWorkspace()

  return (
    <>
      <PageHeader
        title={workspace.title}
        description={workspace.description}
      />
      <section className="grid gap-4 px-6 pb-2 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
            {workspace.eyebrow}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {workspace.postureSummary.map((item) => (
              <div key={item.label} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-sm font-semibold">{item.value}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-semibold">{workspace.reviewQueue.label}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {workspace.reviewQueue.posture}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {workspace.reviewQueue.description}
          </p>
        </div>
      </section>
      <section className="grid gap-3 px-6 py-2 md:grid-cols-2 xl:grid-cols-3">
        {workspace.sections.map((section) => (
          <article key={section.title} className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">{section.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {section.purpose}
            </p>
            <dl className="mt-4 space-y-2 text-xs text-muted-foreground">
              <div>
                <dt className="font-mono uppercase tracking-[0.18em]">Posture</dt>
                <dd>{section.currentPosture}</dd>
              </div>
              <div>
                <dt className="font-mono uppercase tracking-[0.18em]">Authority</dt>
                <dd>{section.authorityRequirement}</dd>
              </div>
              <div>
                <dt className="font-mono uppercase tracking-[0.18em]">Evidence</dt>
                <dd>{section.evidenceLinkage}</dd>
              </div>
              <div>
                <dt className="font-mono uppercase tracking-[0.18em]">Next safe step</dt>
                <dd>{section.nextSafeStep}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
      <MemoryView initial={facts} />
    </>
  )
}
