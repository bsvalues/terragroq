import Link from "next/link"
import { ScrollText, ShieldCheck } from "lucide-react"
import { getDoctrineNativeArea } from "@/components/doctrine/doctrine-native-area"
import { StatusBadge } from "@/components/status-badge"

export function DoctrineNativeAreaPanel() {
  const area = getDoctrineNativeArea()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {area.eyebrow}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{area.title}</h2>
          <StatusBadge value="pass" label="native area" />
          <StatusBadge value="requires_approval" label="approval gates" />
          <StatusBadge value="inactive" label="rules, not runtime" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {area.description}
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-3">
        {area.postureSummary.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-2 text-sm font-semibold">{item.value}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border bg-muted/10 p-4 md:grid-cols-2 xl:grid-cols-4">
        {area.sections.map((section) => (
          <article key={section.label} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-semibold">{section.label}</h3>
              <StatusBadge value="informational" label={section.posture} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {section.purpose}
            </p>
            <dl className="mt-3 grid gap-2 text-xs text-muted-foreground">
              <DoctrineField label="Boundary" value={section.boundary} />
              <DoctrineField label="Evidence" value={section.evidence} />
              <DoctrineField label="Review" value={section.ownerReview} />
            </dl>
            <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
              Next: {section.nextSafeStep}
            </p>
          </article>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
        {area.links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <p className="text-sm font-semibold">{link.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {link.description}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border bg-muted/10 p-4 md:grid-cols-3">
        {area.authorityBoundaries.map((boundary) => (
          <div key={boundary.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {boundary.label}
            </p>
            <p className="mt-2 text-sm font-semibold">{boundary.state}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {boundary.description}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Doctrine may describe operating law, allowed behavior, forbidden behavior, and
          approval gates. This reframe does not change auth or access behavior, access
          grants, token handling, audit writers, durable limiters, runtime validation,
          permission models, approval execution, DB schema, Hermes, MCP, autonomy, or
          production-write behavior.
        </p>
      </div>
    </section>
  )
}

function DoctrineField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider">{label}</dt>
      <dd className="mt-1 leading-relaxed">{value}</dd>
    </div>
  )
}
