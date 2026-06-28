import { useState, useEffect } from 'react'
import { getBriefing } from '../api'

const C = {
  bg: '#0a0f1a',
  surface: '#111827',
  card: '#1a2236',
  border: '#1e2a3e',
  borderLight: '#2a3650',
  text: '#e2e8f0',
  textMuted: '#7b8ba3',
  textDim: '#4a5568',
  blue: '#3b82f6',
  blueGlow: 'rgba(59,130,246,.12)',
  green: '#22c55e',
  greenBg: 'rgba(34,197,94,.08)',
  amber: '#f59e0b',
  amberBg: 'rgba(245,158,11,.08)',
  red: '#ef4444',
  redBg: 'rgba(239,68,68,.08)',
  purple: '#8b5cf6',
}

function healthColor(status: string): string {
  if (status === 'ok' || status === 'healthy' || status === 'pass') return C.green
  if (status === 'warn' || status === 'warning') return C.amber
  if (status === 'error' || status === 'fail' || status === 'critical') return C.red
  return C.textDim
}

function healthEmoji(status: string): string {
  if (status === 'ok' || status === 'healthy' || status === 'pass') return '✓'
  if (status === 'warn' || status === 'warning') return '⚠'
  if (status === 'error' || status === 'fail' || status === 'critical') return '✗'
  return '?'
}

export function BriefingCard() {
  const [briefing, setBriefing] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    getBriefing()
      .then(b => { setBriefing(b); setError(false) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{
        background: C.card,
        borderRadius: 12,
        padding: '14px 18px',
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.blue}`,
        marginBottom: 16,
        fontSize: 13,
        color: C.textDim,
      }}>
        Loading briefing...
      </div>
    )
  }

  if (error || !briefing) {
    return (
      <div style={{
        background: C.card,
        borderRadius: 12,
        padding: '14px 18px',
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.textDim}`,
        marginBottom: 16,
        fontSize: 13,
        color: C.textDim,
      }}>
        Briefing unavailable
      </div>
    )
  }

  const health = briefing.health ?? {}
  const nextAction = briefing.next_action ?? {}
  const pendingReview = briefing.pending_review ?? 0
  const inboxCount = briefing.inbox_count ?? 0

  return (
    <div style={{
      background: C.card,
      borderRadius: 12,
      padding: '16px 20px',
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${C.blue}`,
      marginBottom: 16,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.blue }}>
          Morning Briefing
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
          <span style={{ color: C.textDim }}>
            Review: <span style={{ color: pendingReview > 0 ? C.amber : C.green, fontWeight: 600 }}>{pendingReview}</span>
          </span>
          <span style={{ color: C.textDim }}>
            Inbox: <span style={{ color: inboxCount >= 10 ? C.amber : C.textMuted, fontWeight: 600 }}>{inboxCount}</span>
          </span>
        </div>
      </div>

      {/* Health strip */}
      {Object.keys(health).length > 0 && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
          {Object.entries(health).map(([key, val]: [string, any]) => {
            const status = typeof val === 'string' ? val.toLowerCase() : 'unknown'
            const color = healthColor(status)
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                <span style={{ color, fontWeight: 700 }}>{healthEmoji(status)}</span>
                <span style={{ color: C.textMuted, textTransform: 'capitalize' }}>
                  {key.replace(/_/g, ' ')}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Next action */}
      {nextAction.action && (
        <div style={{
          background: C.blueGlow,
          border: `1px solid ${C.borderLight}`,
          borderRadius: 8,
          padding: '10px 14px',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>
            {nextAction.action}
          </div>
          {nextAction.why && (
            <div style={{ fontSize: 12, color: C.textMuted }}>{nextAction.why}</div>
          )}
        </div>
      )}
    </div>
  )
}
