import { useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { api, getSession, copilotHealth, MemoryFact, DecisionRecord, DoctrineRule, WorkOrderRecord, AgentConfigSurface, AgentSkill, EvidencePacket, RepoStateDashboard, WorkOrderComposePreview, ValidationRunbook, CommitReadinessReview, HandoffPacketPreview, OperatorReviewInbox, DecisionGateConsole, OperatorActionRouterPreview, AuthorityLedgerPreview, OwnerDecisionRecordPreview, ApprovalPacketPreview, GoalRegistryPreview, LoopRegistryPreview, GoalLoopReadinessReview, GoalCommandPreview, LoopCommandPreview, GovernedGoalLoopConsole, CommandCatalogRow, WorkflowDefinition } from './api'
import { ChatPane } from './components/ChatPane'
import { BriefingCard } from './components/BriefingCard'
import { AlertList } from './components/AlertList'
import { QuickCapture } from './components/QuickCapture'
import { SessionList } from './components/SessionList'
import { Button as FButton, CommandResult, EvidenceList, Input as FInput, Panel as FPanel, Select as FSelect, StatusPill, UI } from './components/Foundation'

type Tab = 'home' | 'operate' | 'capture' | 'review' | 'agent' | 'search' | 'safety' | 'chat'

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const C = {
  bg: '#0a0f1a',
  surface: '#111827',
  card: '#1a2236',
  cardHover: '#1e2a3e',
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
  purpleBg: 'rgba(139,92,246,.08)',
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------
function Card({ children, style, accent }: { children: ReactNode; style?: React.CSSProperties; accent?: string }) {
  return (
    <div style={{
      background: C.card,
      borderRadius: 12,
      padding: 20,
      marginBottom: 16,
      border: `1px solid ${C.border}`,
      borderLeft: accent ? `3px solid ${accent}` : `1px solid ${C.border}`,
      ...style,
    }}>
      {children}
    </div>
  )
}

function StatusDot({ status }: { status: 'good' | 'warn' | 'bad' | 'unknown' }) {
  const color = status === 'good' ? C.green : status === 'warn' ? C.amber : status === 'bad' ? C.red : C.textDim
  return (
    <span style={{
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: color,
      boxShadow: status === 'good' ? `0 0 8px ${C.green}` : 'none',
      marginRight: 10,
      flexShrink: 0,
    }} />
  )
}

function StatusLabel({ status, label }: { status: 'good' | 'warn' | 'bad' | 'unknown'; label: string }) {
  const color = status === 'good' ? C.green : status === 'warn' ? C.amber : status === 'bad' ? C.red : C.textDim
  return (
    <span style={{ color, fontWeight: 600, fontSize: 13 }}>{label}</span>
  )
}

function Btn({ children, onClick, disabled, primary, style: s }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; style?: React.CSSProperties
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: primary ? C.blue : C.cardHover,
      color: '#fff',
      border: `1px solid ${primary ? C.blue : C.borderLight}`,
      borderRadius: 8,
      padding: '10px 18px',
      fontSize: 14,
      fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'background .15s',
      ...s,
    }}>
      {children}
    </button>
  )
}

function Details({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={() => setOpen(!open)} style={{
        background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer',
        fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <span style={{ fontSize: 10 }}>{open ? '▼' : '▶'}</span> {label}
      </button>
      {open && <div style={{ marginTop: 8, padding: 12, background: C.bg, borderRadius: 8, fontSize: 12, color: C.textMuted }}>{children}</div>}
    </div>
  )
}

function Loading({ message }: { message?: string }) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 16, color: C.textMuted, marginBottom: 8 }}>{message ?? 'Loading WilliamOS...'}</div>
      <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.blue, borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
    </div>
  )
}

function ErrorMsg({ message, hint }: { message: string; hint?: string }) {
  return (
    <Card accent={C.red}>
      <p style={{ margin: 0, fontWeight: 600 }}>{message}</p>
      {hint && <p style={{ color: C.textMuted, fontSize: 13, margin: '8px 0 0' }}>{hint}</p>}
    </Card>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <Card>
      <p style={{ color: C.textMuted, margin: 0, textAlign: 'center', padding: '12px 0' }}>{message}</p>
    </Card>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: C.text }}>{children}</h3>
}

