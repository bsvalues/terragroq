"use client"

import styles from "./workspace-shell.module.css"
import { validateWilliamJudgment } from "@/lib/environment/working-world"
import { HermesOperationalSurface } from "@/components/hermes/hermes-operational-surface"
import { EXECUTION_ASSIGNMENT_INSPECTOR_KIND, parseExecutionAssignmentInspectorPayload } from "./execution-assignment-inspector"
import { parsePreviewInspectorPayload } from "./types"
import type { AgentSessionDiffReview } from "./agent-sessions"

export type InspectorSurface = Readonly<{
  id: string
  kind: string
  subject: string
  identity?: string
  payload?: unknown
}>

type DiffReviewInspectorPayload = Readonly<{
  schemaVersion: 1
  kind: "diff-review"
  binding: AgentSessionDiffReview
  report: string
}>

const MAX_PERSISTED_REVIEW_PAYLOAD_BYTES = 200_000
const DIFF_REVIEW_TRUNCATION_NOTICE = "\n\n[Report truncated in Inspector; full result remains in the durable Reviewer transcript.]"
const textEncoder = new TextEncoder()

function serializedDiffReviewPayload(binding: AgentSessionDiffReview, report: string): string {
  return JSON.stringify({ schemaVersion: 1, kind: "diff-review", binding, report } satisfies DiffReviewInspectorPayload)
}

export function encodeDiffReviewInspectorPayload(binding: AgentSessionDiffReview, report: string): string {
  const complete = serializedDiffReviewPayload(binding, report)
  if (textEncoder.encode(complete).byteLength <= MAX_PERSISTED_REVIEW_PAYLOAD_BYTES) return complete

  const codePoints = Array.from(report)
  let lower = 0
  let upper = codePoints.length
  let accepted = serializedDiffReviewPayload(binding, DIFF_REVIEW_TRUNCATION_NOTICE)
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2)
    const candidate = serializedDiffReviewPayload(binding, `${codePoints.slice(0, middle).join("")}${DIFF_REVIEW_TRUNCATION_NOTICE}`)
    if (textEncoder.encode(candidate).byteLength <= MAX_PERSISTED_REVIEW_PAYLOAD_BYTES) {
      accepted = candidate
      lower = middle + 1
    } else {
      upper = middle - 1
    }
  }
  return accepted
}

function parseDiffReviewInspectorPayload(value: unknown): DiffReviewInspectorPayload | null {
  if (typeof value !== "string" || value.length > MAX_PERSISTED_REVIEW_PAYLOAD_BYTES
    || textEncoder.encode(value).byteLength > MAX_PERSISTED_REVIEW_PAYLOAD_BYTES) return null
  let decoded: unknown
  try { decoded = JSON.parse(value) } catch { return null }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null
  const candidate = decoded as Record<string, unknown>
  const binding = candidate.binding
  if (candidate.schemaVersion !== 1 || candidate.kind !== "diff-review" || typeof candidate.report !== "string"
    || candidate.report.length === 0 || candidate.report.length > MAX_PERSISTED_REVIEW_PAYLOAD_BYTES
    || !binding || typeof binding !== "object" || Array.isArray(binding)) return null
  const exact = binding as Record<string, unknown>
  const canonicalPath = typeof exact.path === "string" && exact.path === exact.path.trim() && exact.path.length <= 1_000
    && !/[\\\u0000-\u001f\u007f]/.test(exact.path) && !exact.path.startsWith("/") && !/^[A-Za-z]:/.test(exact.path)
    && exact.path.split("/").every((part) => part && part !== "." && part !== "..")
  const completedAt = typeof exact.completedAt === "string" && exact.completedAt.length <= 40
    && Number.isFinite(Date.parse(exact.completedAt)) && new Date(exact.completedAt).toISOString() === exact.completedAt
  if (Object.keys(exact).length !== 7 || typeof exact.worldId !== "string" || !exact.worldId.trim() || exact.worldId.length > 200
    || !canonicalPath || typeof exact.fingerprint !== "string" || !exact.fingerprint.trim() || exact.fingerprint.length > 16_384
    || new TextEncoder().encode(exact.fingerprint).byteLength > 16_384
    || typeof exact.baseHash !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(exact.baseHash)
    || typeof exact.indexHash !== "string" || !/^[0-9a-f]{64}$/.test(exact.indexHash)
    || typeof exact.patchHash !== "string" || !/^[0-9a-f]{64}$/.test(exact.patchHash) || !completedAt) return null
  return candidate as DiffReviewInspectorPayload
}

