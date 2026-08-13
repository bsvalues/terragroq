import { createHash } from 'node:crypto';

export class AtlasRolePolicyError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const ID = /^[a-z][a-z0-9_]{0,62}$/;
const FN = /^[a-z][a-z0-9_]{0,62}$/;
const CID = /^URI:spiffe:\/\/[a-z0-9._/-]{1,120}$/;
const SHA = /^[a-f0-9]{64}$/;
const PRINCIPAL = /^(?:PUBLIC|[a-z][a-z0-9_]{0,62})$/;
const ROLES = ['deploy', 'coordinator', 'worker'];
const ROLE_KEYS = ['role', 'login', 'certIdentity', 'schemas', 'functions'];
const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const fail = code => { throw new AtlasRolePolicyError(code); };
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const qi = value => { if (!ID.test(value)) fail('ATLAS_IDENTIFIER_INVALID'); return `"${value}"`; };
const qp = value => value === 'PUBLIC' ? 'PUBLIC' : qi(value);
const ql = value => `'${String(value).replaceAll("'", "''")}'`;

export const WRAPPERS = Object.freeze({
  pull_worker_envelope: 'ai_evalops.pull_worker_envelope(uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,interval,text,timestamptz)',
  worker_heartbeat: 'ai_evalops.worker_heartbeat(uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,bigint,bigint,uuid,interval,text,text,timestamptz)',
  request_worker_cancellation_enveloped: 'ai_evalops.request_worker_cancellation_enveloped(uuid,text,text,text,timestamptz,uuid,uuid,uuid,uuid,bigint,bigint,text,text,text,interval,uuid,uuid,uuid)',
  acknowledge_worker_cancellation_enveloped: 'ai_evalops.acknowledge_worker_cancellation_enveloped(uuid,text,text,text,text,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,text,uuid,text)'
});

export function verifyAtlasRolePolicy(p) {
  if (!closed(p, ['schemaVersion','validationOnly','r3ApplyBlocked','tls','roles','database','deny','pgHba'])
      || p.schemaVersion !== 'aeh.atlas-runtime-role-policy.v2' || p.validationOnly !== true || p.r3ApplyBlocked !== true) fail('ATLAS_POLICY_INVALID');
  if (!closed(p.tls, ['minimumVersion','clientCertificateRequired','verifyClient','caReference','issuerDecisionRef','sanMapping','sanDecisionRef'])
      || p.tls.minimumVersion !== 'TLSv1.3' || p.tls.clientCertificateRequired !== true || p.tls.verifyClient !== 'verify-full'
      || !p.tls.caReference.startsWith('OS_CERT_STORE:') || !p.tls.issuerDecisionRef.startsWith('R3_REQUIRED:')
      || p.tls.sanMapping !== 'URI_SAN_EXACT' || !p.tls.sanDecisionRef.startsWith('R3_REQUIRED:')) fail('ATLAS_TLS_INVALID');
  if (!closed(p.roles, ROLES)) fail('ATLAS_ROLE_INVALID');
  const names = new Set(), certs = new Set();
  for (const kind of ROLES) {
    const role = p.roles[kind];
    if (!closed(role, ROLE_KEYS) || !ID.test(role.role) || names.has(role.role) || role.schemas.length !== 1
        || role.schemas[0] !== 'ai_evalops' || !Array.isArray(role.functions) || new Set(role.functions).size !== role.functions.length
        || role.functions.some(name => !Object.hasOwn(WRAPPERS, name))) fail('ATLAS_ROLE_INVALID');
    if (kind === 'deploy' && (role.login !== false || role.certIdentity !== null || role.functions.length)) fail('ATLAS_DEPLOY_OWNER_INVALID');
    if (kind !== 'deploy' && (role.login !== true || !CID.test(role.certIdentity) || certs.has(role.certIdentity))) fail('ATLAS_RUNTIME_IDENTITY_INVALID');
    names.add(role.role); if (role.certIdentity) certs.add(role.certIdentity);
  }
  if (!closed(p.database, ['name','revokePublic','runtimeGrant','runtimeDeny']) || !ID.test(p.database.name)
      || p.database.revokePublic.join('|') !== 'CONNECT|CREATE|TEMPORARY' || p.database.runtimeGrant.join('|') !== 'CONNECT'
      || p.database.runtimeDeny.join('|') !== 'CREATE|TEMPORARY') fail('ATLAS_DATABASE_PRIVILEGE_INVALID');
  const denyKeys = ['directTableSelect','directTableDml','ddl','roleMembership','setRole','createExtension','copyProgram','superuser','bypassRls','createDb','createRole'];
  if (!closed(p.deny, denyKeys) || denyKeys.some(key => p.deny[key] !== true)) fail('ATLAS_DENY_INVALID');
  if (!closed(p.pgHba, ['database','sourceDecisionRef','method','clientcert','map','exactRoles']) || p.pgHba.database !== p.database.name
      || !p.pgHba.sourceDecisionRef.startsWith('R3_REQUIRED:') || p.pgHba.method !== 'cert' || p.pgHba.clientcert !== 'verify-full'
      || p.pgHba.exactRoles.join('|') !== 'aeh_coordinator|aeh_worker') fail('ATLAS_HBA_INVALID');
  return Object.freeze({ verified: true, policyDigest: hash(p) });
}

