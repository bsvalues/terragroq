import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export const UI = {
  bg: '#0a0f1a',
  panel: '#111820',
  panel2: '#0d141d',
  field: '#101720',
  border: '#1e2a3e',
  border2: '#2a3650',
  text: '#e2e8f0',
  muted: '#7b8ba3',
  dim: '#4a5568',
  blue: '#7ca7c8',
  green: '#bfe8cc',
  amber: '#efd49d',
  red: '#efb0a9',
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{
      background: UI.panel,
      border: `1px solid ${UI.border}`,
      borderRadius: 8,
      padding: 14,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 13, color: UI.text, letterSpacing: 0, fontWeight: 800 }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  tone = 'neutral',
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'neutral' | 'primary' | 'danger' | 'quiet'
  type?: 'button' | 'submit'
}) {
  const colors = {
    neutral: { bg: '#182330', border: UI.border2, color: UI.text },
    primary: { bg: 'rgba(124,167,200,.18)', border: 'rgba(124,167,200,.45)', color: '#d8e9f5' },
    danger: { bg: 'rgba(239,176,169,.09)', border: 'rgba(239,176,169,.42)', color: UI.red },
    quiet: { bg: '#101720', border: UI.border, color: UI.muted },
  }[tone]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 32,
        borderRadius: 7,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.color,
        padding: '0 10px',
        fontSize: 12,
        fontWeight: 800,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const style: CSSProperties = {
    minHeight: 32,
    minWidth: 0,
    boxSizing: 'border-box',
    background: UI.field,
    color: UI.text,
    border: `1px solid ${UI.border2}`,
    borderRadius: 7,
    padding: '0 9px',
    fontSize: 12,
    ...(props.style ?? {}),
  }

  return (
    <input
      {...props}
      style={style}
    />
  )
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const style: CSSProperties = {
    minHeight: 32,
    minWidth: 0,
    boxSizing: 'border-box',
    background: UI.field,
    color: UI.text,
    border: `1px solid ${UI.border2}`,
    borderRadius: 7,
    padding: '0 9px',
    fontSize: 12,
    ...(props.style ?? {}),
  }

  return (
    <select
      {...props}
      style={style}
    />
  )
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? UI.green : tone === 'warn' ? UI.amber : tone === 'bad' ? UI.red : UI.blue
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      minHeight: 22,
      borderRadius: 999,
      border: `1px solid ${color}55`,
      background: `${color}12`,
      color,
      padding: '0 8px',
      fontSize: 10,
      fontWeight: 900,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

export function CommandResult({ result }: { result: any }) {
  if (!result) return null
  const ok = result.ok !== false && result.returncode !== 1
  return (
    <div style={{
      border: `1px solid ${ok ? 'rgba(191,232,204,.35)' : 'rgba(239,176,169,.42)'}`,
      background: ok ? 'rgba(191,232,204,.06)' : 'rgba(239,176,169,.08)',
      borderRadius: 8,
      padding: 10,
      color: ok ? UI.green : UI.red,
      fontSize: 12,
      lineHeight: 1.45,
    }}>
      <strong>{ok ? 'Command result' : 'Command blocked or failed'}</strong>
      {result.reason && <div style={{ marginTop: 4 }}>{result.reason}</div>}
      {result.error && <div style={{ marginTop: 4 }}>{result.error}</div>}
      {(result.stdout || result.stderr) && (
        <pre style={{ whiteSpace: 'pre-wrap', color: UI.muted, margin: '8px 0 0', maxHeight: 260, overflow: 'auto' }}>
          {result.stdout || result.stderr}
        </pre>
      )}
    </div>
  )
}

export function EvidenceList({ items }: { items: string[] }) {
  if (!items?.length) return <div style={{ color: UI.muted, fontSize: 12 }}>No evidence listed.</div>
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {items.map((item, index) => (
        <div key={`${item}-${index}`} style={{ color: UI.muted, fontSize: 11, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
          <span style={{ color: UI.blue, fontWeight: 900 }}>{index + 1}.</span> {item}
        </div>
      ))}
    </div>
  )
}