export function diffReviewInspectorIdentity(binding: Pick<AgentSessionDiffReview, "worldId" | "fingerprint">): string {
  return JSON.stringify([binding.worldId, binding.fingerprint])
}

function identityToken(value: string): string {
  return [2166136261, 2246822507, 3266489909, 668265263].map((seed) => {
    let hash = seed
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
  }).join("")
}

export function diffReviewInspectorId(binding: Pick<AgentSessionDiffReview, "worldId" | "fingerprint">): string {
  return `inspector-diff-review:${identityToken(diffReviewInspectorIdentity(binding))}`
}

export function diffReviewInspectorBinding(value: unknown): AgentSessionDiffReview | null {
  return parseDiffReviewInspectorPayload(value)?.binding ?? null
}

export function inspectorSurfaceWindowTitle(surface: InspectorSurface): string {
  if (surface.kind === "hermes") return "HERMES · Appliance"
  const assignment = surface.kind === EXECUTION_ASSIGNMENT_INSPECTOR_KIND
    ? parseExecutionAssignmentInspectorPayload(surface.payload) : null
  if (assignment) return `Assignment · Work Order #${assignment.workOrderId}`
  return surface.kind === "review" && parseDiffReviewInspectorPayload(surface.payload)
    ? `Inspector · Current changes · ${surface.subject}`
    : `Inspector · ${surface.subject}`
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function List({ children }: { children: React.ReactNode }) {
  return <div className={styles.inspectorList}>{children}</div>
}

function formatEventTime(at: string): string {
  const parsed = new Date(at)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toISOString().slice(5, 16).replace("T", " ")
}

function Rows({ payload }: { payload: unknown }) {
  const rows = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? [payload] : []
  if (rows.length === 0) return <div className={styles.inspectorEmpty}>No records.</div>
  return (
    <div className={styles.inspectorRows}>
      {rows.map((row, index) => {
        if (!row || typeof row !== "object") return <div key={index}>{display(row)}</div>
        return (
          <dl key={index}>
            {Object.entries(row as Record<string, unknown>).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll(/([a-z])([A-Z])/g, "$1 $2")}</dt>
                <dd>{display(value)}</dd>
              </div>
            ))}
          </dl>
        )
      })}
    </div>
  )
}

function WorldWorkerAssignmentInspector({ payload }: { payload: unknown }) {
  const snapshot = parseExecutionAssignmentInspectorPayload(payload)
  if (!snapshot) return (
    <div className={styles.inspectorEmpty} role="status">
      Persisted execution assignment snapshot unavailable.
    </div>
  )
  return (
    <article className={styles.inspectorRows} aria-label="Persisted execution assignment">
      <h2>{snapshot.role} · {snapshot.providerLabel}</h2>
      <p><strong>Persisted assignment · runtime liveness unverified</strong></p>
      <p>{snapshot.assignment}</p>
      <dl>
        <div><dt>Space</dt><dd>{snapshot.worldId}</dd></div>
        <div><dt>Outcome</dt><dd>{snapshot.outcomeKey} · {snapshot.outcomeTitle}</dd></div>
        <div><dt>Work Order</dt><dd>#{snapshot.workOrderId}</dd></div>
        <div><dt>Status</dt><dd>{snapshot.status}</dd></div>
        <div><dt>Executor</dt><dd>{snapshot.assignee}</dd></div>
        <div><dt>Agent</dt><dd>{snapshot.agent ?? "—"}</dd></div>
        <div><dt>Observed</dt><dd>{snapshot.observedAt}</dd></div>
      </dl>
      <h3>Latest persisted evidence · up to 50 records</h3>
      {snapshot.evidence.length > 0 ? snapshot.evidence.map((evidence, index) => (
        <dl key={`${evidence.at}:${evidence.kind}:${index}`}>
          <div><dt>Kind</dt><dd>{evidence.kind}</dd></div>
          <div><dt>Detail</dt><dd>{evidence.detail || "No detail recorded"}</dd></div>
          <div><dt>Result</dt><dd>{evidence.result || "—"}</dd></div>
          <div><dt>Recorded</dt><dd>{evidence.at}</dd></div>
        </dl>
      )) : <p>No persisted execution evidence yet.</p>}
    </article>
  )
}

