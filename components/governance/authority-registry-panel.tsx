import Link from "next/link"
import { KeyRound, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { getAuthorityRegistrySurface } from "@/components/governance/authority-registry"

function AuthorityField({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <ul className="mt-2 grid gap-1 text-xs leading-relaxed text-muted-foreground">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  )
}

export function AuthorityRegistryPanel() {
  const registry = getAuthorityRegistrySurface()
  const detail = registry.records[0]

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Authority Registry
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">
          {registry.doctrine.title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          A read-only registry of what WilliamOS may display, what remains blocked,
          and what requires owner approval before any mutation can proceed.
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Doctrine
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {registry.doctrine.statements.map((statement) => (
              <li key={statement} className="rounded-md border border-border bg-card px-3 py-2">
                {statement}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Authority Detail
            </p>
            <Badge variant="outline">{detail.level}</Badge>
          </div>
          <h3 className="mt-2 text-base font-semibold">{detail.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail.scope}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <AuthorityField label="Allowed" values={detail.allowedActions} />
            <AuthorityField label="Blocked" values={detail.blockedActions} />
            <AuthorityField label="Required evidence" values={detail.requiredEvidence} />
            <AuthorityField label="Related WOs" values={detail.relatedWorkOrders} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">{detail.category}</Badge>
            <Badge variant="outline">risk: {detail.riskLevel}</Badge>
            <Badge variant="outline">status: {detail.status}</Badge>
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Authority categories and levels</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {registry.categories.map((category) => (
            <div key={category.category} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {category.category}
              </p>
              <p className="mt-2 text-sm font-semibold">{category.level}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {category.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 xl:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Blocked actions</p>
          <div className="mt-3 grid gap-2">
            {registry.blockedActions.map((action) => (
              <div key={action.action} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{action.action}</p>
                  <Badge variant="outline">{action.requiredAuthority}</Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {action.reason}
                </p>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {action.safeDefault}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Owner decision gates</p>
          <div className="mt-3 grid gap-2">
            {registry.ownerDecisions.map((decision) => (
              <div key={decision.decision} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{decision.decision}</p>
                  <Badge variant="outline">{decision.status}</Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Required evidence: {decision.requiredEvidence}
                </p>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {decision.safeDefault}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-3">
        <LinkColumn title="Work Order authority" links={registry.workOrderAuthorityLinks} />
        <LinkColumn title="Evidence authority" links={registry.evidenceAuthorityLinks} />
        <LinkColumn title="Blocked decision authority" links={registry.blockedDecisionAuthorityLinks} />
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Authority safety proof</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {registry.safetyProofCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-border bg-background p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-2 text-sm font-semibold">{card.value}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {card.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-4">
        {registry.navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <p className="text-sm font-semibold">{item.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium">{registry.nextLaneDecision.recommendedBatch}</p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {registry.nextLaneDecision.reason}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
          Static registry only. No approval controls, command runner, enforcement engine, or mutation.
        </div>
      </div>
    </section>
  )
}

function LinkColumn({
  title,
  links,
}: {
  title: string
  links: {
    label: string
    authorityId: string
    relatedItem: string
    description: string
  }[]
}) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-3 grid gap-2">
        {links.map((link) => (
          <div key={`${link.authorityId}-${link.label}`} className="rounded-lg border border-border bg-background p-3">
            <p className="text-sm font-semibold">{link.label}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {link.authorityId}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {link.description}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{link.relatedItem}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
