import { useState, useEffect } from 'react'
import { getSessions } from '../api'

interface Session {
  id: string
  created: string
  message_count: number
  preview: string
}

interface SessionListProps {
  onResume: (sessionId: string) => void
}

const S = {
  card: '#1a2236',
  cardHover: '#1e2a3e',
  border: '#1e2a3e',
  borderLight: '#2a3650',
  text: '#e2e8f0',
  textMuted: '#7b8ba3',
  textDim: '#4a5568',
  blue: '#3b82f6',
  red: '#ef4444',
  bg: '#0a0f1a',
}

export function SessionList({ onResume }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    getSessions()
      .then(r => setSessions(r.sessions ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ color: S.textDim, fontSize: 12, padding: '8px 0' }}>
        Loading past conversations...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ color: S.red, fontSize: 12, padding: '8px 0' }}>
        Could not load past conversations.
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div style={{ color: S.textDim, fontSize: 12, padding: '8px 0', textAlign: 'center' }}>
        No past conversations.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sessions.map(s => (
        <div
          key={s.id}
          onClick={() => onResume(s.id)}
          style={{
            background: S.card,
            border: `1px solid ${S.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            cursor: 'pointer',
            transition: 'background .15s, border-color .15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = S.cardHover
            e.currentTarget.style.borderColor = S.borderLight
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = S.card
            e.currentTarget.style.borderColor = S.border
          }}
        >
          <div style={{ fontSize: 13, color: S.text, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.preview || '(no preview)'}
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: S.textDim }}>
            <span>{s.message_count} msg{s.message_count !== 1 ? 's' : ''}</span>
            <span>{s.created}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
