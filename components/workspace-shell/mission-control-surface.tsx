"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"

import type { MissionAgentSessionProjection } from "./agent-sessions"
import styles from "./mission-control-surface.module.css"

export type MissionControlWindowProjection = Readonly<{
  id: string
  title: string
  kind: "source" | "preview" | "terminal" | "diff" | "tests" | "evidence" | "agent" | "document" | "other"
  frame: Readonly<{ x: number; y: number; width: number; height: number }>
  minimized?: boolean
  active?: boolean
  detail?: string
}>

export type MissionControlAgentProjection = MissionAgentSessionProjection

export type MissionControlSpaceProjection = Readonly<{
  id: string
  name: string
  updatedAt?: string | null
  focus: string
  state: "live" | "saved" | "unavailable"
  truth: "live" | "fixture"
  windows: readonly MissionControlWindowProjection[]
  agents: readonly MissionControlAgentProjection[]
  agentActivityKnown?: boolean
  selectedObject?: string | null
  changed?: string | null
}>

export type MissionControlWilliamOverview = Readonly<{
  summary: string
  attention?: string | null
  attentionAction?: Readonly<{
    kind: "inspect-current-space-persistence"
    spaceId: string
    label: string
  }> | null
  truth: "live" | "fixture"
}>

export type MissionControlSurfaceProps = Readonly<{
  spaces: readonly MissionControlSpaceProjection[]
  currentSpaceId: string | null
  onEnterSpace: (spaceId: string) => void
  onDismiss: () => void
  williamOverview?: MissionControlWilliamOverview | null
  multiSpaceAvailable?: boolean
  onCreateSpace?: (name: string) => Promise<boolean | void>
  onRemoveSpace?: (spaceId: string) => Promise<boolean | void>
  transitionMessage?: string | null
  transitioning?: boolean
  collectionAvailable?: boolean
  collectionReason?: string | null
}>

const stateLabel: Record<MissionControlSpaceProjection["state"], string> = {
  live: "Live",
  saved: "Saved state",
  unavailable: "Runtime unavailable",
}

function projectionBounds(windows: readonly MissionControlWindowProjection[]) {
  const visible = windows.filter((window) => !window.minimized)
  return {
    width: Math.max(1, ...visible.map((window) => window.frame.x + window.frame.width)),
    height: Math.max(1, ...visible.map((window) => window.frame.y + window.frame.height)),
  }
}

function SpacePreview({
  space,
  current,
  onEnter,
  onRequestRemove,
  disabled,
}: {
  space: MissionControlSpaceProjection
  current: boolean
  onEnter: () => void
  onRequestRemove?: () => void
  disabled?: boolean
}) {
  const bounds = projectionBounds(space.windows)
  const visibleWindows = space.windows.filter((window) => !window.minimized)
  const minimizedWindows = space.windows.filter((window) => window.minimized)
  const agentTruthUnknown = space.agentActivityKnown === false
  const agentLabel = agentTruthUnknown
    ? space.agents.length > 0 ? "Agent activity partially known" : "Agent activity unknown"
    : `${space.agents.length} agent sessions`
  const visibleAgents = space.agents.slice(0, 3)
  const content = <>
      <span className={styles.spaceHeader}>
        <span className={styles.spaceIdentity}>
          <strong>{space.name}</strong>
          <span>{space.focus}</span>
        </span>
        <span className={styles.spaceTruth} data-truth={space.truth}>
          {space.truth === "fixture" ? "Fixture projection" : stateLabel[space.state]}
        </span>
      </span>

      <span className={styles.projection} aria-hidden="true">
        {visibleWindows.length === 0 ? (
          <span className={styles.emptyProjection}>No open work surfaces</span>
        ) : visibleWindows.map((window) => (
          <span
            key={window.id}
            className={styles.projectedWindow}
            data-kind={window.kind}
            data-active={Boolean(window.active)}
            style={{
              left: `${Math.max(0, window.frame.x / bounds.width) * 100}%`,
              top: `${Math.max(0, window.frame.y / bounds.height) * 100}%`,
              width: `${Math.max(10, window.frame.width / bounds.width * 100)}%`,
              height: `${Math.max(16, window.frame.height / bounds.height * 100)}%`,
            }}
          >
            <span className={styles.projectedBar}>{window.title}</span>
            <span className={styles.projectedBody}>{window.detail ?? window.kind}</span>
          </span>
        ))}
        {minimizedWindows.length > 0 ? (
          <span className={styles.minimized}>{minimizedWindows.map((window) => window.title).join(" · ")}</span>
        ) : null}
      </span>

      <span className={styles.spaceFooter}>
        <span className={styles.objectState}>
          {space.selectedObject ? `Selected · ${space.selectedObject}` : space.changed ?? "Place preserved"}
        </span>
        <span className={styles.agents} aria-label={agentLabel}>
          {visibleAgents.map((agent) => (
            <span key={agent.id} className={styles.agent} data-state={agent.state} title={`${agent.role} · ${agent.activity}`}>
              <i /> {agent.name} · {agent.activity}{agent.truth === "resume-unverified" ? <small className={styles.agentTruth}>Saved · resume unverified</small> : agent.truth === "persisted" ? <small className={styles.agentTruth}>Persisted assignment · runtime liveness unverified</small> : null}
            </span>
          ))}
          {agentTruthUnknown ? <span>Agent activity unknown</span> : space.agents.length === 0 ? <span>No active agents</span> : null}
          {space.agents.length > 3 ? <span className={styles.agentOverflow}>+{space.agents.length - 3} more</span> : null}
        </span>
      </span>
  </>

  return <div className={styles.spaceSlot}>
    <button type="button" className={styles.space} data-current={current} data-state={space.state} onClick={onEnter} disabled={disabled} aria-label={`Enter ${space.name}${current ? ", current Space" : ""}`}>{content}</button>
    {onRequestRemove ? (
      <button type="button" className={styles.removeSpace} disabled={disabled} onClick={onRequestRemove} aria-label={`Remove ${space.name} Space`}>
        Remove
      </button>
    ) : null}
  </div>
}

