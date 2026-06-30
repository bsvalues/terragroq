import Link from "next/link"
import { Anchor, ShieldCheck } from "lucide-react"
import { getHermesWorkerDockPreview } from "@/components/brain-council/hermes-worker-dock"
import { StatusBadge } from "@/components/status-badge"

export function HermesWorkerDockPanel() {
  const dock = getHermesWorkerDockPreview()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Anchor className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {dock.eyebrow}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{dock.title}</h2>
          <StatusBadge value="neutral" label="preview-only" />
          <StatusBadge value="pass" label="no execution" />
          <StatusBadge value="pass" label="MCP disabled" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {dock.description}
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-border bg-background p-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Preview capabilities
          </h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
            {dock.capabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {dock.links.map((link) => (
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
      </div>

      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Hermes Worker Dock is preview-only. It cannot execute commands, start workers,
          dispatch jobs, deploy, grant authority, activate MCP, enable autonomy, or write production data.
        </p>
      </div>
    </section>
  )
}
