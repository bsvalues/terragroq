import { Laptop, ShieldCheck } from "lucide-react"
import { getLocalOperatorSurface } from "@/components/local/local-operator-surface"

export function LocalOperatorPanel() {
  const surface = getLocalOperatorSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Laptop className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {surface.eyebrow}
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.description}
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
        {surface.posture.map((item) => (
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

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2">
        {surface.runtimeStatus.map((item) => (
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

      <div className="border-b border-border p-4">
        <div className="mb-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Manual Command Reference
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Commands are operator-run in PowerShell. WilliamOS displays these commands; it does not execute them.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {surface.commandReference.map((item) => (
            <div key={item.label} className="rounded-lg border border-border bg-background p-3">
              <p className="text-sm font-semibold">{item.label}</p>
              <code className="mt-2 block rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground">
                {item.command}
              </code>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-border bg-muted/10 p-4">
        <div className="mb-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Safety Warnings
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            These boundaries keep the OMEN proof manual, local, and reversible.
          </p>
        </div>
        <ul className="grid gap-2 md:grid-cols-2">
          {surface.safetyWarnings.map((warning) => (
            <li
              key={warning}
              className="rounded-lg border border-border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground"
            >
              {warning}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-b border-border p-4">
        <div className="mb-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Backup Posture
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Backup status is guidance only. WilliamOS does not create backups, schedules, or cloud sync from this surface.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {surface.backupGuidance.map((item) => (
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
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Secret exclusion: do not commit or display env files, database URLs, Better Auth secrets,
          access grant secrets, or secret-bearing logs.
        </p>
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden={true} />
          Read-only guidance. No local command execution, shell endpoint, container mutation,
          service registration, schedule, LAN exposure, secret disclosure, or autonomy.
        </div>
      </div>
    </section>
  )
}
