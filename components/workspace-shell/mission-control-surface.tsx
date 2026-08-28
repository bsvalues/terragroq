"use client"

import { useEffect, useRef } from "react"

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

export type MissionControlAgentProjection = Readonly<{
  id: string
  name: string
  role: string
  activity: string
  state: "working" | "waiting" | "blocked" | "idle"
}>

export type MissionControlSpaceProjection = Readonly<{
  id: string
  name: string
  focus: string
  state: "live" | "paused" | "unavailable"
  truth: "live" | "fixture"
  windows: readonly MissionControlWindowProjection[]
  agents: readonly MissionControlAgentProjection[]
  selectedObject?: string | null
  changed?: string | null
}>

export type MissionControlWilliamOverview = Readonly<{
  summary: string
  attention?: string | null
  truth: "live" | "fixture"
}>

export type MissionControlSurfaceProps = Readonly<{
  spaces: readonly MissionControlSpaceProjection[]
  currentSpaceId: string | null
  onEnterSpace: (spaceId: string) => void
  onDismiss: () => void
  williamOverview?: MissionControlWilliamOverview | null
}>

const stateLabel: Record<MissionControlSpaceProjection["state"], string> = {
  live: "Live",
  paused: "Paused",
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
}: {
  space: MissionControlSpaceProjection
  current: boolean
  onEnter: () => void
}) {
  const bounds = projectionBounds(space.windows)
  const visibleWindows = space.windows.filter((window) => !window.minimized)
  const minimizedWindows = space.windows.filter((window) => window.minimized)
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
        <span className={styles.agents} aria-label={`${space.agents.length} agent sessions`}>
          {space.agents.length === 0 ? <span>No active agents</span> : space.agents.slice(0, 3).map((agent) => (
            <span key={agent.id} className={styles.agent} data-state={agent.state} title={`${agent.role} · ${agent.activity}`}>
              <i /> {agent.name} · {agent.activity}
            </span>
          ))}
        </span>
      </span>
  </>

  if (space.truth === "fixture") {
    return <div className={styles.space} data-current={false} data-state={space.state} aria-label={`${space.name}, reference-only fixture projection`} aria-disabled="true">{content}</div>
  }
  return <button type="button" className={styles.space} data-current={current} data-state={space.state} onClick={onEnter} aria-label={`Enter ${space.name}${current ? ", current Space" : ""}`}>{content}</button>
}

export function MissionControlSurface({
  spaces,
  currentSpaceId,
  onEnterSpace,
  onDismiss,
  williamOverview,
}: MissionControlSurfaceProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const liveSpaceCount = spaces.filter((space) => space.truth === "live").length
  const fixtureSpaceCount = spaces.length - liveSpaceCount
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onDismiss()
      } else if (event.key === "Tab") {
        const items = focusable()
        if (items.length === 0) return
        const first = items[0]
        const last = items.at(-1)!
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => { window.removeEventListener("keydown", onKeyDown); previous?.focus() }
  }, [onDismiss])

  return (
    <section ref={dialogRef} className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="mission-control-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Spatial overview</span>
          <h1 id="mission-control-title">Mission Control</h1>
        </div>
        <span className={styles.spaceCount}>{liveSpaceCount} live {liveSpaceCount === 1 ? "Space" : "Spaces"}{fixtureSpaceCount ? ` · ${fixtureSpaceCount} reference` : ""}</span>
        <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss Mission Control">
          <span aria-hidden="true">×</span>
        </button>
      </header>

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
        {williamOverview?.truth === "fixture" ? <span className={styles.fixtureLabel}>Illustrative overview</span> : null}
        <span className={styles.hint}>Select a live Space to return to its exact working context · fixtures are reference-only · Esc to close</span>
      </footer>
    </section>
  )
}
