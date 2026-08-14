import Link from "next/link"
import { FolderKanban, ShieldCheck } from "lucide-react"
import type { ProjectView, TruthEnvelope } from "@/lib/operator/operator-state"
import { StatusBadge } from "@/components/status-badge"

const CONTEXT_LINKS = [
  { href: "/work-orders", label: "Work Orders", detail: "Open governed work in context." },
  { href: "/audit", label: "Evidence", detail: "Inspect recorded proof." },
  { href: "/runtime", label: "System", detail: "Inspect system truth." },
  { href: "/brain-council", label: "Brain Council", detail: "Escalate a governed decision." },
]

export function ProjectsWorkspacePanel({ projects }: { projects: TruthEnvelope<ProjectView[]> }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-primary" aria-hidden={true} />
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Durable project register
            </p>
          </div>
          <StatusBadge value={projects.value.length ? "pass" : "neutral"} label={projects.truthState} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Source: {projects.source} · Read {new Date(projects.observedAt).toISOString()}
        </p>
      </header>

      {projects.value.length ? (
        <div className="grid gap-3 p-4 xl:grid-cols-2">
          {projects.value.map((project) => (
            <article key={project.key} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{project.name}</h2>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {project.key}
                  </p>
                </div>
                <StatusBadge
                  value={project.lifecycle === "active" ? "pass" : "neutral"}
                  label={project.lifecycle}
                />
              </div>

              {project.resources.length ? (
                <dl className="mt-4 grid gap-2">
                  {project.resources.map((resource) => (
                    <div
                      key={`${resource.type}:${resource.canonicalIdentity}:${resource.relationship}`}
                      className="rounded-md border border-border bg-card px-3 py-2"
                    >
                      <dt className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                        <span>{resource.label}</span>
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          {resource.type} · {resource.relationship}
                        </span>
                      </dt>
                      <dd className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                        {resource.canonicalIdentity}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-4 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  No explicit resources are bound to this project.
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <p className="text-sm font-semibold">No durable projects are registered.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Ambiguous records remain unassigned until an explicit project binding is recorded.
          </p>
        </div>
      )}

      <nav aria-label="Project context" className="grid gap-3 border-t border-border bg-muted/10 p-4 md:grid-cols-4">
        {CONTEXT_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="rounded-lg border border-border bg-background p-3">
            <p className="text-sm font-semibold">{link.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{link.detail}</p>
          </Link>
        ))}
      </nav>

      <footer className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Projects is read-only. It does not infer project membership from repository, evidence,
          goal, or work-order labels, and it grants no execution authority.
        </p>
      </footer>
    </section>
  )
}