const grantKeys = ['objectType','identity','grantee','privilege','grantable'];
function verifyGrant(g) {
  if (!closed(g, grantKeys) || !['DATABASE','SCHEMA','FUNCTION','TABLE','SEQUENCE'].includes(g.objectType)
      || typeof g.identity !== 'string' || !g.identity || !PRINCIPAL.test(g.grantee)
      || !/^[A-Z ]+$/.test(g.privilege) || typeof g.grantable !== 'boolean') fail('ATLAS_SNAPSHOT_INVALID');
  if ((['DATABASE','SCHEMA'].includes(g.objectType) && !ID.test(g.identity))
      || (['TABLE','SEQUENCE'].includes(g.objectType) && !/^ai_evalops\.[a-z][a-z0-9_]{0,62}$/.test(g.identity))
      || (g.objectType === 'FUNCTION' && !/^ai_evalops\.[a-z][a-z0-9_]{0,62}\([a-z0-9_, \[\]]*\)$/.test(g.identity))) fail('ATLAS_SNAPSHOT_INVALID');
}

export function verifyAtlasCatalogSnapshot(snapshot) {
  const keys = ['schemaVersion','database','schema','schemaOwner','artifacts','roles','grants','defaultPrivileges','functions','hbaBytesSha256','hbaBytesBase64'];
  if (!closed(snapshot, keys) || snapshot.schemaVersion !== 'aeh.atlas-catalog-snapshot.v3' || !ID.test(snapshot.database)
      || snapshot.schema !== 'ai_evalops' || !ID.test(snapshot.schemaOwner) || !Array.isArray(snapshot.roles) || !Array.isArray(snapshot.grants)
      || !Array.isArray(snapshot.defaultPrivileges) || !Array.isArray(snapshot.functions)
      || !SHA.test(snapshot.hbaBytesSha256) || typeof snapshot.hbaBytesBase64 !== 'string'
      || createHash('sha256').update(Buffer.from(snapshot.hbaBytesBase64, 'base64')).digest('hex') !== snapshot.hbaBytesSha256) fail('ATLAS_SNAPSHOT_INVALID');
  if (!closed(snapshot.artifacts,['policySha256','grantTemplateSha256','rollbackTemplateSha256','pgHbaTemplateSha256'])
      || Object.values(snapshot.artifacts).some(value=>!SHA.test(value))) fail('ATLAS_SNAPSHOT_INVALID');
  for (const role of snapshot.roles) {
    if (!closed(role, ['role','login','superuser','createDb','createRole','inherit','replication','bypassRls','memberships'])
        || !ID.test(role.role) || ['login','superuser','createDb','createRole','inherit','replication','bypassRls'].some(k => typeof role[k] !== 'boolean')
        || !Array.isArray(role.memberships) || role.memberships.some(x => !ID.test(x))) fail('ATLAS_SNAPSHOT_INVALID');
  }
  snapshot.grants.forEach(verifyGrant);
  for (const d of snapshot.defaultPrivileges) {
    if (!closed(d, ['owner','schema','objectType','grantee','privilege','grantable']) || !ID.test(d.owner)
        || (d.schema !== null && !ID.test(d.schema)) || !['FUNCTION','TABLE','SEQUENCE'].includes(d.objectType)
        || !PRINCIPAL.test(d.grantee) || !/^[A-Z ]+$/.test(d.privilege) || typeof d.grantable !== 'boolean') fail('ATLAS_SNAPSHOT_INVALID');
  }
  for (const f of snapshot.functions) {
    if (!closed(f, ['identity','owner','securityDefiner','searchPath','grants']) || typeof f.identity !== 'string'
        || !ID.test(f.owner) || typeof f.securityDefiner !== 'boolean' || !Array.isArray(f.searchPath) || !Array.isArray(f.grants)) fail('ATLAS_SNAPSHOT_INVALID');
    f.grants.forEach(verifyGrant);
  }
  return Object.freeze({ verified: true, snapshotDigest: hash(snapshot) });
}

const grantSql = (g, verb='GRANT') => {
  const target = g.objectType === 'FUNCTION' ? `FUNCTION ${g.identity}` : `${g.objectType} ${g.objectType === 'DATABASE' || g.objectType === 'SCHEMA' ? qi(g.identity) : g.identity}`;
  return `${verb} ${g.privilege} ON ${target} ${verb === 'GRANT' ? 'TO' : 'FROM'} ${qp(g.grantee)}${verb === 'GRANT' && g.grantable ? ' WITH GRANT OPTION' : ''};`;
};
const defaultSql = d => `ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(d.owner)}${d.schema ? ` IN SCHEMA ${qi(d.schema)}` : ''} GRANT ${d.privilege} ON ${d.objectType === 'FUNCTION' ? 'FUNCTIONS' : `${d.objectType}S`} TO ${qp(d.grantee)}${d.grantable ? ' WITH GRANT OPTION' : ''};`;

