import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const root=path.resolve('.')
const sql=readFileSync(path.join(root,'migrations/ai-evalops-harness/0005_restart_safe_settlement.sql'),'utf8')
const engine=readFileSync(path.join(root,'lib/execution-control/settlement-engine.ts'),'utf8')
const digest=c=>`sha256:${c.repeat(64)}`

test('descriptor and client bind every restart-safe settlement identity',()=>{
  for(const field of ['job_id','attempt_id','run_id','claim_id','lease_id','effect_domain','fencing_token','holder_worker_id','holder_instance_id','boot_id','authority_digest','capability_digest','input_digest','expires_at','descriptor_digest']) assert.match(sql,new RegExp(`\\b${field}\\b`))
  for(const api of ['issueSettlementDescriptor','reconstructSettlementDescriptor','settleDescriptor']) assert.match(engine,new RegExp(`function ${api}`))
  assert.match(sql,/settlement_descriptors_immutable BEFORE UPDATE OR DELETE/)
  assert.match(sql,/settlement_receipts_immutable BEFORE UPDATE OR DELETE/)
})

test('settlement is receipt-idempotent and current identity gated',()=>{
  assert.match(sql,/SETTLEMENT_DESCRIPTOR_IDEMPOTENCY_CONFLICT/)
  assert.match(sql,/SETTLEMENT_IDEMPOTENCY_CONFLICT/)
  assert.match(sql,/authority_status/); assert.match(sql,/worker_capability_status/)
  assert.match(sql,/l\.released_at IS NULL AND l\.expires_at>clock_timestamp\(\)/)
  assert.match(sql,/terminal_receipt_evidence_type='TERMINAL_RECEIPT'/)
})

