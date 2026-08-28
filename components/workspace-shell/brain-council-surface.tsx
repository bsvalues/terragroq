"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, ChevronRight, Eye, RotateCcw, X } from "lucide-react"

import styles from "./brain-council-surface.module.css"

export type CouncilMember = Readonly<{
  id: string
  role: string
  name: string
  provider: string
  model?: string
  status: "considering" | "ready" | "dissenting"
  perspective: string
}>

export type CouncilEvidence = Readonly<{
  id: string
  label: string
  detail: string
  href?: string
}>

export type CouncilAdvisoryAction = "request-changes" | "reject" | "approve" | "ask-dissent" | "run-another-pass"

export type BrainCouncilSession = Readonly<{
  id: string
  question: string
  status: "deliberating" | "ready"
  context: Readonly<{
    spaceName: string
    kind: "space" | "file" | "preview" | "diff" | "agent" | "selection"
    label: string
  }>
  members: readonly CouncilMember[]
  consensus: string
  dissent: string
  blindSpot: string
  recommendation: string
  confidence: number
  evidence: readonly CouncilEvidence[]
}>

export type BrainCouncilSurfaceProps = Readonly<{
  session: BrainCouncilSession
  onDismiss: () => void
  onAdvisoryAction: (action: CouncilAdvisoryAction, session: BrainCouncilSession) => void
}>

const ACTIONS: readonly Readonly<{ id: CouncilAdvisoryAction; label: string; primary?: boolean }>[] = [
  { id: "request-changes", label: "Request changes" },
  { id: "reject", label: "Reject" },
  { id: "ask-dissent", label: "Ask for dissent" },
  { id: "run-another-pass", label: "Run another pass" },
  { id: "approve", label: "Approve recommendation", primary: true },
]

export function BrainCouncilSurface({
  session,
  onDismiss,
  onAdvisoryAction,
}: BrainCouncilSurfaceProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const [activeMemberId, setActiveMemberId] = useState(session.members[0]?.id ?? "")
  const activeMember = session.members.find((member) => member.id === activeMemberId) ?? session.members[0]
  const confidence = Math.max(0, Math.min(100, Math.round(session.confidence)))

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
    <section ref={dialogRef} className={styles.surface} role="dialog" aria-modal="true" aria-label="Brain Council advisory session" data-session-id={session.id}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Brain Council · advisory session</span>
          <h2>{session.question}</h2>
          <p className={styles.context}>
            <span>{session.context.spaceName}</span>
            <ChevronRight aria-hidden="true" size={12} />
            <span>{session.context.kind}</span>
            <ChevronRight aria-hidden="true" size={12} />
            <strong>{session.context.label}</strong>
          </p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.sessionState} data-status={session.status}>
            {session.status === "ready" ? "Recommendation ready" : "Council deliberating"}
          </span>
          <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss Brain Council">
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </header>

      <div className={styles.memberStrip} aria-label="Council members">
        {session.members.map((member) => (
          <button
            type="button"
            key={member.id}
            className={styles.member}
            data-active={member.id === activeMember?.id}
            data-status={member.status}
            aria-pressed={member.id === activeMember?.id}
            onClick={() => setActiveMemberId(member.id)}
          >
            <span className={styles.memberMark}>{member.role.slice(0, 1)}</span>
            <span>
              <strong>{member.role}</strong>
              <small>{member.name} · {member.status}</small>
            </span>
          </button>
        ))}
      </div>

      <div className={styles.body}>
        <div className={styles.deliberation}>
          <section className={styles.perspective} aria-live="polite">
            <div className={styles.perspectiveMeta}>
              <span>{activeMember?.role}</span>
              <span>{activeMember?.name}</span>
              <span>{activeMember?.provider}{activeMember?.model ? ` · ${activeMember.model}` : ""}</span>
            </div>
            <blockquote>{activeMember?.perspective}</blockquote>
          </section>

          <div className={styles.intelligenceGrid}>
            <section className={styles.finding}>
              <span className={styles.findingIcon}><Check aria-hidden="true" size={14} /></span>
              <div><h3>Consensus</h3><p>{session.consensus}</p></div>
            </section>
            <section className={styles.finding} data-tone="dissent">
              <span className={styles.findingIcon}><AlertTriangle aria-hidden="true" size={14} /></span>
              <div><h3>Strongest dissent</h3><p>{session.dissent}</p></div>
            </section>
            <section className={styles.finding} data-tone="blind-spot">
              <span className={styles.findingIcon}><Eye aria-hidden="true" size={14} /></span>
              <div><h3>Blind spot</h3><p>{session.blindSpot}</p></div>
            </section>
          </div>

          <section className={styles.recommendation}>
            <div className={styles.recommendationHead}>
              <div><span className={styles.eyebrow}>Council recommendation</span><h3>{session.recommendation}</h3></div>
              <div className={styles.confidence} aria-label={`${confidence}% confidence`}>
                <strong>{confidence}%</strong><span>confidence</span>
              </div>
            </div>
            <div className={styles.confidenceTrack} aria-hidden="true"><i style={{ width: `${confidence}%` }} /></div>
          </section>
        </div>

        <aside className={styles.evidence} aria-label="Council evidence">
          <div className={styles.asideHead}><span className={styles.eyebrow}>Evidence pack</span><strong>{session.evidence.length} sources</strong></div>
          <div className={styles.evidenceList}>
            {session.evidence.map((item) => item.href ? (
              <a key={item.id} href={item.href} className={styles.evidenceItem}>
                <strong>{item.label}</strong><span>{item.detail}</span><ChevronRight aria-hidden="true" size={13} />
              </a>
            ) : (
              <div key={item.id} className={styles.evidenceItem}>
                <strong>{item.label}</strong><span>{item.detail}</span>
              </div>
            ))}
          </div>
          <div className={styles.boundary} role="note">
            <AlertTriangle aria-hidden="true" size={14} />
            <p><strong>Advisory only.</strong> Council recommendations never execute silently. An owner action records direction; separate execution remains explicit and inspectable.</p>
          </div>
        </aside>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerNote}><RotateCcw aria-hidden="true" size={13} /> Dismiss anytime; the current Space and its windows stay in place.</div>
        <div className={styles.actions} aria-label="Council advisory actions">
          {ACTIONS.map((action) => (
            <button
              type="button"
              key={action.id}
              className={action.primary ? styles.primaryAction : styles.action}
              onClick={() => onAdvisoryAction(action.id, session)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </footer>
    </section>
  )
}
