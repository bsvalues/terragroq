import { useState, useEffect, useRef, useCallback } from 'react'
import { streamChat, approve, copilotHealth, RuntimeEvidence } from '../api'
import { ApprovalPrompt } from './ApprovalPrompt'
import { renderWithCitations } from './Citation'

type MessageRole = 'user' | 'tool' | 'approval' | 'final' | 'error' | 'runtime'

interface ChatMessage {
  id: number
  role: MessageRole
  text: string
  toolName?: string
  toolStatus?: string
  approvalName?: string
  approvalReason?: string
  callId?: string
  runtime?: RuntimeEvidence
  /** true once the approval widget has been acted on */
  approvalSettled?: boolean
}

let msgId = 0
function nextId() { return ++msgId }

interface ChatPaneProps {
  initialSession?: string
  initialMessages?: { role: string; content: string; meta?: any }[]
}

export function ChatPane({ initialSession, initialMessages }: ChatPaneProps = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!initialMessages || initialMessages.length === 0) return []
    return initialMessages.map(m => ({
      id: nextId(),
      role: (m.role === 'user' ? 'user' : 'final') as MessageRole,
      text: m.content,
      runtime: m.meta?.model_runtime,
    }))
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<string | null>(initialSession ?? null)
  const [offline, setOffline] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const streamingIdRef = useRef<number | null>(null)

  // Health check on mount
  useEffect(() => {
    copilotHealth()
      .then(h => setOffline(!h.ok))
      .catch(() => setOffline(true))
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    setMessages(prev => [...prev, { ...msg, id: nextId() }])
    return msgId
  }, [])

  const handleEvent = useCallback((e: unknown) => {
    const ev = e as Record<string, any>
    if (ev.type === 'session') {
      setSession(ev.session)
    } else if (ev.type === 'token') {
      if (!ev.text) return
      if (streamingIdRef.current === null) {
        const id = addMessage({ role: 'final', text: ev.text })
        streamingIdRef.current = id
      } else {
        const id = streamingIdRef.current
        setMessages(prev => prev.map(m => (
          m.id === id ? { ...m, text: `${m.text}${ev.text}` } : m
        )))
      }
    } else if (ev.type === 'tool') {
      addMessage({ role: 'tool', text: '', toolName: ev.name, toolStatus: ev.status })
    } else if (ev.type === 'runtime') {
      addMessage({ role: 'runtime', text: '', runtime: ev.runtime })
    } else if (ev.type === 'approval') {
      addMessage({
        role: 'approval',
        text: '',
        approvalName: ev.name,
        approvalReason: ev.reason,
        callId: ev.call_id,
        approvalSettled: false,
      })
    } else if (ev.type === 'final') {
      if (streamingIdRef.current !== null) {
        const id = streamingIdRef.current
        setMessages(prev => prev.map(m => (
          m.id === id ? { ...m, text: ev.text || m.text, runtime: ev.runtime ?? m.runtime } : m
        )))
        streamingIdRef.current = null
      } else {
        addMessage({ role: 'final', text: ev.text, runtime: ev.runtime })
      }
    } else if (ev.type === 'error') {
      streamingIdRef.current = null
      addMessage({ role: 'error', text: ev.text })
    }
  }, [addMessage])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    addMessage({ role: 'user', text })
    try {
      await streamChat(text, session, handleEvent)
    } catch (err) {
      addMessage({ role: 'error', text: String(err) })
    } finally {
      setBusy(false)
    }
  }, [input, busy, session, handleEvent, addMessage])

  const handleApprove = useCallback((callId: string, msgIndex: number, approved: boolean) => {
    // Mark the approval widget as settled
    setMessages(prev => prev.map((m, i) =>
      i === msgIndex ? { ...m, approvalSettled: true } : m
    ))
    setBusy(true)
    approve(callId, approved, handleEvent)
      .catch(err => addMessage({ role: 'error', text: String(err) }))
      .finally(() => setBusy(false))
  }, [handleEvent, addMessage])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 520 }}>
      {/* Offline banner */}
      {offline && (
        <div style={{
          background: 'rgba(216,163,75,.10)',
          border: '1px solid #d8a34b',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 12,
          fontSize: 13,
          color: '#efd49d',
        }}>
          Local model offline. Runtime commands still work; conversational routing needs <code style={{ background: 'rgba(0,0,0,.3)', padding: '1px 5px', borderRadius: 3 }}>python scripts/setup_copilot.py</code>
        </div>
      )}

      {/* Message list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        background: '#0a0f1a',
        borderRadius: 10,
        border: '1px solid #1e2a3e',
        padding: '16px',
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {messages.length === 0 && (
          <div style={{ color: '#4a5568', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
            Ask for a status check, a review, a command, or an answer from your notes.
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} style={{ alignSelf: 'flex-end', maxWidth: '80%' }}>
                <div style={{
                  background: '#3b82f6',
                  color: '#fff',
                  borderRadius: '12px 12px 2px 12px',
                  padding: '10px 14px',
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.text}
                </div>
              </div>
            )
          }
          if (msg.role === 'tool') {
            return (
              <div key={msg.id} style={{
                color: '#7b8ba3',
                fontSize: 12,
                padding: '4px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span>⚙</span>
                <span>command <strong style={{ color: '#e2e8f0' }}>william {msg.toolName}</strong> — {msg.toolStatus}</span>
              </div>
            )
          }
          if (msg.role === 'runtime') {
            const label = msg.runtime?.runtime_label ?? msg.runtime?.runtime ?? 'Local runtime'
            const model = msg.runtime?.model ?? 'model unknown'
            return (
              <div key={msg.id} style={{
                color: '#7b8ba3',
                fontSize: 11,
                padding: '2px 0',
              }}>
                Runtime selected: <strong style={{ color: '#e2e8f0' }}>{label}</strong> / {model}; fallback: {String(msg.runtime?.fallback ?? false)}
              </div>
            )
          }
          if (msg.role === 'approval') {
            if (msg.approvalSettled) {
              return (
                <div key={msg.id} style={{ color: '#4a5568', fontSize: 12, fontStyle: 'italic' }}>
                  Review response recorded for <code>{msg.approvalName}</code>.
                </div>
              )
            }
            return (
              <ApprovalPrompt
                key={msg.id}
                name={msg.approvalName ?? ''}
                reason={msg.approvalReason ?? ''}
                onApprove={() => handleApprove(msg.callId!, i, true)}
                onDeny={() => handleApprove(msg.callId!, i, false)}
              />
            )
          }
          if (msg.role === 'final') {
            return (
              <div key={msg.id} style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
                <div style={{
                  background: '#111827',
                  border: '1px solid #1e2a3e',
                  color: '#e2e8f0',
                  borderRadius: '2px 12px 12px 12px',
                  padding: '10px 14px',
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}>
                  {renderWithCitations(msg.text)}
                </div>
                {msg.runtime && (
                  <div style={{ color: '#4a5568', fontSize: 10, marginTop: 4, paddingLeft: 4 }}>
                    {msg.runtime.runtime_label ?? msg.runtime.runtime ?? 'Local runtime'} / {msg.runtime.model ?? 'model unknown'} · {msg.runtime.source ?? 'local'} · fallback {String(msg.runtime.fallback ?? false)}
                  </div>
                )}
              </div>
            )
          }
          if (msg.role === 'error') {
            return (
              <div key={msg.id} style={{
                color: '#ef4444',
                fontSize: 13,
                background: 'rgba(239,68,68,.08)',
                border: '1px solid #ef4444',
                borderRadius: 8,
                padding: '8px 12px',
              }}>
                Error: {msg.text}
              </div>
            )
          }
          return null
        })}
        {busy && (
          <div style={{ color: '#4a5568', fontSize: 13, fontStyle: 'italic' }}>Working locally...</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          placeholder="Ask, check, or request a command... (Enter to send, Shift+Enter for newline)"
          rows={2}
          style={{
            flex: 1,
            background: '#111827',
            color: '#e2e8f0',
            border: '1px solid #2a3650',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 14,
            resize: 'none',
            fontFamily: 'inherit',
            outline: 'none',
            opacity: busy ? 0.6 : 1,
          }}
        />
        <button
          onClick={sendMessage}
          disabled={busy || !input.trim()}
          style={{
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '0 20px',
            fontSize: 14,
            fontWeight: 600,
            cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !input.trim() ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