test('cached PostgreSQL reconstructs after client restart and rejects tampering', {timeout:60_000}, context=>{
  if(spawnSync('docker',['image','inspect','postgres:16'],{encoding:'utf8'}).status!==0) return context.skip('cached postgres:16 unavailable')
  const name=`aeh018-${process.pid}-${Date.now()}`
  const docker=(args,input)=>spawnSync('docker',args,{encoding:'utf8',input})
  assert.equal(docker(['run','-d','--name',name,'-e','POSTGRES_PASSWORD=fixture-only','postgres:16']).status,0)
  try {
    let ready=false; for(let i=0;i<40;i++){if(docker(['exec',name,'pg_isready','-U','postgres']).status===0){ready=true;break} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250)} assert.equal(ready,true)
    const migrations=['0000_expand_migration_control.sql','0001_contract_migration_control.sql','0002_durable_control_schema.sql','0003_claim_lease_engine.sql','0004_transactional_outbox.sql','0005_restart_safe_settlement.sql'].map(f=>readFileSync(path.join(root,'migrations/ai-evalops-harness',f),'utf8')).join('\n')
    const applied=docker(['exec','-i',name,'psql','-v','ON_ERROR_STOP=1','-U','postgres'],migrations); assert.equal(applied.status,0,applied.stderr)
    const seed=`INSERT INTO ai_evalops.effect_domain_fences VALUES ('settle:test',1); INSERT INTO ai_evalops.workers(worker_id,node_id,instance_id,boot_id,capability_digest) VALUES ('10000000-0000-4000-8000-000000000001','hermes','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','${digest('a')}'); INSERT INTO ai_evalops.authority_status(authority_digest,status,valid_until) VALUES ('${digest('b')}','ACTIVE',clock_timestamp()+interval '1 hour'); INSERT INTO ai_evalops.worker_capability_status VALUES ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','${digest('a')}','FRESH',clock_timestamp(),clock_timestamp()+interval '1 hour'); INSERT INTO ai_evalops.jobs(job_id,work_order_id,effect_domain,operation_class,idempotency_key,input_digest,authority_digest,policy_digest,base_digest,requested_output_digest,admission_expires_at) VALUES ('20000000-0000-4000-8000-000000000001','WO-AEH-018','settle:test','SETTLE','one','${digest('c')}','${digest('b')}','${digest('d')}','${digest('e')}','${digest('f')}',clock_timestamp()+interval '1 hour'); INSERT INTO ai_evalops.job_projection(job_id,state) VALUES ('20000000-0000-4000-8000-000000000001','ADMITTED'); SELECT * FROM ai_evalops.claim_job('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',interval '10 seconds');`
    assert.equal(docker(['exec','-i',name,'psql','-v','ON_ERROR_STOP=1','-U','postgres'],seed).status,0)
    const ids=`'60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',(SELECT attempt_id FROM ai_evalops.attempts LIMIT 1),'70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',1`
    const issue=docker(['exec',name,'psql','-At','-v','ON_ERROR_STOP=1','-U','postgres','-c',`SELECT descriptor_digest FROM ai_evalops.issue_settlement_descriptor(${ids});`]); assert.equal(issue.status,0,issue.stderr); const descriptorDigest=issue.stdout.trim()
    const reject=statement=>assert.notEqual(docker(['exec',name,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-c',statement]).status,0)
    assert.equal(docker(['exec',name,'psql','-At','-v','ON_ERROR_STOP=1','-U','postgres','-c',`SELECT descriptor_id FROM ai_evalops.reconstruct_settlement_descriptor('60000000-0000-4000-8000-000000000001','${descriptorDigest}');`]).stdout.trim(),'60000000-0000-4000-8000-000000000001')
    reject(`SELECT * FROM ai_evalops.reconstruct_settlement_descriptor('60000000-0000-4000-8000-000000000001','${digest('9')}');`)
    reject(`SELECT * FROM ai_evalops.issue_settlement_descriptor('60000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000001',(SELECT attempt_id FROM ai_evalops.attempts LIMIT 1),'70000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',1);`)
    assert.equal(docker(['exec',name,'psql','-U','postgres','-c',`UPDATE ai_evalops.authority_status SET status='REVOKED',revoked_at=clock_timestamp() WHERE authority_digest='${digest('b')}';`]).status,0); reject(`SELECT * FROM ai_evalops.reconstruct_settlement_descriptor('60000000-0000-4000-8000-000000000001','${descriptorDigest}');`); assert.equal(docker(['exec',name,'psql','-U','postgres','-c',`UPDATE ai_evalops.authority_status SET status='ACTIVE',revoked_at=NULL WHERE authority_digest='${digest('b')}'; UPDATE ai_evalops.worker_capability_status SET status='STALE' WHERE worker_id='10000000-0000-4000-8000-000000000001';`]).status,0); reject(`SELECT * FROM ai_evalops.reconstruct_settlement_descriptor('60000000-0000-4000-8000-000000000001','${descriptorDigest}');`); assert.equal(docker(['exec',name,'psql','-U','postgres','-c',`UPDATE ai_evalops.worker_capability_status SET status='FRESH' WHERE worker_id='10000000-0000-4000-8000-000000000001';`]).status,0)
    assert.equal(docker(['exec',name,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-c',`INSERT INTO ai_evalops.evidence_references VALUES ('80000000-0000-4000-8000-000000000001','TERMINAL_RECEIPT','${digest('8')}','fixture://settlement/one','application/json',1,clock_timestamp());`]).status,0)
    const settle=`SELECT outcome FROM ai_evalops.settle_descriptor('90000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','${descriptorDigest}','EXECUTED','80000000-0000-4000-8000-000000000001');`
    assert.equal(docker(['exec',name,'psql','-At','-v','ON_ERROR_STOP=1','-U','postgres','-c',settle]).stdout.trim(),'EXECUTED'); assert.equal(docker(['exec',name,'psql','-At','-v','ON_ERROR_STOP=1','-U','postgres','-c',settle]).stdout.trim(),'EXECUTED')
    reject(settle.replace("'EXECUTED'","'AMBIGUOUS'"))
    assert.equal(docker(['exec',name,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-c',"SELECT pg_sleep(GREATEST(0,extract(epoch FROM (SELECT expires_at FROM ai_evalops.settlement_descriptors LIMIT 1)-clock_timestamp()))+0.2);"]).status,0); reject(`SELECT * FROM ai_evalops.reconstruct_settlement_descriptor('60000000-0000-4000-8000-000000000001','${descriptorDigest}');`)
  } finally { const removed=docker(['rm','-f',name]); assert.equal(removed.status,0,removed.stderr); assert.notEqual(docker(['inspect',name]).status,0) }
})
