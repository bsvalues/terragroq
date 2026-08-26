"use client"

import { useEffect, useRef } from "react"
import { Minus, X } from "lucide-react"

import { geometryChanged, readBorderBoxSize } from "./measure"
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
  onClose?: () => void
  children: React.ReactNode
}) {
  const frameRef = useRef<HTMLElement>(null)
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      // Measure the same box we write. Geometry goes back into inline width/height on a
      // border-box element, so reading contentRect returned a value 2px under the box it had just
      // measured and every observation shrank the window a little further. See ./measure.ts.
      const measured = readBorderBoxSize(entry, frame)
      if (!measured) return
      const current = geometryRef.current
      if (!geometryChanged(current, measured)) return
      onGeometry({ ...current, width: measured.width, height: measured.height })
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [onGeometry])

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
      const maxX = Math.max(0, window.innerWidth - 180)
      const maxY = Math.max(28, window.innerHeight - 90)
      onGeometry({
        ...geometryRef.current,
        x: Math.min(maxX, Math.max(-origin.width + 180, origin.x + next.clientX - startX)),
        y: Math.min(maxY, Math.max(28, origin.y + next.clientY - startY)),
      })
    }
    const end = (next: PointerEvent) => {
      if (header.hasPointerCapture(next.pointerId)) header.releasePointerCapture(next.pointerId)
      header.removeEventListener("pointermove", move)
      header.removeEventListener("pointerup", end)
      header.removeEventListener("pointercancel", end)
    }
    header.addEventListener("pointermove", move)
    header.addEventListener("pointerup", end)
    header.addEventListener("pointercancel", end)
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
      onPointerDown={onActivate}
      aria-label={`${title} window`}
      data-window-id={id}
    >
      <header className={styles.windowBar} onPointerDown={startDrag}>
        <span className={styles.windowTitle}>{title}</span>
        {onMinimize ? (
          <button type="button" className={styles.windowControl} onClick={onMinimize} aria-label={`Minimize ${title}`}>
            <Minus size={14} strokeWidth={1.7} />
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className={styles.windowControl} onClick={onClose} aria-label={`Close ${title}`}>
            <X size={13} strokeWidth={1.7} />
          </button>
        ) : null}
      </header>
      <div className={styles.windowBody}>{children}</div>
    </section>
  )
}
