import type { EnvironmentSurfaceDto, EnvironmentWorldDto } from "@/lib/environment/api-contract"

type RecordValue = Readonly<Record<string, unknown>>

const STATUS_TONE: Record<EnvironmentSurfaceDto["status"], string> = {
  ready: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  running: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  passed: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  failed: "border-red-300/30 bg-red-300/10 text-red-100",
  waiting: "border-white/10 bg-white/[0.04] text-neutral-300",
  unavailable: "border-white/10 bg-white/[0.025] text-neutral-500",
}

export function EnvironmentSurface({
  surface,
  endpoints,
  execution,
}: {
  surface: EnvironmentSurfaceDto
  endpoints: EnvironmentWorldDto["endpoints"]
  execution: EnvironmentWorldDto["execution"]
}) {
  const endpoint = endpoints.find((candidate) => candidate.id === surface.endpointId)
  const observedAt = surface.provenance.observedAt
  const label = surface.title?.trim() || surface.subject

  return (
    <article
      className="flex min-h-[15rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d1016] shadow-[0_30px_80px_-50px_rgba(56,189,248,0.35)]"
      aria-label={label}
      data-surface-kind={surface.kind}
      data-surface-status={surface.status}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">{label}</h2>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${STATUS_TONE[surface.status]}`}>
          {surface.status}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        {surface.kind === "browser" ? (
          <BrowserSurface surface={surface} endpoint={endpoint} />
        ) : surface.kind === "editor" || surface.kind === "diff" ? (
          <CodeSurface surface={surface} />
        ) : surface.kind === "tests" ? (
          <TestsSurface surface={surface} execution={execution} />
        ) : surface.kind === "terminal" || surface.kind === "trace" ? (
          <StreamSurface surface={surface} />
        ) : surface.kind === "compare" ? (
          <CompareSurface surface={surface} />
        ) : surface.kind === "conflict" ? (
          <ConflictSurface surface={surface} />
        ) : (
          <TextSurface surface={surface} />
        )}
      </div>

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.07] px-4 py-2 text-[10px] tracking-wide text-neutral-500">
        <span>{provenanceLabel(surface.provenance.source)}</span>
        {surface.provenance.artifactRef ? <span>Artifact {surface.provenance.artifactRef}</span> : null}
        {surface.provenance.evidenceRef ? <span>Evidence {surface.provenance.evidenceRef}</span> : null}
        {observedAt ? <time dateTime={observedAt}>Observed {formatInstant(observedAt)}</time> : null}
      </footer>
    </article>
  )
}

function BrowserSurface({
  surface,
  endpoint,
}: {
  surface: EnvironmentSurfaceDto
  endpoint: EnvironmentWorldDto["endpoints"][number] | undefined
}) {
  const admitted =
    surface.status === "ready" &&
    endpoint?.provenance.liveness.status === "reachable" &&
    Boolean(endpoint.provenance.liveness.sourceEvidenceRef)

  if (!admitted) return <Waiting message="Waiting for an admitted, reachable preview." subject={surface.subject} />

  return (
    <iframe
      className="h-full min-h-[24rem] w-full bg-white"
      src={endpoint.appUrl}
      title={surface.title?.trim() || `Running application at ${surface.subject}`}
      sandbox="allow-forms allow-modals allow-popups allow-scripts"
      referrerPolicy="no-referrer"
    />
  )
}

function CodeSurface({ surface }: { surface: EnvironmentSurfaceDto }) {
  const record = asRecord(surface.content)
  const text = readText(record, ["text", "diff", "content", "patch"])
  if (!text) return <Waiting message="The bound artifact has no readable content yet." subject={surface.subject} />
  const lines = text.split("\n")
  return (
    <pre className="h-full min-h-[18rem] overflow-auto p-4 text-xs leading-6 text-neutral-300" tabIndex={0}>
      <code>
        {lines.map((line, index) => (
          <span
            className={`block ${
              surface.kind === "diff" && line.startsWith("+")
                ? "bg-emerald-400/10 text-emerald-100"
                : surface.kind === "diff" && line.startsWith("-")
                  ? "bg-red-400/10 text-red-100"
                  : ""
            }`}
            key={`${index}:${line}`}
          >
            {line || " "}
          </span>
        ))}
      </code>
    </pre>
  )
}

