import type { QueryExecutor } from './claim-lease-engine'

export type SettlementOutcome = 'NOT_EXECUTED' | 'EXECUTED' | 'AMBIGUOUS' | 'EXPIRED' | 'FENCED'
export interface SettlementDescriptor {
  descriptor_id: string; job_id: string; attempt_id: string; run_id: string; claim_id: string; lease_id: string
  effect_domain: string; fencing_token: string; holder_worker_id: string; holder_instance_id: string; boot_id: string
  authority_digest: `sha256:${string}`; capability_digest: `sha256:${string}`; input_digest: `sha256:${string}`
  expires_at: string; descriptor_digest: `sha256:${string}`; created_at: string
}
export interface IssueSettlementDescriptor {
  descriptorId: string; jobId: string; attemptId: string; runId: string; claimId: string; leaseId: string
  workerId: string; workerInstanceId: string; bootId: string; fencingToken: bigint
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const DIGEST=/^sha256:[a-f0-9]{64}$/
const validUuid=(value:string)=>{if(!UUID.test(value)) throw new Error('SETTLEMENT_UUID_INVALID')}

export async function issueSettlementDescriptor(executor:QueryExecutor, request:IssueSettlementDescriptor) {
  for(const value of Object.entries(request).filter(([key])=>key!=='fencingToken').map(([,value])=>String(value))) validUuid(value)
  const rows=(await executor.query<SettlementDescriptor>('SELECT * FROM ai_evalops.issue_settlement_descriptor($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [request.descriptorId,request.jobId,request.attemptId,request.runId,request.claimId,request.leaseId,request.workerId,request.workerInstanceId,request.bootId,request.fencingToken.toString()])).rows
  if(rows.length!==1) throw new Error('SETTLEMENT_DESCRIPTOR_MISSING')
  return Object.freeze(rows[0])
}

export async function reconstructSettlementDescriptor(executor:QueryExecutor, descriptorId:string, descriptorDigest:`sha256:${string}`) {
  validUuid(descriptorId); if(!DIGEST.test(descriptorDigest)) throw new Error('SETTLEMENT_DIGEST_INVALID')
  const rows=(await executor.query<SettlementDescriptor>('SELECT * FROM ai_evalops.reconstruct_settlement_descriptor($1,$2)',[descriptorId,descriptorDigest])).rows
  if(rows.length!==1) throw new Error('SETTLEMENT_DESCRIPTOR_MISSING')
  return Object.freeze(rows[0])
}

export async function settleDescriptor(executor:QueryExecutor, operationId:string, descriptorId:string, descriptorDigest:`sha256:${string}`, outcome:SettlementOutcome, evidenceId:string) {
  for(const value of [operationId,descriptorId,evidenceId]) validUuid(value)
  if(!DIGEST.test(descriptorDigest)) throw new Error('SETTLEMENT_DIGEST_INVALID')
  return (await executor.query('SELECT * FROM ai_evalops.settle_descriptor($1,$2,$3,$4,$5)',[operationId,descriptorId,descriptorDigest,outcome,evidenceId])).rows[0]
}
