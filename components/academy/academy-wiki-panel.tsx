import Link from "next/link"
import { BookOpenCheck, GraduationCap, ShieldCheck } from "lucide-react"

import { getAcademyWikiSurface } from "@/components/academy/academy-wiki-registry"
import { StatusBadge } from "@/components/status-badge"

function Card({
  label,
  value,
  description,
}: {
  label: string
  value: string
  description: string
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

export function AcademyWikiPanel() {
  const surface = getAcademyWikiSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <GraduationCap className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Academy + Wiki
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">WilliamOS Knowledge Layer</h2>
          <StatusBadge value="pass" label="static" />
          <StatusBadge value="pass" label="read-only" />
          <StatusBadge value="neutral" label="Owner not courier" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Academy teaches operation. Wiki defines concepts. Both stay read-only and link back to
          governed WilliamOS surfaces without automation.
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-4">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-4 w-4 text-primary" aria-hidden={true} />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {surface.academyDoctrine.title}
            </p>
          </div>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {surface.academyDoctrine.statements.map((statement) => (
              <li key={statement} className="rounded-md border border-border bg-card px-3 py-2">
                {statement}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-4 w-4 text-primary" aria-hidden={true} />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {surface.wikiDoctrine.title}
            </p>
          </div>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {surface.wikiDoctrine.statements.map((statement) => (
              <li key={statement} className="rounded-md border border-border bg-card px-3 py-2">
                {statement}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Featured Lesson
          </p>
          <h3 className="mt-2 text-base font-semibold">{surface.featuredLesson.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {surface.featuredLesson.summary}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Card label="Audience" value={surface.featuredLesson.audience} description={surface.featuredLesson.level} />
            <Card
              label="Teaches"
              value="operator model"
              description={surface.featuredLesson.whatThisTeaches.join(" ")}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Featured Wiki Page
          </p>
          <h3 className="mt-2 text-base font-semibold">{surface.featuredWikiPage.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {surface.featuredWikiPage.canonicalDefinition}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Card label="What it is" value={surface.featuredWikiPage.conceptType} description={surface.featuredWikiPage.whatItIs} />
            <Card label="What it is not" value="boundary" description={surface.featuredWikiPage.whatItIsNot} />
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Academy lessons</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {surface.lessons.map((lesson) => (
            <article key={lesson.lessonId} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{lesson.title}</h3>
                <StatusBadge value={lesson.level} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {lesson.summary}
              </p>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {lesson.lessonId}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Does not enable: {lesson.whatThisDoesNotEnable.join(", ")}.
              </p>
            </article>
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <p className="text-sm font-medium">Wiki pages</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.wikiPages.map((page) => (
            <article key={page.pageId} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{page.title}</h3>
                <StatusBadge value={page.conceptType} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {page.canonicalDefinition}
              </p>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Not: {page.whatItIsNot}
              </p>
            </article>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Glossary</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {surface.glossary.map((term) => (
            <div key={term.term} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{term.term}</p>
                <StatusBadge value={term.category} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {term.definition}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-muted/10 p-4">
        <p className="text-sm font-medium">Safety proof</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {surface.safetyProofCards.map((card) => (
            <Card key={card.label} {...card} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Related surfaces</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {surface.navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
              >
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <p className="text-sm font-medium">{surface.nextLaneDecision.recommendedBatch}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.nextLaneDecision.reason}
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Blocked lanes: {surface.nextLaneDecision.blockedLanes.join(", ")}.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Academy/Wiki is static and read-only. No runtime training, progress persistence,
          quiz mutation, command execution, Codex automation, dynamic ingestion, authority
          mutation, local runtime expansion, secrets, or autonomy.
        </p>
      </div>
    </section>
  )
}
