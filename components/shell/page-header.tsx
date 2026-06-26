export function PageHeader({
  title,
  description,
  meta,
  action,
}: {
  title: string
  description?: string
  meta?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-6">
      <div>
        {meta && (
          <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{meta}</p>
        )}
        <h1 className="text-balance text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-pretty text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