function TestsSurface({
  surface,
  execution,
}: {
  surface: EnvironmentSurfaceDto
  execution: EnvironmentWorldDto["execution"]
}) {
  const record = asRecord(surface.content)
  const rows = readRows(record, ["cases", "tests", "results"])
  const summary = readText(record, ["summary", "output"])
  const evidenceBacked =
    surface.provenance.source === "execution_evidence" &&
    execution.state !== "not_started" &&
    execution.evidenceRefs.length > 0 &&
    Boolean(surface.provenance.evidenceRef)

  if (!evidenceBacked) {
    return <Waiting message="No test run has been observed for this endpoint." subject={surface.subject} />
  }

  return (
    <div className="space-y-4 p-4 text-sm text-neutral-300">
      {summary ? <p className="leading-6">{summary}</p> : null}
      {evidenceBacked ? (
        <p className={execution.state === "observed_succeeded" ? "text-emerald-200" : "text-red-200"}>
          {execution.summary}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="space-y-2" aria-label="Observed test results">
          {rows.map((row, index) => (
            <li className="flex items-start justify-between gap-4 rounded-lg bg-white/[0.035] px-3 py-2" key={`${row.label}:${index}`}>
              <span>{row.label}</span>
              <span className={row.state === "passed" ? "text-emerald-200" : row.state === "failed" ? "text-red-200" : "text-neutral-400"}>
                {row.state}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function StreamSurface({ surface }: { surface: EnvironmentSurfaceDto }) {
  const record = asRecord(surface.content)
  const lines = readLines(record)
  if (lines.length === 0) return <Waiting message="Waiting for bound stream evidence." subject={surface.subject} />
  return (
    <ol className="h-full min-h-[18rem] overflow-auto p-4 font-mono text-xs leading-6 text-neutral-300" aria-label={`${surface.kind} events`}>
      {lines.map((line, index) => (
        <li className="border-l border-white/10 pl-3" key={`${index}:${line}`}>{line}</li>
      ))}
    </ol>
  )
}

function CompareSurface({ surface }: { surface: EnvironmentSurfaceDto }) {
  const record = asRecord(surface.content)
  const left = readText(record, ["left", "before"])
  const right = readText(record, ["right", "after"])
  const summary = readText(record, ["summary"])
  if (!left && !right && !summary) return <Waiting message="Waiting for comparison evidence from two isolated applications." subject={surface.subject} />
  return (
    <div className="grid gap-px bg-white/10 sm:grid-cols-2">
      <div className="bg-[#0d1016] p-4"><p className="text-xs text-neutral-500">Left</p><p className="mt-2 text-sm text-neutral-200">{left ?? "No observed value"}</p></div>
      <div className="bg-[#0d1016] p-4"><p className="text-xs text-neutral-500">Right</p><p className="mt-2 text-sm text-neutral-200">{right ?? "No observed value"}</p></div>
      {summary ? <p className="bg-[#0d1016] p-4 text-sm leading-6 text-neutral-300 sm:col-span-2">{summary}</p> : null}
    </div>
  )
}

function ConflictSurface({ surface }: { surface: EnvironmentSurfaceDto }) {
  const record = asRecord(surface.content)
  const conflicts = readStringArray(record, ["conflicts", "paths", "items"])
  const summary = readText(record, ["summary", "message"])
  if (conflicts.length === 0 && !summary) return <Waiting message="No conflict evidence is bound to this comparison." subject={surface.subject} />
  return (
    <div className="space-y-3 p-4 text-sm text-neutral-300">
      {summary ? <p className="leading-6">{summary}</p> : null}
      {conflicts.length > 0 ? (
        <ul className="space-y-2" aria-label="Observed conflicts">
          {conflicts.map((conflict) => <li className="rounded-lg border border-amber-200/15 bg-amber-300/[0.06] px-3 py-2 text-amber-50" key={conflict}>{conflict}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

function TextSurface({ surface }: { surface: EnvironmentSurfaceDto }) {
  const record = asRecord(surface.content)
  const text = readText(record, ["text", "summary", "content", "message"])
  return text ? <p className="whitespace-pre-wrap p-4 text-sm leading-6 text-neutral-300">{text}</p> : <Waiting message="This bound surface has no readable content yet." subject={surface.subject} />
}

function Waiting({ message, subject }: { message: string; subject: string }) {
  return (
    <div className="flex h-full min-h-[15rem] flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm text-neutral-400">{message}</p>
      <p className="max-w-full truncate font-mono text-[11px] text-neutral-600">{subject}</p>
    </div>
  )
}

function asRecord(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {}
}

function readText(record: RecordValue, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return null
}

function readStringArray(record: RecordValue, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
  }
  return []
}

function readLines(record: RecordValue): string[] {
  const direct = readStringArray(record, ["lines", "events", "entries"])
  if (direct.length > 0) return direct
  const text = readText(record, ["text", "output", "trace"])
  return text ? text.split("\n") : []
}

function readRows(record: RecordValue, keys: readonly string[]): ReadonlyArray<{ label: string; state: string }> {
  for (const key of keys) {
    const value = record[key]
    if (!Array.isArray(value)) continue
    return value.flatMap((item) => {
      if (typeof item === "string") return [{ label: item, state: "observed" }]
      const row = asRecord(item)
      const label = readText(row, ["label", "name", "title"])
      const state = readText(row, ["state", "status", "result"])
      return label ? [{ label, state: state ?? "observed" }] : []
    })
  }
  return []
}

function formatInstant(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

function provenanceLabel(source: string): string {
  switch (source) {
    case "execution_evidence": return "Observed during the run"
    case "runtime_registry": return "Live working copy"
    case "execution_receipt": return "Verified working copy"
    case "comparison_evidence": return "Observed comparison"
    default: return "Source unavailable"
  }
}