export function MissionControlSurface({
  spaces,
  currentSpaceId,
  onEnterSpace,
  onDismiss,
  williamOverview,
  multiSpaceAvailable = false,
  onCreateSpace,
  onRemoveSpace,
  transitionMessage,
  transitioning = false,
  collectionAvailable = true,
  collectionReason = null,
}: MissionControlSurfaceProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const removeDialogRef = useRef<HTMLElement>(null)
  const removeCancelRef = useRef<HTMLButtonElement>(null)
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [removeCandidateId, setRemoveCandidateId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const createFlightRef = useRef(false)
  const removeFlightRef = useRef(false)
  const spaceCount = spaces.length
  const currentLiveSpace = spaces.find((space) => (
    space.id === currentSpaceId && space.state === "live" && space.truth === "live"
  )) ?? null
  const proposedAttentionAction = williamOverview?.attentionAction
  const expectedAttentionLabel = currentLiveSpace ? `Inspect ${currentLiveSpace.name} persistence` : null
  const attentionAction = proposedAttentionAction?.kind === "inspect-current-space-persistence"
    && proposedAttentionAction.spaceId === currentSpaceId
    && proposedAttentionAction.spaceId === currentLiveSpace?.id
    && proposedAttentionAction.label === expectedAttentionLabel
    ? proposedAttentionAction
    : null
  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createFlightRef.current || !onCreateSpace) return
    const data = new FormData(event.currentTarget)
    const name = String(data.get("spaceName") ?? "").trim()
    if (!name) { setCreateError("Give the Space a name."); return }
    createFlightRef.current = true
    setSubmitting(true)
    setCreateError(null)
    try {
      const created = await onCreateSpace(name)
      if (created !== false) setCreating(false)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Space creation failed.")
    } finally {
      createFlightRef.current = false
      setSubmitting(false)
    }
  }
  const removeCandidate = spaces.find((space) => space.id === removeCandidateId) ?? null
  const confirmRemove = async () => {
    if (!removeCandidate || !onRemoveSpace || removeFlightRef.current || removeCandidate.id === currentSpaceId) return
    removeFlightRef.current = true
    setRemoving(true)
    setRemoveError(null)
    try {
      const removed = await onRemoveSpace(removeCandidate.id)
      if (removed !== false) setRemoveCandidateId(null)
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Space removal failed.")
    } finally {
      removeFlightRef.current = false
      setRemoving(false)
    }
  }
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = removeDialogRef.current ?? dialogRef.current
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
    if (removeCandidateId && removing) removeDialogRef.current?.focus()
    else if (removeCandidateId) removeCancelRef.current?.focus()
    else focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && removeCandidateId && !removing) {
        event.preventDefault()
        setRemoveCandidateId(null)
        setRemoveError(null)
      } else if (event.key === "Escape" && !transitioning && !removeCandidateId) {
        event.preventDefault()
        onDismiss()
      } else if (event.key === "Tab") {
        const items = focusable()
        if (items.length === 0) {
          if (removeCandidateId) {
            event.preventDefault()
            removeDialogRef.current?.focus()
          }
          return
        }
        const first = items[0]
        const last = items.at(-1)!
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => { window.removeEventListener("keydown", onKeyDown); previous?.focus() }
  }, [onDismiss, removeCandidateId, removing, transitioning])

  return (
    <section ref={dialogRef} className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="mission-control-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Spatial overview</span>
          <h1 id="mission-control-title">Mission Control</h1>
        </div>
        <span className={styles.headerActions}>
          <span className={styles.spaceCount}>{spaceCount} {spaceCount === 1 ? "Space" : "Spaces"}</span>
          <button type="button" className={styles.newSpace} disabled={!multiSpaceAvailable || !onCreateSpace || submitting || Boolean(removeCandidate)} onClick={() => setCreating(true)}>New Space</button>
        </span>
        <button type="button" className={styles.dismiss} disabled={transitioning || Boolean(removeCandidate)} onClick={onDismiss} aria-label="Dismiss Mission Control">
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {creating ? (
        <form className={styles.createSpace} onSubmit={submitCreate}>
          <label htmlFor="mission-space-name">Space name</label>
          <input id="mission-space-name" name="spaceName" maxLength={80} autoFocus disabled={submitting} />
          <button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create Space"}</button>
          <button type="button" disabled={submitting} onClick={() => setCreating(false)}>Cancel</button>
          {createError ? <span role="alert">{createError}</span> : null}
        </form>
      ) : null}

      {removeCandidate ? (
        <section ref={removeDialogRef} tabIndex={-1} className={styles.removeConfirm} role="alertdialog" aria-modal="true" aria-labelledby="mission-remove-title">
          <strong id="mission-remove-title">Remove {removeCandidate.name}?</strong>
          <span>This removes its saved layout and conversation context. The current Space stays open.</span>
          <button type="button" disabled={removing} onClick={() => void confirmRemove()}>{removing ? "Removing…" : "Remove Space"}</button>
          <button ref={removeCancelRef} type="button" disabled={removing} onClick={() => { setRemoveCandidateId(null); setRemoveError(null) }}>Cancel</button>
          {removeError ? <span role="alert">{removeError}</span> : null}
        </section>
      ) : null}

      {!multiSpaceAvailable ? <p className={styles.degraded}>New Space is unavailable because server persistence is unavailable. This browser-local Space remains usable.</p> : null}
      {!collectionAvailable ? <p className={styles.degraded} role="status">Space collection is temporarily unavailable. Known Spaces remain enterable. {collectionReason}</p> : null}
      {transitionMessage ? <p className={styles.transition} role="status">{transitionMessage}</p> : null}

      <main className={styles.spaceField}>
        {spaces.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>No Spaces to re-enter.</strong>
            <span>Open work will appear here as a spatial projection.</span>
          </div>
        ) : spaces.map((space) => (
          <SpacePreview
            key={space.id}
            space={space}
            current={space.id === currentSpaceId}
            onEnter={() => onEnterSpace(space.id)}
            onRequestRemove={multiSpaceAvailable && onRemoveSpace && spaces.length > 1 && space.id !== currentSpaceId
              ? () => { setCreating(false); setRemoveCandidateId(space.id); setRemoveError(null) }
              : undefined}
            disabled={transitioning || removing || Boolean(removeCandidate)}
          />
        ))}
      </main>

      <footer className={styles.william}>
        <span className={styles.williamMark} aria-hidden="true">W</span>
        <span className={styles.williamCopy}>
          <strong>William</strong>
          {williamOverview ? (
            <>
              <span>{williamOverview.summary}</span>
              {williamOverview.attention ? <small>{williamOverview.attention}</small> : null}
            </>
          ) : <span>No ambient overview is available.</span>}
        </span>
        {attentionAction ? (
          <button
            type="button"
            className={styles.attentionAction}
            disabled={transitioning || Boolean(removeCandidate)}
            onClick={() => onEnterSpace(attentionAction.spaceId)}
          >
            {attentionAction.label}
          </button>
        ) : null}
        <span className={styles.hint}>Select a Space to return to its exact working context · Esc to close</span>
      </footer>
    </section>
  )
}
