import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyAtlasRolePolicy, verifyAtlasCatalogSnapshot, renderAtlasRoleChange, WRAPPERS } from '../lib/execution-control/atlas-runtime-role-policy.mjs';

const policy = JSON.parse(readFileSync('config/ai-evalops-harness/atlas-runtime-role-policy.json'));
const grantTemplateBytes = readFileSync('db/ai-evalops/atlas-runtime-role-grants.sql.template', 'utf8');
const rollbackTemplateBytes = readFileSync('db/ai-evalops/atlas-runtime-role-rollback.sql.template', 'utf8');
const pgHbaTemplateBytes = readFileSync('config/ai-evalops-harness/atlas-pg-hba.cert.template', 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('closed policy has one exact role for each of four wrappers', () => {
  assert.equal(verifyAtlasRolePolicy(policy).verified, true);
  const allocation = Object.fromEntries(Object.keys(WRAPPERS).map(name => [name, []]));
  for (const kind of ['coordinator', 'worker']) for (const name of policy.roles[kind].functions) allocation[name].push(kind);
  assert.deepEqual(allocation, {
    pull_worker_envelope: ['worker'], worker_heartbeat: ['worker'],
    request_worker_cancellation_enveloped: ['coordinator'], acknowledge_worker_cancellation_enveloped: ['worker']
  });
});

test('policy rejects weak TLS, shared identity, unknown wrapper, owner login, and open shape', () => {
  for (const mutate of [
    p => { p.tls.minimumVersion = 'TLSv1.2'; }, p => { p.roles.deploy.login = true; },
    p => { p.roles.worker.certIdentity = p.roles.coordinator.certIdentity; }, p => { p.roles.worker.functions.push('claim_job'); },
    p => { p.extra = true; }
  ]) { const candidate = structuredClone(policy); mutate(candidate); assert.throws(() => verifyAtlasRolePolicy(candidate)); }
});

const hbaPreimage = '# seeded nontrivial preimage\nhostssl williamos legacy_role 127.0.0.1/32 cert clientcert=verify-full\n';
const baseSnapshot = {
  schemaVersion: 'aeh.atlas-catalog-snapshot.v3', database: 'williamos', schema: 'ai_evalops', schemaOwner: 'postgres',
  artifacts:{policySha256:sha(JSON.stringify(policy)),grantTemplateSha256:sha(grantTemplateBytes),rollbackTemplateSha256:sha(rollbackTemplateBytes),pgHbaTemplateSha256:sha(pgHbaTemplateBytes)},
  roles: [
    {role:'aeh_migration_owner',login:false,superuser:false,createDb:false,createRole:false,inherit:true,replication:false,bypassRls:false,memberships:[]},
    {role:'aeh_coordinator',login:true,superuser:false,createDb:false,createRole:false,inherit:true,replication:false,bypassRls:false,memberships:[]},
    {role:'aeh_worker',login:true,superuser:false,createDb:false,createRole:false,inherit:true,replication:false,bypassRls:false,memberships:['seed_parent']}
  ], grants: [], defaultPrivileges: [], functions: [],
  hbaBytesSha256: sha(hbaPreimage), hbaBytesBase64: Buffer.from(hbaPreimage).toString('base64')
};

test('closed snapshot rejects omitted, extra, unsafe, and HBA-mismatched observations', () => {
  assert.equal(verifyAtlasCatalogSnapshot(baseSnapshot).verified, true);
  for (const mutate of [s => { delete s.schemaOwner; }, s => { s.extra = 1; }, s => { s.roles[0].role = 'x;'; }, s => { s.hbaBytesBase64 = 'eA=='; }]) {
    const candidate = structuredClone(baseSnapshot); mutate(candidate); assert.throws(() => verifyAtlasCatalogSnapshot(candidate));
  }
});

test('renderer is deterministic, snapshot-bound, token-closed, and restores exact HBA bytes', () => {
  const args = {policy, snapshot:baseSnapshot, grantTemplateBytes, rollbackTemplateBytes, pgHbaTemplateBytes};
  const a = renderAtlasRoleChange(args), b = renderAtlasRoleChange(args);
  assert.deepEqual(a, b); assert.equal(a.hbaRollback, hbaPreimage); assert.doesNotMatch(a.applySql+a.rollbackSql, /\{\{/);
  const changed = structuredClone(baseSnapshot); changed.hbaBytesBase64 = Buffer.from(hbaPreimage+'#x\n').toString('base64'); changed.hbaBytesSha256 = sha(Buffer.from(changed.hbaBytesBase64,'base64'));
  assert.notEqual(renderAtlasRoleChange({...args,snapshot:changed}).snapshotDigest, a.snapshotDigest);
  assert.throws(() => renderAtlasRoleChange({...args,grantTemplateBytes:grantTemplateBytes+'\n{{unknown}}'}), /ARTIFACT_PREIMAGE/);
  assert.throws(() => renderAtlasRoleChange({...args,rollbackTemplateBytes:rollbackTemplateBytes+'\n'}), /ARTIFACT_PREIMAGE/);
});

const image = spawnSync('docker', ['image','inspect','postgres:16'], {encoding:'utf8'}).status === 0;
test('rendered checked-in bytes apply least privilege and canonically roll back a nontrivial PG16 preimage', {skip:!image,timeout:180000}, () => {
  const name = `aeh052-v3-${process.pid}-${Date.now()}`;
  const docker = (args, input) => spawnSync('docker', args, {encoding:'utf8', input});
  const started = docker(['run','--pull=never','--rm','--name',name,'-e','POSTGRES_PASSWORD=fixture','-d','postgres:16']);
  assert.equal(started.status, 0, started.stderr);
  const admin = (sql, db='williamos') => docker(['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',db], sql);
  const asRole = (role, sql) => docker(['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U',role,'-d','williamos'], sql);
  try {
    let ready=false; for(let i=0;i<80;i++){if(docker(['exec',name,'pg_isready','-U','postgres']).status===0){ready=true;break;} docker(['exec',name,'sh','-c','sleep 0.1']);} assert.ok(ready);
    assert.equal(admin("CREATE DATABASE williamos;",'postgres').status,0);
    for (const file of readdirSync('migrations/ai-evalops-harness').filter(x => /^000[0-7]_.*\.sql$/.test(x) && !x.endsWith('.rollback.sql')).sort()) {
      const result=admin(readFileSync(`migrations/ai-evalops-harness/${file}`,'utf8')); assert.equal(result.status,0,`${file}: ${result.stderr}`);
    }
    const seed = `
CREATE ROLE seed_parent NOLOGIN;
CREATE ROLE aeh_migration_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION;
CREATE ROLE aeh_coordinator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION;
CREATE ROLE aeh_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOREPLICATION;
GRANT seed_parent TO aeh_worker;
GRANT CREATE ON DATABASE williamos TO aeh_coordinator;
GRANT TEMPORARY ON DATABASE williamos TO aeh_worker;
GRANT USAGE ON SCHEMA ai_evalops TO PUBLIC;
GRANT CREATE ON SCHEMA ai_evalops TO aeh_worker;
GRANT SELECT ON ai_evalops.jobs TO aeh_coordinator;
CREATE SEQUENCE ai_evalops.seed_sequence;
GRANT USAGE ON SEQUENCE ai_evalops.seed_sequence TO aeh_worker;
GRANT EXECUTE ON FUNCTION ${WRAPPERS.worker_heartbeat} TO aeh_coordinator WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai_evalops GRANT SELECT ON TABLES TO aeh_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai_evalops GRANT EXECUTE ON FUNCTIONS TO aeh_coordinator;
ALTER DEFAULT PRIVILEGES FOR ROLE aeh_migration_owner IN SCHEMA ai_evalops GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE aeh_migration_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE aeh_migration_owner GRANT EXECUTE ON FUNCTIONS TO aeh_coordinator;
`;
    const seeded=admin(seed); assert.equal(seeded.status,0,seeded.stderr);
    const functionsResult=admin("SELECT p.oid::regprocedure::text||'|'||r.rolname||'|'||p.prosecdef||'|'||coalesce(array_to_string(p.proconfig,','),'') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='ai_evalops' ORDER BY 1");
    assert.equal(functionsResult.status,0,functionsResult.stderr);
    let functions=functionsResult.stdout.trim().split(/\r?\n/).map(line=>{const [identity,owner,securityDefiner,search]=line.split('|');return {identity,owner,securityDefiner:securityDefiner==='t',searchPath:search?search.replace('search_path=','').split(',').map(x=>x.trim()):[],grants:[]};});
    const grantRows=admin(`
SELECT object_type||E'\\t'||identity||E'\\t'||grantee||E'\\t'||privilege||E'\\t'||grantable FROM (
 SELECT 'DATABASE' object_type,d.datname::text identity,coalesce(g.rolname,'PUBLIC')::text grantee,x.privilege_type::text privilege,x.is_grantable grantable FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE d.datname='williamos'
 UNION ALL SELECT 'SCHEMA',n.nspname::text,coalesce(g.rolname,'PUBLIC')::text,x.privilege_type::text,x.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE n.nspname='ai_evalops'
 UNION ALL SELECT CASE WHEN c.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,(n.nspname||'.'||c.relname)::text,coalesce(g.rolname,'PUBLIC')::text,x.privilege_type::text,x.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END)::"char",c.relowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE n.nspname='ai_evalops' AND c.relkind IN('r','p','S')
 UNION ALL SELECT 'FUNCTION',p.oid::regprocedure::text,coalesce(g.rolname,'PUBLIC')::text,x.privilege_type::text,x.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE n.nspname='ai_evalops'
) q ORDER BY object_type,identity,grantee,privilege,grantable;`);
    assert.equal(grantRows.status,0,grantRows.stderr);
    const grants=grantRows.stdout.trim().split(/\r?\n/).map(line=>{const [objectType,identity,grantee,privilege,grantable]=line.split('\t');return {objectType,identity,grantee,privilege,grantable:['t','true'].includes(grantable)};});
    functions=functions.map(f=>({...f,grants:grants.filter(g=>g.objectType==='FUNCTION'&&g.identity===f.identity)}));
    const snapshot={...structuredClone(baseSnapshot),functions,grants,defaultPrivileges:[
      {owner:'postgres',schema:'ai_evalops',objectType:'TABLE',grantee:'aeh_worker',privilege:'SELECT',grantable:false},
      {owner:'postgres',schema:'ai_evalops',objectType:'FUNCTION',grantee:'aeh_coordinator',privilege:'EXECUTE',grantable:false},
      {owner:'aeh_migration_owner',schema:'ai_evalops',objectType:'FUNCTION',grantee:'PUBLIC',privilege:'EXECUTE',grantable:false}
      ,{owner:'aeh_migration_owner',schema:null,objectType:'FUNCTION',grantee:'aeh_coordinator',privilege:'EXECUTE',grantable:false}
    ]};
    verifyAtlasCatalogSnapshot(snapshot);
    const rendered=renderAtlasRoleChange({policy,snapshot,grantTemplateBytes,rollbackTemplateBytes,pgHbaTemplateBytes});
    assert.deepEqual(rendered,renderAtlasRoleChange({policy,snapshot,grantTemplateBytes,rollbackTemplateBytes,pgHbaTemplateBytes}));
    const canonicalSql=`
WITH acl AS (
 SELECT 'database' k,d.datname obj,coalesce(g.rolname,'PUBLIC') grantee,x.privilege_type p,x.is_grantable go FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE d.datname='williamos'
 UNION ALL SELECT 'schema',n.nspname,coalesce(g.rolname,'PUBLIC'),x.privilege_type,x.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE n.nspname='ai_evalops'
 UNION ALL SELECT c.relkind::text,n.nspname||'.'||c.relname,coalesce(g.rolname,'PUBLIC'),x.privilege_type,x.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END)::"char",c.relowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE n.nspname='ai_evalops' AND c.relkind IN('r','p','S')
 UNION ALL SELECT 'function',p.oid::regprocedure::text,coalesce(g.rolname,'PUBLIC'),x.privilege_type,x.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE n.nspname='ai_evalops'
), meta AS (SELECT p.oid::regprocedure::text identity,r.rolname owner,p.prosecdef,coalesce(array_to_string(p.proconfig,','),'') config FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='ai_evalops'), defs AS (SELECT pg_get_userbyid(d.defaclrole) owner,coalesce(n.nspname,'') schema,d.defaclobjtype,coalesce(g.rolname,'PUBLIC') grantee,x.privilege_type,x.is_grantable FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE pg_get_userbyid(d.defaclrole) IN('postgres','aeh_migration_owner')), role_state AS (SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,coalesce((SELECT string_agg(parent.rolname,',' ORDER BY parent.rolname) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid),'') memberships FROM pg_roles r WHERE r.rolname IN('aeh_migration_owner','aeh_coordinator','aeh_worker'))
SELECT jsonb_build_object('acl',(SELECT jsonb_agg(to_jsonb(acl) ORDER BY k,obj,grantee,p,go) FROM acl),'meta',(SELECT jsonb_agg(to_jsonb(meta) ORDER BY identity) FROM meta),'defs',(SELECT jsonb_agg(to_jsonb(defs) ORDER BY owner,schema,defaclobjtype,grantee,privilege_type) FROM defs),'roles',(SELECT jsonb_agg(to_jsonb(role_state) ORDER BY rolname) FROM role_state),'schemaOwner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='ai_evalops'))::text;`;
    const before=admin(canonicalSql); assert.equal(before.status,0,before.stderr);
    const applied=admin(rendered.applySql); assert.equal(applied.status,0,applied.stderr);
    const ownerCheck=admin("SELECT bool_and(n.nspowner::regrole='aeh_migration_owner'::regrole) AND bool_and(p.proowner='aeh_migration_owner'::regrole) AND bool_and(NOT p.prosecdef OR p.proconfig=ARRAY['search_path=pg_catalog, ai_evalops, pg_temp']) FROM pg_namespace n JOIN pg_proc p ON p.pronamespace=n.oid WHERE n.nspname='ai_evalops'");
    assert.equal(ownerCheck.stdout.trim(),'t',ownerCheck.stderr);
    const expected={aeh_coordinator:['request_worker_cancellation_enveloped'],aeh_worker:['pull_worker_envelope','worker_heartbeat','acknowledge_worker_cancellation_enveloped']};
    for(const role of Object.keys(expected)) for(const [fn,identity] of Object.entries(WRAPPERS)) assert.equal(admin(`SELECT has_function_privilege('${role}','${identity}','EXECUTE')`).stdout.trim(),String(expected[role].includes(fn)?'t':'f'));
    for(const role of Object.keys(expected)) {
      const checks=["SELECT * FROM ai_evalops.jobs","INSERT INTO ai_evalops.jobs DEFAULT VALUES","UPDATE ai_evalops.jobs SET state='ADMITTED'","DELETE FROM ai_evalops.jobs","TRUNCATE ai_evalops.jobs","CREATE TABLE ai_evalops.denied(id int)","CREATE FUNCTION ai_evalops.denied() RETURNS int LANGUAGE sql AS 'SELECT 1'","SELECT ai_evalops.canonical_operation_digest('{}')","SELECT nextval('ai_evalops.seed_sequence')","CREATE EXTENSION hstore","COPY(SELECT 1)TO PROGRAM 'false'","CREATE TEMP TABLE denied(id int)","CREATE DATABASE denied","CREATE ROLE denied","GRANT seed_parent TO aeh_worker","SET ROLE seed_parent"];
      for(const sql of checks) assert.notEqual(asRole(role,sql).status,0,`${role} unexpectedly passed ${sql}`);
    }
    const future=admin("SET SESSION AUTHORIZATION aeh_migration_owner; CREATE TABLE ai_evalops.future_private(id int); CREATE SEQUENCE ai_evalops.future_sequence; CREATE FUNCTION ai_evalops.future_function() RETURNS int LANGUAGE sql AS 'SELECT 1'; RESET SESSION AUTHORIZATION; SELECT has_table_privilege('aeh_worker','ai_evalops.future_private','SELECT') OR has_table_privilege('aeh_coordinator','ai_evalops.future_private','SELECT') OR has_sequence_privilege('aeh_worker','ai_evalops.future_sequence','USAGE') OR has_sequence_privilege('aeh_coordinator','ai_evalops.future_sequence','USAGE') OR has_function_privilege('aeh_worker','ai_evalops.future_function()','EXECUTE') OR has_function_privilege('aeh_coordinator','ai_evalops.future_function()','EXECUTE') OR has_function_privilege('public','ai_evalops.future_function()','EXECUTE');");
    assert.equal(future.stdout.trim().split(/\r?\n/).at(-1),'f',future.stderr);
    assert.equal(admin('DROP TABLE ai_evalops.future_private; DROP SEQUENCE ai_evalops.future_sequence; DROP FUNCTION ai_evalops.future_function();').status,0);
    const rolled=admin(rendered.rollbackSql); assert.equal(rolled.status,0,rolled.stderr);
    const after=admin(canonicalSql); assert.equal(after.status,0,after.stderr); const delta=[...after.stdout].findIndex((c,i)=>c!==before.stdout[i]); assert.equal(after.stdout,before.stdout,`canonical catalog preimage not exactly restored; first delta ${delta}; before=${before.stdout.slice(delta-120,delta+240)} after=${after.stdout.slice(delta-120,delta+240)}`);
    assert.equal(rendered.hbaRollback,hbaPreimage); assert.equal(sha(rendered.hbaRollback),snapshot.hbaBytesSha256);
  } finally {
    const removed=docker(['rm','-f',name]); assert.equal(removed.status,0,removed.stderr);
    assert.equal(docker(['ps','-a','--filter',`name=^/${name}$`,'--format','{{.Names}}']).stdout.trim(),'');
  }
});