export function renderAtlasRoleChange({ policy, snapshot, grantTemplateBytes, rollbackTemplateBytes, pgHbaTemplateBytes }) {
  verifyAtlasRolePolicy(policy); verifyAtlasCatalogSnapshot(snapshot);
  for (const bytes of [grantTemplateBytes, rollbackTemplateBytes, pgHbaTemplateBytes]) if (typeof bytes !== 'string' || !bytes.length) fail('ATLAS_TEMPLATE_INVALID');
  if (snapshot.artifacts.policySha256 !== hash(policy) || snapshot.artifacts.grantTemplateSha256 !== hash(grantTemplateBytes)
      || snapshot.artifacts.rollbackTemplateSha256 !== hash(rollbackTemplateBytes) || snapshot.artifacts.pgHbaTemplateSha256 !== hash(pgHbaTemplateBytes)) fail('ATLAS_ARTIFACT_PREIMAGE_MISMATCH');
  const deploy = policy.roles.deploy.role, coordinator = policy.roles.coordinator.role, worker = policy.roles.worker.role;
  const runtime = [coordinator, worker];
  const exactGrants = runtime.flatMap(kindRole => {
    const kind = kindRole === coordinator ? 'coordinator' : 'worker';
    return policy.roles[kind].functions.map(name => ({ role: kindRole, identity: WRAPPERS[name] }));
  });
  const common = { database_name: policy.database.name, deploy_role: deploy, coordinator_role: coordinator, worker_role: worker };
  const substitute = (bytes, values) => bytes.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) fail('ATLAS_TEMPLATE_TOKEN_INVALID'); return values[key];
  });
  const defaultRevokes = [...new Map(snapshot.defaultPrivileges.map(d => [`${d.owner}|${d.schema}|${d.objectType}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(d.owner)}${d.schema ? ` IN SCHEMA ${qi(d.schema)}` : ''} REVOKE ALL ON ${d.objectType === 'FUNCTION' ? 'FUNCTIONS' : `${d.objectType}S`} FROM PUBLIC, ${qi(coordinator)}, ${qi(worker)};`])).values()].join('\n');
  const membershipRevokes = snapshot.roles.flatMap(r => r.memberships.map(parent => `REVOKE ${qi(parent)} FROM ${qi(r.role)};`)).join('\n');
  const applyBody = substitute(grantTemplateBytes, {
    ...common,
    exact_wrapper_grants: exactGrants.map(x => `GRANT EXECUTE ON FUNCTION ${x.identity} TO ${qi(x.role)};`).join('\n'),
    preimage_default_revokes: defaultRevokes,
    preimage_membership_revokes: membershipRevokes
  });
  const roleRestore = snapshot.roles.map(r => `ALTER ROLE ${qi(r.role)} ${r.login?'LOGIN':'NOLOGIN'} ${r.superuser?'SUPERUSER':'NOSUPERUSER'} ${r.createDb?'CREATEDB':'NOCREATEDB'} ${r.createRole?'CREATEROLE':'NOCREATEROLE'} ${r.inherit?'INHERIT':'NOINHERIT'} ${r.replication?'REPLICATION':'NOREPLICATION'} ${r.bypassRls?'BYPASSRLS':'NOBYPASSRLS'};`).join('\n');
  const ownerRestore = snapshot.functions.map(f => `ALTER FUNCTION ${f.identity} OWNER TO ${qi(f.owner)};`).join('\n');
  const aclRestore = snapshot.grants.map(g => grantSql(g)).join('\n');
  const defaultRestore = snapshot.defaultPrivileges.map(defaultSql).join('\n');
  const membershipRestore = snapshot.roles.flatMap(r => r.memberships.map(parent => `GRANT ${qi(parent)} TO ${qi(r.role)};`)).join('\n');
  const rollbackBody = substitute(rollbackTemplateBytes, {
    ...common, schema_owner_restore: qi(snapshot.schemaOwner), role_restore: roleRestore, membership_restore: membershipRestore, function_owner_restore: ownerRestore, acl_restore: aclRestore, default_acl_restore: defaultRestore, preimage_default_revokes: defaultRevokes
  });
  const hbaAfter = substitute(pgHbaTemplateBytes, { database_name: policy.database.name });
  return Object.freeze({
    schemaVersion: 'aeh.atlas-rendered-change.v3', snapshotDigest: hash(snapshot), policyDigest: hash(policy),
    applySql: applyBody, rollbackSql: rollbackBody, hbaAfter,
    hbaRollback: Buffer.from(snapshot.hbaBytesBase64, 'base64').toString('utf8'),
    applySha256: hash(applyBody), rollbackSha256: hash(rollbackBody), hbaAfterSha256: hash(hbaAfter)
  });
}

export function planAtlasRolePolicy({policy,snapshot}) {
  const verified=verifyAtlasRolePolicy(policy); verifyAtlasCatalogSnapshot(snapshot);
  return Object.freeze({schemaVersion:'aeh.atlas-role-plan.v3',planId:hash({verified,snapshot}),dryRun:true,r3ApplyBlocked:true,preimage:snapshot,secrets:[]});
}
