import{createHash}from'node:crypto';
import{canonicalizeJcs}from'./worker-protocol.ts'
export class AegisWorkerError extends Error{constructor(code){super(code);
this.code=code}}
const SHA=/^sha256:[a-f0-9]{64}$/,OBJECT=/^obj_sha256_[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,safe=(n,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>0&&n<=max,closed=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...k].sort().join('|'),fail=c=>{throw new AegisWorkerError(c)},same=(a,b)=>canonicalizeJcs(a)===canonicalizeJcs(b),digest=v=>`sha256:${createHash('sha256').update(v).digest('hex')}`
const AK=['envelope','payload'],RK=['pull','heartbeat','request'],QK=['templateId','operation','algorithm','objectId','sourceReceiptDigest','expectedDigest','expectedBytes'],CK=['request','ack','binding','reason'],HK=['binding','receipt'];
const CFG=['schemaVersion','validationOnly','operation','templateId','templateDigest','runtimeDigest','imageDigest','policyDigest','configDigest','identity','network','protocolTransport','concurrency','cpuMs','ramBytes','scratchBytes','sandboxPidsMax','timeoutMs','maxInputBytes','maxOutputBytes','gracefulStopMs','killStopMs'];
const configDigestValid=config=>{try{return digest(Buffer.from(canonicalizeJcs(Object.fromEntries(Object.entries(config).filter(([k])=>k!=='configDigest')))))===config.configDigest}catch{return false}}

function action(v){if(!closed(v,AK)||!(v.payload instanceof Uint8Array)||!v.envelope?.binding)fail('AEGIS_ACTION_INVALID');
let body;
try{body=JSON.parse(new TextDecoder().decode(v.payload))}catch{fail('AEGIS_ACTION_INVALID')}const c=new TextEncoder().encode(canonicalizeJcs(body));
if(c.length!==v.payload.length||c.some((x,i)=>x!==v.payload[i]))fail('AEGIS_ACTION_INVALID');
return{...v,body}}
export function createAegisWorker(deps){if(!closed(deps,['config','sdk','executor','keyring','sandbox','supervisor','handoff','clock']))fail('AEGIS_DEPENDENCY_INVALID');const{config,sdk,executor,keyring,sandbox,supervisor,handoff,clock}=deps;if(!closed(config,CFG)||config.schemaVersion!=='aeh.aegis-worker.validation.v1'||config.validationOnly!==true||config.operation!=='HASH_VERIFY'||config.templateId!=='aegis.hash-verify.v1'||!SHA.test(config.templateDigest)||!SHA.test(config.runtimeDigest)||!SHA.test(config.imageDigest)||!SHA.test(config.policyDigest)||!SHA.test(config.configDigest)||!configDigestValid(config)||!closed(config.identity,['name','elevated'])||config.identity.name!=='williamos-aegis-worker'||config.identity.elevated!==false||config.network!=='ISOLATED_COMPUTE_NO_SOCKETS'||config.protocolTransport!=='EXTERNAL_BROKER_NOT_IMPLEMENTED'||config.concurrency!==1||!safe(config.cpuMs,3600000)||!safe(config.ramBytes,1099511627776)||!safe(config.scratchBytes,1099511627776)||!safe(config.sandboxPidsMax,64)||!safe(config.timeoutMs,3600000)||!safe(config.maxInputBytes,1099511627776)||!safe(config.maxOutputBytes,16777216)||!safe(config.gracefulStopMs,60000)||!safe(config.killStopMs,60000))fail('AEGIS_CONFIG_INVALID');for(const[x,k]of[[sdk,['pullForWorker','heartbeat','requestCancellation','acknowledgeCancellation']],[sandbox,['open','executeHashVerify','stat','cleanup','storeResult']],[supervisor,['abort','graceful','kill','evidence','ambiguousEvidence']],[handoff,['complete']],[clock,['setTimer','clearTimer']]])if(!closed(x,k)||!Object.values(x).every(v=>typeof v==='function'))fail('AEGIS_DEPENDENCY_INVALID');
let state='BOOTSTRAP',active=null,pending=null,result=null,controller=null;
const reconcile=c=>{state='RECONCILING';
throw new AegisWorkerError(c)},bound=async(p,ms)=>{let t;
const x=await Promise.race([p,new Promise(r=>{t=clock.setTimer(()=>r(null),ms)})]);
if(t)clock.clearTimer(t);
return x},cleanup=async()=>{const x=await bound(sandbox.cleanup({objectId:pending.objectId,binding:active}),config.killStopMs);
if(!x?.removed||!UUID.test(x.cleanupReceiptId)||!SHA.test(x.cleanupReceiptDigest)||x.attemptId!==active.attemptId||x.leaseId!==active.leaseId||String(x.fencingToken)!==active.fencingToken)reconcile('AEGIS_CLEANUP_AMBIGUOUS');
return x};
return Object.freeze({get state(){return state},async startup(d=[]){if(state!=='BOOTSTRAP')fail('AEGIS_STATE_INVALID');
state='RECONCILING';
if(d.length)return{state,route:'WO-AEH-019'};
state='IDLE';
return{state}},async execute(v){if(state!=='IDLE'||active)fail('AEGIS_CONCURRENCY_EXCEEDED');
if(!closed(v,RK)||!closed(v.request,QK))fail('AEGIS_REQUEST_INVALID');
const p=action(v.pull),hb=action(v.heartbeat),q=v.request,b=p.envelope.binding;
if(q.templateId!==config.templateId||q.operation!=='HASH_VERIFY'||q.algorithm!=='SHA-256'||!OBJECT.test(q.objectId)||!SHA.test(q.expectedDigest)||!SHA.test(q.sourceReceiptDigest)||!safe(q.expectedBytes)||q.expectedBytes>config.maxInputBytes||b.configDigest!==config.configDigest||b.imageDigest!==config.imageDigest||b.policyDigest!==config.policyDigest||!same(hb.envelope.binding,b))fail('AEGIS_REQUEST_INVALID');
active=b;
pending=q;
state='PULLING';
try{const lease=await sdk.pullForWorker(executor,p.envelope,p.payload,keyring),handle=await sandbox.open({objectId:q.objectId,sourceReceiptDigest:q.sourceReceiptDigest,noFollow:true,readOnly:true,exclusive:true,binding:b}),before=await sandbox.stat(handle);
if(before.kind!=='REGULAR'||before.linkCount!==1||before.immutable!==true||before.sizeBytes!==q.expectedBytes||before.objectId!==q.objectId||before.sourceReceiptDigest!==q.sourceReceiptDigest)fail('AEGIS_STAGING_IDENTITY_INVALID');
state='RUNNING';
const hr=await sdk.heartbeat(executor,hb.envelope,hb.payload,keyring);
if(BigInt(hr.renewal_sequence)!==BigInt(b.renewalSequence)+1n)fail('AEGIS_HEARTBEAT_INVALID');
active=Object.freeze({...b,renewalSequence:hr.renewal_sequence});
controller=new AbortController();
const spec=Object.freeze({cpuMs:config.cpuMs,ramBytes:config.ramBytes,scratchBytes:config.scratchBytes,pidsMax:config.sandboxPidsMax,timeoutMs:config.timeoutMs,maxOutputBytes:config.maxOutputBytes,networkPolicy:'NO_SOCKETS',socketAllowlist:Object.freeze([]),signal:controller.signal});let timeoutToken;const x=await Promise.race([sandbox.executeHashVerify(handle,spec),new Promise((_,reject)=>{timeoutToken=clock.setTimer(()=>{controller.abort();reject(new AegisWorkerError('AEGIS_TIMEOUT'))},config.timeoutMs)})]);if(timeoutToken)clock.clearTimer(timeoutToken);const c=x.containment;
if(!c||!['PASS','TIMEOUT','OOM','DISK_QUOTA','PIDS','NETWORK_ATTEMPT'].includes(c.classification)||c.cpuMs!==spec.cpuMs||c.ramBytes!==spec.ramBytes||c.scratchBytes!==spec.scratchBytes||c.pidsMax!==spec.pidsMax||c.timeoutMs!==spec.timeoutMs||c.maxOutputBytes!==spec.maxOutputBytes||c.networkPolicy!=='NO_SOCKETS'||c.socketAllowlist?.length||!SHA.test(c.containmentReceiptDigest))fail('AEGIS_CONTAINMENT_INVALID');
if(c.classification!=='PASS')fail(`AEGIS_CONTAINMENT_${c.classification}`);
let n=0,h=createHash('sha256');
if(!Array.isArray(x.chunks)||x.chunks.some(z=>!(z instanceof Uint8Array)))fail('AEGIS_READ_INVALID');
for(const z of x.chunks){n+=z.length;
if(n>q.expectedBytes)fail('AEGIS_EXTRA_OR_OVERFLOW');
h.update(z)}if(n!==q.expectedBytes)fail('AEGIS_SHORT_READ');
if(!same(before,await sandbox.stat(handle)))fail('AEGIS_STAGING_MUTATED');
const computed=`sha256:${h.digest('hex')}`,clean=await cleanup(),out={schemaVersion:'aeh.aegis-hash-result.v1',objectId:q.objectId,inputDigest:q.expectedDigest,computedDigest:computed,match:computed===q.expectedDigest,byteLength:n,containmentReceiptDigest:c.containmentReceiptDigest,cleanupReceiptDigest:clean.cleanupReceiptDigest},resultDigest=digest(Buffer.from(canonicalizeJcs(out))),store=await sandbox.storeResult({...out,resultDigest},active);
if(store.resultDigest!==resultDigest||store.computedDigest!==computed||store.inputDigest!==q.expectedDigest||store.cleanupReceiptDigest!==clean.cleanupReceiptDigest||!SHA.test(store.resultStoreReceiptDigest))fail('AEGIS_RESULT_STORE_INVALID');
result={resultDigest,computedDigest:computed,inputDigest:q.expectedDigest,cleanupReceiptDigest:clean.cleanupReceiptDigest,resultStoreReceiptDigest:store.resultStoreReceiptDigest};
state='HANDOFF';
return{...out,resultDigest,...store}}catch(e){try{controller?.abort();
await supervisor.abort(active);
await cleanup()}catch{}return reconcile(e.code??'AEGIS_EXECUTION_RECONCILE')}},async cancel(v){if(!closed(v,CK))fail('AEGIS_CANCEL_INVALID');
const r=action(v.request),a=action(v.ack);
if(!active||!same(v.binding,active)||!same(r.envelope.binding,active)||!same(a.envelope.binding,active))fail('AEGIS_CANCEL_BINDING_MISMATCH');
state='CANCEL_PENDING';
await sdk.requestCancellation(executor,r.envelope,r.payload,keyring);
controller?.abort();
await supervisor.abort(active);
let e=await bound(supervisor.evidence(active),config.gracefulStopMs);
if(!e)e=await supervisor.ambiguousEvidence(active);
if(typeof e.allStopped!=='boolean'||!UUID.test(e.observationEvidenceId)||!SHA.test(e.observationEvidenceDigest)||a.body.disposition!==(e.allStopped?'STOPPED_AFTER_EFFECT_STARTED':'STOP_STATUS_AMBIGUOUS')||a.body.observationEvidenceId!==e.observationEvidenceId||a.body.observationEvidenceDigest!==e.observationEvidenceDigest)reconcile('AEGIS_ACK_MISMATCH');
await cleanup();
await sdk.acknowledgeCancellation(executor,a.envelope,a.payload,keyring);
state=e.allStopped?'HANDOFF':'RECONCILING';
return{route:e.allStopped?'WO-AEH-017/018':'WO-AEH-019'}},async completeHandoff(v){if(state!=='HANDOFF'||!closed(v,HK)||!same(v.binding,active)||!result)fail('AEGIS_HANDOFF_INVALID');
const x=await handoff.complete(v.receipt,active);
for(const k of['resultDigest','computedDigest','inputDigest','cleanupReceiptDigest','resultStoreReceiptDigest'])if(x[k]!==result[k])reconcile('AEGIS_HANDOFF_INVALID');
if(x.durable!==true||!same(x.binding,active))reconcile('AEGIS_HANDOFF_INVALID');
active=pending=result=controller=null;
state='IDLE';
return{state}},async restart(d){if(active)fail('AEGIS_RESTART_OVERLAP');
state='BOOTSTRAP';
return this.startup(d)}})}
