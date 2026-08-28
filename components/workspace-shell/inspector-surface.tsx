"use client"

import styles from "./workspace-shell.module.css"

export type InspectorSurface = Readonly<{
  id: string
  kind: string
  subject: string
  payload?: unknown
}>

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

export function InspectorSurfaceView({ surface }: { surface: InspectorSurface }) {
  if (surface.kind === "review") {
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
