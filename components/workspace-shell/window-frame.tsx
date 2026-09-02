"use client"

import { useRef } from "react"
import { Minus, X } from "lucide-react"

import type { WindowGeometry } from "./types"
import styles from "./workspace-shell.module.css"

export function WindowFrame({
  id,
  title,
  geometry,
  active,
  onActivate,
  onGeometry,
  onMinimize,
  minimizeDisabled = false,
  minimizeDisabledReason,
  onClose,
  children,
}: {
  id: string
  title: string
  geometry: WindowGeometry
  active: boolean
  onActivate: () => void
  onGeometry: (next: WindowGeometry) => void
  onMinimize?: () => void
  minimizeDisabled?: boolean
  minimizeDisabledReason?: string
  onClose?: () => void
  children: React.ReactNode
}) {
  const frameRef = useRef<HTMLElement>(null)
  const geometryRef = useRef(geometry)
  const restoreGeometryRef = useRef<WindowGeometry | null>(null)
  geometryRef.current = geometry

  function trackNativeResize(event: React.PointerEvent<HTMLElement>) {
    const frame = frameRef.current
    if (!frame || event.button !== 0) return
    const initial = frame.getBoundingClientRect()
    if (event.clientX < initial.right - 18 || event.clientY < initial.bottom - 18) return
    const finish = () => {
      const bounds = frame.getBoundingClientRect()
      const width = Math.round(bounds.width)
      const height = Math.round(bounds.height)
      const current = geometryRef.current
      if (Math.abs(width - current.width) >= 2 || Math.abs(height - current.height) >= 2) {
        onGeometry({ ...current, width, height })
      }
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
    }
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
  }

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest("button")) return
    event.preventDefault()
    onActivate()
    const startX = event.clientX
    const startY = event.clientY
    const origin = geometryRef.current
    const header = event.currentTarget
    header.setPointerCapture(event.pointerId)

    const move = (next: PointerEvent) => {
      const canvas = frameRef.current?.parentElement
      const maxX = Math.max(0, (canvas?.clientWidth ?? window.innerWidth) - 180)
      const maxY = Math.max(28, (canvas?.clientHeight ?? window.innerHeight) - 60)
      onGeometry({
        ...geometryRef.current,
        x: Math.min(maxX, Math.max(-origin.width + 180, origin.x + next.clientX - startX)),
        y: Math.min(maxY, Math.max(28, origin.y + next.clientY - startY)),
      })
    }
    const end = (next: PointerEvent) => {
      if (header.hasPointerCapture(next.pointerId)) header.releasePointerCapture(next.pointerId)
      const canvas = frameRef.current?.parentElement
      const bounds = canvas?.getBoundingClientRect()
      if (canvas && bounds && next.clientX <= bounds.left + 16) {
        onGeometry({ ...geometryRef.current, x: 6, y: 28, width: Math.max(360, Math.round(canvas.clientWidth / 2) - 9), height: Math.max(260, canvas.clientHeight - 36) })
      } else if (canvas && bounds && next.clientX >= bounds.right - 16) {
        const width = Math.max(360, Math.round(canvas.clientWidth / 2) - 9)
        onGeometry({ ...geometryRef.current, x: Math.max(6, canvas.clientWidth - width - 6), y: 28, width, height: Math.max(260, canvas.clientHeight - 36) })
      }
      header.removeEventListener("pointermove", move)
      header.removeEventListener("pointerup", end)
      header.removeEventListener("pointercancel", end)
    }
    header.addEventListener("pointermove", move)
    header.addEventListener("pointerup", end)
    header.addEventListener("pointercancel", end)
  }

  function toggleMaximize() {
    const canvas = frameRef.current?.parentElement
    if (!canvas) return
    if (restoreGeometryRef.current) {
      onGeometry(restoreGeometryRef.current)
      restoreGeometryRef.current = null
      return
    }
    restoreGeometryRef.current = geometryRef.current
    onGeometry({
      ...geometryRef.current,
      x: 6,
      y: 28,
      width: Math.max(360, canvas.clientWidth - 12),
      height: Math.max(260, canvas.clientHeight - 36),
    })
  }

  if (geometry.minimized) return null

  return (
    <section
      ref={frameRef}
      className={`${styles.window} ${active ? styles.activeWindow : ""}`}
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
        zIndex: geometry.z,
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("[data-window-control]")) return
        onActivate()
        trackNativeResize(event)
      }}
      aria-label={`${title} window`}
      data-window-id={id}
    >
      <header className={styles.windowBar} onPointerDown={startDrag} onDoubleClick={toggleMaximize}>
        <span className={styles.windowTitle}>{title}</span>
        {onMinimize ? (
          <button data-window-control type="button" className={styles.windowControl} onClick={onMinimize} disabled={minimizeDisabled} aria-label={`Minimize ${title}`} title={minimizeDisabledReason ?? `Minimize ${title}`}>
            <Minus size={14} strokeWidth={1.7} />
          </button>
        ) : null}
        {onClose ? (
          <button data-window-control type="button" className={styles.windowControl} onClick={onClose} aria-label={`Close ${title}`}>
            <X size={13} strokeWidth={1.7} />
          </button>
        ) : null}
      </header>
      <div className={styles.windowBody}>{children}</div>
    </section>
  )
}
