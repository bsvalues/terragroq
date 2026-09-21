"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { AppWindow, X } from "lucide-react"

import styles from "./create-application-dialog.module.css"

type CreatedApplicationPayload = Readonly<{
  application?: Readonly<{ projectKey?: unknown; manifest?: Readonly<{ id?: unknown }> }>
  error?: unknown
}>

function slugFor(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "")
}

function errorMessage(value: unknown, status: number): string {
  const code = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { error?: unknown }).error
    : null
  if (code === "APPLICATION_EXISTS" || status === 409) {
    return "An application with that ID already exists. Choose a different Application ID."
  }
  if (code === "APPLICATION_REQUEST_INVALID" || status === 400 || status === 413) {
    return "Use a name of 80 characters or fewer and an ID like my-application."
  }
  return "WilliamOS could not create the application. The destination was left unchanged."
}

export function CreateApplicationDialog({
  open,
  onClose,
  onCreated,
}: Readonly<{
  open: boolean
  onClose: () => void
  onCreated: (projectKey: string) => void
}>) {
  const [displayName, setDisplayName] = useState("")
  const [id, setId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose()
        return
      }
      if (event.key !== "Tab") return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>([
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        '[tabindex]:not([tabindex="-1"])',
      ].join(",")))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) {
        event.preventDefault()
        return
      }

      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [busy, onClose, open])

  if (!open) return null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const name = displayName.trim()
    const projectId = (id.trim() || slugFor(name)).toLowerCase()
    if (!name || name.length > 80 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(projectId) || projectId.length > 64) {
      setError("Use a name of 80 characters or fewer and an ID like my-application.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: projectId, displayName: name }),
      })
      let payload: CreatedApplicationPayload = {}
      try { payload = await response.json() as CreatedApplicationPayload } catch { /* mapped below */ }
      const createdKey = payload.application?.projectKey
      const manifestId = payload.application?.manifest?.id
      if (!response.ok || typeof createdKey !== "string" || createdKey !== projectId || manifestId !== projectId) {
        setError(errorMessage(payload, response.status))
        return
      }
      onCreated(createdKey)
    } catch {
      setError("WilliamOS could not reach the application service. No repository was created.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.backdrop} onPointerDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="create-application-title">
        <header className={styles.header}>
          <span className={styles.title}><AppWindow size={17} aria-hidden /><strong id="create-application-title">Create application</strong></span>
          <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Close Create application"><X size={16} aria-hidden /></button>
        </header>
        <div className={styles.introduction}>
          <p>WilliamOS creates a separate Git repository on HERMES. It does not write into WilliamOS or TerraFusion.</p>
          <p>The repository starts from the pinned <code>static-web-v1</code> starter with HTML, CSS, JavaScript, and its validation test.</p>
        </div>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <label htmlFor="create-application-name">Application name</label>
          <input
            id="create-application-name"
            autoFocus
            value={displayName}
            onChange={(event) => { setDisplayName(event.target.value); setError(null) }}
            maxLength={80}
            autoComplete="off"
            placeholder="Focus Board"
            disabled={busy}
          />
          <label htmlFor="create-application-id">Application ID <span>(optional)</span></label>
          <input
            id="create-application-id"
            value={id}
            onChange={(event) => { setId(event.target.value); setError(null) }}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            placeholder={slugFor(displayName) || "my-application"}
            aria-describedby="create-application-id-help"
            disabled={busy}
          />
          <p id="create-application-id-help" className={styles.help}>Lowercase letters, numbers, and single hyphens. Leave blank to derive it from the name.</p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <footer className={styles.actions}>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={styles.create} disabled={busy}>{busy ? "Creating application…" : "Create application"}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
