import { useState, useCallback } from 'react'
import { capture } from '../api'

const S = {
  bg: '#0a0f1a',
  surface: '#111827',
  border: '#1e2a3e',
  borderLight: '#2a3650',
  text: '#e2e8f0',
  textMuted: '#7b8ba3',
  textDim: '#4a5568',
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
}

export function QuickCapture() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'captured' | 'error'>('idle')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setStatus('idle')
    try {
      const r = await capture(text.trim())
      if (r?.ok) {
        setText('')
        setStatus('captured')
        setTimeout(() => setStatus('idle'), 2000)
      } else {
        setStatus('error')
        setTimeout(() => setStatus('idle'), 3000)
      }
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    } finally {
      setBusy(false)
    }
  }, [text, busy])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Capture a thought..."
          disabled={busy}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          style={{
            flex: 1,
            background: S.bg,
            color: S.text,
            border: `1px solid ${S.borderLight}`,
            borderRadius: 8,
            padding: '9px 13px',
            fontSize: 13,
            outline: 'none',
            opacity: busy ? 0.6 : 1,
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          style={{
            background: S.blue,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '9px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !text.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !text.trim() ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          Capture
        </button>
      </div>
      {status === 'captured' && (
        <div style={{ fontSize: 12, color: S.green }}>Captured ✓</div>
      )}
      {status === 'error' && (
        <div style={{ fontSize: 12, color: S.red }}>Capture failed. Try again.</div>
      )}
    </div>
  )
}
