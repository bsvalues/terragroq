"use client"

import { Command, MessageCircle, Send, X } from "lucide-react"
import { useEffect, useRef } from "react"

import spatial from "./experience-spatial.module.css"

export type WilliamConversationEntry = Readonly<{
  id: string
  role: "owner" | "williamos"
  text: string
  at: string
}>

export function WilliamConversationRail({
  conversation,
  judgment,
  input,
  busy,
  ready,
  judgmentBusy,
  canThinkAgain,
  canInspectJudgment,
  canOverrideJudgment,
  error,
  open,
  escapeDismissEnabled,
  persistenceLabel,
  persistenceError,
  onInput,
  onSubmit,
  onOpen,
  onClose,
  onThinkAgain,
  onInspectJudgment,
  onOverrideJudgment,
  onCouncil,
  onOpenLocal,
  onOpenLine,
}: Readonly<{
  conversation: readonly WilliamConversationEntry[]
  judgment: string
  input: string
  busy: boolean
  ready: boolean
  judgmentBusy: boolean
  canThinkAgain: boolean
  canInspectJudgment: boolean
  canOverrideJudgment: boolean
  error: string | null
  open: boolean
  escapeDismissEnabled: boolean
  persistenceLabel: string
  persistenceError: string | null
  onInput: (value: string) => void
  onSubmit: () => void
  onOpen: () => void
  onClose: () => void
  onThinkAgain: () => void
  onInspectJudgment: () => void
  onOverrideJudgment: () => void
  onCouncil: () => void
  onOpenLocal: () => void
  onOpenLine: () => void
}>) {
  const historyRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const escapeDismissEnabledRef = useRef(escapeDismissEnabled)
  const drawerHidden = !open
  escapeDismissEnabledRef.current = escapeDismissEnabled

  useEffect(() => {
    if (!open) return
    composerRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !escapeDismissEnabledRef.current) return
      event.preventDefault()
      onClose()
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [onClose, open])

  useEffect(() => {
    historyRef.current?.scrollTo?.({ top: historyRef.current.scrollHeight, behavior: "smooth" })
  }, [conversation])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={spatial.williamDrawerTrigger}
        onClick={onOpen}
        aria-label="Open William conversation"
        aria-expanded={open}
        aria-controls="william-conversation-drawer"
        aria-hidden={open ? "true" : undefined}
        inert={open ? true : undefined}
        tabIndex={open ? -1 : undefined}
      >
        <span className={spatial.williamAmbientOrb} aria-hidden>W</span>
        <span className={spatial.williamAmbientCopy}>
          <strong>Ask William</strong>
          <small>{judgmentBusy ? "Forming a grounded judgment…" : judgment}</small>
        </span>
        <MessageCircle size={15} aria-hidden />
      </button>
      <aside
        id="william-conversation-drawer"
        className={spatial.williamConversationRail}
        aria-label="William conversation"
        aria-hidden={drawerHidden ? "true" : undefined}
        inert={drawerHidden ? true : undefined}
        data-open={open ? "true" : "false"}
        data-testid="william-conversation-rail"
      >
        <header className={spatial.williamConversationHeader}>
          <span className={spatial.williamOrb} aria-hidden>W</span>
          <div><strong>William</strong><span>Present in this Space</span></div>
          <button type="button" className={spatial.williamRailClose} onClick={() => { onClose(); requestAnimationFrame(() => triggerRef.current?.focus()) }} aria-label="Close William conversation"><X size={15} /></button>
        </header>

        <section className={spatial.williamJudgmentCard} aria-label="William judgment">
          <span>Current judgment</span>
          <p>{judgment}</p>
          <div>
            <button type="button" onClick={onThinkAgain} disabled={!canThinkAgain || judgmentBusy}>{judgmentBusy ? "Reasoning" : "Think again"}</button>
            {canInspectJudgment ? <button type="button" onClick={onInspectJudgment} aria-label="Inspect judgment basis">Inspect basis</button> : null}
            {canOverrideJudgment ? <button type="button" onClick={() => { onOverrideJudgment(); requestAnimationFrame(() => composerRef.current?.focus()) }} aria-label="Override William judgment" disabled={busy || judgmentBusy}>Override</button> : null}
            <button type="button" onClick={onCouncil}>Ask Council</button>
          </div>
        </section>

        <div ref={historyRef} className={spatial.williamConversationHistory} aria-live="polite">
          {conversation.length ? conversation.map((entry) => (
            <article key={entry.id} className={entry.role === "owner" ? spatial.ownerTurn : spatial.williamTurn}>
              <span>{entry.role === "owner" ? "You" : "William"}</span>
              <p>{entry.text}</p>
            </article>
          )) : (
            <div className={spatial.williamConversationEmpty}>
              <strong>Pick up where the work is.</strong>
              <p>Ask about the selected object, the state of this Space, or what should happen next.</p>
            </div>
          )}
          {busy ? <div className={spatial.williamThinking} role="status"><i /><span>William is thinking in this context…</span></div> : null}
        </div>

        <form className={spatial.williamComposer} onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
          {error ? <div className={spatial.williamConversationError} role="alert">{error} Your question is still here.</div> : null}
          <label htmlFor="william-message">Message William</label>
          <textarea
            ref={composerRef}
            id="william-message"
            value={input}
            onChange={(event) => onInput(event.target.value)}
            placeholder="Ask William about this Space"
            rows={3}
            disabled={busy || !ready}
          />
          <div>
            <button type="button" className={spatial.williamLineButton} onClick={onOpenLine}><Command size={13} />The Line <kbd>Ctrl K</kbd></button>
            <button type="submit" className={spatial.williamSendButton} aria-label="Send to William" disabled={busy || !ready || !input.trim()}>{busy ? "Thinking" : ready ? "Send" : "Opening Space"}<Send size={13} /></button>
          </div>
        </form>

        <div className={spatial.williamSecondaryActions}>
          <span>Local agent · separate session</span>
          <button type="button" onClick={onOpenLocal}>Ask Local</button>
        </div>

        <footer className={persistenceError ? spatial.williamRailPersistenceError : spatial.williamRailPersistence} title={persistenceError ?? undefined}>
          {persistenceLabel}
        </footer>
      </aside>
    </>
  )
}