// ---------------------------------------------------------------------------
// HOME TAB
// ---------------------------------------------------------------------------
function HomeTab({ switchTab }: { switchTab: (t: Tab) => void }) {
  const [home, setHome] = useState<any>(null)
  const [agent, setAgent] = useState<any>(null)
  const [safety, setSafety] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    Promise.all([api.home(), api.agentNext(), api.safety()])
      .then(([h, a, s]) => { setHome(h); setAgent(a); setSafety(s) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading message="Loading your cockpit..." />
  if (error || !home) return <ErrorMsg message="Could not reach backend." hint="Try: william control-center" />

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const reviewTotal = home.review_queues?.total ?? 0
  const safetyOk = safety?.status === 'HEALTHY'
  const rec = agent?.recommended

  return (
    <div>
      {/* Briefing + Alerts */}
      <BriefingCard />
      <AlertList />

      {/* Greeting */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, margin: '0 0 4px', fontWeight: 700 }}>{greeting}, William.</h2>
        <p style={{ color: C.textMuted, fontSize: 14, margin: 0 }}>{home.today?.date}</p>
      </div>

      {/* Next Action — hero card */}
      {rec && (
        <Card accent={C.blue} style={{ background: C.blueGlow, marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.blue, marginBottom: 8 }}>
            Recommended Next Action
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{rec.action}</div>
          <p style={{ color: C.textMuted, fontSize: 14, margin: '0 0 16px' }}>{rec.why}</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {rec.command && (
              <Btn primary onClick={() => switchTab('agent')}>
                Open Agent
              </Btn>
            )}
            <Btn onClick={() => switchTab('review')}>View Review Queue</Btn>
          </div>
        </Card>
      )}

      {/* Status strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <StatusDot status={home.today?.exists ? 'good' : 'warn'} />
            <span style={{ fontSize: 13, color: C.textMuted }}>Today</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{home.today?.exists ? 'Ready' : 'No note'}</div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <StatusDot status={(home.inbox_count ?? 0) < 10 ? 'good' : 'warn'} />
            <span style={{ fontSize: 13, color: C.textMuted }}>Inbox</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{home.inbox_count ?? 0}</div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <StatusDot status={reviewTotal === 0 ? 'good' : 'warn'} />
            <span style={{ fontSize: 13, color: C.textMuted }}>Review</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{reviewTotal}</div>
          <div style={{ color: C.textMuted, fontSize: 11 }}>drafts waiting</div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <StatusDot status={safetyOk ? 'good' : 'warn'} />
            <span style={{ fontSize: 13, color: C.textMuted }}>Safety</span>
          </div>
          <StatusLabel status={safetyOk ? 'good' : 'warn'} label={safetyOk ? 'Good' : 'Needs Review'} />
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <StatusDot status={home.backup?.count > 0 ? 'good' : 'warn'} />
            <span style={{ fontSize: 13, color: C.textMuted }}>Backup</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{home.backup?.count ?? 0}</div>
          <div style={{ color: C.textMuted, fontSize: 11 }}>archives</div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <StatusDot status={!home.git?.has_remote ? 'good' : 'bad'} />
            <span style={{ fontSize: 13, color: C.textMuted }}>Git</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {home.git?.tags?.length ? home.git.tags[home.git.tags.length - 1] : 'no tags'}
          </div>
          <div style={{ fontSize: 11, color: home.git?.has_remote ? C.red : C.textDim }}>
            {home.git?.has_remote ? 'Remote detected!' : 'local only'}
          </div>
        </Card>
      </div>

      {/* Quick capture */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionTitle>Quick Capture</SectionTitle>
          <Btn onClick={() => switchTab('capture')} style={{ padding: '6px 14px', fontSize: 12 }}>Open Full Capture</Btn>
        </div>
        <p style={{ color: C.textMuted, fontSize: 13, margin: '0 0 0' }}>
          Drop a thought into the inbox from the Capture tab, or use <code style={{ background: C.bg, padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>william inbox "your thought"</code>
        </p>
      </Card>

      {/* Review breakdown */}
      {reviewTotal > 0 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Review Queue</SectionTitle>
            <Btn onClick={() => switchTab('review')} style={{ padding: '6px 14px', fontSize: 12 }}>Open Review</Btn>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
            {Object.entries(home.review_queues ?? {}).filter(([k]) => k !== 'total').map(([name, q]: [string, any]) => (
              q.count > 0 && (
                <div key={name} style={{ background: C.bg, padding: '10px 12px', borderRadius: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{prettyQueueName(name)}</div>
                  <div style={{ color: C.amber, fontWeight: 700, fontSize: 18 }}>{q.count}</div>
                </div>
              )
            ))}
          </div>
        </Card>
      )}

      {/* Recent inbox */}
      {home.recent_inbox && home.recent_inbox.length > 0 && (
        <Card>
          <SectionTitle>Recent Inbox</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {home.recent_inbox.slice(0, 5).map((item: any, i: number) => (
              <div key={i} style={{ fontSize: 13, color: C.textMuted, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                {item.name.replace('.md', '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CAPTURE TAB
// ---------------------------------------------------------------------------
const PLACEHOLDERS = [
  '"Richard said his boss wants a simple AI explanation."',
  '"Principle: public trust requires evidence people can understand."',
  '"Need to follow up on exemption workflow vendor idea."',
  '"Insight from today\'s board meeting about transparency."',
  '"Question: What makes a good comparable selection?"',
]

function CaptureTab() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<any>(null)
  const [sending, setSending] = useState(false)
  const [placeholder] = useState(() => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)])

  const submit = useCallback(async () => {
    if (!text.trim()) return
    setSending(true)
    setResult(null)
    const r = await api.capture(text.trim())
    setResult(r)
    if (r.ok) setText('')
    setSending(false)
  }, [text])

  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>Capture Thought</h2>
      <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 20 }}>
        Drop a thought, idea, principle, or question into the inbox. You can sort it later.
      </p>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={placeholder}
        rows={5}
        style={{
          width: '100%',
          background: C.bg,
          color: C.text,
          border: `1px solid ${C.borderLight}`,
          borderRadius: 10,
          padding: 16,
          fontSize: 15,
          lineHeight: 1.6,
          resize: 'vertical',
          boxSizing: 'border-box',
          outline: 'none',
        }}
        onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submit() }}
      />

      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Btn primary onClick={submit} disabled={sending || !text.trim()}>
          {sending ? 'Capturing...' : 'Capture'}
        </Btn>
        <span style={{ color: C.textDim, fontSize: 12 }}>Ctrl+Enter to send</span>
      </div>

      {/* Example prompts */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>Example thoughts:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['A principle I keep returning to', 'Someone said something worth remembering', 'An idea for a project', 'A question I need to answer'].map((ex, i) => (
            <span key={i} onClick={() => setText(ex)} style={{
              background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, padding: '5px 12px',
              fontSize: 12, color: C.textMuted, cursor: 'pointer',
            }}>
              {ex}
            </span>
          ))}
        </div>
      </div>

      {/* Result */}
      {result && (
        <Card accent={result.ok ? C.green : C.red} style={{ marginTop: 20, background: result.ok ? C.greenBg : C.redBg }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
            {result.ok ? 'Captured.' : 'Could not capture.'}
          </div>
          {result.ok && result.stdout && (
            <p style={{ color: C.textMuted, fontSize: 13, margin: '4px 0' }}>{result.stdout.trim()}</p>
          )}
          {result.ok && (
            <p style={{ color: C.textMuted, fontSize: 13, margin: '8px 0 0' }}>
              Keep going, or review your inbox later.
            </p>
          )}
          {!result.ok && <p style={{ color: C.red, fontSize: 13 }}>{result.reason ?? result.error ?? 'Unknown error'}</p>}
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// REVIEW TAB
// ---------------------------------------------------------------------------
function prettyQueueName(name: string): string {
  const map: Record<string, string> = {
    doctrine: 'Doctrine',
    decisions: 'Decisions',
    concepts: 'Concepts',
    projects: 'Projects',
    work_orders: 'Work Orders',
    suggested_links: 'Suggested Links',
    daily_reviews: 'Daily Reviews',
    weekly_reviews: 'Weekly Reviews',
    monthly_reviews: 'Monthly Reviews',
    inbox_promoted: 'Inbox Promoted',
  }
  return map[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function QueueBadge({ queue }: { queue: string }) {
  const colors: Record<string, string> = {
    doctrine: C.purple, decisions: C.blue, concepts: C.amber,
    projects: C.green, work_orders: '#e879f9',
  }
  return (
    <span style={{
      background: `${colors[queue] ?? C.textDim}18`,
      color: colors[queue] ?? C.textDim,
      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
    }}>
      {prettyQueueName(queue)}
    </span>
  )
}

function ReviewTab() {
  const [items, setItems] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [plan, setPlan] = useState<any>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [agentReview, setAgentReview] = useState<any>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [acceptResult, setAcceptResult] = useState<any>(null)
  const [closureLoading, setClosureLoading] = useState<string | null>(null)
  const [closureResults, setClosureResults] = useState<Record<string, any>>({})

  const load = useCallback(() => {
    setLoading(true)
    api.reviewItems().then(setItems).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const selectDraft = useCallback(async (path: string) => {
    setSelectedPath(path)
    setDetail(null)
    setPlan(null)
    setAgentReview(null)
    setConfirmText('')
    setAcceptResult(null)
    setClosureLoading(null)
    setClosureResults({})
    setDetailLoading(true)
    const d = await api.reviewItem(path)
    setDetail(d)
    setDetailLoading(false)
  }, [])

  const goBack = useCallback(() => {
    setSelectedPath(null)
    setDetail(null)
    setPlan(null)
    setAgentReview(null)
    setConfirmText('')
    setAcceptResult(null)
    setClosureLoading(null)
    setClosureResults({})
  }, [])

  const generatePlan = useCallback(async () => {
    if (!selectedPath) return
    setPlanLoading(true)
    const p = await api.acceptancePlan(selectedPath)
    setPlan(p)
    setPlanLoading(false)
  }, [selectedPath])

  const askAgent = useCallback(async () => {
    if (!selectedPath) return
    setAgentLoading(true)
    const r = await api.agentReviewDraft(selectedPath)
    setAgentReview(r)
    setAgentLoading(false)
  }, [selectedPath])

  const acceptDraft = useCallback(async () => {
    if (!selectedPath || !plan?.target_folder || confirmText !== 'ACCEPT') return
    setAccepting(true)
    const r = await api.acceptDraft(selectedPath, plan.target_folder, confirmText)
    setAcceptResult(r)
    setAccepting(false)
    if (r?.ok) load()
  }, [selectedPath, plan, confirmText, load])

  const runClosureAction = useCallback(async (key: string, apiFn: () => Promise<any>) => {
    setClosureLoading(key)
    try {
      const r = await apiFn()
      setClosureResults(prev => ({ ...prev, [key]: r }))
    } catch (e: any) {
      setClosureResults(prev => ({ ...prev, [key]: { ok: false, error: e?.message || 'Request failed' } }))
    }
    setClosureLoading(null)
  }, [])

  if (loading) return <Loading message="Loading drafts..." />

  const allItems: any[] = items?.items ?? []
  const total = items?.total ?? 0

  // ---- DETAIL VIEW ----
  if (selectedPath) {
    if (detailLoading) return <Loading message="Reading draft..." />
    if (!detail || !detail.ok) return (
      <div>
        <button onClick={goBack} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 14, padding: 0, marginBottom: 16 }}>
          ← Back to drafts
        </button>
        <ErrorMsg message="Could not load this draft." hint={detail?.error ?? 'Unknown error'} />
      </div>
    )

    const contentSections = (detail.sections ?? []).filter(
      (s: any) => !['Human Review Checklist', 'Generator Notes'].includes(s.heading)
    )

    return (
      <div>
        {/* Back */}
        <button onClick={goBack} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 14, padding: 0, marginBottom: 16 }}>
          ← Back to drafts
        </button>

        {/* Header */}
        <Card accent={C.blue} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <QueueBadge queue={detail.queue} />
            {detail.frontmatter?.area && (
              <span style={{ fontSize: 11, color: C.textDim }}>· {detail.frontmatter.area}</span>
            )}
            {detail.frontmatter?.created && (
              <span style={{ fontSize: 11, color: C.textDim }}>· {detail.frontmatter.created}</span>
            )}
          </div>
          <h2 style={{ fontSize: 22, margin: '0 0 4px', fontWeight: 700 }}>{detail.title}</h2>
          <div style={{ fontSize: 12, color: C.textDim }}>
            Checklist: {detail.checklist_done}/{detail.checklist_total} complete
          </div>
        </Card>

        {/* Checklist */}
        {detail.checklist && detail.checklist.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>Review Checklist</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {detail.checklist.map((c: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'start', gap: 8, fontSize: 13, padding: '4px 0' }}>
                  <span style={{ color: c.done ? C.green : C.textDim, fontSize: 14, flexShrink: 0 }}>
                    {c.done ? '✓' : '○'}
                  </span>
                  <span style={{ color: c.done ? C.textMuted : C.text }}>{c.text}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Content sections */}
        {contentSections.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>Draft Content</SectionTitle>
            {contentSections.map((sec: any, i: number) => {
              const isPlaceholder = sec.content.includes('(Draft') || sec.content.includes('(None identified') || sec.content.includes('(Define ')
              return (
                <div key={i} style={{ marginBottom: i < contentSections.length - 1 ? 16 : 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: isPlaceholder ? C.textDim : C.text }}>
                    {sec.heading}
                  </div>
                  <div style={{
                    fontSize: 13,
                    color: isPlaceholder ? C.textDim : C.textMuted,
                    fontStyle: isPlaceholder ? 'italic' : 'normal',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    padding: '4px 0',
                    borderLeft: isPlaceholder ? `2px solid ${C.border}` : 'none',
                    paddingLeft: isPlaceholder ? 12 : 0,
                  }}>
                    {sec.content || '(empty)'}
                  </div>
                </div>
              )
            })}
          </Card>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          <Btn primary onClick={generatePlan} disabled={planLoading}>
            {planLoading ? 'Generating...' : 'Generate Acceptance Plan'}
          </Btn>
          <Btn onClick={askAgent} disabled={agentLoading}>
            {agentLoading ? 'Asking...' : 'Ask Agent to Review'}
          </Btn>
        </div>

        {/* Acceptance Plan */}
        {plan && plan.ok && (
          <Card accent={plan.ready ? C.green : C.amber} style={{ background: plan.ready ? C.greenBg : C.amberBg, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: plan.ready ? C.green : C.amber, marginBottom: 8 }}>
              Acceptance Plan
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
              {plan.ready ? 'Ready for acceptance' : `${plan.incomplete_count} item${plan.incomplete_count !== 1 ? 's' : ''} to complete`}
            </div>

            {plan.steps && (
              <ol style={{ paddingLeft: 20, margin: '0 0 12px', fontSize: 13, color: C.textMuted }}>
                {plan.steps.map((step: string, i: number) => (
                  <li key={i} style={{ marginBottom: 6, lineHeight: 1.5 }}>{step}</li>
                ))}
              </ol>
            )}

            {plan.warnings && plan.warnings.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {plan.warnings.map((w: string, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'start', gap: 6, fontSize: 12, color: C.amber, marginBottom: 4 }}>
                    <span>⚠</span> {w}
                  </div>
                ))}
              </div>
            )}

            {plan.target_folder && (
              <div style={{ marginTop: 8, fontSize: 12, color: C.textDim }}>
                Target: <code style={{ background: C.bg, padding: '2px 6px', borderRadius: 4 }}>{plan.target_folder}</code>
              </div>
            )}

            <div style={{ marginTop: 8, fontSize: 11, color: C.textDim, fontStyle: 'italic' }}>
              {plan.safety}
            </div>
          </Card>
        )}

        {/* Acceptance Confirmation */}
        {plan && plan.ok && plan.ready && !acceptResult?.ok && (
          <Card accent={C.green} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.green, marginBottom: 8 }}>
              Confirm Acceptance
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>
              This will copy the draft to <code style={{ background: C.bg, padding: '2px 6px', borderRadius: 4 }}>{plan.target_folder}</code>. The original draft is not deleted.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <input
                type="text"
                placeholder='Type ACCEPT to confirm'
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: C.bg, color: C.text, fontSize: 14, fontFamily: 'inherit',
                  outline: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = C.green }}
                onBlur={e => { e.target.style.borderColor = C.border }}
              />
              <Btn primary onClick={acceptDraft} disabled={confirmText !== 'ACCEPT' || accepting}
                style={{ background: confirmText === 'ACCEPT' ? C.green : undefined, opacity: confirmText !== 'ACCEPT' ? 0.5 : 1 }}>
                {accepting ? 'Accepting...' : 'Accept Draft'}
              </Btn>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, fontStyle: 'italic' }}>
              One item. Human-confirmed. Copy, not move. Append-only log.
            </div>
          </Card>
        )}

        {/* Acceptance Result */}
        {acceptResult && (
          <Card accent={acceptResult.ok ? C.green : C.red} style={{ background: acceptResult.ok ? C.greenBg : C.redBg, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: acceptResult.ok ? C.green : C.red, marginBottom: 8 }}>
              {acceptResult.ok ? 'Accepted' : 'Acceptance Failed'}
            </div>
            {acceptResult.ok ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Draft promoted to official folder</div>
                {acceptResult.stdout && (
                  <pre style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px', fontSize: 12, color: C.textMuted, background: C.bg, padding: 12, borderRadius: 8 }}>
                    {acceptResult.stdout}
                  </pre>
                )}
                <div style={{ fontSize: 12, color: C.textDim, marginBottom: 4 }}>
                  Draft: <code style={{ background: C.bg, padding: '2px 6px', borderRadius: 4 }}>{acceptResult.draft_path}</code>
                </div>
                <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>
                  Destination: <code style={{ background: C.bg, padding: '2px 6px', borderRadius: 4 }}>{acceptResult.dest}</code>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Btn onClick={() => { navigator.clipboard.writeText(acceptResult.dest) }}>
                    Copy Official Path
                  </Btn>
                  <Btn onClick={() => { goBack(); load() }}>
                    Back to Drafts
                  </Btn>
                </div>

                {/* Closure Actions */}
                <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, marginBottom: 12 }}>
                    Closure Actions
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                    <Btn onClick={() => runClosureAction('checklist', api.closureChecklist)}
                      disabled={closureLoading !== null}>
                      {closureLoading === 'checklist' ? 'Generating...' : 'Generate Checklist'}
                    </Btn>
                    <Btn onClick={() => runClosureAction('dryRun', api.closureDryRun)}
                      disabled={closureLoading !== null}>
                      {closureLoading === 'dryRun' ? 'Running...' : 'Closure Dry-Run'}
                    </Btn>
                    <Btn onClick={() => runClosureAction('run', api.closureRun)}
                      disabled={closureLoading !== null}>
                      {closureLoading === 'run' ? 'Running...' : 'Run Closure'}
                    </Btn>
                    <Btn onClick={() => runClosureAction('snapshot', api.snapshotDryRun)}
                      disabled={closureLoading !== null}>
                      {closureLoading === 'snapshot' ? 'Running...' : 'Snapshot Dry-Run'}
                    </Btn>
                    <Btn onClick={() => runClosureAction('guidance', api.agentPostAcceptance)}
                      disabled={closureLoading !== null}>
                      {closureLoading === 'guidance' ? 'Loading...' : 'Post-Acceptance Guidance'}
                    </Btn>
                  </div>

                  {/* Closure results — each renders inline below buttons */}
                  {Object.entries(closureResults).map(([key, res]: [string, any]) => {
                    const labels: Record<string, string> = {
                      checklist: 'Closure Checklist',
                      dryRun: 'Closure Dry-Run',
                      run: 'Closure',
                      snapshot: 'Snapshot Dry-Run',
                      guidance: 'Post-Acceptance Guidance',
                    }
                    const isError = res && !res.ok && res.ok !== undefined
                    const isGuidance = key === 'guidance' && res?.ok

                    return (
                      <div key={key} style={{ marginBottom: 12 }}>
                        <div style={{
                          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.08em', marginBottom: 6,
                          color: isError ? C.red : C.blue,
                        }}>
                          {labels[key] || key}
                        </div>

                        {isError && (
                          <div style={{ fontSize: 13, color: C.red, padding: '8px 12px', background: C.redBg, borderRadius: 8 }}>
                            {res.error || res.reason || 'Action failed'}
                          </div>
                        )}

                        {isGuidance && (
                          <div style={{ padding: '12px 14px', background: C.card, borderRadius: 8, border: `1px solid ${C.border}` }}>
                            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{res.summary}</div>
                            {res.steps && (
                              <ol style={{ paddingLeft: 20, margin: '0 0 8px', fontSize: 13, color: C.textMuted }}>
                                {res.steps.map((s: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
                              </ol>
                            )}
                            {res.snapshot_note && (
                              <div style={{ fontSize: 12, color: C.amber, marginBottom: 6 }}>{res.snapshot_note}</div>
                            )}
                            {res.warnings && res.warnings.map((w: string, i: number) => (
                              <div key={i} style={{ fontSize: 12, color: C.amber, marginBottom: 2 }}>⚠ {w}</div>
                            ))}
                            {res.remaining_drafts !== undefined && (
                              <div style={{ fontSize: 12, color: C.textDim, marginTop: 6 }}>
                                Remaining drafts in queue: {res.remaining_drafts}
                              </div>
                            )}
                          </div>
                        )}

                        {!isError && !isGuidance && (res.stdout || res.ok !== undefined) && (
                          <Details label={`${labels[key] || key} output`}>
                            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>
                              {res.stdout || res.stderr || JSON.stringify(res, null, 2)}
                            </pre>
                          </Details>
                        )}
                      </div>
                    )
                  })}

                  {/* Suggested snapshot command */}
                  {(closureResults.snapshot?.ok || closureResults.run?.ok) && (
                    <div style={{ marginTop: 8, padding: '10px 14px', background: C.bg, borderRadius: 8, border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', marginBottom: 6 }}>
                        Suggested snapshot command (run manually)
                      </div>
                      <code style={{ fontSize: 12, color: C.textMuted, wordBreak: 'break-all' }}>
                        python scripts/william.py snapshot --message "Post-acceptance closure: {new Date().toISOString().slice(0, 10)}"
                      </code>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: C.red }}>{acceptResult.error || 'Unknown error'}</div>
            )}
          </Card>
        )}

        {/* Agent Review */}
        {agentReview && agentReview.ok && (
          <Card accent={C.purple} style={{ background: C.purpleBg, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.purple, marginBottom: 8 }}>
              Agent Review
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{agentReview.summary}</div>

            {/* Quality checks */}
            {agentReview.quality && (
              <div style={{ marginBottom: 12 }}>
                {Object.entries(agentReview.quality).map(([k, v]: [string, any]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                    <StatusDot status={v === 'good' || v === 'complete' ? 'good' : v === 'partial' ? 'warn' : 'bad'} />
                    <span style={{ fontWeight: 600, fontSize: 13, marginRight: 8 }}>
                      {k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </span>
                    <span style={{ fontSize: 12, color: C.textMuted }}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
              Checklist: {agentReview.checklist_status}
            </div>

            {agentReview.concerns && agentReview.concerns.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {agentReview.concerns.map((c: string, i: number) => (
                  <div key={i} style={{ fontSize: 13, color: C.amber, marginBottom: 4 }}>• {c}</div>
                ))}
              </div>
            )}

            <div style={{ padding: '10px 14px', background: C.bg, borderRadius: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase' }}>Recommendation: </span>
              <span style={{ fontSize: 13, color: C.textMuted }}>{agentReview.recommendation}</span>
            </div>

            <Details label="Technical details">
              <div>{agentReview.safety}</div>
            </Details>
          </Card>
        )}

        {/* Raw content toggle */}
        <Details label="Show raw markdown">
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{detail.content}</pre>
        </Details>
      </div>
    )
  }

  // ---- LIST VIEW ----
  const queues = [...new Set(allItems.map((i: any) => i.queue))]
  const queueCounts: Record<string, number> = {}
  for (const it of allItems) queueCounts[it.queue] = (queueCounts[it.queue] ?? 0) + 1
  const filtered = filter === 'all' ? allItems : allItems.filter((i: any) => i.queue === filter)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ fontSize: 22, margin: 0 }}>Review Workbench</h2>
        <Btn onClick={load} style={{ padding: '8px 14px', fontSize: 13 }}>Refresh</Btn>
      </div>
      <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 16 }}>
        {total} {total === 1 ? 'draft' : 'drafts'} waiting. Select one to review.
      </p>

      {/* Filter chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        <span onClick={() => setFilter('all')} style={{
          background: filter === 'all' ? C.blue : C.bg,
          color: filter === 'all' ? '#fff' : C.textMuted,
          border: `1px solid ${filter === 'all' ? C.blue : C.border}`,
          borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>
          All ({total})
        </span>
        {queues.map(q => (
          <span key={q} onClick={() => setFilter(q)} style={{
            background: filter === q ? C.blue : C.bg,
            color: filter === q ? '#fff' : C.textMuted,
            border: `1px solid ${filter === q ? C.blue : C.border}`,
            borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            {prettyQueueName(q)} ({queueCounts[q] ?? 0})
          </span>
        ))}
      </div>

      {/* Draft list */}
      {filtered.length === 0 ? (
        <Empty message={total === 0 ? 'All clear. No drafts waiting for review.' : 'No drafts in this queue.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((item: any) => (
            <div key={item.path} onClick={() => selectDraft(item.path)} style={{
              background: C.card, borderRadius: 10, padding: '14px 18px',
              border: `1px solid ${C.border}`, cursor: 'pointer',
              transition: 'background .15s, border-color .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.cardHover; e.currentTarget.style.borderColor = C.borderLight }}
            onMouseLeave={e => { e.currentTarget.style.background = C.card; e.currentTarget.style.borderColor = C.border }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 15, flex: 1, marginRight: 12 }}>{item.title}</div>
                <QueueBadge queue={item.queue} />
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: C.textDim }}>
                {item.created && <span>{item.created}</span>}
                {item.area && <span>{item.area}</span>}
                <span>Checklist: {item.checklist_done}/{item.checklist_total}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AGENT TAB
// ---------------------------------------------------------------------------
function AgentTab() {
  const [rec, setRec] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [response, setResponse] = useState<any>(null)
  const [responseLabel, setResponseLabel] = useState('')
  const [asking, setAsking] = useState(false)
  const [runResult, setRunResult] = useState<any>(null)

  useEffect(() => {
    api.agentNext().then(setRec).finally(() => setLoading(false))
  }, [])

  const ask = useCallback(async (fn: () => Promise<any>, label: string) => {
    setAsking(true)
    setResponse(null)
    setResponseLabel(label)
    setRunResult(null)
    const r = await fn()
    setResponse(r)
    setAsking(false)
  }, [])

  const refreshNext = useCallback(async () => {
    setAsking(true)
    setResponse(null)
    setRunResult(null)
    const n = await api.agentNext()
    setRec(n)
    setAsking(false)
  }, [])

  const runSafe = useCallback(async (command: string) => {
    setRunResult(null)
    const r = await api.run(command)
    setRunResult(r)
  }, [])

  if (loading) return <Loading message="Loading operator..." />

  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>What Should I Do?</h2>
      <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 20 }}>
        Ask the operator. It reads your vault and recommends what to focus on.
      </p>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        <Btn primary onClick={refreshNext} disabled={asking}>What should I do next?</Btn>
        <Btn onClick={() => ask(api.agentToday, 'Today\'s Summary')} disabled={asking}>Summarize today</Btn>
        <Btn onClick={() => ask(api.agentReviewQueues, 'Review Queue')} disabled={asking}>Explain my review queue</Btn>
        <Btn onClick={() => ask(api.agentHealth, 'System Health')} disabled={asking}>Explain system health</Btn>
        <Btn onClick={() => ask(api.agentIgnore, 'What to Ignore')} disabled={asking}>What can I ignore?</Btn>
      </div>

      {asking && <Loading message="Thinking..." />}

      {/* Recommended action */}
      {rec?.recommended && !asking && !response && (
        <Card accent={C.blue} style={{ background: C.blueGlow }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.blue, marginBottom: 8 }}>
            Recommended
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{rec.recommended.action}</div>
          <p style={{ color: C.textMuted, fontSize: 14, margin: '0 0 12px' }}>{rec.recommended.why}</p>
          {rec.recommended.command && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Btn primary onClick={() => runSafe(rec.recommended.command)}>Run</Btn>
              <code style={{ background: C.bg, padding: '6px 10px', borderRadius: 6, fontSize: 12, color: C.textMuted }}>
                william {rec.recommended.command}
              </code>
            </div>
          )}
        </Card>
      )}

      {/* Agent response */}
      {response && !asking && (
        <Card accent={C.purple} style={{ background: C.purpleBg }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.purple, marginBottom: 8 }}>
            {responseLabel}
          </div>

          {/* Summary */}
          {response.summary && (
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{response.summary}</div>
          )}
          {response.overall && !response.summary && (
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{response.overall}</div>
          )}

          {/* Checks */}
          {response.checks && (
            <div style={{ marginBottom: 12 }}>
              {response.checks.map((c: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                  <StatusDot status={c.status === 'OK' ? 'good' : c.status === 'WARNING' ? 'warn' : 'unknown'} />
                  <span style={{ fontWeight: 600, fontSize: 14, marginRight: 8 }}>{c.check}</span>
                  <span style={{ color: C.textMuted, fontSize: 13 }}>{c.detail}</span>
                </div>
              ))}
            </div>
          )}

          {/* Items list */}
          {response.items && (
            <ul style={{ paddingLeft: 20, margin: '0 0 12px' }}>
              {response.items.map((item: string, i: number) => (
                <li key={i} style={{ color: C.textMuted, fontSize: 14, marginBottom: 6, lineHeight: 1.5 }}>{item}</li>
              ))}
            </ul>
          )}

          {/* Detail block */}
          {response.detail && (
            <div style={{ background: C.bg, padding: 12, borderRadius: 8, fontSize: 13, color: C.textMuted, whiteSpace: 'pre-wrap', marginBottom: 12 }}>
              {response.detail}
            </div>
          )}

          {/* Recommendation */}
          {response.recommendation && (
            <div style={{ padding: '10px 14px', background: C.bg, borderRadius: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase' }}>Recommendation: </span>
              <span style={{ fontSize: 13, color: C.textMuted }}>{response.recommendation}</span>
            </div>
          )}

          {/* Why */}
          {response.why && (
            <p style={{ color: C.textDim, fontSize: 12, fontStyle: 'italic', margin: '8px 0 0' }}>{response.why}</p>
          )}

          <Details label="Technical details">
            <div>Read-only analysis. {response.commands_used?.join(', ') ?? ''}</div>
            <div>{response.safety ?? ''}</div>
          </Details>
        </Card>
      )}

      {/* Command result */}
      {runResult && (
        <Card accent={runResult.ok ? C.green : C.red}>
          <SectionTitle>{runResult.ok ? 'Command Complete' : 'Command Failed'}</SectionTitle>
          {runResult.ok && runResult.stdout && (
            <Details label="Show output">
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{runResult.stdout}</pre>
            </Details>
          )}
          {runResult.stderr && (
            <Details label="Show errors">
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0, color: C.amber }}>{runResult.stderr}</pre>
            </Details>
          )}
          {!runResult.ok && <p style={{ color: C.red, fontSize: 13 }}>{runResult.reason ?? runResult.error ?? 'Command was refused by the safety gate.'}</p>}
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SEARCH TAB
// ---------------------------------------------------------------------------
const SEARCH_EXAMPLES = [
  'public trust',
  'appraisal methodology',
  'appeal evidence',
  'what did I decide about backups?',
  'Academy as moat',
]

function SearchTab() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any>(null)
  const [searching, setSearching] = useState(false)

  const search = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true)
    setResults(null)
    const r = await api.search(query.trim())
    setResults(r)
    setSearching(false)
  }, [query])

  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>Search Memory</h2>
      <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 20 }}>
        Find notes, decisions, ideas, and doctrine across your vault.
      </p>

      <div style={{ display: 'flex', gap: 10 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="What are you looking for?"
          style={{
            flex: 1,
            background: C.bg,
            color: C.text,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 15,
            outline: 'none',
          }}
          onKeyDown={e => { if (e.key === 'Enter') search() }}
        />
        <Btn primary onClick={search} disabled={searching || !query.trim()}>
          {searching ? 'Searching...' : 'Search'}
        </Btn>
      </div>

      {/* Example searches */}
      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SEARCH_EXAMPLES.map((ex, i) => (
          <span key={i} onClick={() => { setQuery(ex); setResults(null) }} style={{
            background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, padding: '5px 12px',
            fontSize: 12, color: C.textMuted, cursor: 'pointer',
          }}>
            {ex}
          </span>
        ))}
      </div>

      {/* Results */}
      {searching && <Loading message="Searching your vault..." />}

      {results && !searching && (
        <div style={{ marginTop: 20 }}>
          {!results.ok ? (
            <ErrorMsg
              message="Search failed."
              hint={results.reason ?? results.error ?? 'The semantic search index may not be built. Try: william semantic-index'}
            />
          ) : results.stdout ? (
            <Card>
              <SectionTitle>Results</SectionTitle>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
                {results.stdout}
              </div>
            </Card>
          ) : (
            <Empty message="No results found. Try a different search." />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SAFETY TAB
// ---------------------------------------------------------------------------
function SafetyTab() {
  const [safety, setSafety] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [checkResult, setCheckResult] = useState<any>(null)
  const [runningCheck, setRunningCheck] = useState(false)

  useEffect(() => {
    api.safety().then(setSafety).catch(() => setError(true)).finally(() => setLoading(false))
  }, [])

  const runCheck = useCallback(async () => {
    setRunningCheck(true)
    setCheckResult(null)
    const r = await api.run('production-readiness')
    setCheckResult(r)
    setRunningCheck(false)
  }, [])

  if (loading) return <Loading message="Checking system safety..." />
  if (error) return <ErrorMsg message="Could not load safety data." hint="Try: william control-center" />

  const safetyStatus = safety?.status === 'HEALTHY' ? 'good'
    : safety?.status === 'WARNING' ? 'warn'
    : safety?.status === 'CRITICAL' ? 'bad' : 'unknown'

  const safetyLabel = safety?.status === 'HEALTHY' ? 'Good'
    : safety?.status === 'WARNING' ? 'Needs Review'
    : safety?.status === 'CRITICAL' ? 'Blocked' : 'Unknown'

  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>System Safety</h2>
      <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 20 }}>
        Is WilliamOS safe? Check what matters.
      </p>

      {/* Overall status */}
      <Card accent={safetyStatus === 'good' ? C.green : safetyStatus === 'warn' ? C.amber : C.red}
        style={{ background: safetyStatus === 'good' ? C.greenBg : safetyStatus === 'warn' ? C.amberBg : C.redBg, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <StatusDot status={safetyStatus as any} />
          <span style={{ fontSize: 20, fontWeight: 700 }}>
            <StatusLabel status={safetyStatus as any} label={safetyLabel} />
          </span>
        </div>
        {safety?.concerns && (
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {safety.concerns.map((c: string, i: number) => (
              <li key={i} style={{ color: C.textMuted, fontSize: 14, marginBottom: 4 }}>{c}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* Status cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <StatusDot status={!safety?.has_remote ? 'good' : 'bad'} />
            <span style={{ fontWeight: 600 }}>Git</span>
          </div>
          <StatusLabel status={!safety?.has_remote ? 'good' : 'bad'} label={safety?.has_remote ? 'Remote detected!' : 'Local only'} />
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <StatusDot status={(safety?.backup_count ?? 0) > 0 ? 'good' : 'warn'} />
            <span style={{ fontWeight: 600 }}>Backup</span>
          </div>
          <div style={{ fontSize: 14, color: C.textMuted }}>{safety?.backup_count ?? 0} archives</div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <StatusDot status={safety?.latest_tag ? 'good' : 'unknown'} />
            <span style={{ fontWeight: 600 }}>Release</span>
          </div>
          <div style={{ fontSize: 14, color: C.textMuted }}>{safety?.latest_tag ?? 'No tags'}</div>
        </Card>
      </div>

      {/* Production check */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionTitle>Production Readiness</SectionTitle>
          <Btn onClick={runCheck} disabled={runningCheck}>
            {runningCheck ? 'Running...' : 'Run Check'}
          </Btn>
        </div>
        <p style={{ color: C.textMuted, fontSize: 13, margin: 0 }}>
          Runs the 9-point production gate: governance, smoke, restore, schema, commands, backup, git, docs, forbidden files.
        </p>
        {checkResult && (
          <Details label="Show full output">
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
              {checkResult.stdout ?? checkResult.reason ?? checkResult.error ?? 'Done'}
            </pre>
          </Details>
        )}
      </Card>

      {/* Rules */}
      <Card style={{ marginTop: 8 }}>
        <SectionTitle>Non-Negotiable Rules</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {[
            'No remote creation, push, or cloud sync',
            'No background daemon unless explicitly launched',
            'No deleting notes or rewriting official notes',
            'No automatic or batch acceptance',
            'No executing work orders generated by WilliamOS',
            'No secrets, .env, tokens, or hardcoded paths',
            'No pretending a check passed if it did not',
          ].map((rule, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'start', gap: 8, fontSize: 13, color: C.textMuted, padding: '4px 0' }}>
              <span style={{ color: C.red, fontSize: 10, marginTop: 4 }}>&#9679;</span>
              {rule}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OPERATOR HOME — no-slop daily console over the existing engine
// ---------------------------------------------------------------------------
function OperatorPill({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? '#61b982' : tone === 'warn' ? '#d8a34b' : tone === 'bad' ? '#d56b63' : '#7ca7c8'
  return (
    <div style={{
      minHeight: 42,
      border: `1px solid ${C.borderLight}`,
      borderRadius: 8,
      padding: '8px 10px',
      background: '#101720',
    }}>
      <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 800 }}>{label}</div>
      <div style={{ marginTop: 3, color, fontSize: 13, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function OperatorPanel({ title, action, children, style }: { title: string; action?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section style={{
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      background: '#111820',
      minWidth: 0,
      ...style,
    }}>
      <div style={{
        minHeight: 42,
        padding: '11px 13px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>{title}</h3>
        {action}
      </div>
      <div style={{ padding: 13 }}>{children}</div>
    </section>
  )
}

const RESEARCH_CLASSES = [
  'Research',
  'Evidence',
  'Work item',
  'Decision support',
  'TerraFusion',
  'Appraisal / county',
  'Personal notes',
  'Inbox',
]

function ResearchDropZone({ onIntake }: { onIntake: (item: any) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [classification, setClassification] = useState('Research')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const ingest = useCallback(async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setResult(null)
    try {
      const r = await api.uploadResearch(file, classification)
      setResult(r)
      if (r?.ok && r.item) onIntake(r.item)
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || 'Upload failed' })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [classification, onIntake])

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    ingest(e.dataTransfer.files?.[0])
  }, [ingest])

  const item = result?.item
  const border = dragging ? '#7ca7c8' : C.borderLight
  const background = dragging ? 'rgba(124,167,200,.10)' : '#0d141d'

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          minHeight: 116,
          border: `1px dashed ${border}`,
          borderRadius: 8,
          background,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 8,
          padding: 16,
          cursor: 'pointer',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          onChange={e => ingest(e.target.files?.[0])}
          style={{ display: 'none' }}
          accept=".pdf,.txt,.md,.markdown,.csv,.html,.htm,.png,.jpg,.jpeg,.gif,.webp"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Drop Research</div>
            <div style={{ marginTop: 4, color: C.textMuted, fontSize: 12, lineHeight: 1.4 }}>
              PDF, text, markdown, CSV, HTML, or image. Original is preserved; note stays unreviewed.
            </div>
          </div>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
            disabled={uploading}
            style={{
              height: 32,
              borderRadius: 7,
              border: `1px solid ${C.borderLight}`,
              background: '#182330',
              color: C.text,
              fontSize: 12,
              fontWeight: 700,
              padding: '0 12px',
              cursor: uploading ? 'not-allowed' : 'pointer',
            }}
          >
            {uploading ? 'Filing...' : 'Add file'}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: C.textDim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 800 }}>Classify as</span>
        <select
          value={classification}
          onChange={e => setClassification(e.target.value)}
          style={{
            background: '#0d141d',
            color: C.text,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 7,
            height: 30,
            padding: '0 8px',
            fontSize: 12,
          }}
        >
          {RESEARCH_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {result && (
        <div style={{
          marginTop: 12,
          border: `1px solid ${result.ok ? 'rgba(97,185,130,.35)' : 'rgba(213,107,99,.42)'}`,
          background: result.ok ? 'rgba(97,185,130,.07)' : 'rgba(213,107,99,.08)',
          borderRadius: 8,
          padding: 11,
          fontSize: 12,
        }}>
          <div style={{ color: result.ok ? '#bfe8cc' : '#efb0a9', fontWeight: 800 }}>
            {result.ok ? (result.duplicate ? 'Duplicate detected. No new copy created.' : 'Filed into research intake.') : 'Intake failed.'}
          </div>
          <div style={{ color: C.textMuted, marginTop: 5 }}>{result.message ?? result.error}</div>
          {item && (
            <div style={{ marginTop: 9, display: 'grid', gap: 5, color: C.textMuted }}>
              <div><strong style={{ color: C.text }}>Original:</strong> {item.original_path}</div>
              <div><strong style={{ color: C.text }}>Note:</strong> {item.note_path}</div>
              <div><strong style={{ color: C.text }}>Hash:</strong> {String(item.hash).slice(0, 16)}...</div>
              <div><strong style={{ color: C.text }}>Indexes:</strong> search {item.search_index?.ok ? 'ok' : 'review'}, RAG {item.rag_index?.ok ? 'ok' : 'review'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MemoryGovernancePanel() {
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [review, setReview] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [auditFactId, setAuditFactId] = useState<number | null>(null)
  const [auditEvents, setAuditEvents] = useState<any[]>([])
  const [exportResult, setExportResult] = useState<any>(null)
  const [draftText, setDraftText] = useState('')
  const [result, setResult] = useState<any>(null)

  const loadFacts = useCallback(async () => {
    setLoading(true)
    try {
      const [r, q] = await Promise.all([api.memoryFacts(), api.memoryReview()])
      setFacts(r.facts ?? [])
      setReview(q)
    } catch (e: any) {
      setResult({ ok: false, error: e?.message ?? 'Could not load memory facts.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFacts() }, [loadFacts])

  const runFactAction = useCallback(async (factId: number, action: () => Promise<any>) => {
    setBusyId(factId)
    setResult(null)
    try {
      const r = await action()
      setResult(r)
      if (r?.ok) {
        await loadFacts()
        setEditingId(null)
        setDraftText('')
        setAuditFactId(null)
        setAuditEvents([])
      }
    } catch (e: any) {
      setResult({ ok: false, error: e?.message ?? 'Memory action failed.' })
    } finally {
      setBusyId(null)
    }
  }, [loadFacts])

  const loadAudit = useCallback(async (factId: number) => {
    setAuditFactId(factId)
    const r = await api.memoryFactAudit(factId)
    setAuditEvents(r.events ?? [])
  }, [])

  const exportMemory = useCallback(async (format: string) => {
    setExportResult(await api.exportMemory(format))
  }, [])

  if (loading) {
    return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading memory facts...</p>
  }

  const activeFacts = facts.filter(f => !f.archived)
  const needsReview = activeFacts.filter(f => f.review_required && !f.stale)
  const staleFacts = activeFacts.filter(f => f.stale)
  const canonFacts = activeFacts.filter(f => f.authority_state === 'canon')
  const conflictFacts = activeFacts.filter(f => f.conflict)
  const counts = review?.counts ?? {
    needs_review: needsReview.length,
    stale: staleFacts.length,
    conflicts: conflictFacts.length,
    canon: canonFacts.length,
    total: activeFacts.length,
  }
  const visibleFacts = [
    ...conflictFacts,
    ...needsReview.filter(f => !conflictFacts.some(c => c.id === f.id)),
    ...staleFacts.filter(f => !conflictFacts.some(c => c.id === f.id)),
    ...canonFacts.filter(f => !conflictFacts.some(c => c.id === f.id)),
    ...activeFacts.filter(f =>
      !conflictFacts.some(c => c.id === f.id)
      && !needsReview.some(r => r.id === f.id)
      && !staleFacts.some(s => s.id === f.id)
      && !canonFacts.some(c => c.id === f.id)
    ),
  ].slice(0, 8)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Facts are reviewed locally. Stale and archived facts are excluded from chat context; canon requires operator confirmation.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        {[
          ['Review', counts.needs_review ?? 0, '#efd49d'],
          ['Canon', counts.canon ?? 0, '#bfe8cc'],
          ['Stale', counts.stale ?? 0, '#efb0a9'],
          ['Conflict', counts.conflicts ?? 0, '#d8a34b'],
        ].map(([label, value, color]) => (
          <div key={String(label)} style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 8px', background: '#0d141d' }}>
            <div style={{ color: C.textDim, fontSize: 9, textTransform: 'uppercase', fontWeight: 800 }}>{label}</div>
            <div style={{ color: String(color), fontSize: 14, fontWeight: 800 }}>{String(value)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={() => exportMemory('json')}
          style={{ height: 26, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#101720', color: C.textMuted, fontSize: 11, cursor: 'pointer' }}
        >
          Export JSON
        </button>
        <button
          onClick={() => exportMemory('markdown')}
          style={{ height: 26, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#101720', color: C.textMuted, fontSize: 11, cursor: 'pointer' }}
        >
          Export Markdown
        </button>
      </div>

      {result && (
        <div style={{
          border: `1px solid ${result.ok ? 'rgba(97,185,130,.35)' : 'rgba(213,107,99,.42)'}`,
          background: result.ok ? 'rgba(97,185,130,.07)' : 'rgba(213,107,99,.08)',
          color: result.ok ? '#bfe8cc' : '#efb0a9',
          borderRadius: 8,
          padding: 9,
          fontSize: 12,
        }}>
          {result.ok ? 'Memory updated.' : (result.error ?? 'Memory action failed.')}
        </div>
      )}

      {exportResult && (
        <Details label={`Export ready: ${exportResult.format ?? 'memory'}`}>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 11 }}>
            {exportResult.content ?? JSON.stringify(exportResult, null, 2)}
          </pre>
        </Details>
      )}

      {visibleFacts.length === 0 ? (
        <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>No remembered facts yet.</p>
      ) : (
        visibleFacts.map(fact => {
          const editing = editingId === fact.id
          const busy = busyId === fact.id
          const tone = fact.conflict ? '#d8a34b' : fact.stale ? '#efd49d' : fact.authority_state === 'canon' ? '#bfe8cc' : '#7ca7c8'
          const stateLabel = fact.conflict ? 'conflict' : fact.stale ? 'stale' : fact.authority_state
          return (
            <div key={fact.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 9 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                <span style={{ color: tone, fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>
                  {stateLabel}
                </span>
                <span style={{ color: C.textDim, fontSize: 10 }}>#{fact.id}</span>
              </div>

              {editing ? (
                <textarea
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: '#0d141d',
                    color: C.text,
                    border: `1px solid ${C.borderLight}`,
                    borderRadius: 7,
                    padding: 8,
                    fontSize: 12,
                    lineHeight: 1.4,
                    marginTop: 7,
                  }}
                />
              ) : (
                <div style={{ color: C.text, fontSize: 12, lineHeight: 1.4, marginTop: 4 }}>{fact.text}</div>
              )}

              <div style={{ color: C.textDim, fontSize: 10, lineHeight: 1.35, marginTop: 5 }}>
                Source: {fact.source || 'unknown'} · Citation: {fact.citation ?? `memory.fact:${fact.id}`}
              </div>
              <div style={{ color: C.textDim, fontSize: 10, lineHeight: 1.35, marginTop: 2 }}>
                Created: {fact.created || 'unknown'} · Last used: {fact.last_used || 'never'} · Indicator: {fact.staleness_indicator ?? 'current'}
              </div>
              {fact.conflict && (
                <div style={{ color: '#efd49d', fontSize: 10, marginTop: 4 }}>
                  Conflicts with: {(fact.conflict_with ?? []).map(id => `#${id}`).join(', ')}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {editing ? (
                  <>
                    <button
                      disabled={busy || !draftText.trim()}
                      onClick={() => runFactAction(fact.id, () => api.editMemoryFact(fact.id, draftText.trim()))}
                      style={{ height: 26, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, cursor: 'pointer' }}
                    >
                      Save
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => { setEditingId(null); setDraftText('') }}
                      style={{ height: 26, borderRadius: 7, border: `1px solid ${C.border}`, background: '#101720', color: C.textMuted, fontSize: 11, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => { setEditingId(fact.id); setDraftText(fact.text) }}
                      style={{ height: 26, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => runFactAction(fact.id, () => api.markMemoryFactStale(fact.id, !fact.stale))}
                      style={{ height: 26, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, cursor: 'pointer' }}
                    >
                      {fact.stale ? 'Restore' : 'Mark stale'}
                    </button>
                    {fact.authority_state !== 'canon' && !fact.stale && (
                      <button
                        disabled={busy}
                        onClick={() => runFactAction(fact.id, () => api.setMemoryFactAuthority(fact.id, 'canon', 'PROMOTE'))}
                        style={{ height: 26, borderRadius: 7, border: `1px solid rgba(97,185,130,.40)`, background: 'rgba(97,185,130,.08)', color: '#bfe8cc', fontSize: 11, cursor: 'pointer' }}
                      >
                        Promote
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => loadAudit(fact.id)}
                      style={{ height: 26, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#101720', color: C.textMuted, fontSize: 11, cursor: 'pointer' }}
                    >
                      Audit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => runFactAction(fact.id, () => api.deleteMemoryFact(fact.id, 'DELETE'))}
                      style={{ height: 26, borderRadius: 7, border: `1px solid rgba(213,107,99,.45)`, background: 'rgba(213,107,99,.08)', color: '#efb0a9', fontSize: 11, cursor: 'pointer' }}
                    >
                      Archive
                    </button>
                  </>
                )}
              </div>
              {auditFactId === fact.id && (
                <div style={{ marginTop: 8, border: `1px solid ${C.border}`, borderRadius: 7, padding: 8, background: '#0d141d' }}>
                  <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 800, marginBottom: 5 }}>Audit</div>
                  {auditEvents.length === 0 ? (
                    <div style={{ color: C.textMuted, fontSize: 11 }}>No audit events recorded.</div>
                  ) : auditEvents.slice(0, 5).map(event => (
                    <div key={event.id} style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginBottom: 4 }}>
                      <strong style={{ color: C.text }}>{event.action}</strong> · {event.created}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}

      <button
        onClick={loadFacts}
        style={{ height: 28, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#101720', color: C.textMuted, fontSize: 12, cursor: 'pointer' }}
      >
        Refresh memory
      </button>
    </div>
  )
}

function DecisionRegisterPanel() {
  const [decisions, setDecisions] = useState<DecisionRecord[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (q = '') => {
    setLoading(true)
    setError('')
    try {
      const r = await api.decisions(q)
      setDecisions(r.decisions ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Could not load decisions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = decisions.slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Active governing decisions. Read-only seed register; no automatic decision creation.
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load(query.trim()) }}
          placeholder="Search decisions"
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            background: '#0d141d',
            color: C.text,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 7,
            padding: '0 8px',
            fontSize: 12,
          }}
        />
        <button
          onClick={() => load(query.trim())}
          style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, cursor: 'pointer' }}
        >
          Search
        </button>
      </div>

      {loading ? (
        <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading decisions...</p>
      ) : error ? (
        <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>
      ) : visible.length === 0 ? (
        <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>No matching decisions.</p>
      ) : (
        visible.map(decision => (
          <div key={decision.decision_id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
              <span style={{ color: decision.status === 'active' ? '#bfe8cc' : '#efd49d', fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>
                {decision.status}
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{decision.authority}</span>
            </div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.35, marginTop: 4, fontWeight: 700 }}>{decision.title}</div>
            <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{decision.decision}</div>
            <div style={{ color: C.textDim, fontSize: 10, lineHeight: 1.35, marginTop: 5 }}>
              {decision.decision_id} · Review: {decision.review_at}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function DoctrineRegistryPanel() {
  const [rules, setRules] = useState<DoctrineRule[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (q = '') => {
    setLoading(true)
    setError('')
    try {
      const r = await api.doctrine(q)
      setRules(r.doctrine ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Could not load doctrine.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = rules.slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Active operating rules. Read-only seed registry; existing safety gates remain authoritative.
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load(query.trim()) }}
          placeholder="Search doctrine"
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            background: '#0d141d',
            color: C.text,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 7,
            padding: '0 8px',
            fontSize: 12,
          }}
        />
        <button
          onClick={() => load(query.trim())}
          style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, cursor: 'pointer' }}
        >
          Search
        </button>
      </div>

      {loading ? (
        <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading doctrine...</p>
      ) : error ? (
        <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>
      ) : visible.length === 0 ? (
        <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>No matching doctrine.</p>
      ) : (
        visible.map(rule => (
          <div key={rule.rule_id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
              <span style={{ color: rule.status === 'active' ? '#bfe8cc' : '#efd49d', fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>
                {rule.status}
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>{rule.scope.slice(0, 2).join(' / ')}</span>
            </div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.35, marginTop: 4, fontWeight: 700 }}>{rule.title}</div>
            <div style={{ display: 'grid', gap: 4, marginTop: 6, fontSize: 11, lineHeight: 1.35 }}>
              <div style={{ color: C.textMuted }}><strong style={{ color: '#bfe8cc' }}>Allowed:</strong> {rule.allowed[0]}</div>
              <div style={{ color: C.textMuted }}><strong style={{ color: '#efb0a9' }}>Forbidden:</strong> {rule.forbidden[0]}</div>
              <div style={{ color: C.textMuted }}><strong style={{ color: '#efd49d' }}>Approval:</strong> {rule.requires_approval[0]}</div>
            </div>
            <div style={{ color: C.textDim, fontSize: 10, lineHeight: 1.35, marginTop: 6 }}>
              {rule.rule_id} · Owner: {rule.owner}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function WorkOrderPanel() {
  const [orders, setOrders] = useState<WorkOrderRecord[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (q = '') => {
    setLoading(true)
    setError('')
    try {
      const r = q ? await api.workOrders(q) : await api.activeWorkOrders()
      setOrders(r.work_orders ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Could not load work orders.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = orders.slice(0, 4)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Active scoped work. Read-only seed registry; no autonomous execution or status mutation.
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load(query.trim()) }}
          placeholder="Search WOs"
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            background: '#0d141d',
            color: C.text,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 7,
            padding: '0 8px',
            fontSize: 12,
          }}
        />
        <button
          onClick={() => load(query.trim())}
          style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, cursor: 'pointer' }}
        >
          Search
        </button>
      </div>

      {loading ? (
        <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading work orders...</p>
      ) : error ? (
        <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>
      ) : visible.length === 0 ? (
        <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>No matching work orders.</p>
      ) : (
        visible.map(order => (
          <div key={order.wo_id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
              <span style={{ color: order.status === 'active' ? '#bfe8cc' : '#efd49d', fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>
                {order.status}
              </span>
              <span style={{ color: C.textDim, fontSize: 10 }}>Phase {order.phase}</span>
            </div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.35, marginTop: 4, fontWeight: 700 }}>{order.title}</div>
            <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{order.goal}</div>
            <div style={{ display: 'grid', gap: 4, marginTop: 6, fontSize: 11, lineHeight: 1.35 }}>
              <div style={{ color: C.textMuted }}><strong style={{ color: '#bfe8cc' }}>Validator:</strong> {order.validators[0]}</div>
              <div style={{ color: C.textMuted }}><strong style={{ color: '#efb0a9' }}>Stop:</strong> {order.stop_conditions[0]}</div>
              <div style={{ color: C.textMuted }}><strong style={{ color: '#efd49d' }}>Commit:</strong> {order.commit ? order.commit.slice(0, 7) : 'pending approval'}</div>
            </div>
            <div style={{ color: C.textDim, fontSize: 10, lineHeight: 1.35, marginTop: 6 }}>
              {order.wo_id} · Evidence: {order.evidence.length}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function ComposerTextArea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>{label}</span>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          resize: 'vertical',
          background: '#0d141d',
          color: C.text,
          border: `1px solid ${C.borderLight}`,
          borderRadius: 7,
          padding: 8,
          fontSize: 12,
          lineHeight: 1.4,
        }}
      />
    </label>
  )
}

function WorkOrderComposerPanel() {
  const [title, setTitle] = useState('Phase 5O Candidate')
  const [objective, setObjective] = useState('Create the next governed local-only WilliamOS work packet.')
  const [allowedScope, setAllowedScope] = useState('control-center/backend/**\ncontrol-center/frontend/src/**\nWilliamOS/95_ReleaseGovernance/**')
  const [deniedActions, setDeniedActions] = useState('push\nPR\nmerge\nrelease\ntag\nMCP activation\nautonomy\nscheduler\nproduction/data writes')
  const [validators, setValidators] = useState('python -m pytest control-center/backend/tests -q\ncd control-center/frontend && npm run build')
  const [evidence, setEvidence] = useState('validation report\ngit status before/after\nfiles changed list\nsafety review')
  const [runbooks, setRunbooks] = useState<ValidationRunbook[]>([])
  const [selectedRunbooks, setSelectedRunbooks] = useState<string[]>(['backend-full', 'frontend-build'])
  const [preview, setPreview] = useState<WorkOrderComposePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const compose = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.composeWorkOrder({
        title,
        objective,
        phase: '5N',
        lane: title || 'Work Order Composer',
        allowed_scope: splitLines(allowedScope),
        denied_actions: splitLines(deniedActions),
        validators: splitLines(validators),
        validator_runbook_ids: selectedRunbooks,
        evidence_outputs: splitLines(evidence),
      })
      setPreview(result)
      if (!result.ok) setError(result.error ?? 'Could not compose work order.')
    } catch (e: any) {
      setError(e?.message ?? 'Could not compose work order.')
    } finally {
      setLoading(false)
    }
  }, [allowedScope, deniedActions, evidence, objective, selectedRunbooks, title, validators])

  useEffect(() => {
    api.validationRunbooks()
      .then(result => setRunbooks(result.runbooks ?? []))
      .catch(() => setRunbooks([]))
  }, [])

  useEffect(() => { compose() }, [])

  const toggleRunbook = useCallback((runbookId: string) => {
    setSelectedRunbooks(prev => prev.includes(runbookId)
      ? prev.filter(id => id !== runbookId)
      : [...prev, runbookId])
  }, [])

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only structured Work Order packet. No save, no execution, no registry mutation, no scheduler.
      </div>
      <label style={{ display: 'grid', gap: 5 }}>
        <span style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>Title</span>
        <input value={title} onChange={e => setTitle(e.target.value)} style={{ height: 30, background: '#0d141d', color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 7, padding: '0 8px', fontSize: 12 }} />
      </label>
      <ComposerTextArea label="Objective" value={objective} onChange={setObjective} rows={3} />
      <ComposerTextArea label="Allowed scope" value={allowedScope} onChange={setAllowedScope} />
      <ComposerTextArea label="Denied actions" value={deniedActions} onChange={setDeniedActions} />
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>Approved validation runbooks</div>
        {runbooks.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: 12 }}>No runbooks loaded.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6, maxHeight: 150, overflow: 'auto' }}>
            {runbooks.slice(0, 6).map(runbook => {
              const selected = selectedRunbooks.includes(runbook.id)
              return (
                <button key={runbook.id} onClick={() => toggleRunbook(runbook.id)} style={{
                  textAlign: 'left',
                  border: `1px solid ${selected ? C.blue : C.border}`,
                  background: selected ? C.blueGlow : '#0d141d',
                  color: C.text,
                  borderRadius: 8,
                  padding: 8,
                  cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 12 }}>{runbook.name}</strong>
                    <span style={{ color: runbook.requires_owner_approval ? '#efd49d' : '#bfe8cc', fontSize: 10, fontWeight: 900 }}>
                      {runbook.requires_owner_approval ? 'owner-gated' : 'local'}
                    </span>
                  </div>
                  <div style={{ color: C.textMuted, fontSize: 11, marginTop: 3 }}>{runbook.commands[0]}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <ComposerTextArea label="Validators" value={validators} onChange={setValidators} />
      <ComposerTextArea label="Evidence outputs" value={evidence} onChange={setEvidence} />
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      <button onClick={compose} disabled={loading || !objective.trim()} style={{ height: 32, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: objective.trim() ? 'pointer' : 'not-allowed' }}>
        {loading ? 'Composing...' : 'Preview packet'}
      </button>
      {preview?.draft && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: '#111820', padding: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7, marginBottom: 8 }}>
            <OperatorPill label="WO" value={preview.draft.wo_id.slice(0, 22)} tone="neutral" />
            <OperatorPill label="Mode" value={preview.draft.status} tone="good" />
            <OperatorPill label="Executes" value={String(preview.draft.would_execute)} tone={preview.draft.would_execute ? 'bad' : 'good'} />
            <OperatorPill label="Persists" value={String(preview.draft.would_persist)} tone={preview.draft.would_persist ? 'bad' : 'good'} />
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 220, overflow: 'auto', color: C.textMuted, fontSize: 11, background: '#0d141d', border: `1px solid ${C.border}`, borderRadius: 8, padding: 9 }}>
            {preview.packet_markdown}
          </pre>
        </div>
      )}
    </div>
  )
}

function ValidationRunbookPanel() {
  const [runbooks, setRunbooks] = useState<ValidationRunbook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.validationRunbooks()
      setRunbooks(result.runbooks ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Could not load validation runbooks.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading validation runbooks...</p>

  return (
    <div style={{ display: 'grid', gap: 9 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Metadata-only validation recipes. They are references for WOs; this panel does not execute validators.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {runbooks.slice(0, 5).map(runbook => (
        <div key={runbook.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 9 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 12 }}>{runbook.name}</strong>
            <span style={{ color: runbook.risk_level === 'medium' ? '#efd49d' : '#bfe8cc', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>
              {runbook.risk_level}
            </span>
          </div>
          <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{runbook.description}</div>
          <div style={{ color: C.textDim, fontSize: 10, marginTop: 5 }}>
            {runbook.category} · execute {String(runbook.would_execute)} · scheduler {String(runbook.scheduler_enabled)}
          </div>
        </div>
      ))}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh runbooks
      </button>
    </div>
  )
}

function DevOpsPlaybookPanel() {
  const [summary, setSummary] = useState<any>(null)
  const [goal, setGoal] = useState('/goal create work order for Current Truth Panel')
  const [authority, setAuthority] = useState('A0_READ_ONLY')
  const [target, setTarget] = useState('WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001')
  const [loopType, setLoopType] = useState('verify')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [goalPacket, setGoalPacket] = useState<any>(null)
  const [loopPacket, setLoopPacket] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.devopsPlaybook()
      setSummary(r)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load DevOps playbook.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const classifyGoal = useCallback(async () => {
    if (!goal.trim()) return
    setBusy('goal')
    setError('')
    try {
      const cleaned = goal.trim().replace(/^\/goal\s+/i, '')
      const r = await api.classifyDevOpsGoal(cleaned, authority)
      setGoalPacket(r)
    } catch (e: any) {
      setError(e?.message ?? 'Could not classify goal.')
    } finally {
      setBusy('')
    }
  }, [goal, authority])

  const planLoop = useCallback(async () => {
    if (!target.trim()) return
    setBusy('loop')
    setError('')
    try {
      const r = await api.planDevOpsLoop(target.trim(), loopType, authority, 1)
      setLoopPacket(r)
    } catch (e: any) {
      setError(e?.message ?? 'Could not plan loop.')
    } finally {
      setBusy('')
    }
  }, [target, loopType, authority])

  const truth = goalPacket?.current_truth ?? summary?.current_truth
  const banner = goalPacket?.handoff_banner ?? loopPacket?.handoff_banner ?? summary?.handoff_banner
  const authorityLevels = summary?.authority_levels ?? ['A0_READ_ONLY', 'A1_DRAFT_ONLY', 'A2_LOCAL_MUTATION']
  const loopTypes = summary?.loop_types ?? ['read', 'verify', 'plan', 'execute', 'evidence', 'watch']

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading DevOps playbook...</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Classifies goals and plans loops from the work-order playbook. It drafts packets only; it does not execute, commit, push, tag, or promote.
      </div>

      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}

      {truth && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
          <OperatorPill label="Posture" value={truth.posture ?? 'unknown'} tone={truth.posture === 'READY' ? 'good' : 'warn'} />
          <OperatorPill label="Phase 6" value={truth.phase_6_status ?? 'blocked'} tone={truth.phase_6_status === 'blocked' ? 'good' : 'bad'} />
          <OperatorPill label="Branch" value={truth.branch ?? 'unknown'} tone="neutral" />
          <OperatorPill label="Worktree" value={truth.worktree_dirty ? 'Dirty' : 'Clean'} tone={truth.worktree_dirty ? 'warn' : 'good'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={authority} onChange={e => setAuthority(e.target.value)} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#0d141d', color: C.text, fontSize: 11, padding: '0 7px', maxWidth: 150 }}>
          {authorityLevels.map((level: string) => <option key={level} value={level}>{level}</option>)}
        </select>
        <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#101720', color: C.textMuted, fontSize: 11, cursor: 'pointer', padding: '0 9px' }}>
          Refresh
        </button>
      </div>

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: '#0d141d', padding: 10 }}>
        <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, marginBottom: 7 }}>Goal classifier</div>
        <textarea
          value={goal}
          onChange={e => setGoal(e.target.value)}
          rows={3}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: '#101720', color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 7, padding: 8, fontSize: 12, lineHeight: 1.4 }}
        />
        <button disabled={busy === 'goal' || !goal.trim()} onClick={classifyGoal} style={{ marginTop: 7, height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: goal.trim() ? 'pointer' : 'not-allowed' }}>
          {busy === 'goal' ? 'Classifying...' : 'Classify goal'}
        </button>
      </div>

      {goalPacket?.ok && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7, marginBottom: 8 }}>
            <OperatorPill label="Lane" value={goalPacket.LANE} tone="neutral" />
            <OperatorPill label="Mode" value={goalPacket.MODE} tone={goalPacket.MODE === 'EXECUTE' ? 'warn' : 'good'} />
            <OperatorPill label="Granted" value={goalPacket.AUTHORITY_GRANTED} tone={goalPacket.AUTHORITY_GRANTED === goalPacket.AUTHORITY_REQUESTED ? 'good' : 'warn'} />
            <OperatorPill label="Risk" value={goalPacket.RISK} tone={goalPacket.RISK === 'LOW' ? 'good' : goalPacket.RISK === 'P0' ? 'bad' : 'warn'} />
          </div>
          <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.4 }}>{goalPacket.RECOMMENDED_NEXT_MOVE}</div>
          {goalPacket.MISTAKE_PATTERN_MATCHES?.length > 0 && (
            <div style={{ marginTop: 8, color: '#efd49d', fontSize: 11, lineHeight: 1.35 }}>
              Mistake patterns: {goalPacket.MISTAKE_PATTERN_MATCHES.map((m: any) => `${m.pattern_id} ${m.title}`).join(', ')}
            </div>
          )}
          {goalPacket.DOCTRINE_CONFLICTS?.length > 0 && (
            <div style={{ marginTop: 8, color: '#efb0a9', fontSize: 11, lineHeight: 1.35 }}>
              Doctrine conflicts: {goalPacket.DOCTRINE_CONFLICTS.slice(0, 2).join(' | ')}
            </div>
          )}
          <div style={{ marginTop: 8, color: C.textDim, fontSize: 10 }}>
            Draft: {goalPacket.work_order_draft?.WO_ID} | {goalPacket.work_order_draft?.STATUS}
          </div>
        </div>
      )}

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: '#0d141d', padding: 10 }}>
        <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, marginBottom: 7 }}>Loop planner</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 7 }}>
          <input
            value={target}
            onChange={e => setTarget(e.target.value)}
            style={{ flex: 1, minWidth: 0, height: 30, background: '#101720', color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 7, padding: '0 8px', fontSize: 12 }}
          />
          <select value={loopType} onChange={e => setLoopType(e.target.value)} style={{ height: 32, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#101720', color: C.text, fontSize: 11, padding: '0 7px' }}>
            {loopTypes.map((type: string) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <button disabled={busy === 'loop' || !target.trim()} onClick={planLoop} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: target.trim() ? 'pointer' : 'not-allowed' }}>
          {busy === 'loop' ? 'Planning...' : 'Plan loop'}
        </button>
      </div>

      {loopPacket?.ok && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <strong style={{ fontSize: 12 }}>{loopPacket.LOOP_TYPE} loop</strong>
            <span style={{ color: loopPacket.BLOCKERS?.length ? '#efb0a9' : '#bfe8cc', fontSize: 11, fontWeight: 800 }}>{loopPacket.AUTHORITY}</span>
          </div>
          <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>{loopPacket.STOP_REASON}</div>
          <div style={{ marginTop: 7, color: C.textDim, fontSize: 10 }}>
            Actions: {(loopPacket.ACTIONS_TAKEN ?? []).join(' | ')}
          </div>
        </div>
      )}

      {banner && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 9, color: C.textDim, fontSize: 10, lineHeight: 1.45 }}>
          <div><strong style={{ color: C.textMuted }}>HANDOFF:</strong> {banner.HANDOFF_AUTHORITY}</div>
          <div><strong style={{ color: C.textMuted }}>MUTATION:</strong> {banner.MUTATION_AUTHORITY}</div>
          <div><strong style={{ color: C.textMuted }}>NEXT:</strong> {banner.NEXT_VALID_ACTION}</div>
        </div>
      )}
    </div>
  )
}

function AgentConfigInventoryPanel() {
  const [surfaces, setSurfaces] = useState<AgentConfigSurface[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (q = '') => {
    setLoading(true)
    setError('')
    try {
      const r = await api.agentConfigs(q)
      setSurfaces(r.surfaces ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Could not load agent config inventory.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = surfaces.slice(0, 6)
  const riskColor = (risk: string) => risk === 'high' ? '#efb0a9' : risk === 'review' || risk === 'unknown' ? '#efd49d' : '#bfe8cc'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Read-only external tool inventory. Secrets redacted; no config mutation or provider switching.
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load(query.trim()) }}
          placeholder="Search configs"
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            background: '#0d141d',
            color: C.text,
            border: `1px solid ${C.borderLight}`,
            borderRadius: 7,
            padding: '0 8px',
            fontSize: 12,
          }}
        />
        <button
          onClick={() => load(query.trim())}
          style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, cursor: 'pointer' }}
        >
          Search
        </button>
      </div>

      {loading ? (
        <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading config inventory...</p>
      ) : error ? (
        <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>
      ) : visible.length === 0 ? (
        <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>No matching config surfaces.</p>
      ) : (
        visible.map(surface => (
          <div key={surface.surface_id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
              <span style={{ color: surface.status === 'detected' ? '#bfe8cc' : C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>
                {surface.status}
              </span>
              <span style={{ color: riskColor(surface.risk_level), fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>{surface.risk_level}</span>
            </div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.35, marginTop: 4, fontWeight: 700 }}>{surface.label}</div>
            <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{surface.notes[0]}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
              {(surface.flags.length ? surface.flags : ['redacted']).slice(0, 3).map(flag => (
                <span key={flag} style={{ border: `1px solid ${C.borderLight}`, borderRadius: 6, padding: '2px 6px', color: C.textDim, fontSize: 10 }}>
                  {flag}
                </span>
              ))}
            </div>
            <div style={{ color: C.textDim, fontSize: 10, lineHeight: 1.35, marginTop: 6 }}>
              {surface.surface_id} · Locations: {surface.locations.length} · Secrets redacted: {surface.secrets_redacted ? 'yes' : 'no'}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function AgentSkillsPanel() {
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [selected, setSelected] = useState<AgentSkill | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.agentSkills()
      const rows = r.skills ?? []
      setSkills(rows)
      setSelected(rows[0] ?? null)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load agent skills.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading agent skills...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview only. No execution, no autonomy, no MCP activation, and no production writes.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflow: 'auto' }}>
        {skills.map(skill => (
          <button
            key={skill.id}
            onClick={() => setSelected(skill)}
            style={{
              textAlign: 'left',
              border: `1px solid ${selected?.id === skill.id ? C.blue : C.border}`,
              background: selected?.id === skill.id ? C.blueGlow : '#0d141d',
              borderRadius: 8,
              color: C.text,
              padding: 9,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 12 }}>{skill.name}</strong>
              <span style={{ color: skill.risk_level === 'high' ? '#efb0a9' : skill.risk_level === 'medium' ? '#efd49d' : '#bfe8cc', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>{skill.risk_level}</span>
            </div>
            <div style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>{skill.category} · {skill.mode}</div>
          </button>
        ))}
      </div>
      {selected && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: '#111820', padding: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <OperatorPill label="Read only" value={String(selected.read_only)} tone={selected.read_only ? 'good' : 'bad'} />
            <OperatorPill label="Would execute" value={String(selected.would_execute)} tone={selected.would_execute ? 'bad' : 'good'} />
            <OperatorPill label="Owner approval" value={selected.requires_owner_approval ? 'required' : 'not required'} tone={selected.requires_owner_approval ? 'warn' : 'good'} />
          </div>
          <div style={{ color: C.text, fontSize: 12, lineHeight: 1.4, marginBottom: 8 }}>{selected.description}</div>
          <div style={{ display: 'grid', gap: 7, fontSize: 11, lineHeight: 1.35 }}>
            <div style={{ color: C.textMuted }}><strong style={{ color: '#bfe8cc' }}>Allowed:</strong> {selected.allowed_actions.slice(0, 3).join('; ')}</div>
            <div style={{ color: C.textMuted }}><strong style={{ color: '#efb0a9' }}>Denied:</strong> {selected.denied_actions.slice(0, 3).join('; ')}</div>
            <div style={{ color: C.textMuted }}><strong style={{ color: '#efd49d' }}>Validators:</strong> {selected.required_validators.slice(0, 2).join('; ')}</div>
            <div style={{ color: C.textMuted }}><strong style={{ color: '#7ca7c8' }}>Evidence:</strong> {selected.evidence_outputs.join('; ')}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function EvidencePackPanel() {
  const [packet, setPacket] = useState<EvidencePacket | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPacket(await api.evidencePack())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load evidence pack.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Generating evidence preview...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Read-only handoff packet preview. Validators are listed, not run. No files are written.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {packet && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="HEAD" value={packet.short_head} tone="neutral" />
            <OperatorPill label="Worktree" value={packet.worktree_clean ? 'clean' : 'dirty'} tone={packet.worktree_clean ? 'good' : 'warn'} />
            <OperatorPill label="Branch" value={packet.branch} tone="neutral" />
            <OperatorPill label="Writes" value={String(packet.safety.would_write_files)} tone={packet.safety.would_write_files ? 'bad' : 'good'} />
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820' }}>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Next gate</div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.4 }}>{packet.next_valid_gate}</div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {packet.validators.slice(0, 4).map(validator => (
              <div key={validator.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }}>
                <strong style={{ fontSize: 12 }}>{validator.id}</strong>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>{validator.command}</div>
                <div style={{ color: C.textDim, fontSize: 10 }}>Result: {validator.last_result}</div>
              </div>
            ))}
          </div>
          {packet.git_status.length > 0 && (
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 140, overflow: 'auto', color: C.textMuted, fontSize: 11, background: '#0d141d', border: `1px solid ${C.border}`, borderRadius: 8, padding: 9 }}>
              {packet.git_status.join('\n')}
            </pre>
          )}
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh evidence
      </button>
    </div>
  )
}

function RepoStateDashboardPanel() {
  const [dashboard, setDashboard] = useState<RepoStateDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setDashboard(await api.repoState())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load repo state.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading repo state preview...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Read-only dashboard from current git state and validation evidence. No validators are run. No files are written.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {dashboard && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Baseline" value={dashboard.baseline.short_head} tone="neutral" />
            <OperatorPill label="Branch" value={dashboard.branch} tone="neutral" />
            <OperatorPill label="Worktree" value={dashboard.worktree.clean ? 'clean' : 'dirty'} tone={dashboard.worktree.clean ? 'good' : 'warn'} />
            <OperatorPill label="Gate" value={dashboard.gate_status.replace(/-/g, ' ')} tone={dashboard.gate_status.startsWith('ready') ? 'good' : 'warn'} />
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820' }}>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Next valid action</div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.4 }}>{dashboard.next_valid_action}</div>
          </div>
          <div>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Recent commits</div>
            <div style={{ display: 'grid', gap: 5 }}>
              {dashboard.recent_commits.slice(0, 4).map(commit => (
                <code key={commit} style={{ color: C.textMuted, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit}</code>
              ))}
            </div>
          </div>
          <div>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Validation reports</div>
            {dashboard.validation_history.latest_reports.length === 0 ? (
              <div style={{ color: C.textMuted, fontSize: 12 }}>No validation reports found.</div>
            ) : (
              <div style={{ display: 'grid', gap: 5 }}>
                {dashboard.validation_history.latest_reports.slice(0, 3).map(report => (
                  <div key={report.path} style={{ color: C.textMuted, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{report.name}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gap: 5 }}>
            {dashboard.active_gates.slice(0, 4).map(gate => (
              <div key={gate.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, fontSize: 11, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
                <strong style={{ color: C.text }}>{gate.label}</strong>
                <span style={{ color: C.textMuted }}>{gate.authority}</span>
              </div>
            ))}
          </div>
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>
            Preserved: {dashboard.non_authorizations_preserved.slice(0, 5).join(', ')}.
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh repo state
      </button>
    </div>
  )
}

function CommitReadinessPanel() {
  const [review, setReview] = useState<CommitReadinessReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReview(await api.commitReadiness())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load commit readiness.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Reviewing commit readiness...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only commit decision support. No staging, no commit, no validators run.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {review && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Decision" value={review.decision.replace(/_/g, ' ')} tone={review.safe_to_commit ? 'good' : 'warn'} />
            <OperatorPill label="Files" value={String(review.candidate_count)} tone={review.candidate_count > 0 ? 'neutral' : 'warn'} />
            <OperatorPill label="Dist" value={review.dist_status.present ? review.dist_status.decision : 'none'} tone={review.dist_status.decision === 'ok' ? 'good' : 'warn'} />
            <OperatorPill label="Validators run" value={String(review.validators_run_by_reviewer)} tone={review.validators_run_by_reviewer ? 'bad' : 'good'} />
          </div>
          {review.blockers.length > 0 && (
            <div style={{ border: '1px solid rgba(216,163,75,.45)', borderRadius: 8, background: 'rgba(216,163,75,.08)', padding: 10 }}>
              <div style={{ color: '#efd49d', fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Blockers</div>
              {review.blockers.map(blocker => <div key={blocker} style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>{blocker}</div>)}
            </div>
          )}
          <div>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Required validators</div>
            <div style={{ display: 'grid', gap: 5 }}>
              {review.required_validators.slice(0, 4).map(validator => (
                <div key={validator.id} style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>
                  <strong style={{ color: C.text }}>{validator.name}:</strong> {validator.commands[0]}
                </div>
              ))}
            </div>
          </div>
          {review.candidate_files.length > 0 && (
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 140, overflow: 'auto', color: C.textMuted, fontSize: 11, background: '#0d141d', border: `1px solid ${C.border}`, borderRadius: 8, padding: 9 }}>
              {review.candidate_files.map(file => `${file.code} ${file.path}`).join('\n')}
            </pre>
          )}
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>
            Preserved: {review.non_authorizations_preserved.slice(0, 5).join(', ')}.
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh readiness
      </button>
    </div>
  )
}

function HandoffPacketPanel() {
  const [packet, setPacket] = useState<HandoffPacketPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setCopied(false)
    try {
      setPacket(await api.handoffPacket())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load handoff packet.')
    } finally {
      setLoading(false)
    }
  }, [])

  const copyPacket = useCallback(async () => {
    if (!packet?.packet_text) return
    try {
      await navigator.clipboard.writeText(packet.packet_text)
      setCopied(true)
    } catch (e: any) {
      setError(e?.message ?? 'Clipboard copy failed.')
    }
  }, [packet])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Composing handoff packet...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only operator handoff. Copy uses clipboard only; no packet file is written.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {packet && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Result" value={packet.result} tone={packet.result === 'PASS' ? 'good' : 'warn'} />
            <OperatorPill label="HEAD" value={packet.repo_state.short_head} tone="neutral" />
            <OperatorPill label="Readiness" value={packet.commit_readiness.decision.replace(/_/g, ' ')} tone={packet.commit_readiness.safe_to_commit ? 'good' : 'warn'} />
            <OperatorPill label="Writes" value={String(packet.safety.would_write_files)} tone={packet.safety.would_write_files ? 'bad' : 'good'} />
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820' }}>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Next gate</div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.4 }}>{packet.next_valid_gate}</div>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 240, overflow: 'auto', color: C.textMuted, fontSize: 11, background: '#0d141d', border: `1px solid ${C.border}`, borderRadius: 8, padding: 9 }}>
            {packet.packet_text}
          </pre>
        </>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
          Refresh packet
        </button>
        <button onClick={copyPacket} disabled={!packet} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: copied ? 'rgba(97,185,130,.20)' : '#101720', color: copied ? '#bfe8cc' : C.text, fontSize: 11, fontWeight: 800, cursor: packet ? 'pointer' : 'not-allowed' }}>
          {copied ? 'Copied' : 'Copy packet'}
        </button>
      </div>
    </div>
  )
}

function OperatorReviewInboxPanel() {
  const [inbox, setInbox] = useState<OperatorReviewInbox | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setInbox(await api.operatorReviewInbox())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load operator review inbox.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading review inbox...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only review queue. Items are generated from current state; nothing is persisted or approved.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {inbox && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Items" value={String(inbox.total)} tone="neutral" />
            <OperatorPill label="Queue" value={inbox.queue_status} tone="good" />
            <OperatorPill label="Persists" value={String(inbox.safety.would_persist)} tone={inbox.safety.would_persist ? 'bad' : 'good'} />
            <OperatorPill label="Auto approve" value={String(inbox.safety.would_auto_approve)} tone={inbox.safety.would_auto_approve ? 'bad' : 'good'} />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {inbox.items.map(item => (
              <div key={item.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 12 }}>{item.title}</strong>
                  <span style={{ color: item.priority === 'high' ? '#efd49d' : '#bfe8cc', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>
                    {item.priority}
                  </span>
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{item.summary}</div>
                <div style={{ color: C.textDim, fontSize: 10, marginTop: 5 }}>
                  {item.kind} · allowed: {item.actions_allowed.join(', ')} · denied: {item.actions_denied.slice(0, 3).join(', ')}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh inbox
      </button>
    </div>
  )
}

function DecisionGateConsolePanel() {
  const [consoleState, setConsoleState] = useState<DecisionGateConsole | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setConsoleState(await api.decisionGateConsole())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load decision gate console.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading decision gates...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only owner decision support. This console does not approve gates, persist decisions, or execute work.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {consoleState && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Gate" value={consoleState.gate_status.replace(/-/g, ' ')} tone={consoleState.blocked_gates.length > 0 ? 'warn' : 'good'} />
            <OperatorPill label="HEAD" value={consoleState.short_head} tone="neutral" />
            <OperatorPill label="Decisions" value={String(consoleState.pending_owner_decisions.length)} tone="warn" />
            <OperatorPill label="Persists" value={String(consoleState.safety.would_persist)} tone={consoleState.safety.would_persist ? 'bad' : 'good'} />
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820' }}>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Recommended WO lane</div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.4 }}>{consoleState.recommended_work_order_lane}</div>
            <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 5 }}>{consoleState.next_valid_gate}</div>
          </div>
          {consoleState.blocked_gates.length > 0 && (
            <div style={{ border: '1px solid rgba(216,163,75,.45)', borderRadius: 8, background: 'rgba(216,163,75,.08)', padding: 10 }}>
              <div style={{ color: '#efd49d', fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Blocked gates</div>
              {consoleState.blocked_gates.map(gate => (
                <div key={gate.id} style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>
                  <strong style={{ color: C.text }}>{gate.label}:</strong> {gate.reason}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gap: 8 }}>
            {consoleState.pending_owner_decisions.map(decision => (
              <div key={decision.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 12 }}>{decision.title}</strong>
                  <span style={{ color: decision.owner_action_required ? '#efd49d' : '#bfe8cc', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>
                    {decision.status}
                  </span>
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{decision.reason}</div>
                <div style={{ color: C.textDim, fontSize: 10, marginTop: 5 }}>
                  source: {decision.source} · allowed: {decision.actions_allowed.join(', ')}
                </div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Allowed next actions</div>
            <div style={{ display: 'grid', gap: 5 }}>
              {consoleState.allowed_next_actions.map(action => (
                <div key={action.id} style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>
                  <strong style={{ color: C.text }}>{action.label}</strong> [{action.authority}] - {action.reason}
                </div>
              ))}
            </div>
          </div>
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>
            Denied: {consoleState.denied_actions.slice(0, 6).join(', ')}.
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh decisions
      </button>
    </div>
  )
}

function OperatorActionRouterPanel() {
  const [router, setRouter] = useState<OperatorActionRouterPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRouter(await api.operatorActionRouter())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load operator action router.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Routing safe next actions...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only route map. It classifies what authority would be needed next but performs no action.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {router && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Routes" value={String(router.route_count)} tone="neutral" />
            <OperatorPill label="Recommended" value={router.recommended_action_type} tone={router.recommended_action_type === 'stop' ? 'warn' : 'good'} />
            <OperatorPill label="Performs" value={String(router.safety.would_perform_action)} tone={router.safety.would_perform_action ? 'bad' : 'good'} />
            <OperatorPill label="Writes state" value={String(router.safety.would_write_state)} tone={router.safety.would_write_state ? 'bad' : 'good'} />
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820' }}>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Recommended WO lane</div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.4 }}>{router.recommended_work_order_lane}</div>
            <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 5 }}>{router.next_valid_gate}</div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {router.routes.map(route => (
              <div key={route.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 12 }}>{route.decision_title}</strong>
                  <span style={{ color: route.action_type === 'stop' ? '#efd49d' : '#bfe8cc', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>
                    {route.action_type}
                  </span>
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{route.reason}</div>
                <div style={{ color: C.textDim, fontSize: 10, marginTop: 5 }}>
                  authority: {route.authority_required} · performs: {String(route.would_perform)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>
            Action categories: {router.action_types.join(', ')}. Denied: {router.denied_actions.slice(0, 5).join(', ')}.
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh routes
      </button>
    </div>
  )
}

function AuthorityLedgerPanel() {
  const [ledger, setLedger] = useState<AuthorityLedgerPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setLedger(await api.authorityLedger())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load authority ledger.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading authority ledger...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only authority ledger. It shows missing authority but does not grant or record approval.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {ledger && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Entries" value={String(ledger.entry_count)} tone="neutral" />
            <OperatorPill label="Missing" value={String(ledger.missing_authorities.length)} tone={ledger.missing_authorities.length > 0 ? 'warn' : 'good'} />
            <OperatorPill label="Grants" value={String(ledger.safety.would_grant_authority)} tone={ledger.safety.would_grant_authority ? 'bad' : 'good'} />
            <OperatorPill label="Records" value={String(ledger.safety.would_record_approval)} tone={ledger.safety.would_record_approval ? 'bad' : 'good'} />
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820' }}>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Next authority question</div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.4 }}>{ledger.recommended_work_order_lane}</div>
            <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 5 }}>{ledger.next_valid_gate}</div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {ledger.entries.map(entry => (
              <div key={entry.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 12 }}>{entry.decision_title}</strong>
                  <span style={{ color: entry.authorized_now ? '#bfe8cc' : '#efd49d', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>
                    {entry.current_authority}
                  </span>
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{entry.reason}</div>
                <div style={{ color: C.textDim, fontSize: 10, marginTop: 5 }}>
                  required: {entry.authority_required} · approver: {entry.required_approver} · missing: {entry.missing_authority.join(', ') || 'none'}
                </div>
              </div>
            ))}
          </div>
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>
            Grantable authorities: {ledger.grantable_authorities.slice(0, 4).join(', ')}. Denied: {ledger.denied_actions.slice(0, 5).join(', ')}.
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh authority
      </button>
    </div>
  )
}

function OwnerDecisionRecordPreviewPanel() {
  const [preview, setPreview] = useState<OwnerDecisionRecordPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPreview(await api.ownerDecisionRecordPreview())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load owner decision preview.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Composing decision record preview...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only decision records. This drafts what would be recorded later, but writes nothing now.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {preview && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Drafts" value={String(preview.record_count)} tone="neutral" />
            <OperatorPill label="Owner req." value={String(preview.owner_required_count)} tone={preview.owner_required_count > 0 ? 'warn' : 'good'} />
            <OperatorPill label="Writes" value={String(preview.safety.would_write_decision_record)} tone={preview.safety.would_write_decision_record ? 'bad' : 'good'} />
            <OperatorPill label="Grants" value={String(preview.safety.would_grant_authority)} tone={preview.safety.would_grant_authority ? 'bad' : 'good'} />
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820' }}>
            <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 6 }}>Next decision context</div>
            <div style={{ color: C.text, fontSize: 12, lineHeight: 1.4 }}>{preview.recommended_work_order_lane}</div>
            <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 5 }}>{preview.next_valid_gate}</div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {preview.records.map(record => (
              <div key={record.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 12 }}>{record.title}</strong>
                  <span style={{ color: record.status === 'owner-required' ? '#efd49d' : '#bfe8cc', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>
                    {record.status}
                  </span>
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{record.recommended_record_text}</div>
                <div style={{ color: C.textDim, fontSize: 10, marginTop: 5 }}>
                  approver: {record.required_approver} · writes: {String(record.would_write_record)} · grants: {String(record.would_grant_authority)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>
            Missing authorities: {preview.missing_authorities.join(', ') || 'none'}. Denied: {preview.denied_actions.slice(0, 5).join(', ')}.
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh decision preview
      </button>
    </div>
  )
}

function ApprovalPacketPreviewPanel() {
  const [preview, setPreview] = useState<ApprovalPacketPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setCopied('')
    try {
      setPreview(await api.approvalPacketPreview())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load approval packet preview.')
    } finally {
      setLoading(false)
    }
  }, [])

  const copyPacket = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
    } catch (e: any) {
      setError(e?.message ?? 'Clipboard copy failed.')
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Composing approval packet preview...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only approval packets. Copy is clipboard-only; no approval, grant, or record write occurs.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {preview && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Packets" value={String(preview.packet_count)} tone="neutral" />
            <OperatorPill label="Owner req." value={String(preview.owner_required_count)} tone={preview.owner_required_count > 0 ? 'warn' : 'good'} />
            <OperatorPill label="Approves" value={String(preview.safety.would_approve_packet)} tone={preview.safety.would_approve_packet ? 'bad' : 'good'} />
            <OperatorPill label="Grants" value={String(preview.safety.would_grant_authority)} tone={preview.safety.would_grant_authority ? 'bad' : 'good'} />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {preview.packets.map(packet => (
              <div key={packet.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 12 }}>{packet.title}</strong>
                  <span style={{ color: packet.owner_required ? '#efd49d' : '#bfe8cc', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>
                    {packet.status}
                  </span>
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>
                  authority: {packet.authority_required} · approver: {packet.required_approver}
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', maxHeight: 120, overflow: 'auto', color: C.textMuted, fontSize: 10, background: '#0d141d', border: `1px solid ${C.border}`, borderRadius: 7, padding: 8 }}>
                  {packet.approval_text}
                </pre>
                <button onClick={() => copyPacket(packet.id, packet.approval_text)} style={{ marginTop: 7, height: 26, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: copied === packet.id ? 'rgba(97,185,130,.20)' : '#101720', color: copied === packet.id ? '#bfe8cc' : C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                  {copied === packet.id ? 'Copied' : 'Copy packet'}
                </button>
              </div>
            ))}
          </div>
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>
            Missing authorities: {preview.missing_authorities.join(', ') || 'none'}. Denied: {preview.denied_actions.slice(0, 5).join(', ')}.
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh packets
      </button>
    </div>
  )
}

function GoalRegistryPreviewPanel() {
  const [registry, setRegistry] = useState<GoalRegistryPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRegistry(await api.goalRegistry())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load goal registry preview.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading goal registry...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Metadata-only goal registry. Goals are inspectable previews; none are created, persisted, or executed.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {registry && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Goals" value={String(registry.total)} tone="neutral" />
            <OperatorPill label="Creates" value={String(registry.safety.would_create_goal)} tone={registry.safety.would_create_goal ? 'bad' : 'good'} />
            <OperatorPill label="Persists" value={String(registry.safety.would_persist)} tone={registry.safety.would_persist ? 'bad' : 'good'} />
            <OperatorPill label="Executes" value={String(registry.safety.would_execute)} tone={registry.safety.would_execute ? 'bad' : 'good'} />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {registry.goals.map(goal => (
              <div key={goal.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 12 }}>{goal.name}</strong>
                  <span style={{ color: '#bfe8cc', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>{goal.status}</span>
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>{goal.objective}</div>
                <div style={{ color: C.textDim, fontSize: 10, marginTop: 5 }}>
                  allowed lanes: {goal.allowed_lanes.length} · denied: {goal.denied_lanes.slice(0, 3).join(', ')}
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 5 }}>{goal.next_gate}</div>
              </div>
            ))}
          </div>
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>
            Denied actions: {registry.denied_actions.slice(0, 6).join(', ')}.
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh goals
      </button>
    </div>
  )
}

function LoopRegistryPreviewPanel() {
  const [registry, setRegistry] = useState<LoopRegistryPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRegistry(await api.loopRegistry())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load loop registry preview.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading loop registry...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Metadata-only loop registry. Loop plans are inspectable only; none are started, scheduled, or executed.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {registry && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Loops" value={String(registry.total)} tone="neutral" />
            <OperatorPill label="Starts" value={String(registry.safety.would_start_loop)} tone={registry.safety.would_start_loop ? 'bad' : 'good'} />
            <OperatorPill label="Schedules" value={String(registry.safety.would_schedule_loop)} tone={registry.safety.would_schedule_loop ? 'bad' : 'good'} />
            <OperatorPill label="Executes" value={String(registry.safety.would_execute)} tone={registry.safety.would_execute ? 'bad' : 'good'} />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {registry.loops.map(loop => (
              <div key={loop.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 12 }}>{loop.name}</strong>
                  <span style={{ color: '#bfe8cc', fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>{loop.status}</span>
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35, marginTop: 4 }}>
                  steps: {loop.steps.length} · stops: {loop.stop_conditions.length} · human gates: {loop.human_approval_gates.length}
                </div>
                <div style={{ color: C.textDim, fontSize: 10, marginTop: 5 }}>
                  denied: {loop.denied_actions.slice(0, 4).join(', ')}
                </div>
              </div>
            ))}
          </div>
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>
            Denied actions: {registry.denied_actions.slice(0, 6).join(', ')}.
          </div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh loops
      </button>
    </div>
  )
}

function GoalLoopReadinessPanel() {
  const [review, setReview] = useState<GoalLoopReadinessReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReview(await api.goalLoopReadiness())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load goal/loop readiness.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Reviewing goal/loop readiness...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Preview-only readiness review. It decides owner-review readiness without approving goals or starting loops.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {review && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Decision" value={review.decision.replace(/_/g, ' ')} tone={review.safe_for_owner_review ? 'good' : 'warn'} />
            <OperatorPill label="Goals" value={String(review.goals_reviewed)} tone="neutral" />
            <OperatorPill label="Loops" value={String(review.loops_reviewed)} tone="neutral" />
            <OperatorPill label="Executes" value={String(review.safety.would_execute_commands)} tone={review.safety.would_execute_commands ? 'bad' : 'good'} />
          </div>
          {review.blocked_gates.length > 0 && (
            <div style={{ color: '#efd49d', fontSize: 11, lineHeight: 1.35 }}>Blocked: {review.blocked_gates.join('; ')}</div>
          )}
          <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>
            Missing approvals: {review.missing_approvals.join(', ') || 'none'}.
          </div>
          <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>
            Required validators: {review.required_validators.slice(0, 4).map(v => v.id).join(', ')}.
          </div>
          <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.35 }}>{review.next_valid_gate}</div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh readiness
      </button>
    </div>
  )
}

function GoalCommandPreviewPanel() {
  const [request, setRequest] = useState('Finish governed goal loop readiness')
  const [preview, setPreview] = useState<GoalCommandPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPreview(await api.goalCommandPreview(request))
    } catch (e: any) {
      setError(e?.message ?? 'Could not preview goal command.')
    } finally {
      setLoading(false)
    }
  }, [request])

  useEffect(() => { load() }, [])

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Non-executing /goal preview. Classifies owner-review readiness without creating or running a goal.
      </div>
      <input value={request} onChange={e => setRequest(e.target.value)} style={{ background: '#0d141d', border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: 8, fontSize: 12 }} />
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {preview && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Decision" value={preview.preview.decision.replace(/_/g, ' ')} tone={preview.preview.allowed_for_owner_review ? 'good' : 'warn'} />
            <OperatorPill label="Creates" value={String(preview.safety.would_create_goal)} tone={preview.safety.would_create_goal ? 'bad' : 'good'} />
            <OperatorPill label="Executes" value={String(preview.safety.would_execute_goal)} tone={preview.safety.would_execute_goal ? 'bad' : 'good'} />
            <OperatorPill label="Schedules" value={String(preview.safety.scheduler_enabled)} tone={preview.safety.scheduler_enabled ? 'bad' : 'good'} />
          </div>
          {preview.preview.blocked_reasons.length > 0 && <div style={{ color: '#efd49d', fontSize: 11 }}>{preview.preview.blocked_reasons.join('; ')}</div>}
          <div style={{ color: C.textMuted, fontSize: 11 }}>Authority: {preview.preview.required_authority}. {preview.preview.next_valid_gate}</div>
        </>
      )}
      <button onClick={load} disabled={loading} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer' }}>
        {loading ? 'Previewing...' : 'Preview goal'}
      </button>
    </div>
  )
}

function LoopCommandPreviewPanel() {
  const [request, setRequest] = useState('Run local checks until pass then stop')
  const [preview, setPreview] = useState<LoopCommandPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPreview(await api.loopCommandPreview(request))
    } catch (e: any) {
      setError(e?.message ?? 'Could not preview loop command.')
    } finally {
      setLoading(false)
    }
  }, [request])

  useEffect(() => { load() }, [])

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Non-executing /loop preview. Requires a stop condition and never schedules or continues autonomously.
      </div>
      <input value={request} onChange={e => setRequest(e.target.value)} style={{ background: '#0d141d', border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: 8, fontSize: 12 }} />
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {preview && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Decision" value={preview.preview.decision.replace(/_/g, ' ')} tone={preview.preview.allowed_for_owner_review ? 'good' : 'warn'} />
            <OperatorPill label="Starts" value={String(preview.safety.would_start_loop)} tone={preview.safety.would_start_loop ? 'bad' : 'good'} />
            <OperatorPill label="Schedules" value={String(preview.safety.would_schedule_loop)} tone={preview.safety.would_schedule_loop ? 'bad' : 'good'} />
            <OperatorPill label="Continues" value={String(preview.safety.autonomous_continuation)} tone={preview.safety.autonomous_continuation ? 'bad' : 'good'} />
          </div>
          {preview.preview.blocked_reasons.length > 0 && <div style={{ color: '#efd49d', fontSize: 11 }}>{preview.preview.blocked_reasons.join('; ')}</div>}
          <div style={{ color: C.textMuted, fontSize: 11 }}>Authority: {preview.preview.required_authority}. Stop condition required: {String(preview.preview.stop_condition_required)}.</div>
        </>
      )}
      <button onClick={load} disabled={loading} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer' }}>
        {loading ? 'Previewing...' : 'Preview loop'}
      </button>
    </div>
  )
}

function GovernedGoalLoopConsolePanel() {
  const [consoleState, setConsoleState] = useState<GovernedGoalLoopConsole | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setConsoleState(await api.governedGoalLoopConsole())
    } catch (e: any) {
      setError(e?.message ?? 'Could not load governed goal/loop console.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Loading governed goal/loop console...</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.35 }}>
        Single preview console for goal registry, loop registry, readiness, authority, approvals, routes, and next gate.
      </div>
      {error && <div style={{ color: '#efb0a9', fontSize: 12 }}>{error}</div>}
      {consoleState && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            <OperatorPill label="Goals" value={String(consoleState.summary.goals)} tone="neutral" />
            <OperatorPill label="Loops" value={String(consoleState.summary.loops)} tone="neutral" />
            <OperatorPill label="Owner review" value={String(consoleState.summary.safe_for_owner_review)} tone={consoleState.summary.safe_for_owner_review ? 'good' : 'warn'} />
            <OperatorPill label="Executes" value={String(consoleState.safety.would_execute)} tone={consoleState.safety.would_execute ? 'bad' : 'good'} />
          </div>
          <div style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>
            Missing authorities: {consoleState.summary.missing_authorities}. Approval packets: {consoleState.summary.approval_packets}. Routes: {consoleState.summary.routes}.
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, background: '#111820', color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>
            Next valid gate: {consoleState.next_valid_gate}
          </div>
          <div style={{ color: C.textDim, fontSize: 11 }}>Denied: {consoleState.denied_actions.slice(0, 7).join(', ')}.</div>
        </>
      )}
      <button onClick={load} style={{ height: 30, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
        Refresh console
      </button>
    </div>
  )
}

function WorkerStateLabel({ worker }: { worker: any }) {
  const isRuntime = worker.kind === 'local_model_runtime'
  const tone = worker.available ? 'good' : worker.install?.installed ? 'warn' : 'bad'
  const color = tone === 'good' ? '#bfe8cc' : tone === 'warn' ? '#efd49d' : '#efb0a9'
  const label = isRuntime
    ? (worker.available ? 'Online' : worker.install?.installed ? 'Service offline' : 'Not installed')
    : (worker.available ? 'Available' : 'Not configured')
  return <span style={{ color, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{label}</span>
}

function DelegationReview({ event, onDecide }: { event: any; onDecide: (approved: boolean) => void }) {
  return (
    <div style={{
      marginTop: 10,
      border: '1px solid rgba(216,163,75,.55)',
      background: 'rgba(216,163,75,.08)',
      borderRadius: 8,
      padding: 11,
      fontSize: 12,
    }}>
      <div style={{ color: '#efd49d', fontWeight: 800, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.07em', marginBottom: 7 }}>
        Delegation review required
      </div>
      <div style={{ display: 'grid', gap: 5, color: C.textMuted }}>
        <div><strong style={{ color: C.text }}>Worker:</strong> {event.worker_label}</div>
        <div><strong style={{ color: C.text }}>Task:</strong> {event.task}</div>
        <div><strong style={{ color: C.text }}>Scope:</strong> {(event.scope?.allowed_paths ?? []).join(', ') || event.scope?.repo}</div>
        <div><strong style={{ color: C.text }}>Authority:</strong> {event.authority?.replace(/_/g, ' ')}</div>
        <div><strong style={{ color: C.text }}>Writes:</strong> {event.writes_allowed ? 'allowed' : 'not allowed'} · <strong style={{ color: C.text }}>Commit:</strong> {event.commit_allowed ? 'allowed' : 'not allowed'} · <strong style={{ color: C.text }}>Promotion:</strong> {event.promotion_allowed ? 'allowed' : 'not allowed'}</div>
        <div><strong style={{ color: C.text }}>Execution:</strong> proposal-only; applying output is a separate governed action.</div>
        {event.command_preview && <div><strong style={{ color: C.text }}>Command:</strong> <code>{event.command_preview}</code></div>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={() => onDecide(true)} style={{ border: 'none', borderRadius: 7, background: '#22c55e', color: '#fff', padding: '7px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          Approve intent
        </button>
        <button onClick={() => onDecide(false)} style={{ border: 'none', borderRadius: 7, background: '#ef4444', color: '#fff', padding: '7px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          Deny
        </button>
      </div>
    </div>
  )
}

function tierTone(tier: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (tier === 'forbidden') return 'bad'
  if (tier === 'confirmation-required' || tier === 'dry-run-first') return 'warn'
  if (tier === 'safe-read') return 'good'
  return 'neutral'
}

function parseCommandArgs(raw: string): string[] {
  return raw
    .split('\n')
    .flatMap(line => line.split(' '))
    .map(part => part.trim())
    .filter(Boolean)
}

function RuntimeEnginePanel() {
  const [runtime, setRuntime] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRuntime(await api.runtimeStatus())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ color: UI.muted, fontSize: 12 }}>Probing local runtimes...</div>

  const active = runtime?.active ?? {}
  const registry = runtime?.registry ?? []
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8 }}>
        <div style={{ border: `1px solid ${UI.border}`, borderRadius: 8, padding: 9, background: UI.panel2 }}>
          <div style={{ color: UI.dim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>Selected</div>
          <div style={{ color: UI.text, fontWeight: 900, marginTop: 4 }}>{runtime?.selected ?? 'unknown'}</div>
        </div>
        <div style={{ border: `1px solid ${UI.border}`, borderRadius: 8, padding: 9, background: UI.panel2 }}>
          <div style={{ color: UI.dim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>Policy</div>
          <div style={{ color: UI.green, fontWeight: 900, marginTop: 4 }}>{runtime?.policy ?? 'explicit-runtime-only'}</div>
        </div>
        <div style={{ border: `1px solid ${UI.border}`, borderRadius: 8, padding: 9, background: UI.panel2 }}>
          <div style={{ color: UI.dim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>Fallback</div>
          <div style={{ color: runtime?.fallback ? UI.red : UI.green, fontWeight: 900, marginTop: 4 }}>{String(runtime?.fallback ?? false)}</div>
        </div>
      </div>

      <div style={{ color: UI.muted, fontSize: 12, lineHeight: 1.4 }}>
        Active runtime: <strong style={{ color: UI.text }}>{active.runtime_label ?? active.runtime ?? 'unknown'}</strong> / {active.model ?? 'model unknown'}.
        Candidate engines are probed only for visibility; WilliamOS does not auto-switch.
      </div>

      <div style={{ display: 'grid', gap: 7 }}>
        {registry.map((row: any) => (
          <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8, alignItems: 'center', borderBottom: `1px solid ${UI.border}`, paddingBottom: 7 }}>
            <strong style={{ fontSize: 12 }}>{row.label}</strong>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: UI.muted, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.host}</div>
              <div style={{ color: UI.dim, fontSize: 10 }}>{row.protocol}; auto-switch {String(row.auto_switch)}</div>
            </div>
            <StatusPill label={row.selected ? 'selected' : row.state} tone={row.selected ? 'good' : 'neutral'} />
          </div>
        ))}
      </div>

      <FButton onClick={load} tone="quiet">Refresh runtime</FButton>
    </div>
  )
}

function WorkflowCenterPanel({ workflows, onSelect }: { workflows: WorkflowDefinition[]; onSelect: (workflow: WorkflowDefinition) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 9 }}>
      {workflows.map(workflow => (
        <button
          key={workflow.id}
          onClick={() => onSelect(workflow)}
          style={{
            textAlign: 'left',
            border: `1px solid ${UI.border}`,
            borderRadius: 8,
            background: UI.panel2,
            color: UI.text,
            padding: 11,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start', marginBottom: 7 }}>
            <strong style={{ fontSize: 13 }}>{workflow.title}</strong>
            <StatusPill label={workflow.safety_tier} tone={tierTone(workflow.safety_tier)} />
          </div>
          <div style={{ color: UI.muted, fontSize: 11, lineHeight: 1.4, minHeight: 46 }}>{workflow.purpose}</div>
          <div style={{ color: UI.dim, fontSize: 10, marginTop: 8 }}>
            {workflow.command} {workflow.dry_run_args.length ? `· dry-run ${workflow.dry_run_args.join(' ')}` : ''}
          </div>
        </button>
      ))}
    </div>
  )
}

function WorkOrderLifecyclePanel() {
  const [orders, setOrders] = useState<WorkOrderRecord[]>([])
  const [selected, setSelected] = useState<WorkOrderRecord | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.workOrders()
      const rows = r.work_orders ?? []
      setOrders(rows)
      setSelected(rows[0] ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ color: UI.muted, fontSize: 12 }}>Loading work orders...</div>

  return (
    <div className="workorder-lifecycle-grid" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
        {orders.slice(0, 8).map(order => (
          <button
            key={order.wo_id}
            onClick={() => setSelected(order)}
            style={{
              textAlign: 'left',
              border: `1px solid ${selected?.wo_id === order.wo_id ? UI.blue : UI.border}`,
              background: selected?.wo_id === order.wo_id ? 'rgba(124,167,200,.10)' : UI.panel2,
              borderRadius: 7,
              color: UI.text,
              padding: 8,
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{order.title}</div>
            <div style={{ color: UI.dim, fontSize: 10 }}>{order.status} · {order.phase}</div>
          </button>
        ))}
      </div>
      {selected ? (
        <div style={{ minWidth: 0, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPill label={selected.status} tone={selected.status === 'closed' ? 'good' : selected.status === 'blocked' ? 'bad' : 'warn'} />
            <StatusPill label={`phase ${selected.phase}`} />
            <span style={{ color: UI.dim, fontSize: 11, overflowWrap: 'anywhere' }}>{selected.wo_id}</span>
          </div>
          <div>
            <div style={{ color: UI.text, fontWeight: 900, fontSize: 13 }}>{selected.goal}</div>
            <div style={{ color: UI.muted, fontSize: 11, lineHeight: 1.4, marginTop: 5 }}>{selected.result}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div>
              <div style={{ color: UI.dim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 5 }}>Validators</div>
              <EvidenceList items={selected.validators} />
            </div>
            <div>
              <div style={{ color: UI.dim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 5 }}>Evidence</div>
              <EvidenceList items={selected.evidence} />
            </div>
            <div>
              <div style={{ color: UI.dim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900, marginBottom: 5 }}>Stop conditions</div>
              <EvidenceList items={selected.stop_conditions} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ color: UI.muted, fontSize: 12 }}>No work order selected.</div>
      )}
    </div>
  )
}

function OperateTab() {
  const [catalog, setCatalog] = useState<CommandCatalogRow[]>([])
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [runtimePolicy, setRuntimePolicy] = useState<any>(null)
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState('all')
  const [selected, setSelected] = useState<CommandCatalogRow | null>(null)
  const [argsText, setArgsText] = useState('')
  const [dryRun, setDryRun] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, w, r] = await Promise.all([api.commandCatalog(), api.workflows(), api.runtimeStatus()])
      setCatalog(c.commands ?? [])
      setWorkflows(w.workflows ?? [])
      setRuntimePolicy(r)
      setSelected((c.commands ?? [])[0] ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = catalog.filter(command => {
    const haystack = `${command.name} ${command.purpose} ${command.group} ${command.safety_tier}`.toLowerCase()
    return (!query.trim() || haystack.includes(query.trim().toLowerCase()))
      && (tier === 'all' || command.safety_tier === tier)
  })

  const selectCommand = useCallback((command: CommandCatalogRow) => {
    setSelected(command)
    setArgsText('')
    setDryRun(command.dry_run_args.length > 0)
    setConfirmed(false)
    setPreview(null)
    setResult(null)
  }, [])

  const selectWorkflow = useCallback((workflow: WorkflowDefinition) => {
    const command = catalog.find(row => row.name === workflow.command)
    if (command) {
      selectCommand(command)
      setDryRun(workflow.dry_run_first && command.dry_run_args.length > 0)
    }
  }, [catalog, selectCommand])

  const previewCommand = useCallback(async () => {
    if (!selected) return
    setBusy('preview')
    setResult(null)
    try {
      setPreview(await api.commandPreview(selected.name, parseCommandArgs(argsText), dryRun))
    } finally {
      setBusy('')
    }
  }, [selected, argsText, dryRun])

  const runCommand = useCallback(async () => {
    if (!selected) return
    setBusy('run')
    try {
      const p = await api.commandPreview(selected.name, parseCommandArgs(argsText), dryRun)
      setPreview(p)
      if (!p.allowed) {
        setResult({ ok: false, error: 'blocked', reason: p.blocked_reason })
        return
      }
      if (p.confirmation_required && !confirmed) {
        setResult({ ok: false, error: 'confirm_required', reason: p.confirm_reason })
        return
      }
      setResult(await api.run(p.command, p.args, confirmed))
    } finally {
      setBusy('')
    }
  }, [selected, argsText, dryRun, confirmed])

  if (loading) return <Loading message="Loading governed operating surface..." />

  const tiers = ['all', ...Array.from(new Set(catalog.map(row => row.safety_tier))).sort()]
  const selectedTone = selected ? tierTone(selected.safety_tier) : 'neutral'

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{
        border: `1px solid ${UI.border}`,
        borderRadius: 8,
        background: '#111820',
        padding: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: UI.dim, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.09em', fontWeight: 900, marginBottom: 6 }}>GUI command + workflow center</div>
            <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.1 }}>Operate WilliamOS without memorizing the CLI</h2>
            <p style={{ margin: '7px 0 0', color: UI.muted, fontSize: 13, lineHeight: 1.45, maxWidth: 820 }}>
              Registry commands stay behind the existing safety gate. Forbidden commands remain blocked; confirmation commands pause before execution; dry-run paths are shown first where supported.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <StatusPill label={`${catalog.length} commands`} tone="neutral" />
            <StatusPill label={`${runtimePolicy?.policy ?? 'explicit-runtime-only'}`} tone="good" />
            <StatusPill label="phase 6 blocked" tone="good" />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(320px, .8fr)', gap: 14, alignItems: 'start' }} className="operate-grid">
        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          <FPanel title="Workflow Center">
            <WorkflowCenterPanel workflows={workflows} onSelect={selectWorkflow} />
          </FPanel>

          <FPanel title="Command Catalog" action={<FButton onClick={load} tone="quiet">Refresh</FButton>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 190px', gap: 8, marginBottom: 10 }}>
              <FInput value={query} onChange={e => setQuery(e.target.value)} placeholder="Search commands, groups, safety tiers" />
              <FSelect value={tier} onChange={e => setTier(e.target.value)}>
                {tiers.map(item => <option key={item} value={item}>{item}</option>)}
              </FSelect>
            </div>
            <div style={{ display: 'grid', gap: 6, maxHeight: 520, overflow: 'auto' }}>
              {filtered.map(command => (
                <button
                  key={command.name}
                  onClick={() => selectCommand(command)}
                  style={{
                    border: `1px solid ${selected?.name === command.name ? UI.blue : UI.border}`,
                    background: selected?.name === command.name ? 'rgba(124,167,200,.10)' : UI.panel2,
                    color: UI.text,
                    borderRadius: 8,
                    padding: 10,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 13 }}>{command.name}</strong>
                      <div style={{ color: UI.muted, fontSize: 11, lineHeight: 1.35, marginTop: 3 }}>{command.purpose}</div>
                    </div>
                    <StatusPill label={command.safety_tier} tone={tierTone(command.safety_tier)} />
                  </div>
                  <div style={{ color: UI.dim, fontSize: 10, marginTop: 7 }}>
                    {command.group_desc} · writes {String(command.writes)} · confirm {String(command.confirmation_required)}
                  </div>
                </button>
              ))}
            </div>
          </FPanel>
        </div>

        <aside style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          <FPanel title="Command Detail / Runner">
            {selected ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{selected.name}</strong>
                    <div style={{ color: UI.muted, fontSize: 12, lineHeight: 1.4, marginTop: 4 }}>{selected.purpose}</div>
                  </div>
                  <StatusPill label={selected.safety_tier} tone={selectedTone} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
                  <StatusPill label={`writes ${String(selected.writes)}`} tone={selected.writes ? 'warn' : 'good'} />
                  <StatusPill label={selected.confirmation_required ? 'confirm required' : 'no confirm'} tone={selected.confirmation_required ? 'warn' : 'good'} />
                  <StatusPill label={selected.dry_run_args.length ? `dry-run ${selected.dry_run_args.join(' ')}` : 'no dry-run flag'} tone={selected.dry_run_args.length ? 'good' : 'neutral'} />
                  <StatusPill label={selected.allowed ? 'allowed by safety' : 'blocked'} tone={selected.allowed ? 'good' : 'bad'} />
                </div>

                {selected.blocked_reason && <div style={{ color: UI.red, fontSize: 12 }}>{selected.blocked_reason}</div>}
                {selected.confirm_reason && <div style={{ color: UI.amber, fontSize: 12 }}>{selected.confirm_reason}</div>}

                <label style={{ display: 'grid', gap: 5, color: UI.dim, fontSize: 10, textTransform: 'uppercase', fontWeight: 900 }}>
                  Arguments
                  <textarea
                    value={argsText}
                    onChange={e => setArgsText(e.target.value)}
                    rows={3}
                    placeholder={selected.args?.length ? selected.args.join(' ') : 'One argument per space or line'}
                    style={{ resize: 'vertical', background: UI.field, color: UI.text, border: `1px solid ${UI.border2}`, borderRadius: 7, padding: 9, fontSize: 12, lineHeight: 1.4 }}
                  />
                </label>

                <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: UI.muted, fontSize: 12 }}>
                  <input type="checkbox" checked={dryRun} disabled={!selected.dry_run_args.length} onChange={e => setDryRun(e.target.checked)} />
                  Dry-run first {selected.dry_run_args.length ? `(${selected.dry_run_args.join(' ')})` : '(not advertised by registry)'}
                </label>

                {selected.confirmation_required && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: UI.amber, fontSize: 12 }}>
                    <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                    I reviewed this command and approve the confirmation-gated run.
                  </label>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <FButton onClick={previewCommand} disabled={busy !== ''}>Preview</FButton>
                  <FButton onClick={runCommand} disabled={busy !== '' || !selected.allowed} tone={selected.confirmation_required ? 'primary' : 'neutral'}>
                    {busy === 'run' ? 'Running...' : selected.confirmation_required ? 'Run with confirmation' : 'Run'}
                  </FButton>
                </div>

                {preview && (
                  <div style={{ border: `1px solid ${UI.border}`, borderRadius: 8, padding: 9, background: UI.panel2, fontSize: 11, color: UI.muted }}>
                    Preview: <strong style={{ color: UI.text }}>william {preview.command} {(preview.args ?? []).join(' ')}</strong>
                    <div>Would execute now: {String(preview.would_execute)} · endpoint: {preview.execution_endpoint}</div>
                  </div>
                )}
                <CommandResult result={result} />
              </div>
            ) : (
              <div style={{ color: UI.muted, fontSize: 12 }}>Select a command.</div>
            )}
          </FPanel>

          <FPanel title="Runtime Engine Panel">
            <RuntimeEnginePanel />
          </FPanel>
        </aside>
      </div>

      <FPanel title="Work Order Lifecycle Readiness">
        <WorkOrderLifecyclePanel />
      </FPanel>
    </div>
  )
}

function WorkersPanel({
  workers,
  delegation,
  proposal,
  onDelegationChange,
  onProposalChange,
}: {
  workers: any[];
  delegation: any;
  proposal: any;
  onDelegationChange: (state: any) => void;
  onProposalChange: (state: any) => void;
}) {
  const [selected, setSelected] = useState('claude-code')
  const [task, setTask] = useState('review frontend diff')
  const [scopePath, setScopePath] = useState('control-center/frontend')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)

  if (!workers || workers.length === 0) {
    return <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>No workers registered.</p>
  }

  const selectedWorker = workers.find((worker: any) => worker.id === selected)
  const canRequest = selectedWorker?.available && selectedWorker?.enabled && selectedWorker?.delegation?.allowed
  const pending = delegation?.pending?.[0]
  const latest = delegation?.history?.[0]
  const latestRun = proposal?.history?.[0]
  const approvedPending = latest?.approved && !latest?.executed && latest?.proposal_status !== 'canceled'

  const refreshDelegation = async () => {
    const state = await api.delegationState()
    onDelegationChange(state)
  }

  const refreshProposal = async () => {
    const state = await api.proposalHistory()
    onProposalChange(state)
  }

  const requestReview = async () => {
    if (!selectedWorker || !task.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const r = await api.requestDelegation(selectedWorker.id, task.trim(), {
        repo: 'william-os-devops',
        allowed_paths: scopePath.trim() ? [scopePath.trim()] : [],
      }, 'External worker requested for proposal-only review.')
      setResult(r)
      await refreshDelegation()
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || 'Delegation request failed.' })
    } finally {
      setBusy(false)
    }
  }

  const decide = async (approved: boolean) => {
    if (!pending?.request_id) return
    setBusy(true)
    try {
      const r = await api.decideDelegation(pending.request_id, approved)
      setResult(r)
      await refreshDelegation()
      await refreshProposal()
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || 'Delegation decision failed.' })
    } finally {
      setBusy(false)
    }
  }

  const runProposal = async () => {
    if (!latest?.request_id) return
    setBusy(true)
    setResult(null)
    try {
      const r = await api.runProposal(latest.request_id)
      setResult(r)
      await refreshDelegation()
      await refreshProposal()
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || 'Proposal run failed.' })
    } finally {
      setBusy(false)
    }
  }

  const cancelProposal = async () => {
    if (!latest?.request_id) return
    setBusy(true)
    setResult(null)
    try {
      const r = await api.cancelProposal(latest.request_id)
      setResult(r)
      await refreshDelegation()
      await refreshProposal()
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || 'Proposal cancel failed.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {workers.slice(0, 5).map((worker: any) => {
        const external = String(worker.kind ?? '').startsWith('external_')
        const policy = worker.delegation_policy?.authority ?? 'status'
        const statusText = external
          ? (worker.enabled ? 'Enabled' : 'Disabled')
          : (worker.kind === 'control_plane' ? 'Control plane' : 'Runtime')
        return (
          <div key={worker.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <strong style={{ fontSize: 13 }}>{worker.label}</strong>
              <WorkerStateLabel worker={worker} />
            </div>
            <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 7, padding: '2px 6px', fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>
                {worker.kind?.replace(/_/g, ' ')}
              </span>
              <span style={{ color: external && !worker.enabled ? '#efd49d' : C.textMuted, border: `1px solid ${C.border}`, borderRadius: 7, padding: '2px 6px', fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>
                {statusText}
              </span>
              <span style={{ color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 7, padding: '2px 6px', fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>
                {policy.replace(/_/g, ' ')}
              </span>
            </div>
            {worker.delegation && !worker.delegation.allowed && (
              <div style={{ marginTop: 5, color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>
                {worker.delegation.reason}
              </div>
            )}
          </div>
        )
      })}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
        <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, marginBottom: 7 }}>Delegation paper gate</div>
        <div style={{ display: 'grid', gap: 7 }}>
          <select value={selected} onChange={e => setSelected(e.target.value)} style={{ background: '#0d141d', color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 7, height: 30, padding: '0 8px', fontSize: 12 }}>
            {workers.filter((worker: any) => String(worker.kind ?? '').startsWith('external_')).map((worker: any) => (
              <option key={worker.id} value={worker.id}>{worker.label}</option>
            ))}
          </select>
          <input value={task} onChange={e => setTask(e.target.value)} placeholder="Task" style={{ background: '#0d141d', color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 7, height: 30, padding: '0 8px', fontSize: 12 }} />
          <input value={scopePath} onChange={e => setScopePath(e.target.value)} placeholder="Allowed path" style={{ background: '#0d141d', color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 7, height: 30, padding: '0 8px', fontSize: 12 }} />
          <button disabled={!canRequest || busy} onClick={requestReview} style={{ borderRadius: 7, border: `1px solid ${C.borderLight}`, background: canRequest ? '#182330' : '#101720', color: canRequest ? C.text : C.textDim, height: 31, fontSize: 12, fontWeight: 800, cursor: canRequest ? 'pointer' : 'not-allowed' }}>
            Prepare review
          </button>
        </div>
        {!canRequest && selectedWorker && (
          <div style={{ marginTop: 6, color: C.textMuted, fontSize: 11, lineHeight: 1.35 }}>
            {selectedWorker.delegation?.reason || 'Worker must be enabled and available before a delegation review can be prepared.'}
          </div>
        )}
        {pending && <DelegationReview event={pending} onDecide={decide} />}
        {latest && !pending && (
          <div style={{ marginTop: 8, color: C.textMuted, fontSize: 11, lineHeight: 1.35, display: 'grid', gap: 5 }}>
            <div>Last decision: {latest.approved ? 'approved intent recorded' : 'denied'}; executed: {String(latest.executed)}.</div>
            {latest.command_preview && <div>Command preview: <code>{latest.command_preview}</code></div>}
            {approvedPending && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button disabled={busy || !latest.proposal_execution_ready} onClick={runProposal} style={{ borderRadius: 7, border: `1px solid ${C.borderLight}`, background: latest.proposal_execution_ready ? '#182330' : '#101720', color: latest.proposal_execution_ready ? C.text : C.textDim, height: 29, padding: '0 10px', fontSize: 12, fontWeight: 800, cursor: latest.proposal_execution_ready ? 'pointer' : 'not-allowed' }}>
                  Run proposal
                </button>
                <button disabled={busy} onClick={cancelProposal} style={{ borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#101720', color: C.text, height: 29, padding: '0 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            )}
            {approvedPending && !latest.proposal_execution_ready && (
              <div>Proposal command is not configured for this disabled-by-default worker.</div>
            )}
          </div>
        )}
        {latestRun && (
          <div style={{ marginTop: 8, color: C.textMuted, fontSize: 11, lineHeight: 1.35, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
            Last worker run: {latestRun.worker_label} · {latestRun.status} · git unchanged: {String(latestRun.evidence?.git_unchanged ?? true)}
          </div>
        )}
        {result && !result.ok && (
          <div style={{ marginTop: 8, color: '#efb0a9', fontSize: 11 }}>{result.message ?? result.error}</div>
        )}
      </div>
    </div>
  )
}

function OperatorHomeTab({ switchTab, onResume }: { switchTab: (t: Tab) => void; onResume: (sessionId: string) => void }) {
  const [home, setHome] = useState<any>(null)
  const [safety, setSafety] = useState<any>(null)
  const [agent, setAgent] = useState<any>(null)
  const [review, setReview] = useState<any>(null)
  const [model, setModel] = useState<any>(null)
  const [intake, setIntake] = useState<any[]>([])
  const [workers, setWorkers] = useState<any[]>([])
  const [delegation, setDelegation] = useState<any>(null)
  const [proposal, setProposal] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    Promise.all([
      api.home(),
      api.safety(),
      api.agentNext(),
      api.reviewItems(),
      api.researchIntakeHistory(),
      api.workersStatus(),
      api.delegationState(),
      api.proposalHistory(),
      copilotHealth().catch(err => ({ ok: false, model: 'local model', detail: String(err) })),
    ])
      .then(([h, s, a, r, intakeHistory, workerStatus, delegationState, proposalState, m]) => {
        setHome(h)
        setSafety(s)
        setAgent(a)
        setReview(r)
        setIntake(intakeHistory?.items ?? [])
        setWorkers(workerStatus?.workers ?? [])
        setDelegation(delegationState)
        setProposal(proposalState)
        setModel(m)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading message="Loading operator console..." />
  if (error || !home) return <ErrorMsg message="Could not reach backend." hint="Run: william control-center" />

  const reviewTotal = review?.total ?? home.review_queues?.total ?? 0
  const safetyGood = safety?.status === 'HEALTHY'
  const modelOnline = model?.ok === true
  const runtimeLabel = model?.runtime_label ?? model?.runtime ?? 'Local runtime'
  const runtimeModel = model?.model ?? 'model unknown'
  const gitLocal = !home.git?.has_remote
  const backupCount = home.backup?.count ?? 0
  const recentReview = (review?.items ?? []).slice(0, 4)
  const recentIntake = intake.slice(0, 4)
  const evidence = [
    {
      kind: 'runtime',
      title: `${runtimeLabel} / ${runtimeModel}`,
      detail: `${model?.source ?? 'local'} runtime; fallback ${String(model?.fallback ?? false)}`,
    },
    ...(recentIntake.map((item: any) => ({
      kind: 'intake',
      title: item.source_filename,
      detail: item.note_path,
    }))),
    ...(recentReview.map((item: any) => ({
      kind: item.queue,
      title: item.title,
      detail: item.path,
    }))),
    ...(home.recent_inbox ?? []).slice(0, 3).map((item: any) => ({
      kind: 'inbox',
      title: item.name.replace('.md', ''),
      detail: item.path,
    })),
  ].slice(0, 6)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        background: '#111820',
        padding: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.09em', fontWeight: 800, marginBottom: 6 }}>
              WilliamOS Control Center
            </div>
            <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.1 }}>Operator home</h2>
            <p style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.5, margin: '7px 0 0', maxWidth: 760 }}>
              Local runtime, command review, evidence, memory, and history. No cloud fallback. No risky command runs without approval.
            </p>
          </div>
          <button onClick={() => switchTab('safety')} style={{
            height: 34,
            borderRadius: 8,
            border: `1px solid ${C.borderLight}`,
            background: safetyGood ? 'rgba(97,185,130,.10)' : 'rgba(216,163,75,.10)',
            color: safetyGood ? '#bfe8cc' : '#efd49d',
            padding: '0 12px',
            fontSize: 12,
            fontWeight: 800,
            whiteSpace: 'nowrap',
          }}>
            Production gate
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 9 }}>
          <OperatorPill label="Runtime" value={safetyGood ? 'PASS' : 'Review'} tone={safetyGood ? 'good' : 'warn'} />
          <OperatorPill label="Model runtime" value={`${runtimeLabel}: ${modelOnline ? 'Online' : 'Offline'}`} tone={modelOnline ? 'good' : 'warn'} />
          <OperatorPill label="Backup" value={`${backupCount} archives`} tone={backupCount > 0 ? 'good' : 'warn'} />
          <OperatorPill label="Git" value={gitLocal ? 'Local only' : 'Remote detected'} tone={gitLocal ? 'good' : 'bad'} />
          <OperatorPill label="Review" value={`${reviewTotal} pending`} tone={reviewTotal > 0 ? 'warn' : 'good'} />
          <OperatorPill label="Today" value={home.today?.exists ? 'Note exists' : 'No note'} tone={home.today?.exists ? 'good' : 'warn'} />
        </div>
      </div>

      {!modelOnline && (
        <div style={{
          border: '1px solid rgba(216,163,75,.45)',
          borderRadius: 8,
          background: 'rgba(216,163,75,.08)',
          color: '#efd49d',
          padding: '10px 13px',
          fontSize: 13,
        }}>
          Local model is offline. Status, review queues, safety checks, capture, and deterministic guidance still work. Conversational routing needs <code style={{ background: 'rgba(0,0,0,.25)', padding: '2px 5px', borderRadius: 4 }}>python scripts/setup_copilot.py</code>.
        </div>
      )}

      <div className="operator-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <OperatorPanel title="Command">
            <ChatPane />
          </OperatorPanel>

          <OperatorPanel title="Drop Research">
            <ResearchDropZone onIntake={(item) => setIntake(prev => [item, ...prev.filter(existing => existing.hash !== item.hash)])} />
          </OperatorPanel>

          <div className="operator-subgrid">
            <OperatorPanel
              title="Review required"
              action={<button onClick={() => switchTab('review')} style={{ height: 28, borderRadius: 7, border: `1px solid ${C.borderLight}`, background: '#182330', color: C.text, fontSize: 12 }}>Open review</button>}
            >
              {recentReview.length === 0 ? (
                <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>No review drafts are waiting.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {recentReview.map((item: any) => (
                    <div key={item.path} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 9 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <strong style={{ fontSize: 13 }}>{item.title}</strong>
                        <span style={{ color: '#efd49d', fontSize: 11, whiteSpace: 'nowrap' }}>{prettyQueueName(item.queue)}</span>
                      </div>
                      <div style={{ marginTop: 3, color: C.textMuted, fontSize: 12 }}>{item.path}</div>
                    </div>
                  ))}
                </div>
              )}
            </OperatorPanel>

            <OperatorPanel title="Runtime rules">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: C.textMuted, lineHeight: 1.35 }}>
                <div><strong style={{ color: C.text }}>Exact command</strong> shown before risky execution.</div>
                <div><strong style={{ color: C.text }}>Confirm required</strong> actions pause for approve or deny.</div>
                <div><strong style={{ color: C.text }}>No cloud fallback</strong> when the model is offline.</div>
                <div><strong style={{ color: C.text }}>Evidence first</strong> for note-grounded answers.</div>
              </div>
            </OperatorPanel>

            <OperatorPanel title="Decisions">
              <DecisionRegisterPanel />
            </OperatorPanel>

            <OperatorPanel title="Doctrine">
              <DoctrineRegistryPanel />
            </OperatorPanel>

            <OperatorPanel title="Work Orders">
              <WorkOrderPanel />
            </OperatorPanel>

            <OperatorPanel title="WO Composer">
              <WorkOrderComposerPanel />
            </OperatorPanel>

            <OperatorPanel title="Validation Runbooks">
              <ValidationRunbookPanel />
            </OperatorPanel>

            <OperatorPanel title="DevOps Playbook">
              <DevOpsPlaybookPanel />
            </OperatorPanel>

            <OperatorPanel title="Agent Configs">
              <AgentConfigInventoryPanel />
            </OperatorPanel>

            <OperatorPanel title="Agent Skills">
              <AgentSkillsPanel />
            </OperatorPanel>

            <OperatorPanel title="Repo State">
              <RepoStateDashboardPanel />
            </OperatorPanel>

            <OperatorPanel title="Commit Readiness">
              <CommitReadinessPanel />
            </OperatorPanel>

            <OperatorPanel title="Handoff Packet">
              <HandoffPacketPanel />
            </OperatorPanel>

            <OperatorPanel title="Review Inbox">
              <OperatorReviewInboxPanel />
            </OperatorPanel>

            <OperatorPanel title="Decision Gates">
              <DecisionGateConsolePanel />
            </OperatorPanel>

            <OperatorPanel title="Action Router">
              <OperatorActionRouterPanel />
            </OperatorPanel>

            <OperatorPanel title="Authority Ledger">
              <AuthorityLedgerPanel />
            </OperatorPanel>

            <OperatorPanel title="Owner Decision Preview">
              <OwnerDecisionRecordPreviewPanel />
            </OperatorPanel>

            <OperatorPanel title="Approval Packet">
              <ApprovalPacketPreviewPanel />
            </OperatorPanel>

            <OperatorPanel title="Goal Registry">
              <GoalRegistryPreviewPanel />
            </OperatorPanel>

            <OperatorPanel title="Loop Registry">
              <LoopRegistryPreviewPanel />
            </OperatorPanel>

            <OperatorPanel title="Goal/Loop Readiness">
              <GoalLoopReadinessPanel />
            </OperatorPanel>

            <OperatorPanel title="Goal Command Preview">
              <GoalCommandPreviewPanel />
            </OperatorPanel>

            <OperatorPanel title="Loop Command Preview">
              <LoopCommandPreviewPanel />
            </OperatorPanel>

            <OperatorPanel title="Goal/Loop Console">
              <GovernedGoalLoopConsolePanel />
            </OperatorPanel>

            <OperatorPanel title="Evidence Pack">
              <EvidencePackPanel />
            </OperatorPanel>
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <OperatorPanel title="Briefing">
            <BriefingCard />
            <AlertList />
            {agent?.recommended && (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, marginBottom: 6 }}>Next safe step</div>
                <strong style={{ fontSize: 13 }}>{agent.recommended.action}</strong>
                <p style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.45, margin: '5px 0 0' }}>{agent.recommended.why}</p>
              </div>
            )}
          </OperatorPanel>

          <OperatorPanel title="Evidence">
            {evidence.length === 0 ? (
              <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>No current evidence items.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {evidence.map((item: any, i: number) => (
                  <div key={`${item.detail}-${i}`} style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 9, borderBottom: `1px solid ${C.border}`, paddingBottom: 9 }}>
                    <span style={{ color: '#7ca7c8', fontSize: 10, textTransform: 'uppercase', fontWeight: 800 }}>{item.kind}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </OperatorPanel>

          <OperatorPanel title="Memory">
            <MemoryGovernancePanel />
          </OperatorPanel>

          <OperatorPanel title="Workers">
            <WorkersPanel
              workers={workers}
              delegation={delegation}
              proposal={proposal}
              onDelegationChange={setDelegation}
              onProposalChange={setProposal}
            />
          </OperatorPanel>

          <OperatorPanel title="History">
            <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
              <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, marginBottom: 7 }}>Model runtime</div>
              <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.35 }}>
                <div style={{ color: C.text }}>{runtimeLabel} / {runtimeModel}</div>
                <div>{model?.policy ?? 'explicit-runtime-only'}; fallback {String(model?.fallback ?? false)}</div>
              </div>
            </div>
            {recentIntake.length > 0 && (
              <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
                <div style={{ color: C.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, marginBottom: 7 }}>Research intake</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {recentIntake.map((item: any) => (
                    <div key={item.hash} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.source_filename}</div>
                      <div style={{ fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.note_path}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <SessionList onResume={onResume} />
          </OperatorPanel>
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TAB CONFIG
// ---------------------------------------------------------------------------
const tabs: { key: Tab; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'operate', label: 'Operate' },
  { key: 'capture', label: 'Capture' },
  { key: 'review', label: 'Review' },
  { key: 'agent', label: 'Guidance' },
  { key: 'search', label: 'Search' },
  { key: 'safety', label: 'Safety' },
  { key: 'chat', label: 'Command' },
]

// ---------------------------------------------------------------------------
// APP SHELL
// ---------------------------------------------------------------------------
export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [status, setStatus] = useState<any>(null)
  const [activeSession, setActiveSession] = useState<string | undefined>(undefined)
  const [resumedMessages, setResumedMessages] = useState<{ role: string; content: string }[] | undefined>(undefined)

  useEffect(() => { api.status().then(setStatus) }, [])

  const handleResume = useCallback(async (sessionId: string) => {
    const r = await getSession(sessionId)
    setActiveSession(sessionId)
    setResumedMessages(r.messages ?? [])
    setTab('chat')
  }, [])

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {/* Spinner animation */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        .operator-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(320px, .9fr);
          gap: 14px;
          align-items: start;
        }
        .operator-subgrid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(260px, .75fr);
          gap: 14px;
        }
        .operate-grid {
          grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr);
        }
        .workorder-lifecycle-grid {
          grid-template-columns: minmax(180px, .55fr) minmax(0, 1fr);
        }
        @media (max-width: 980px) {
          .operator-grid,
          .operator-subgrid,
          .operate-grid,
          .workorder-lifecycle-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* Header */}
      <header style={{
        background: C.surface,
        padding: '14px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: `conic-gradient(from 180deg, ${C.green}, ${C.blue}, ${C.amber}, ${C.green})`,
            position: 'relative',
          }}>
            <div style={{ position: 'absolute', inset: 5, borderRadius: '50%', background: C.surface }} />
          </div>
          <div>
            <span style={{ fontSize: 16, fontWeight: 700 }}>WilliamOS</span>
            <span style={{ color: C.textDim, fontSize: 12, marginLeft: 8 }}>Control Center</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: C.textDim }}>
          {status?.engine && <span>{status.engine}</span>}
          <StatusDot status={status?.status === 'ok' ? 'good' : 'unknown'} />
        </div>
      </header>

      {/* Nav */}
      <nav style={{
        background: C.surface,
        padding: '0 24px',
        display: 'flex',
        gap: 0,
        borderBottom: `1px solid ${C.border}`,
        overflowX: 'auto',
      }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? `2px solid ${C.blue}` : '2px solid transparent',
              color: tab === t.key ? C.text : C.textMuted,
              padding: '14px 18px',
              fontSize: 14,
              fontWeight: tab === t.key ? 600 : 400,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color .15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Main */}
      <main style={{ maxWidth: tab === 'home' ? 1180 : 960, margin: '0 auto', padding: '28px 24px' }}>
        {tab === 'home' && <OperatorHomeTab switchTab={setTab} onResume={handleResume} />}
        {tab === 'operate' && <OperateTab />}
        {tab === 'capture' && <CaptureTab />}
        {tab === 'review' && <ReviewTab />}
        {tab === 'agent' && <AgentTab />}
        {tab === 'search' && <SearchTab />}
        {tab === 'safety' && <SafetyTab />}
        {tab === 'chat' && (
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ChatPane
                key={activeSession ?? 'new'}
                initialSession={activeSession}
                initialMessages={resumedMessages}
              />
            </div>
            <div style={{ width: 240, flexShrink: 0 }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>Quick Capture</div>
                <QuickCapture />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>Past Conversations</div>
                <SessionList onResume={handleResume} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
