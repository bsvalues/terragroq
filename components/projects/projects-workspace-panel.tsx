import Link from "next/link"
import { Compass, FolderKanban, ShieldCheck } from "lucide-react"
import { getProjectsWorkspace, type ProjectPosture } from "@/components/projects/projects-workspace"
import { StatusBadge } from "@/components/status-badge"

const postureValue: Record<ProjectPosture, "pass" | "neutral" | "partial"> = {
  active: "pass",
  planned: "neutral",
  blocked: "partial",
}

export function ProjectsWorkspacePanel() {
  const workspace = getProjectsWorkspace()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <FolderKanban className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {workspace.eyebrow}
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{workspace.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {workspace.description}
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-3">
        {workspace.postureSummary.map((item) => (
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

      <div className="border-b border-border bg-muted/10 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Compass className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Project command context
          </p>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {workspace.commandStates.map((item) => (
            <div key={item.label} className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-semibold">{item.label}</p>
              <p className="mt-2 text-xs font-medium text-foreground">{item.state}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-4 xl:grid-cols-2">
        {workspace.projects.map((project) => (
          <article key={project.name} className="rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{project.name}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {project.currentFocus}
                </p>
              </div>
              <StatusBadge value={postureValue[project.posture]} label={project.posture} />
            </div>
            <dl className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
              <ProjectField label="Latest WO" value={project.latestWorkOrder} />
              <ProjectField label="Latest Evidence" value={project.latestEvidence} />
              <ProjectField label="Deployment Posture" value={project.deploymentPosture} />
              <ProjectField label="Blocked Decision" value={project.blockedDecision} />
            </dl>
            <p className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              Next: {project.nextRecommendedWork}
            </p>
          </article>
        ))}
      </div>

      <div className="grid gap-3 border-t border-border bg-muted/10 p-4 md:grid-cols-3">
        {workspace.authorityBoundaries.map((boundary) => (
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

      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-4">
        {workspace.links.map((link) => (
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

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Projects is read-only. It does not move repositories, deploy, write production,
          mutate data, grant authority, activate Hermes, activate MCP, or enable autonomy.
        </p>
      </div>
    </section>
  )
}

function ProjectField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider">{label}</dt>
      <dd className="mt-1 leading-relaxed">{value}</dd>
    </div>
  )
}
