import {createHash} from 'node:crypto'
export class GpuAdmissionError extends Error{constructor(code){super(code);this.code=code}}
const SHA=/^sha256:[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,TOKEN=/^[A-Za-z0-9._:-]{1,128}$/
const BINDING=['jobId','claimId','attemptId','leaseId','effectDomain','idempotencyKey','workerId','instanceId','bootId','fencingToken','renewalSequence','authorityDigest','capabilityDigest','inputDigest','baseDigest','policyDigest','requestedOutputDigest','configDigest','imageDigest','modelDigest']
const ROOT=['schemaVersion','evaluationId','evaluatedAt','inputDigest','binding','model','measurement','policy']
const MODEL=['modelDigest','runtimeKind','runtimeDigest','contextTokens','requestedOutputTokens','concurrency']
const METRIC=['measurementDigest','snapshotSourceDigest','modelDigest','runtimeDigest','weightsBytes','runtimeOverheadBytes','kvFormulaVersion','kvSourceDigest','kvBytesPerToken','observedAt','ttlSeconds','confidence','gpuTotalVramBytes','freeVramBytes','freeRamBytes','temperatureMilliC','queueDepth','residentModels']
const POLICY=['policyDigest','reserveVramBytes','maxTemperatureMilliC','maxQueueDepth','allowedModelDigests','allowedRuntimeDigests']
const safe=n=>Number.isSafeInteger(n)&&n>=0,keys=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('\0')===[...k].sort().join('\0')
const add=(...n)=>{let x=0;for(const v of n){if(!safe(v)||v>Number.MAX_SAFE_INTEGER-x)throw new GpuAdmissionError('INTEGER_OVERFLOW');x+=v}return x}
const mul=(a,b)=>{if(!safe(a)||!safe(b)||a!==0&&b>Math.floor(Number.MAX_SAFE_INTEGER/a))throw new GpuAdmissionError('INTEGER_OVERFLOW');return a*b}
function instant(v){if(typeof v!=='string'||!UTC.test(v))throw new GpuAdmissionError('TIMESTAMP_INVALID');const n=Date.parse(v);if(!Number.isFinite(n))throw new GpuAdmissionError('TIMESTAMP_INVALID');return n}
function canonical(v){if(v===null)return'null';if(typeof v==='string')return JSON.stringify(v);if(typeof v==='boolean')return String(v);if(typeof v==='number'){if(!Number.isSafeInteger(v))throw new GpuAdmissionError('INTEGER_INVALID');return String(v)}if(Array.isArray(v))return`[${v.map(canonical).join(',')}]`;if(v&&typeof v==='object')return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;throw new GpuAdmissionError('CANONICAL_VALUE_INVALID')}
const digest=v=>`sha256:${createHash('sha256').update(canonical(v)).digest('hex')}`
const without=(o,k)=>Object.fromEntries(Object.entries(o).filter(([x])=>x!==k))
export function sealGpuAdmissionInput(value){const v=structuredClone(value);v.measurement.measurementDigest=digest(without(v.measurement,'measurementDigest'));v.policy.policyDigest=digest(without(v.policy,'policyDigest'));v.inputDigest=digest(without(v,'inputDigest'));return v}
function result(status,reasons,echo={},calculated=null){const out={schemaVersion:'aeh.gpu-admission.result.v1',status,recommendationOnly:true,dispatchAllowed:false,executionAuthorized:false,evaluationId:echo.evaluationId??null,evaluatedAt:echo.evaluatedAt??null,inputDigest:echo.inputDigest??null,bindingDigest:echo.bindingDigest??null,measurementDigest:echo.measurementDigest??null,policyDigest:echo.policyDigest??null,snapshotSourceDigest:echo.snapshotSourceDigest??null,modelDigest:echo.modelDigest??null,calculated,reasonCodes:[...new Set(reasons)].sort()};return Object.freeze({...out,decisionDigest:digest(out)})}
function validateBinding(b){if(!keys(b,BINDING))throw new GpuAdmissionError('BINDING_FIELDS_INVALID');for(const x of ['jobId','claimId','attemptId','leaseId','workerId','instanceId','bootId'])if(!UUID.test(b[x]))throw new GpuAdmissionError('BINDING_ID_INVALID');for(const x of BINDING.filter(x=>x.endsWith('Digest')))if(!SHA.test(b[x]))throw new GpuAdmissionError('BINDING_DIGEST_INVALID');for(const x of ['effectDomain','idempotencyKey'])if(!TOKEN.test(b[x]))throw new GpuAdmissionError('BINDING_TOKEN_INVALID');if(!/^\d+$/.test(b.fencingToken)||BigInt(b.fencingToken)<1n||!/^(0|[1-9]\d*)$/.test(b.renewalSequence))throw new GpuAdmissionError('BINDING_FENCE_INVALID')}
export function evaluateGpuAdmission(input){
 const echo={evaluationId:input?.evaluationId??null,evaluatedAt:input?.evaluatedAt??null,inputDigest:input?.inputDigest??null,measurementDigest:input?.measurement?.measurementDigest??null,policyDigest:input?.policy?.policyDigest??null}
 try{
  if(!keys(input,ROOT)||input.schemaVersion!=='aeh.gpu-admission.input.v1'||!UUID.test(input.evaluationId))throw new GpuAdmissionError('INPUT_FIELDS_INVALID')
  const at=instant(input.evaluatedAt);validateBinding(input.binding);if(!keys(input.model,MODEL)||!keys(input.measurement,METRIC)||!keys(input.policy,POLICY))throw new GpuAdmissionError('ENVELOPE_FIELDS_INVALID')
  echo.bindingDigest=digest(input.binding);echo.snapshotSourceDigest=input.measurement.snapshotSourceDigest;echo.modelDigest=input.model.modelDigest
  const m=input.model,s=input.measurement,p=input.policy
  if(!SHA.test(input.inputDigest)||!SHA.test(s.measurementDigest)||!SHA.test(p.policyDigest))throw new GpuAdmissionError('INTEGRITY_DIGEST_INVALID')
  if(s.measurementDigest!==digest(without(s,'measurementDigest')))throw new GpuAdmissionError('MEASUREMENT_DIGEST_MISMATCH')
  if(p.policyDigest!==digest(without(p,'policyDigest')))throw new GpuAdmissionError('POLICY_DIGEST_MISMATCH')
  if(input.inputDigest!==digest(without(input,'inputDigest')))throw new GpuAdmissionError('INPUT_DIGEST_MISMATCH')
  if(input.binding.policyDigest!==p.policyDigest)throw new GpuAdmissionError('POLICY_BINDING_MISMATCH')
  for(const x of ['modelDigest','runtimeDigest'])if(!SHA.test(m[x]))throw new GpuAdmissionError('MODEL_DIGEST_INVALID')
  if(!TOKEN.test(m.runtimeKind))throw new GpuAdmissionError('MODEL_IDENTITY_INVALID')
  for(const x of ['contextTokens','requestedOutputTokens','concurrency'])if(!safe(m[x])||m[x]===0)throw new GpuAdmissionError('MODEL_INTEGER_INVALID')
  if(m.concurrency!==1)throw new GpuAdmissionError('CONCURRENCY_UNVALIDATED')
  if(!SHA.test(s.snapshotSourceDigest)||!SHA.test(s.kvSourceDigest)||!TOKEN.test(s.kvFormulaVersion)||!['observed','proven'].includes(s.confidence)||!Array.isArray(s.residentModels)||s.residentModels.some(x=>!SHA.test(x))||new Set(s.residentModels).size!==s.residentModels.length)throw new GpuAdmissionError('MEASUREMENT_IDENTITY_INVALID')
  for(const x of ['weightsBytes','runtimeOverheadBytes','kvBytesPerToken','gpuTotalVramBytes','freeVramBytes','freeRamBytes','temperatureMilliC','ttlSeconds'])if(!safe(s[x])||s[x]===0)throw new GpuAdmissionError('MEASUREMENT_INTEGER_INVALID')
  if(!safe(s.queueDepth))throw new GpuAdmissionError('MEASUREMENT_INTEGER_INVALID')
  for(const x of ['reserveVramBytes','maxTemperatureMilliC'])if(!safe(p[x])||p[x]===0)throw new GpuAdmissionError('POLICY_INTEGER_INVALID')
  if(!safe(p.maxQueueDepth))throw new GpuAdmissionError('POLICY_INTEGER_INVALID')
  for(const x of ['allowedModelDigests','allowedRuntimeDigests'])if(!Array.isArray(p[x])||p[x].some(d=>!SHA.test(d))||new Set(p[x]).size!==p[x].length)throw new GpuAdmissionError('POLICY_ALLOWLIST_INVALID')
  const observed=instant(s.observedAt),ttlMs=mul(s.ttlSeconds,1000);if(observed>at)throw new GpuAdmissionError('MEASUREMENT_FUTURE');if(at>=add(observed,ttlMs))throw new GpuAdmissionError('MEASUREMENT_STALE')
  if(m.modelDigest!==input.binding.modelDigest||m.modelDigest!==s.modelDigest||m.runtimeDigest!==s.runtimeDigest)throw new GpuAdmissionError('IDENTITY_MISMATCH')
  if(s.freeVramBytes>s.gpuTotalVramBytes)throw new GpuAdmissionError('MEASUREMENT_CONFLICT')
  const kv=mul(mul(s.kvBytesPerToken,add(m.contextTokens,m.requestedOutputTokens)),m.concurrency),workload=add(s.weightsBytes,s.runtimeOverheadBytes,kv),required=add(workload,p.reserveVramBytes),requiredRam=add(s.weightsBytes,s.runtimeOverheadBytes)
  const reasons=[];if(!p.allowedModelDigests.includes(m.modelDigest))reasons.push('MODEL_NOT_ALLOWED');if(!p.allowedRuntimeDigests.includes(m.runtimeDigest))reasons.push('RUNTIME_NOT_ALLOWED');if(s.temperatureMilliC>=p.maxTemperatureMilliC)reasons.push('TEMPERATURE_LIMIT');if(s.queueDepth>p.maxQueueDepth)reasons.push('QUEUE_LIMIT');if(!s.residentModels.includes(m.modelDigest)&&s.queueDepth!==0)reasons.push('RESIDENCY_LOAD_BLOCKED');if(required>s.freeVramBytes)reasons.push('VRAM_INSUFFICIENT');if(requiredRam>s.freeRamBytes)reasons.push('RAM_INSUFFICIENT')
  const calculated={estimateOnly:true,reservationCreated:false,concurrentRequestsMayShareSnapshot:true,kvFormulaVersion:s.kvFormulaVersion,kvSourceDigest:s.kvSourceDigest,kvBytes:kv,workloadVramBytes:workload,reserveVramBytes:p.reserveVramBytes,requiredVramBytes:required,usableVramBytes:s.freeVramBytes,requiredRamBytes:requiredRam,contextTokens:m.contextTokens,requestedOutputTokens:m.requestedOutputTokens,concurrency:1}
  return result(reasons.length?'REJECT':'ADMIT_SIMULATION',reasons,echo,calculated)
 }catch(e){return result('INPUT_REJECTED',[e instanceof GpuAdmissionError?e.code:'INPUT_INVALID'],echo,null)}
}
