import type { QueryExecutor } from './claim-lease-engine'
export type ReconciliationOutcome='NOT_EXECUTED'|'EXECUTED'|'AMBIGUOUS'|'EXPIRED'|'FENCED'
export type ReconciliationResult='RETRY_SAFE'|'TERMINAL_EXECUTED'|'BLOCKED_AMBIGUOUS'|'TERMINAL_EXPIRED'|'TERMINAL_FENCED'
export interface ReconciliationRequest { operationId:string; descriptorId:string; descriptorDigest:`sha256:${string}`; actorId:string; authorityDigest:`sha256:${string}`; capabilityDigest:`sha256:${string}`; observationEvidenceId:string; observationEvidenceDigest:`sha256:${string}`; terminalReceiptEvidenceId:string|null; terminalReceiptEvidenceDigest:`sha256:${string}`|null; outcome:ReconciliationOutcome; expectedProjectionVersion:bigint }
export interface ReconciliationReceipt { operation_id:string; result:ReconciliationResult; outcome:ReconciliationOutcome; projection_version:string; event_id:string }
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const DIGEST=/^sha256:[a-f0-9]{64}$/
export async function reconcileRecovery(db:QueryExecutor,r:ReconciliationRequest):Promise<Readonly<ReconciliationReceipt>>{
  for(const value of [r.operationId,r.descriptorId,r.observationEvidenceId,...(r.terminalReceiptEvidenceId?[r.terminalReceiptEvidenceId]:[])]) if(!UUID.test(value)) throw new Error('RECONCILIATION_UUID_INVALID')
  for(const value of [r.descriptorDigest,r.authorityDigest,r.capabilityDigest,r.observationEvidenceDigest,...(r.terminalReceiptEvidenceDigest?[r.terminalReceiptEvidenceDigest]:[])]) if(!DIGEST.test(value)) throw new Error('RECONCILIATION_DIGEST_INVALID')
  if(!/^[A-Za-z0-9:_-]{3,128}$/.test(r.actorId)||r.expectedProjectionVersion<0n) throw new Error('RECONCILIATION_INPUT_INVALID')
  const rows=(await db.query<ReconciliationReceipt>('SELECT * FROM ai_evalops.reconcile_recovery($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[r.operationId,r.descriptorId,r.descriptorDigest,r.actorId,r.authorityDigest,r.capabilityDigest,r.observationEvidenceId,r.observationEvidenceDigest,r.terminalReceiptEvidenceId,r.terminalReceiptEvidenceDigest,r.outcome,r.expectedProjectionVersion.toString()])).rows
  if(rows.length!==1) throw new Error('RECONCILIATION_RECEIPT_MISSING')
  return Object.freeze(rows[0])
}
