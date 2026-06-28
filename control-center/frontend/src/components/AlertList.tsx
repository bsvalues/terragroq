import { useState, useEffect, useRef } from 'react'
import { getAlerts } from '../api'

const C = {
  bg: '#0a0f1a',
  card: '#1a2236',
  cardHover: '#1e2a3e',
  border: '#1e2a3e',
  borderLight: '#2a3650',
  text: '#e2e8f0',
  textMuted: '#7b8ba3',
  textDim: '#4a5568',
  green: '#22c55e',
  greenBg: 'rgba(34,197,94,.08)',
  amber: '#f59e0b',
  amberBg: 'rgba(245,158,11,.08)',
  red: '#ef4444',
  redBg: 'rgba(239,68,68,.08)',
  blue: '#3b82f6',
}

const POLL_INTERVAL = 60_000

interface Alert {
  level: string
  message: string
  command?: string
}

function levelStyle(level: string): { color: string; bg: string; label: string; border: string } {
  switch (level?.toLowerCase()) {
    case 'critical':
      return { color: C.red, bg: C.redBg, label: 'Stop', border: C.red }
    case 'warn':
    case 'warning':
      return { color: C.amber, bg: C.amberBg, label: 'Review', border: C.amber }
    default:
      return { color: C.blue, bg: 'rgba(59,130,246,.08)', label: 'Info', border: C.blue }
  }
}

export function AlertList() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function fetchAlerts() {
    getAlerts()
      .then(data => {
        setAlerts(Array.isArray(data?.alerts) ? data.alerts : [])
        setError(false)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchAlerts()
    timerRef.current = setInterval(fetchAlerts, POLL_INTERVAL)
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current)
    }
  }, [])

  if (loading) return null

  if (error) {
    return (
      <div style={{
        background: C.card,
        borderRadius: 12,
        padding: '10px 16px',
        border: `1px solid ${C.border}`,
        fontSize: 12,
        color: C.textDim,
        marginBottom: 12,
      }}>
        Alerts unavailable
      </div>
    )
  }

  if (alerts.length === 0) {
    return (
      <div style={{
        background: C.card,
        borderRadius: 12,
        padding: '10px 16px',
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.green}`,
        fontSize: 12,
        color: C.textDim,
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ color: C.green, fontWeight: 700 }}>OK</span>
        <span>All clear — no active alerts</span>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: C.textDim,
        marginBottom: 8,
      }}>
        Active Alerts ({alerts.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {alerts.map((alert, i) => {
          const style = levelStyle(alert.level)
          return (
            <div
              key={i}
              style={{
                background: style.bg,
                border: `1px solid ${style.border}30`,
                borderLeft: `3px solid ${style.border}`,
                borderRadius: 10,
                padding: '10px 14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: alert.command ? 6 : 0 }}>
                <span style={{ fontSize: 10, color: style.color, fontWeight: 800, textTransform: 'uppercase', minWidth: 42 }}>{style.label}</span>
                <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{alert.message}</span>
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: style.color,
                  letterSpacing: '0.06em',
                }}>
                  {alert.level}
                </span>
              </div>
              {alert.command && (
                <div style={{ fontSize: 11, color: C.textDim, marginLeft: 50 }}>
                  Hint: <code style={{ background: C.bg, padding: '1px 6px', borderRadius: 4, color: C.textMuted }}>
                    {alert.command}
                  </code>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