export function InspectorSurfaceView({ surface, onRefresh }: { surface: InspectorSurface; onRefresh?: () => void }) {
  if (surface.kind === "hermes") return <HermesOperationalSurface />
  if (surface.kind === EXECUTION_ASSIGNMENT_INSPECTOR_KIND) return <WorldWorkerAssignmentInspector payload={surface.payload} />
  if (surface.kind === "william-judgment") {
    try {
      const snapshot = validateWilliamJudgment(surface.payload)
      return (
        <article className={styles.inspectorRows} aria-label="William judgment basis snapshot">
          <h2>William judgment · basis</h2>
          <p><strong>Snapshot generated then · not current live truth</strong></p>
          <dl>
            <div><dt>Recommendation</dt><dd>{snapshot.recommendation}</dd></div>
            <div><dt>Rationale</dt><dd>{snapshot.rationale}</dd></div>
            <div><dt>Confidence</dt><dd>{String(snapshot.confidence)}</dd></div>
            <div><dt>Confidence percentage</dt><dd>{Math.round(snapshot.confidence * 10_000) / 100}%</dd></div>
            <div><dt>Generated at</dt><dd>{snapshot.generatedAt}</dd></div>
            <div><dt>Provider</dt><dd>{snapshot.provenance.provider}</dd></div>
            <div><dt>Model</dt><dd>{snapshot.provenance.model}</dd></div>
            <div><dt>Basis fingerprint</dt><dd>{snapshot.basisFingerprint}</dd></div>
          </dl>
          <h3>Recorded basis</h3>
          {snapshot.basis.map((item) => (
            <dl key={item.key}>
              <div><dt>{item.label}</dt><dd>{item.value}</dd></div>
            </dl>
          ))}
        </article>
      )
    } catch {
      return <div className={styles.inspectorEmpty}>William judgment basis snapshot unavailable.</div>
    }
  }
  if (surface.kind === "preview-evidence") {
    const payload = parsePreviewInspectorPayload(surface.payload)
    if (!payload) return <div className={styles.inspectorEmpty}>Preview evidence snapshot unavailable.</div>
    const { evidence } = payload
    return (
      <article className={styles.inspectorRows}>
        <h2>Preview evidence · {surface.subject}</h2>
        <p><strong>{payload.snapshot === "saved" ? "Saved snapshot" : "Live check"}</strong></p>
        <dl>
          <div><dt>Status</dt><dd>{evidence.status}</dd></div>
          <div><dt>Reason</dt><dd>{evidence.reason ?? "—"}</dd></div>
          <div><dt>Configured URL</dt><dd>{evidence.configuredUrl ?? "—"}</dd></div>
          <div><dt>Admitted URL</dt><dd>{evidence.admittedUrl ?? "—"}</dd></div>
          <div><dt>Origin</dt><dd>{evidence.origin ?? "—"}</dd></div>
          <div><dt>Identity</dt><dd>{evidence.identity}</dd></div>
          <div><dt>Reachable</dt><dd>{String(evidence.reachable)}</dd></div>
          <div><dt>Frameable</dt><dd>{String(evidence.frameable)}</dd></div>
          <div><dt>Checked</dt><dd>{evidence.checkedAt}</dd></div>
        </dl>
        <p>DOM unavailable · console unavailable · network unavailable</p>
        {onRefresh ? <button type="button" aria-label="Refresh Preview evidence" onClick={onRefresh}>Refresh evidence</button> : null}
      </article>
    )
  }
  if (surface.kind === "review") {
    const diffReview = parseDiffReviewInspectorPayload(surface.payload)
    if (diffReview) return (
      <article className={styles.inspectorCode} aria-label="Current changes review report">
        <h2>Current changes · {surface.subject}</h2>
        <dl>
          <div><dt>Reviewed fingerprint</dt><dd>{diffReview.binding.fingerprint}</dd></div>
          <div><dt>Base</dt><dd>{diffReview.binding.baseHash}</dd></div>
          <div><dt>Index</dt><dd>{diffReview.binding.indexHash}</dd></div>
          <div><dt>Patch</dt><dd>{diffReview.binding.patchHash}</dd></div>
          <div><dt>Completed</dt><dd>{diffReview.binding.completedAt}</dd></div>
        </dl>
        <pre>{diffReview.report}</pre>
      </article>
    )
    return (
      <article className={styles.inspectorCode}>
        <h2>Review report · {surface.subject}</h2>
        <pre>{display(surface.payload)}</pre>
      </article>
    )
  }
  if (surface.kind === "browser") {
    return (
      <iframe
        src={`/api/environment/view${surface.subject}`}
        title={surface.subject}
        sandbox=""
        className={styles.inspectorBrowser}
      />
    )
  }

  if (surface.kind === "diff") {
    return (
      <pre className={styles.inspectorCode}>
        {String(surface.payload ?? "").split("\n").map((line, index) => (
          <span
            key={index}
            className={line.startsWith("+") && !line.startsWith("+++") ? styles.diffAdd
              : line.startsWith("-") && !line.startsWith("---") ? styles.diffRemove
                : line.startsWith("@@") ? styles.diffRange : ""}
          >
            {line || " "}{"\n"}
          </span>
        ))}
      </pre>
    )
  }

  if (surface.kind === "trace") {
    const rows = (surface.payload ?? []) as readonly {
      url: string; status?: number; location?: string; setsSessionCookie?: boolean; error?: string
    }[]
    return (
      <List>{rows.map((step, index) => (
        <div key={index} className={styles.inspectorRow}>
          <span>{step.url}</span>
          {step.error ? <strong data-tone="fault">{step.error}</strong> : <strong data-tone={step.status && step.status >= 400 ? "fault" : "pass"}>{step.status}</strong>}
          {step.location ? <span>→ {step.location}</span> : null}
          {step.setsSessionCookie ? <span>· cookie</span> : null}
        </div>
      ))}</List>
    )
  }

  if (surface.kind === "project") {
    const rows = (surface.payload ?? []) as readonly { name: string; key: string; lifecycle: string }[]
    return rows.length === 0 ? <div className={styles.inspectorEmpty}>No projects are registered.</div> : (
      <List>{rows.map((row) => <div key={row.key} className={styles.inspectorRow}><strong>{row.name}</strong><span>{row.lifecycle}</span></div>)}</List>
    )
  }

  if (surface.kind === "work-orders") {
    const rows = (surface.payload ?? []) as readonly {
      ref: string | null; title: string; status: string; agent: string | null; phase: string | null
    }[]
    return rows.length === 0 ? <div className={styles.inspectorEmpty}>No work orders exist yet.</div> : (
      <List>{rows.map((row, index) => (
        <div key={row.ref ?? index} className={styles.inspectorRow}>
          <span>{row.ref ?? "—"}</span><strong data-tone={row.status}>{row.status}</strong><span>{row.title}</span>
          {row.agent || row.phase ? <span>{[row.agent, row.phase].filter(Boolean).join(" · ")}</span> : null}
        </div>
      ))}</List>
    )
  }

  if (surface.kind === "activity") {
    const rows = (surface.payload ?? []) as readonly {
      at: string; kind: string; label: string; detail: string | null; ref: string | null
    }[]
    return rows.length === 0 ? <div className={styles.inspectorEmpty}>No governed activity recorded.</div> : (
      <List>{rows.map((row, index) => (
        <div key={`${row.at}-${index}`} className={styles.inspectorRow}>
          <span>{formatEventTime(row.at)}</span><strong data-tone={row.kind}>{row.kind}</strong><span>{row.label}</span>
          {row.detail ? <span>{row.detail}</span> : null}{row.ref ? <span className={styles.rowRef}>{row.ref}</span> : null}
        </div>
      ))}</List>
    )
  }

  if (surface.kind === "queue") {
    const rows = (surface.payload ?? []) as readonly {
      outcomeKey: string; title: string; lifecycleState: string; queueOrder: number; activeWorkOrderId: number | null
    }[]
    return rows.length === 0 ? <div className={styles.inspectorEmpty}>The governed queue is empty.</div> : (
      <List>{rows.map((row) => <div key={row.outcomeKey} className={styles.inspectorRow}><span>{row.queueOrder}</span><strong data-tone={row.lifecycleState}>{row.lifecycleState}</strong><span>{row.title}</span></div>)}</List>
    )
  }

  if (surface.kind === "runtime-trace") {
    const rows = (surface.payload ?? []) as readonly {
      workOrderRef: string; title: string; status: string; result: string | null; lane: string | null
      attempts: number; lease: string; checkpoint: string | null
    }[]
    return rows.length === 0 ? <div className={styles.inspectorEmpty}>No runtime executions recorded.</div> : (
      <List>{rows.map((row) => (
        <div key={row.workOrderRef} className={styles.inspectorRow}>
          <span>{row.workOrderRef}</span><strong data-tone={row.result ?? row.status}>{row.result ?? row.status}</strong>
          <span>{row.title}</span><span>{row.attempts}x{row.checkpoint ? ` · ${row.checkpoint}` : ""}{row.lane ? ` · ${row.lane}` : ""}</span>
        </div>
      ))}</List>
    )
  }

  if (surface.kind === "decisions") {
    const rows = (surface.payload ?? []) as readonly {
      ref: string | null; title: string; decision: string; status: string; authority: string; supersededById: number | null
    }[]
    return rows.length === 0 ? <div className={styles.inspectorEmpty}>The decision register is empty.</div> : (
      <List>{rows.map((row, index) => (
        <div key={row.ref ?? index} className={styles.inspectorRow} data-superseded={Boolean(row.supersededById)}>
          <span>{row.ref ?? "—"}</span><strong data-tone={row.decision}>{row.decision}</strong>
          <strong data-tone={row.status}>{row.status}</strong><span>{row.title}</span>
          {row.supersededById ? <span>superseded</span> : null}
        </div>
      ))}</List>
    )
  }

  if (surface.kind === "evidence") {
    const rows = (surface.payload ?? []) as readonly { result: string | null; notes: string | null; at: string }[]
    return rows.length === 0 ? <div className={styles.inspectorEmpty}>No evidence records.</div> : (
      <List>{rows.map((row, index) => <div key={index} className={styles.inspectorRow}><strong data-tone={row.result ?? ""}>{row.result ?? "—"}</strong><span>{row.notes ?? ""}</span></div>)}</List>
    )
  }

  if (surface.kind === "source" || surface.kind === "tests") {
    return <pre className={styles.inspectorCode}>{display(surface.payload)}</pre>
  }

  // Non-summonable future records still remain readable; every SUMMONED_SURFACES kind above has an
  // explicit branch so adding a route address can never quietly fall through to object coercion.
  return <Rows payload={surface.payload} />
}
