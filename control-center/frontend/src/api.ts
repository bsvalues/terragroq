// In dev (Vite), proxy is not configured so use the backend directly; in production serve from same origin.
const BASE = (import.meta as unknown as { env: { DEV: boolean } }).env.DEV
  ? 'http://127.0.0.1:8420/api'
  : '/api'

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`)
  return res.json()
}

async function post(path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

async function parseSSEStream(
  response: Response,
  onEvent: (e: unknown) => void,
): Promise<void> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('data:')) {
        const json = trimmed.slice(5).trim()
        if (json) {
          try { onEvent(JSON.parse(json)) } catch { /* ignore malformed */ }
        }
      }
    }
  }
}

export async function streamChat(
  message: string,
  session: string | null,
  onEvent: (e: unknown) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session ? { message, session } : { message }),
  })
  await parseSSEStream(res, onEvent)
}

export async function approve(
  callId: string,
  approved: boolean,
  onEvent: (e: unknown) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/chat/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call_id: callId, approved }),
  })
  await parseSSEStream(res, onEvent)
}

export interface RuntimeEvidence {
  runtime?: string
  runtime_label?: string
  model?: string
  host?: string
  source?: string
  fallback?: boolean
}

export interface CopilotHealth {
  ok: boolean
  model: string
  detail: string
  runtime?: string
  runtime_label?: string
  runtime_host?: string
  source?: string
  fallback?: boolean
  policy?: string
  registry?: any[]
}

export interface MemoryFact {
  id: number
  text: string
  created: string
  updated: string
  source: string
  authority_state: string
  stale: boolean
  archived: boolean
  last_used?: string | null
  citation?: string
  review_required?: boolean
  staleness_indicator?: string
  conflict?: boolean
  conflict_with?: number[]
}

export interface DecisionRecord {
  decision_id: string
  title: string
  status: string
  decision: string
  reason: string
  owner: string
  created_at: string
  review_at: string
  scope: string[]
  evidence: string[]
  supersedes: string[]
  superseded_by?: string | null
  authority: string
}

export interface DoctrineRule {
  rule_id: string
  title: string
  scope: string[]
  status: string
  allowed: string[]
  forbidden: string[]
  requires_approval: string[]
  evidence: string[]
  supersedes: string[]
  created_at: string
  owner: string
}

export interface WorkOrderRecord {
  wo_id: string
  title: string
  status: string
  goal: string
  loop: string[]
  scope: string[]
  non_goals: string[]
  allowed_files: string[]
  forbidden_files: string[]
  validators: string[]
  stop_conditions: string[]
  owner_decisions: string[]
  result: string
  evidence: string[]
  commit?: string | null
  tag?: string | null
  phase: string
}

export interface AgentConfigSurface {
  surface_id: string
  label: string
  category: string
  status: string
  risk_level: string
  locations: { path: string; exists: boolean; kind: string }[]
  secrets_redacted: boolean
  notes: string[]
  flags: string[]
  authority: string
}

export interface DevOpsPlaybookSummary {
  ok: boolean
  mode: string
  lanes: string[]
  modes: string[]
  authority_levels: string[]
  loop_types: string[]
  mistake_patterns: any[]
  current_truth: any
  handoff_banner: Record<string, string>
  first_slices: { wo_id: string; purpose: string }[]
  non_authorization: string
}

export interface CommandCatalogRow {
  name: string
  purpose: string
  group: string
  group_desc: string
  safe: boolean
  writes: boolean
  args: string[]
  dry_run_args: string[]
  allowed: boolean
  runnable: boolean
  confirmation_required: boolean
  confirm_reason: string
  blocked_reason: string
  safety_tier: string
  execution_path: string
}

export interface WorkflowDefinition {
  id: string
  title: string
  command: string
  purpose: string
  steps: string[]
  dry_run_first: boolean
  allowed: boolean
  safety_tier: string
  confirmation_required: boolean
  dry_run_args: string[]
  blocked_reason: string
}

export interface AgentSkill {
  id: string
  name: string
  category: string
  phase: string
  status: string
  mode: string
  description: string
  allowed_actions: string[]
  denied_actions: string[]
  safe_paths: string[]
  required_validators: string[]
  evidence_outputs: string[]
  risk_level: string
  requires_owner_approval: boolean
  would_execute: boolean
  read_only: boolean
  autonomy_enabled: boolean
  mcp_activation: boolean
  production_write: boolean
}

export interface EvidencePacket {
  ok: boolean
  mode: string
  packet_id: string
  generated_at: string
  repo: string
  branch: string
  head: string
  short_head: string
  worktree_clean: boolean
  git_status: string[]
  dirty_files: Record<string, string[] | boolean>
  diff_stat: string[]
  staged_stat: string[]
  recent_commits: string[]
  validators: { id: string; command: string; purpose: string; required_for: string[]; last_result: string }[]
  build_result: string
  test_result: string
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
  next_valid_gate: string
}

export interface RepoStateDashboard {
  ok: boolean
  mode: string
  repo: string
  branch: string
  head: string
  short_head: string
  baseline: { short_head: string; source: string; worktree_clean: boolean }
  worktree: { clean: boolean; status_lines: string[]; dirty_files: Record<string, string[] | boolean> }
  recent_commits: string[]
  validation_history: {
    latest_reports: { name: string; path: string; source?: string }[]
    declared_validators: { id: string; command: string; purpose: string; required_for: string[]; last_result: string }[]
    test_result: string
    build_result: string
    validators_run_by_dashboard: boolean
  }
  active_gates: { id: string; label: string; command: string; authority: string; required_for: string[] }[]
  gate_status: string
  next_valid_action: string
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
}

export interface WorkOrderComposeInput {
  objective: string
  title?: string
  phase?: string
  lane?: string
  mode?: string
  allowed_scope?: string[]
  denied_actions?: string[]
  validators?: string[]
  validator_runbook_ids?: string[]
  evidence_outputs?: string[]
  commit_rules?: string[]
  stop_conditions?: string[]
  owner_decisions?: string[]
}

export interface WorkOrderDraft {
  wo_id: string
  title: string
  phase: string
  lane: string
  mode: string
  objective: string
  allowed_scope: string[]
  denied_actions: string[]
  validators: string[]
  evidence_outputs: string[]
  commit_rules: string[]
  stop_conditions: string[]
  owner_decisions: string[]
  status: string
  authority: string
  would_execute: boolean
  would_write_files: boolean
  would_persist: boolean
  autonomy_enabled: boolean
  mcp_activation: boolean
  scheduler_enabled: boolean
  production_write: boolean
}

export interface WorkOrderComposePreview {
  ok: boolean
  mode?: string
  draft?: WorkOrderDraft
  packet_markdown?: string
  safety?: Record<string, boolean>
  error?: string
}

export interface ValidationRunbook {
  id: string
  name: string
  category: string
  phase: string
  status: string
  description: string
  commands: string[]
  required_for: string[]
  evidence_outputs: string[]
  safe_paths: string[]
  denied_actions: string[]
  risk_level: string
  requires_owner_approval: boolean
  would_execute: boolean
  scheduler_enabled: boolean
  autonomy_enabled: boolean
  mcp_activation: boolean
  production_write: boolean
}

export interface CommitReadinessReview {
  ok: boolean
  mode: string
  repo: string
  branch: string
  head: string
  short_head: string
  decision: string
  safe_to_commit: boolean
  candidate_files: { code: string; path: string }[]
  candidate_count: number
  dist_status: {
    present: boolean
    files: { code: string; path: string }[]
    deleted: string[]
    added: string[]
    modified: string[]
    complete_matching_triplet: boolean
    decision: string
  }
  required_validators: ValidationRunbook[]
  validators_run_by_reviewer: boolean
  blockers: string[]
  reasons: string[]
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
}

export interface HandoffPacketPreview {
  ok: boolean
  mode: string
  generated_at: string
  result: string
  repo_state: RepoStateDashboard
  evidence_pack: EvidencePacket
  commit_readiness: CommitReadinessReview
  validation_runbooks: ValidationRunbook[]
  active_work_orders: WorkOrderRecord[]
  next_valid_gate: string
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
  packet_text: string
}

export interface OperatorReviewInboxItem {
  id: string
  kind: string
  title: string
  summary: string
  status: string
  priority: string
  source: string
  payload: Record<string, unknown>
  actions_allowed: string[]
  actions_denied: string[]
}

export interface OperatorReviewInbox {
  ok: boolean
  mode: string
  generated_at: string
  items: OperatorReviewInboxItem[]
  total: number
  queue_status: string
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
}

export interface DecisionGateConsoleDecision {
  id: string
  title: string
  status: string
  reason: string
  owner_action_required: boolean
  source: string
  actions_allowed: string[]
  actions_denied: string[]
}

export interface DecisionGateConsoleAction {
  id: string
  label: string
  authority: string
  reason: string
}

export interface DecisionGateConsole {
  ok: boolean
  mode: string
  generated_at: string
  repo: string
  branch: string
  head: string
  short_head: string
  worktree_clean: boolean
  gate_status: string
  pending_owner_decisions: DecisionGateConsoleDecision[]
  blocked_gates: { id: string; label: string; reason: string }[]
  allowed_next_actions: DecisionGateConsoleAction[]
  denied_actions: string[]
  recommended_work_order_lane: string
  next_valid_gate: string
  review_item_count: number
  validation_runbook_count: number
  active_work_order_count: number
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
}

export interface OperatorActionRoute {
  id: string
  decision_id: string
  decision_title: string
  action_type: string
  authority_required: string
  reason: string
  source: string
  would_perform: boolean
  actions_allowed: string[]
  actions_denied: string[]
}

export interface OperatorActionRouterPreview {
  ok: boolean
  mode: string
  generated_at: string
  repo: string
  branch: string
  head: string
  short_head: string
  action_types: string[]
  routes: OperatorActionRoute[]
  route_count: number
  recommended_action_type: string
  recommended_work_order_lane: string
  next_valid_gate: string
  denied_actions: string[]
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
}

export interface AuthorityLedgerEntry {
  id: string
  route_id: string
  decision_title: string
  action_type: string
  authority_required: string
  current_authority: string
  missing_authority: string[]
  required_approver: string
  authorized_now: boolean
  reason: string
  actions_denied: string[]
  would_grant: boolean
  would_record_approval: boolean
}

export interface AuthorityLedgerPreview {
  ok: boolean
  mode: string
  generated_at: string
  repo: string
  branch: string
  head: string
  short_head: string
  entries: AuthorityLedgerEntry[]
  entry_count: number
  grantable_authorities: string[]
  missing_authorities: string[]
  authorized_preview_actions: string[]
  denied_actions: string[]
  recommended_work_order_lane: string
  next_valid_gate: string
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
}

export interface OwnerDecisionRecordDraft {
  id: string
  title: string
  status: string
  decision_type: string
  authority_required: string
  missing_authority: string[]
  required_approver: string
  recommended_record_text: string
  evidence: Record<string, string>
  would_write_record: boolean
  would_grant_authority: boolean
  actions_allowed: string[]
  actions_denied: string[]
}

export interface OwnerDecisionRecordPreview {
  ok: boolean
  mode: string
  generated_at: string
  repo: string
  branch: string
  head: string
  short_head: string
  record_statuses: string[]
  records: OwnerDecisionRecordDraft[]
  record_count: number
  owner_required_count: number
  missing_authorities: string[]
  recommended_work_order_lane: string
  next_valid_gate: string
  denied_actions: string[]
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
}

export interface ApprovalPacket {
  id: string
  decision_record_id: string
  title: string
  status: string
  owner_required: boolean
  authority_required: string
  required_approver: string
  approval_text: string
  required_evidence: Record<string, string>
  would_approve: boolean
  would_grant_authority: boolean
  would_write_record: boolean
  actions_allowed: string[]
  actions_denied: string[]
}

export interface ApprovalPacketPreview {
  ok: boolean
  mode: string
  generated_at: string
  repo: string
  branch: string
  head: string
  short_head: string
  packets: ApprovalPacket[]
  packet_count: number
  owner_required_count: number
  missing_authorities: string[]
  recommended_work_order_lane: string
  next_valid_gate: string
  denied_actions: string[]
  safety: Record<string, boolean>
  non_authorizations_preserved: string[]
}

export interface GoalRegistryGoal {
  id: string
  name: string
  status: string
  mode: string
  objective: string
  allowed_lanes: string[]
  denied_lanes: string[]
  success_criteria: string[]
  next_gate: string
  requires_owner_approval: boolean
  would_create_goal: boolean
  would_persist: boolean
  would_execute: boolean
  scheduler_enabled: boolean
  autonomy_enabled: boolean
  mcp_activation: boolean
  production_write: boolean
}

export interface GoalRegistryPreview {
  ok: boolean
  mode: string
  generated_at: string
  goals: GoalRegistryGoal[]
  total: number
  denied_actions: string[]
  safety: Record<string, boolean>
}

export interface LoopRegistryLoop {
  id: string
  name: string
  status: string
  mode: string
  steps: string[]
  stop_conditions: string[]
  denied_actions: string[]
  evidence_expectations: string[]
  human_approval_gates: string[]
  would_start_loop: boolean
  would_schedule_loop: boolean
  would_execute: boolean
  would_write_state: boolean
  autonomy_enabled: boolean
  mcp_activation: boolean
  production_write: boolean
}

export interface LoopRegistryPreview {
  ok: boolean
  mode: string
  generated_at: string
  loops: LoopRegistryLoop[]
  total: number
  denied_actions: string[]
  safety: Record<string, boolean>
}

export interface GoalLoopReadinessReview {
  ok: boolean
  mode: string
  generated_at: string
  decision: string
  safe_for_owner_review: boolean
  goals_reviewed: number
  loops_reviewed: number
  missing_approvals: string[]
  blocked_gates: string[]
  required_validators: ValidationRunbook[]
  denied_actions: string[]
  next_valid_gate: string
  safety: Record<string, boolean>
}

export interface GoalCommandPreview {
  ok: boolean
  mode: string
  generated_at: string
  preview: {
    request: string
    decision: string
    allowed_for_owner_review: boolean
    blocked_reasons: string[]
    required_authority: string
    required_validators: ValidationRunbook[]
    next_valid_gate: string
  }
  denied_actions: string[]
  safety: Record<string, boolean>
}

export interface LoopCommandPreview {
  ok: boolean
  mode: string
  generated_at: string
  preview: {
    request: string
    decision: string
    allowed_for_owner_review: boolean
    blocked_reasons: string[]
    stop_condition_required: boolean
    known_stop_conditions: string[]
    required_authority: string
    next_valid_gate: string
  }
  denied_actions: string[]
  safety: Record<string, boolean>
}

export interface GovernedGoalLoopConsole {
  ok: boolean
  mode: string
  generated_at: string
  goal_registry: GoalRegistryPreview
  loop_registry: LoopRegistryPreview
  readiness: GoalLoopReadinessReview
  authority_ledger: AuthorityLedgerPreview
  approval_packets: ApprovalPacketPreview
  action_router: OperatorActionRouterPreview
  next_valid_gate: string
  summary: {
    goals: number
    loops: number
    safe_for_owner_review: boolean
    missing_authorities: number
    approval_packets: number
    routes: number
  }
  denied_actions: string[]
  safety: Record<string, boolean>
}

export async function copilotHealth(): Promise<CopilotHealth> {
  const res = await fetch(`${BASE}/copilot/health`)
  return res.json()
}

export async function getSessions(): Promise<{ sessions: any[] }> {
  return get('/sessions')
}

export async function getSession(id: string): Promise<{ messages: any[] }> {
  return get(`/session?session=${encodeURIComponent(id)}`)
}

export async function capture(text: string): Promise<any> {
  return post('/capture', { text })
}

export async function uploadResearch(file: File, classification = 'Research'): Promise<any> {
  const data = new FormData()
  data.append('file', file)
  data.append('classification', classification)
  const res = await fetch(`${BASE}/research-intake`, {
    method: 'POST',
    body: data,
  })
  return res.json()
}

export async function getBriefing(): Promise<any> {
  return get('/briefing')
}

export async function getAlerts(): Promise<{ alerts: any[] }> {
  return get('/alerts')
}

export const api = {
  status: () => get('/status'),
  home: () => get('/home'),
  today: () => get('/today'),
  capture: (text: string) => post('/capture', { text }),
  reviewQueues: () => get('/review-queues'),
  refreshQueues: () => post('/review-queues/refresh'),
  reviewItems: () => get('/review/items'),
  reviewItem: (path: string) => get(`/review/item?path=${encodeURIComponent(path)}`),
  acceptancePlan: (path: string) => post('/acceptance/plan', { path }),
  acceptDraft: (draft_path: string, dest: string, confirmation: string) =>
    post('/acceptance/accept', { draft_path, dest, confirmation }),
  agentReviewDraft: (path: string) => post('/agent/review-draft', { path }),
  closureChecklist: () => post('/closure/checklist'),
  closureDryRun: () => post('/closure/dry-run'),
  closureRun: () => post('/closure/run'),
  snapshotDryRun: () => post('/git/snapshot-dry-run'),
  agentPostAcceptance: () => post('/agent/post-acceptance'),
  safety: () => get('/safety'),
  agentNext: () => post('/agent/next'),
  agentToday: () => post('/agent/today'),
  agentReviewQueues: () => post('/agent/review-queues'),
  agentHealth: () => post('/agent/health'),
  agentIgnore: () => post('/agent/ignore'),
  researchIntakeHistory: () => get('/research-intake/history'),
  uploadResearch: (file: File, classification = 'Research') => uploadResearch(file, classification),
  workersStatus: () => get('/workers/status'),
  delegationState: () => get('/workers/delegation/state'),
  requestDelegation: (worker_id: string, task: string, scope: Record<string, unknown>, reason = '') =>
    post('/workers/delegation/request', { worker_id, task, scope, reason }),
  decideDelegation: (request_id: string, approved: boolean) =>
    post('/workers/delegation/decide', { request_id, approved }),
  proposalHistory: () => get('/workers/proposal/history'),
  runProposal: (request_id: string) => post('/workers/proposal/run', { request_id }),
  cancelProposal: (request_id: string) => post('/workers/proposal/cancel', { request_id }),
  memoryFacts: () => get('/memory/facts'),
  memoryReview: () => get('/memory/review'),
  exportMemory: (format = 'json') => get(`/memory/export?format=${encodeURIComponent(format)}`),
  memoryFactAudit: (fact_id: number) => get(`/memory/facts/${fact_id}/audit`),
  decisions: (q = '') => get(q ? `/decisions?q=${encodeURIComponent(q)}` : '/decisions'),
  decision: (decision_id: string) => get(`/decisions/${encodeURIComponent(decision_id)}`),
  doctrine: (q = '') => get(q ? `/doctrine?q=${encodeURIComponent(q)}` : '/doctrine'),
  doctrineRule: (rule_id: string) => get(`/doctrine/${encodeURIComponent(rule_id)}`),
  checkDoctrine: (action: string) => post('/doctrine/check', { action }),
  workOrders: (q = '') => get(q ? `/work-orders?q=${encodeURIComponent(q)}` : '/work-orders'),
  activeWorkOrders: () => get('/work-orders/active'),
  workOrder: (wo_id: string) => get(`/work-orders/${encodeURIComponent(wo_id)}`),
  composeWorkOrder: (draft: WorkOrderComposeInput): Promise<WorkOrderComposePreview> =>
    post('/work-order-composer/preview', draft),
  validationRunbooks: (category = ''): Promise<{ ok: boolean; runbooks: ValidationRunbook[]; total: number; mode: string; would_execute: boolean; scheduler_enabled: boolean; autonomy_enabled: boolean; mcp_activation: boolean; production_write: boolean }> =>
    get(category ? `/validation-runbooks?category=${encodeURIComponent(category)}` : '/validation-runbooks'),
  validationRunbook: (runbook_id: string): Promise<{ ok: boolean; runbook?: ValidationRunbook; error?: string }> =>
    get(`/validation-runbooks/${encodeURIComponent(runbook_id)}`),
  agentConfigs: (q = '') => get(q ? `/agent-configs?q=${encodeURIComponent(q)}` : '/agent-configs'),
  agentConfig: (surface_id: string) => get(`/agent-configs/${encodeURIComponent(surface_id)}`),
  agentSkills: (): Promise<{ ok: boolean; skills: AgentSkill[]; total: number; mode: string; would_execute: boolean; read_only: boolean; autonomy_enabled: boolean; mcp_activation: boolean; production_write: boolean }> =>
    get('/agent-skills'),
  agentSkill: (skill_id: string): Promise<{ ok: boolean; skill?: AgentSkill; error?: string }> =>
    get(`/agent-skills/${encodeURIComponent(skill_id)}`),
  evidencePack: (): Promise<EvidencePacket> => get('/evidence-pack'),
  repoState: (): Promise<RepoStateDashboard> => get('/repo-state'),
  commitReadiness: (): Promise<CommitReadinessReview> => get('/commit-readiness'),
  handoffPacket: (): Promise<HandoffPacketPreview> => get('/handoff-packet'),
  operatorReviewInbox: (): Promise<OperatorReviewInbox> => get('/operator-review-inbox'),
  decisionGateConsole: (): Promise<DecisionGateConsole> => get('/decision-gate-console'),
  operatorActionRouter: (): Promise<OperatorActionRouterPreview> => get('/operator-action-router'),
  authorityLedger: (): Promise<AuthorityLedgerPreview> => get('/authority-ledger'),
  ownerDecisionRecordPreview: (): Promise<OwnerDecisionRecordPreview> => get('/owner-decision-record-preview'),
  approvalPacketPreview: (): Promise<ApprovalPacketPreview> => get('/approval-packet-preview'),
  goalRegistry: (): Promise<GoalRegistryPreview> => get('/goal-registry'),
  loopRegistry: (): Promise<LoopRegistryPreview> => get('/loop-registry'),
  goalLoopReadiness: (): Promise<GoalLoopReadinessReview> => get('/goal-loop-readiness'),
  goalCommandPreview: (request = ''): Promise<GoalCommandPreview> =>
    get(`/goal-command-preview?request=${encodeURIComponent(request)}`),
  loopCommandPreview: (request = ''): Promise<LoopCommandPreview> =>
    get(`/loop-command-preview?request=${encodeURIComponent(request)}`),
  governedGoalLoopConsole: (): Promise<GovernedGoalLoopConsole> => get('/governed-goal-loop-console'),
  devopsPlaybook: (): Promise<DevOpsPlaybookSummary> => get('/devops/playbook'),
  devopsCurrentTruth: () => get('/devops/current-truth'),
  classifyDevOpsGoal: (goal: string, authority = 'A0_READ_ONLY', lane = '', mode = '') =>
    post('/devops/goal', { goal, authority, lane, mode }),
  planDevOpsLoop: (target: string, loop_type = 'verify', authority = 'A0_READ_ONLY', max_iterations = 1, stop_on = '', evidence = '') =>
    post('/devops/loop', { target, loop_type, authority, max_iterations, stop_on, evidence }),
  editMemoryFact: (fact_id: number, text: string) =>
    post(`/memory/facts/${fact_id}/edit`, { text }),
  markMemoryFactStale: (fact_id: number, stale = true) =>
    post(`/memory/facts/${fact_id}/stale`, { stale }),
  setMemoryFactAuthority: (fact_id: number, authority_state: string, confirmation = '') =>
    post(`/memory/facts/${fact_id}/authority`, { authority_state, confirmation }),
  deleteMemoryFact: (fact_id: number, confirmation = 'DELETE') =>
    post(`/memory/facts/${fact_id}/delete`, { confirmation }),
  commandCatalog: (): Promise<{ ok: boolean; registry_count: number; cli_count: number; parity: boolean; groups: any[]; commands: CommandCatalogRow[]; policy: any }> =>
    get('/commands/catalog'),
  commandDetail: (command: string): Promise<{ ok: boolean; command?: CommandCatalogRow; error?: string }> =>
    get(`/commands/${encodeURIComponent(command)}`),
  commandPreview: (command: string, args: string[] = [], dry_run = false) =>
    post('/commands/preview', { command, args, dry_run }),
  workflows: (): Promise<{ ok: boolean; workflows: WorkflowDefinition[]; policy: any }> =>
    get('/workflows'),
  runtimeStatus: () => get('/copilot/runtime'),
  search: (query: string) => post('/search', { query }),
  run: (command: string, args: string[] = [], confirmed = false) =>
    post('/run', { command, args, confirmed }),
}
