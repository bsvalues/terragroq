interface ApprovalPromptProps {
  name: string
  reason: string
  onApprove: () => void
  onDeny: () => void
}

export function ApprovalPrompt({ name, reason, onApprove, onDeny }: ApprovalPromptProps) {
  return (
    <div style={{
      background: 'rgba(216,163,75,.10)',
      border: '1px solid rgba(216,163,75,.65)',
      borderRadius: 8,
      padding: '14px 16px',
      margin: '8px 0',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#f59e0b', marginBottom: 6 }}>
        Review Required
      </div>
      <div style={{ fontSize: 12, color: '#7b8ba3', marginBottom: 8 }}>
        Exact command
      </div>
      <code style={{ display: 'block', background: 'rgba(0,0,0,.3)', padding: '8px 10px', borderRadius: 6, fontSize: 13, color: '#e2e8f0', marginBottom: 10 }}>
        william {name}
      </code>
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, fontSize: 12, marginBottom: 12 }}>
        <span style={{ color: '#7b8ba3' }}>Risk tier</span>
        <strong style={{ color: '#efd49d' }}>Confirm required</strong>
        <span style={{ color: '#7b8ba3' }}>Why</span>
        <span style={{ color: '#cbd5df' }}>{reason || 'This action can change local state.'}</span>
        <span style={{ color: '#7b8ba3' }}>Execution</span>
        <span style={{ color: '#cbd5df' }}>No command runs unless you approve it here.</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onApprove}
          style={{
            background: '#22c55e',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '7px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Approve
        </button>
        <button
          onClick={onDeny}
          style={{
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '7px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Deny
        </button>
      </div>
    </div>
  )
}
