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
  judgmentBusy,
  canThinkAgain,
  canInspectJudgment,
  canOverrideJudgment,
  error,
  open,
  narrow,
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
  judgmentBusy: boolean
  canThinkAgain: boolean
  canInspectJudgment: boolean
  canOverrideJudgment: boolean
  error: string | null
  open: boolean
  narrow: boolean
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
  const drawerHidden = narrow && !open

  useEffect(() => {
    historyRef.current?.scrollTo?.({ top: historyRef.current.scrollHeight, behavior: "smooth" })
  }, [conversation])

  return (
    <>
      <button ref={triggerRef} type="button" className={spatial.williamDrawerTrigger} onClick={onOpen} aria-label="Open William conversation">
        <MessageCircle size={16} aria-hidden />
        <span>William</span>
      </button>
      <aside
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
          <button type="button" className={spatial.williamRailClose} onClick={() => { onClose(); triggerRef.current?.focus() }} aria-label="Close William conversation"><X size={15} /></button>
        </header>

        <section className={spatial.williamJudgmentCard} aria-label="William judgment">
          <span>Current judgment</span>
          <p>{judgment}</p>
          <div>
            <button type="button" onClick={onThinkAgain} disabled={!canThinkAgain || judgmentBusy}>{judgmentBusy ? "Reasoning" : "Think again"}</button>
            {canInspectJudgment ? <button type="button" onClick={onInspectJudgment} aria-label="Inspect judgment basis">Inspect basis</button> : null}
            {canOverrideJudgment ? <button type="button" onClick={() => { onOverrideJudgment(); requestAnimationFrame(() => composerRef.current?.focus()) }} aria-label="Override William judgment">Override</button> : null}
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
            disabled={busy}
          />
          <div>
            <button type="button" className={spatial.williamLineButton} onClick={onOpenLine}><Command size={13} />The Line <kbd>Ctrl K</kbd></button>
            <button type="submit" className={spatial.williamSendButton} aria-label="Send to William" disabled={busy || !input.trim()}>{busy ? "Thinking" : "Send"}<Send size={13} /></button>
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
