#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalizeJcs } from './canonical-json.mjs';

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const seedPath = arg('--seed', 'config/execution-fabric/registry.seed.json');
const schemaPath = arg('--schema', 'config/execution-fabric/registry.schema.json');
const evidenceDir = arg('--evidence-dir', '.artifacts/execution-fabric');
const outPath = arg('--out', '.artifacts/execution-fabric/registry.snapshot.json');

if (fs.existsSync(outPath)) fs.rmSync(outPath);
function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`FABRIC_REGISTRY_INVALID: unable to read ${label} at ${filePath}: ${error.message}`);
    process.exit(2);
  }
}
const seed = readJson(seedPath, 'seed');
const schema = readJson(schemaPath, 'schema');
// The registry declares the version of the schema that validates it, so it is READ from that schema
// rather than restated here. A restated literal is how a bump lands emitting the old version: the
// only signal was a reviewer noticing two edits had to happen together, and the digest pin in
// `assemble-registry.mjs` is the thing that actually enforces "these move together".
const registrySchemaVersion = schema?.properties?.schema_version?.const;
if (typeof registrySchemaVersion !== 'string') {
  console.error('FABRIC_REGISTRY_INVALID: schema does not pin properties.schema_version.const');
  process.exit(2);
}
const warnings = [];
const probeWarnings = new Map();

// Node identity, roster and per-node authority have ONE owner: the reviewed identity contract.
//
// They used to have three. `probe-windows.ps1` and `probe-linux.sh` each carried their own
// hostname-to-node-id table, and this file restated the whole authority catalogue as a literal. Three
// copies of the same reviewed facts drift independently, and nothing compared them -- a node renamed
// in one probe and not the other would simply stop being the node it was.
//
// This is a REPLACEMENT, not a fourth copy: the literal that stood here and both probe tables are
// gone, and all three now read this file. The contract's bytes are digest-pinned by
// `assemble-registry.mjs` exactly as the seed and schema are, so it is a reviewed input rather than
// an editable one -- otherwise moving authority out of code would have moved it out of review too.
const identityContractPath = arg('--identity-contract', 'config/execution-fabric/node-identity-contract.json');
const identityContract = readJson(identityContractPath, 'identity contract');
if (identityContract?.contract !== 'williamos-node-identity/1') {
  console.error('FABRIC_REGISTRY_INVALID: identity contract version is not williamos-node-identity/1');
  process.exit(2);
}
const canonicalAuthority = Object.fromEntries(
  Object.entries(identityContract.nodes ?? {}).map(([id, entry]) => [id, entry.authority])
);
// Every roster entry must actually carry authority, checked here rather than trusted.
//
// The comparison below skips a node whose expected authority is falsy. When the catalogue was a
// literal in this file that could not happen, but a contract is a FILE: an entry with its `authority`
// key removed would keep the roster check passing while silently disabling the allow/deny/bounded
// comparison for that node. A wall that quietly stops applying is worse than no wall, because the
// assembly still reports success.
for (const [id, authority] of Object.entries(canonicalAuthority)) {
  if (!authority || !Array.isArray(authority.allow) || !Array.isArray(authority.deny)) {
    console.error(`FABRIC_REGISTRY_INVALID: identity contract entry ${id} carries no allow/deny authority`);
    process.exit(2);
  }
}
// One hostname belongs to exactly one node. The three readers of this contract resolve a duplicate
// differently -- the probes build maps by assignment and keep the LAST claim, the TypeScript reader
// returns the FIRST -- so an alias claimed twice would have the probes and the projection disagree
// about which node a machine is. Rejected here as well as in the reader, because this is the check
// CI actually runs, and a contract that reaches assembly has therefore been proven unambiguous.
const hostnameClaims = new Map();
for (const [id, entry] of Object.entries(identityContract.nodes ?? {})) {
  for (const alias of entry.hostnames ?? []) {
    const normalized = String(alias).trim().toLowerCase();
    if (!normalized) continue;
    if (hostnameClaims.has(normalized)) {
      console.error(`FABRIC_REGISTRY_INVALID: identity contract hostname ${normalized} is claimed by both ${hostnameClaims.get(normalized)} and ${id}`);
      process.exit(2);
    }
    hostnameClaims.set(normalized, id);
  }
}
const canonicalNodeIds = Object.keys(canonicalAuthority);

function typeMatches(value, expected) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

function isRfc3339DateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText == null ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText == null ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  const parseableValue = second === 60
    ? value.replace(/:(?:60)(?=(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$)/, ':59')
    : value;
  return day >= 1 && day <= daysInMonth && Number.isFinite(Date.parse(parseableValue));
}

function rfc3339Ms(value) {
  if (!isRfc3339DateTime(value)) return null;
  const parseableValue = value
    .replace('t', 'T')
    .replace(/z$/, 'Z')
    .replace(/:(?:60)(?=(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$)/, ':59');
  const parsed = Date.parse(parseableValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateSchema(value, rawRule, location = '$') {
  const errors = [];
  let rule = rawRule;
  if (typeof rule?.$ref === 'string') {
    const match = /^#\/\$defs\/(.+)$/.exec(rule.$ref);
    if (!match || !schema.$defs?.[match[1]]) return [`${location}: unresolved schema reference ${rule.$ref}`];
    rule = schema.$defs[match[1]];
  }
  if (Array.isArray(rule?.oneOf)) {
    const matches = rule.oneOf.filter(candidate => validateSchema(value, candidate, location).length === 0);
    return matches.length === 1 ? [] : [`${location}: expected exactly one oneOf schema match`];
  }
  if (Object.hasOwn(rule, 'const') && value !== rule.const) errors.push(`${location}: expected const ${JSON.stringify(rule.const)}`);
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) errors.push(`${location}: value is not in enum`);
  const expectedTypes = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : [];
  if (expectedTypes.length && !expectedTypes.some(expected => typeMatches(value, expected))) {
    return [`${location}: expected ${expectedTypes.join('|')}`];
  }
  if (typeof value === 'string') {
    if (Number.isInteger(rule.minLength) && value.length < rule.minLength) errors.push(`${location}: shorter than minLength`);
    if (typeof rule.pattern === 'string' && !new RegExp(rule.pattern).test(value)) errors.push(`${location}: pattern mismatch`);
    if (rule.format === 'date-time' && !isRfc3339DateTime(value)) errors.push(`${location}: invalid RFC 3339 date-time`);
  }
  if (typeof value === 'number') {
    if (typeof rule.minimum === 'number' && value < rule.minimum) errors.push(`${location}: below minimum`);
    if (typeof rule.maximum === 'number' && value > rule.maximum) errors.push(`${location}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(rule.minItems) && value.length < rule.minItems) errors.push(`${location}: shorter than minItems`);
    if (Number.isInteger(rule.maxItems) && value.length > rule.maxItems) errors.push(`${location}: longer than maxItems`);
    if (Array.isArray(rule.prefixItems)) {
      rule.prefixItems.forEach((itemRule, index) => {
        if (index < value.length) errors.push(...validateSchema(value[index], itemRule, `${location}[${index}]`));
      });
      if (rule.items === false && value.length > rule.prefixItems.length) {
        errors.push(`${location}: contains items beyond prefixItems`);
      } else if (rule.items && rule.items !== false) {
        value.slice(rule.prefixItems.length).forEach((item, offset) => {
          const index = rule.prefixItems.length + offset;
          errors.push(...validateSchema(item, rule.items, `${location}[${index}]`));
        });
      }
    } else if (rule.items && rule.items !== false) {
      value.forEach((item, index) => errors.push(...validateSchema(item, rule.items, `${location}[${index}]`)));
    }
  }
  if (typeMatches(value, 'object')) {
    const properties = rule.properties ?? {};
    for (const required of rule.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}: missing required ${required}`);
    }
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${location}: additional property ${key}`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) errors.push(...validateSchema(child, properties[key], `${location}.${key}`));
    }
  }
  return errors;
}

function exactKeys(value, expected, location) {
  if (!typeMatches(value, 'object')) return [`${location}: expected object`];
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return JSON.stringify(actual) === JSON.stringify(wanted) ? [] : [`${location}: expected exact keys ${wanted.join(',')}`];
}

function capabilityAxis(state, reason, observedAt = null, expiresAt = null, snapshotSha256 = null, evidenceRef = null) {
  return { state, reason, observed_at: observedAt, expires_at: expiresAt, snapshot_sha256: snapshotSha256, evidence_ref: evidenceRef };
}

function capabilityFallback(kind, reason) {
  const state = kind === 'missing' ? 'PENDING' : 'FAIL_CLOSED';
  return {
    compute: capabilityAxis(kind === 'missing' ? 'UNKNOWN' : 'DEGRADED', reason),
    backup_target: capabilityAxis(state, reason),
    archive_storage: capabilityAxis(state, reason),
    nas: capabilityAxis('PENDING', 'NAS_SERVICE_UNPROVEN')
  };
}

function invalidCapability(reason, detail) {
  const error = new Error(detail);
  error.reason = reason;
  throw error;
}

function compactUtcMs(value) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === iso ? parsed : null;
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function percentage(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readPinnedBytes(filePath, expectedSha256, missingReason, mismatchReason) {
  if (!fs.existsSync(filePath)) invalidCapability(missingReason, `${path.basename(filePath)} is missing`);
  const bytes = fs.readFileSync(filePath);
  if (sha256(bytes) !== expectedSha256) {
    invalidCapability(mismatchReason, `${path.basename(filePath)} exact-byte SHA-256 does not match trusted policy`);
  }
  return bytes;
}

function validateCapabilityPolicy(policy) {
  const shapeErrors = [
    ...exactKeys(policy, ['schema', 'max_ttl_hours', 'accepted_raw_probe_sha256', 'accepted_capability_file_sha256', 'accepted_backup_receipt_sha256', 'required_mounts'], '$.capability_evidence_policy')
  ];
  if (shapeErrors.length) invalidCapability('CAPABILITY_POLICY_INVALID', shapeErrors.join('; '));
  if (policy.schema !== 'aegis-capability-evidence-policy/1') invalidCapability('CAPABILITY_POLICY_INVALID', 'capability policy schema mismatch');
  if (!positiveNumber(policy.max_ttl_hours) || policy.max_ttl_hours > 48) invalidCapability('CAPABILITY_POLICY_INVALID', 'max_ttl_hours must be in (0,48]');
  for (const field of ['accepted_raw_probe_sha256', 'accepted_capability_file_sha256', 'accepted_backup_receipt_sha256']) {
    if (!/^[a-f0-9]{64}$/.test(policy[field])) invalidCapability('CAPABILITY_POLICY_INVALID', `${field} must be lowercase SHA-256`);
  }
  if (!Array.isArray(policy.required_mounts) || policy.required_mounts.length !== 2) invalidCapability('CAPABILITY_POLICY_INVALID', 'exactly two required mounts are required');
  const roles = new Set();
  for (const mount of policy.required_mounts) {
    const errors = exactKeys(mount, ['role', 'serial', 'label', 'uuid', 'mountpoint'], '$.capability_evidence_policy.required_mounts[]');
    if (errors.length || !['primary', 'secondary'].includes(mount?.role) || roles.has(mount.role)) invalidCapability('CAPABILITY_POLICY_INVALID', errors.join('; ') || 'required mount roles must be unique primary and secondary');
    roles.add(mount.role);
    for (const field of ['serial', 'label', 'uuid', 'mountpoint']) {
      if (typeof mount[field] !== 'string' || !mount[field].trim()) invalidCapability('CAPABILITY_POLICY_INVALID', `required mount ${field} must be nonempty`);
    }
  }
  return policy;
}

function readBackupReceipt(policy) {
  const receiptPath = path.join(evidenceDir, 'aegis-backup-state.json');
  const bytes = readPinnedBytes(receiptPath, policy.accepted_backup_receipt_sha256, 'BACKUP_RECEIPT_MISSING', 'BACKUP_RECEIPT_HASH_MISMATCH');
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    invalidCapability('BACKUP_RECEIPT_MALFORMED', error.message);
  }
  const shapeErrors = [
    ...exactKeys(receipt, ['schema', 'observed_at', 'backup_generation', 'last_backup', 'last_hash_verify', 'last_restore_verify', 'primary_result', 'secondary_result', 'protected_sources', 'primary_crown_jewel_manifest_sha256', 'secondary_crown_jewel_manifest_sha256', 'primary_free', 'secondary_free', 'receipt'], '$.receipt'),
    ...(Array.isArray(receipt?.protected_sources) ? receipt.protected_sources.flatMap((source, index) => exactKeys(source, ['source', 'status'], `$.receipt.protected_sources[${index}]`)) : ['$.receipt.protected_sources: expected array'])
  ];
  if (shapeErrors.length) invalidCapability('BACKUP_RECEIPT_INVALID', shapeErrors.join('; '));
  if (receipt.schema !== 'aegis-backup-state/1') invalidCapability('BACKUP_RECEIPT_INVALID', 'receipt schema mismatch');
  const observedMs = rfc3339Ms(receipt.observed_at);
  const backupMs = compactUtcMs(receipt.last_backup);
  const hashMs = compactUtcMs(receipt.last_hash_verify);
  const restoreMs = compactUtcMs(receipt.last_restore_verify);
  if ([observedMs, backupMs, hashMs, restoreMs].some(value => value == null) || backupMs > hashMs || hashMs > restoreMs || restoreMs > observedMs) {
    invalidCapability('BACKUP_RECEIPT_INVALID', 'receipt backup/hash/restore chronology is invalid');
  }
  if (receipt.backup_generation !== receipt.last_backup || receipt.receipt !== `/backup-primary/receipts/${receipt.backup_generation}.json`) invalidCapability('BACKUP_RECEIPT_INVALID', 'receipt generation fields disagree');
  if (!receipt.protected_sources.length || receipt.protected_sources.some(source => typeof source.source !== 'string' || !source.source.trim() || !['RESTORE_VERIFIED', 'SKIPPED'].includes(source.status)) || !receipt.protected_sources.some(source => source.status === 'RESTORE_VERIFIED')) {
    invalidCapability('BACKUP_RECEIPT_INVALID', 'protected sources must be named and every non-SKIPPED source must be RESTORE_VERIFIED');
  }
  const restoredCount = receipt.protected_sources.filter(source => source.status === 'RESTORE_VERIFIED').length;
  if (receipt.primary_result !== Array(restoredCount).fill('RESTORE_VERIFIED').join('/') || receipt.secondary_result !== 'OK') invalidCapability('BACKUP_RECEIPT_INVALID', 'receipt results do not match restored sources');
  if (!/^[a-f0-9]{64}$/.test(receipt.primary_crown_jewel_manifest_sha256) || receipt.primary_crown_jewel_manifest_sha256 !== receipt.secondary_crown_jewel_manifest_sha256) invalidCapability('BACKUP_RECEIPT_INVALID', 'primary and secondary manifests must be equal lowercase SHA-256 values');
  for (const field of ['primary_free', 'secondary_free']) {
    if (typeof receipt[field] !== 'string' || !receipt[field].trim()) invalidCapability('BACKUP_RECEIPT_INVALID', `${field} must be nonempty`);
  }
  return { receipt, backupMs, restoreMs };
}

const aegisDeclared = seed.nodes?.find(node => node.id === 'aegis');
let aegisPolicy;
try {
  aegisPolicy = validateCapabilityPolicy(aegisDeclared?.capability_evidence_policy);
} catch (error) {
  aegisPolicy = { invalid: true, reason: error.reason || 'CAPABILITY_POLICY_INVALID', detail: error.message };
}

function readCapabilitySnapshot(nodeId, nowMs) {
  const capabilityPath = path.join(evidenceDir, `${nodeId}-capability.json`);
  if (!fs.existsSync(capabilityPath)) {
    return { kind: 'missing', reason: 'CAPABILITY_EVIDENCE_MISSING', warning: 'CAPABILITY_EVIDENCE_MISSING' };
  }
  try {
    if (aegisPolicy.invalid) invalidCapability(aegisPolicy.reason, aegisPolicy.detail);
    let snapshot;
    const bytes = readPinnedBytes(capabilityPath, aegisPolicy.accepted_capability_file_sha256, 'CAPABILITY_EVIDENCE_MISSING', 'CAPABILITY_FILE_HASH_MISMATCH');
    try {
      snapshot = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      invalidCapability('CAPABILITY_EVIDENCE_MALFORMED', error.message);
    }
    const shapeErrors = [
      ...exactKeys(snapshot, [
        'schema', 'canonicalization', 'node', 'observed_at', 'timestamp', 'status',
        'root_avail_gb', 'root_use_pct', 'docker_active', 'docker_disk', 'portainer_agent',
        'load1', 'cores', 'cpu_temp_c', 'ram_total_mb', 'ram_avail_pct', 'smart', 'nic',
        'storage_role', 'node_health', 'compute_capability_health', 'backup_capability_health',
        'archive_capability_health', 'backup_reason', 'scheduler', 'backup', 'issues', 'snapshot_sha256'
      ], '$'),
      ...exactKeys(snapshot?.backup, ['last_backup', 'last_restore_verify', 'age_hours', 'capability', 'reason', 'threshold_hours'], '$.backup')
    ];
    if (shapeErrors.length) invalidCapability('CAPABILITY_EVIDENCE_INVALID', shapeErrors.join('; '));
    if (snapshot.schema !== 'aegis-capability/1') invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'schema must be aegis-capability/1');
    if (snapshot.node !== 'aegis' || nodeId !== 'aegis') invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'node must be aegis');
    if (snapshot.canonicalization !== 'jcs-rfc8785/1') invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'canonicalization must be jcs-rfc8785/1');
    if (!['ok', 'warn', 'fail'].includes(snapshot.status)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'status must be ok, warn, or fail');
    if (!['OK', 'WARN', 'FAIL'].includes(snapshot.node_health)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'node_health must be OK, WARN, or FAIL');
    if (!positiveNumber(snapshot.root_avail_gb)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'root_avail_gb must be positive');
    if (!percentage(snapshot.root_use_pct)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'root_use_pct must be between 0 and 100');
    if (!positiveNumber(snapshot.cores)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'cores must be positive');
    if (!positiveNumber(snapshot.ram_total_mb)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'ram_total_mb must be positive');
    if (!percentage(snapshot.ram_avail_pct)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'ram_avail_pct must be between 0 and 100');
    if (!['READY', 'DEGRADED'].includes(snapshot.compute_capability_health)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'compute_capability_health must be READY or DEGRADED');
    if (snapshot.compute_capability_health === 'READY' && snapshot.docker_active !== 'active') {
      invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'READY compute requires docker_active=active');
    }
    if (!['READY', 'FAIL_CLOSED'].includes(snapshot.backup_capability_health)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'backup_capability_health must be READY or FAIL_CLOSED');
    if (!['READY', 'FAIL_CLOSED'].includes(snapshot.archive_capability_health)) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'archive_capability_health must be READY or FAIL_CLOSED');
    if (snapshot.backup_capability_health !== snapshot.archive_capability_health) {
      invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'backup and archive capability health must match in v1');
    }
    if (!['READY', 'FAIL_CLOSED'].includes(snapshot.backup.capability) || snapshot.backup.capability !== snapshot.backup_capability_health) {
      invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'backup.capability must match backup and archive capability health');
    }
    if (typeof snapshot.backup.reason !== 'string' || !snapshot.backup.reason.trim()) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'backup.reason must be nonempty');
    if (snapshot.backup_reason !== snapshot.backup.reason) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'backup_reason must match backup.reason');
    if (typeof snapshot.backup.threshold_hours !== 'number' || !Number.isFinite(snapshot.backup.threshold_hours) || snapshot.backup.threshold_hours <= 0) {
      invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'backup.threshold_hours must be positive');
    }
    if (snapshot.backup.threshold_hours > aegisPolicy.max_ttl_hours) invalidCapability('CAPABILITY_TTL_EXCEEDS_POLICY', 'backup.threshold_hours exceeds trusted max_ttl_hours');
    if (snapshot.scheduler !== 'OFF') invalidCapability('CAPABILITY_SCHEDULER_NOT_OFF', 'scheduler must be OFF');
    const observedMs = rfc3339Ms(snapshot.observed_at);
    if (observedMs == null) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'observed_at must be RFC3339');
    if (observedMs > nowMs) invalidCapability('CAPABILITY_EVIDENCE_FUTURE', 'observed_at must not be in the future');
    const timestampMs = rfc3339Ms(snapshot.timestamp);
    if (timestampMs == null || timestampMs !== observedMs) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'timestamp must be RFC3339 and match observed_at');
    let backupMs = null;
    let restoreMs = null;
    if (snapshot.backup_capability_health === 'READY') {
      if (!['OK', 'RESTORE_VERIFIED'].includes(snapshot.backup.reason)) {
        invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'READY reason must be OK or RESTORE_VERIFIED');
      }
      backupMs = compactUtcMs(snapshot.backup.last_backup);
      restoreMs = compactUtcMs(snapshot.backup.last_restore_verify);
      if (backupMs == null || restoreMs == null) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'READY backup timestamps must use YYYYMMDDTHHMMSSZ');
      if (backupMs > observedMs || restoreMs > observedMs) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'READY backup timestamps must not be future relative to observed_at');
      if (restoreMs < backupMs) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'restore verification must not precede backup');
    }
    const thresholdMs = snapshot.backup.threshold_hours * 60 * 60 * 1000;
    const expiresMs = observedMs + thresholdMs;
    if (!Number.isFinite(expiresMs) || Math.abs(expiresMs) > 8.64e15) invalidCapability('CAPABILITY_EVIDENCE_INVALID', 'backup.threshold_hours produces an invalid expiry');
    if (!/^[a-f0-9]{64}$/.test(snapshot.snapshot_sha256)) invalidCapability('CAPABILITY_HASH_MISMATCH', 'snapshot_sha256 must be lowercase SHA-256');
    const hashInput = { ...snapshot };
    delete hashInput.snapshot_sha256;
    const calculatedHash = crypto.createHash('sha256').update(canonicalizeJcs(hashInput), 'utf8').digest('hex');
    if (calculatedHash !== snapshot.snapshot_sha256) invalidCapability('CAPABILITY_HASH_MISMATCH', 'snapshot_sha256 does not match canonical content');
    let storageProof;
    try {
      const receipt = readBackupReceipt(aegisPolicy);
      if (snapshot.backup.last_backup !== receipt.receipt.last_backup || snapshot.backup.last_restore_verify !== receipt.receipt.last_restore_verify || observedMs < rfc3339Ms(receipt.receipt.observed_at)) {
        invalidCapability('BACKUP_RECEIPT_MISMATCH', 'capability snapshot and backup receipt fields disagree');
      }
      storageProof = { kind: 'valid', ...receipt };
    } catch (error) {
      storageProof = { kind: 'invalid', reason: error.reason || 'BACKUP_RECEIPT_INVALID', detail: error.message };
    }
    return {
      kind: 'valid',
      snapshot,
      observedMs,
      backupMs,
      restoreMs,
      thresholdMs,
      storageProof,
      evidenceRef: path.basename(capabilityPath)
    };
  } catch (error) {
    const reason = error.reason || 'CAPABILITY_EVIDENCE_INVALID';
    return { kind: 'invalid', reason, warning: `CAPABILITY_EVIDENCE_INVALID reason=${reason} detail=${error.message}` };
  }
}

function recordInvalidProbe(nodeId, message) {
  const warning = `${nodeId}: invalid probe: ${message}`;
  warnings.push(warning);
  probeWarnings.set(nodeId, warning);
}

function readProbe(declared) {
  const nodeId = declared.id;
  const p = path.join(evidenceDir, `${nodeId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const rawProbe = fs.readFileSync(p);
    if (declared.id === 'aegis') {
      const acceptedDigest = declared.capability_evidence_policy?.accepted_raw_probe_sha256;
      const observedDigest = crypto.createHash('sha256').update(rawProbe).digest('hex');
      if (!acceptedDigest || observedDigest !== acceptedDigest) throw new Error('raw probe digest does not match reviewed policy');
    }
    const x = JSON.parse(rawProbe.toString('utf8'));
    const shapeErrors = [
      ...exactKeys(x, ['schema_version', 'node', 'evidence'], '$'),
      ...exactKeys(x?.node, ['id', 'hostname', 'identity', 'observed_at', 'os', 'cpus', 'dimms', 'gpus', 'disks', 'network', 'runtimes', 'warnings'], '$.node'),
      ...exactKeys(x?.evidence, ['observed_at', 'probe', 'probe_version', 'confidence'], '$.evidence')
    ];
    if (shapeErrors.length) throw new Error(shapeErrors.join('; '));
    if (x?.schema_version !== '0.1-node-probe' || x?.node?.id !== nodeId) {
      throw new Error('node id or probe schema mismatch');
    }
    if (x?.node?.observed_at !== x?.evidence?.observed_at || rfc3339Ms(x?.evidence?.observed_at) == null) {
      throw new Error('node and evidence timestamps must be identical valid instants');
    }
    for (const field of ['cpus', 'dimms', 'gpus', 'disks', 'network', 'runtimes', 'warnings']) {
      if (!Array.isArray(x.node[field])) throw new Error(`${field} must be an array`);
    }
    const nestedRules = {
      cpus: schema.$defs.cpu,
      dimms: schema.$defs.dimm,
      gpus: schema.$defs.gpu,
      disks: schema.$defs.disk,
      network: schema.$defs.network,
      runtimes: schema.$defs.runtime
    };
    const nestedErrors = [];
    for (const [field, rule] of Object.entries(nestedRules)) {
      x.node[field].forEach((item, index) => {
        nestedErrors.push(...validateSchema(item, rule, `$.node.${field}[${index}]`));
      });
    }
    nestedErrors.push(...validateSchema(x.node.os, schema.$defs.os, '$.node.os'));
    if (nestedErrors.length) throw new Error(nestedErrors.join('; '));
    const expectedProbe = declared.os?.family === 'windows'
      ? 'scripts/execution-fabric/probe-windows.ps1'
      : declared.os?.family === 'linux'
        ? 'scripts/execution-fabric/probe-linux.sh'
        : null;
    if (!expectedProbe || x.evidence.probe !== expectedProbe || x.evidence.confidence !== 'observed') {
      throw new Error('probe implementation or confidence is not allowlisted');
    }
    if (x.node.os?.family !== declared.os?.family) {
      throw new Error('probe OS family does not match the trusted node declaration');
    }
    const expectedIdentity = declared.identity;
    const observedIdentity = x.node.identity;
    if (!expectedIdentity?.machine_id_sha256) throw new Error('trusted machine identity pin is missing');
    if (
      String(x.node.hostname).trim().toLowerCase() !== String(expectedIdentity.hostname).trim().toLowerCase() ||
      observedIdentity?.machine_id_sha256 !== expectedIdentity.machine_id_sha256 ||
      observedIdentity?.source !== expectedIdentity.source ||
      String(observedIdentity?.hostname).trim().toLowerCase() !== String(expectedIdentity.hostname).trim().toLowerCase()
    ) {
      throw new Error('trusted machine identity mismatch');
    }
    return x;
  } catch (e) {
    recordInvalidProbe(nodeId, e.message);
    return null;
  }
}

function isoMs(value) {
  return rfc3339Ms(value);
}

const configuredNow = process.env.FABRIC_NOW_UTC;
const testClockAllowed = process.env.NODE_ENV === 'test' && process.env.FABRIC_ALLOW_TEST_CLOCK === '1';
if (configuredNow != null && !testClockAllowed) {
  console.error('FABRIC_REGISTRY_INVALID: FABRIC_NOW_UTC is restricted to explicit test execution');
  process.exit(2);
}
const configuredNowMs = configuredNow == null ? null : rfc3339Ms(configuredNow);
if (configuredNow != null && configuredNowMs == null) {
  console.error('FABRIC_REGISTRY_INVALID: FABRIC_NOW_UTC must be an RFC3339 date-time');
  process.exit(2);
}
const now = configuredNowMs ?? Date.now();
const dynamicTtl = 300;
const aegisCapability = readCapabilitySnapshot('aegis', now);
function declaredFallback(declared) {
  const evidenceWarning = probeWarnings.has(declared.id)
    ? `LIVE_PROBE_INVALID ${probeWarnings.get(declared.id)}`
    : 'LIVE_PROBE_MISSING';
  return {
    ...declared,
    warnings: [...(declared.warnings || []), evidenceWarning],
    constraints: [...new Set([...(declared.constraints || []), 'not-schedulable-without-live-probe'])]
  };
}

const probedNodes = seed.nodes.map((declared) => {
  const probe = readProbe(declared);
  if (!probe) return declaredFallback(declared);

  const observedMs = isoMs(probe.evidence?.observed_at);
  const ageSeconds = observedMs == null ? null : Math.max(0, Math.floor((now - observedMs) / 1000));
  const future = observedMs != null && observedMs > now + 30_000;
  const stale = ageSeconds == null || ageSeconds > dynamicTtl || future;
  const mergedWarnings = [...(probe.node.warnings || [])];
  if (future) mergedWarnings.push(`LIVE_PROBE_FUTURE observed_at=${probe.evidence.observed_at}`);
  else if (stale) mergedWarnings.push(`LIVE_PROBE_STALE age_seconds=${ageSeconds ?? 'unknown'}`);

  const capabilityList = declared.capabilities || [];
  const incompleteInventory =
    probe.node.cpus.length === 0 ||
    probe.node.disks.length === 0 ||
    (capabilityList.length > 0 && probe.node.runtimes.length === 0) ||
    (capabilityList.some(capability => /gpu|cuda/.test(capability)) && probe.node.gpus.length === 0);
  if (incompleteInventory) mergedWarnings.push('LIVE_PROBE_INCOMPLETE required capability inventory is absent');

  const candidate = {
    ...declared,
    hostname: probe.node.hostname ?? declared.hostname,
    os: probe.node.os ?? declared.os,
    evidence: {
      observed_at: probe.evidence.observed_at,
      probe: probe.evidence.probe,
      probe_version: probe.evidence.probe_version ?? null,
      confidence: 'observed',
      ttl_seconds: dynamicTtl,
      notes: `assembled from declared role/authority plus live ${declared.id} probe`
    },
    cpus: probe.node.cpus || [],
    dimms: probe.node.dimms || [],
    gpus: probe.node.gpus || [],
    disks: probe.node.disks || [],
    network: probe.node.network || [],
    runtimes: probe.node.runtimes || [],
    constraints: [
      ...new Set([
        ...(declared.constraints || []),
        ...(stale ? ['not-schedulable-stale-evidence'] : []),
        ...(incompleteInventory ? ['not-schedulable-incomplete-inventory'] : []),
        ...(probe.node.disks.some(disk => disk.serial == null) ? ['not-schedulable-ambiguous-disk-identity'] : []),
        ...(probe.node.disks.some(disk => disk.capacity_bytes == null) ? ['not-schedulable-unknown-disk-capacity'] : [])
      ])
    ],
    warnings: [...new Set([...(declared.warnings || []).filter(x => !x.includes('require live probe')), ...mergedWarnings])]
  };
  const candidateErrors = validateSchema(candidate, schema.$defs.node, `$.nodes[${declared.id}]`);
  if (candidateErrors.length) {
    recordInvalidProbe(declared.id, candidateErrors.join('; '));
    return declaredFallback(declared);
  }
  return candidate;
});

function nodeProbeGateReason(node) {
  const nodeWarnings = node.warnings || [];
  if (nodeWarnings.some(warning => warning.startsWith('LIVE_PROBE_INVALID'))) return 'LIVE_PROBE_INVALID';
  if (nodeWarnings.some(warning => warning.startsWith('LIVE_PROBE_MISSING'))) return 'LIVE_PROBE_MISSING';
  if (nodeWarnings.some(warning => warning.startsWith('LIVE_PROBE_FUTURE'))) return 'LIVE_PROBE_FUTURE';
  if (nodeWarnings.some(warning => warning.startsWith('LIVE_PROBE_STALE'))) return 'LIVE_PROBE_STALE';
  if (nodeWarnings.some(warning => warning.startsWith('LIVE_PROBE_INCOMPLETE'))) return 'LIVE_PROBE_INCOMPLETE';
  return null;
}

function projectAegisCapabilityHealth(node) {
  const probeReason = nodeProbeGateReason(node);
  const dockerReady = (node.runtimes || []).some(runtime => runtime.kind === 'docker' && runtime.state === 'running');
  const computeGateReason = probeReason || (!dockerReady ? 'RUNTIME_UNAVAILABLE' : null);
  const computeObservedMs = rfc3339Ms(node.evidence?.observed_at);
  const computeTtlSeconds = node.evidence?.ttl_seconds;
  const computeExpiresAt = computeObservedMs != null && Number.isFinite(computeTtlSeconds)
    ? new Date(computeObservedMs + computeTtlSeconds * 1000).toISOString()
    : null;
  const compute = capabilityAxis(
    computeGateReason ? 'DEGRADED' : 'READY',
    computeGateReason || 'COMPUTE_CAPABILITY_READY',
    node.evidence?.observed_at ?? null,
    computeExpiresAt,
    null,
    'aegis.json'
  );
  if (aegisCapability.kind !== 'valid') {
    const fallback = capabilityFallback(aegisCapability.kind, aegisCapability.reason);
    return {
      ...node,
      capability_health: { ...fallback, compute },
      warnings: [...new Set([...(node.warnings || []), aegisCapability.warning])]
    };
  }
  const { snapshot, observedMs, backupMs, restoreMs, thresholdMs, storageProof, evidenceRef } = aegisCapability;
  const metadata = [snapshot.observed_at, snapshot.snapshot_sha256, evidenceRef];
  const requiredMountsPresent = !probeReason && aegisPolicy.required_mounts.every(required =>
    (node.disks || []).some(disk => disk.serial === required.serial && (disk.filesystems || []).some(filesystem =>
      filesystem.label === required.label && filesystem.uuid === required.uuid && filesystem.mountpoint === required.mountpoint
    ))
  );
  const storageGateReason = probeReason || (!requiredMountsPresent ? 'AEGIS_REQUIRED_MOUNTS_MISMATCH' : null) || (storageProof.kind !== 'valid' ? storageProof.reason : null);
  const projectStorageAxis = (state) => {
    const observedExpiresMs = observedMs + thresholdMs;
    const expiryCandidates = [observedExpiresMs];
    if (backupMs != null) expiryCandidates.push(backupMs + thresholdMs);
    if (restoreMs != null) expiryCandidates.push(restoreMs + thresholdMs);
    const expiresMs = Math.min(...expiryCandidates);
    const expiresAt = new Date(expiresMs).toISOString();
    if (state === 'FAIL_CLOSED') return capabilityAxis(state, snapshot.backup.reason, metadata[0], expiresAt, metadata[1], metadata[2]);
    if (storageGateReason) return capabilityAxis('FAIL_CLOSED', storageGateReason, metadata[0], expiresAt, metadata[1], metadata[2]);
    const stale = now >= observedExpiresMs || now - backupMs > thresholdMs || now - restoreMs > thresholdMs;
    if (stale) return capabilityAxis('FAIL_CLOSED', 'BACKUP_STALE', metadata[0], expiresAt, metadata[1], metadata[2]);
    return capabilityAxis(state, snapshot.backup.reason, metadata[0], expiresAt, metadata[1], metadata[2]);
  };
  return {
    ...node,
    capability_health: {
      compute,
      backup_target: projectStorageAxis(snapshot.backup_capability_health),
      archive_storage: projectStorageAxis(snapshot.archive_capability_health),
      nas: capabilityAxis('PENDING', 'NAS_SERVICE_UNPROVEN')
    }
  };
}

const nodes = probedNodes.map(node => node.id === 'aegis' ? projectAegisCapabilityHealth(node) : node);

// Fail-closed semantic invariants.
const errors = [];
const ids = new Set();
const globalDiskSerials = new Map();
const seedSchemaErrors = validateSchema(seed, schema);
if (seedSchemaErrors.length) errors.push(...seedSchemaErrors.map(error => `seed schema: ${error}`));
if (seed.scheduler?.state !== 'disabled' || seed.scheduler?.authority !== 'not-granted') {
  errors.push(`scheduler must remain disabled and unauthorized in v${registrySchemaVersion}`);
}
const seedNodeIds = seed.nodes.map(node => node.id);
if (
  seedNodeIds.length !== canonicalNodeIds.length ||
  [...seedNodeIds].sort().join('|') !== [...canonicalNodeIds].sort().join('|')
) {
  errors.push(`canonical node roster must be exactly ${canonicalNodeIds.join(',')}`);
}
for (const n of nodes) {
  if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
  ids.add(n.id);
  if (!n.authority?.allow || !n.authority?.deny) errors.push(`${n.id}: missing authority`);
  if (!n.evidence?.observed_at) errors.push(`${n.id}: missing evidence timestamp`);
  const diskSerials = new Set();
  const diskIds = new Set();
  for (const d of n.disks || []) {
    const diskId = String(d.id ?? '').trim();
    if (!diskId) errors.push(`${n.id}: blank disk id`);
    else if (diskIds.has(diskId)) errors.push(`${n.id}: duplicate disk id ${diskId}`);
    else diskIds.add(diskId);
    if (d.serial !== null && d.serial !== undefined) {
      const normalizedSerial = String(d.serial).replace(/\s+/g, '').toUpperCase();
      if (!normalizedSerial) {
        errors.push(`${n.id}: blank disk serial`);
        continue;
      }
      if (diskSerials.has(normalizedSerial)) errors.push(`${n.id}: duplicate disk serial ${normalizedSerial}`);
      diskSerials.add(normalizedSerial);
      if (globalDiskSerials.has(normalizedSerial)) {
        errors.push(`disk serial ${normalizedSerial} appears on both ${globalDiskSerials.get(normalizedSerial)} and ${n.id}`);
      } else {
        globalDiskSerials.set(normalizedSerial, n.id);
      }
    }
  }
  const expectedAuthority = canonicalAuthority[n.id];
  if (!expectedAuthority) {
    // An assembled node the contract does not describe has no reviewed authority to be compared
    // against. That is a fail-closed condition, not a node to wave through.
    errors.push(`${n.id}: no reviewed authority in the identity contract`);
  } else {
    const rawAllow = n.authority?.allow ?? [];
    const rawDeny = n.authority?.deny ?? [];
    const actualAllow = [...new Set(rawAllow)].sort();
    const actualDeny = [...new Set(rawDeny)].sort();
    const expectedAllow = [...expectedAuthority.allow].sort();
    const expectedDeny = [...expectedAuthority.deny].sort();
    if (actualAllow.length !== rawAllow.length) errors.push(`${n.id}: duplicate authority allow entry`);
    if (actualDeny.length !== rawDeny.length) errors.push(`${n.id}: duplicate authority deny entry`);
    if (JSON.stringify(actualAllow) !== JSON.stringify(expectedAllow)) errors.push(`${n.id}: authority allow set differs from the reviewed identity contract`);
    if (JSON.stringify(actualDeny) !== JSON.stringify(expectedDeny)) errors.push(`${n.id}: authority deny set differs from the reviewed identity contract`);
    const actualBoundedCompute = n.authority?.bounded_compute;
    const expectedBoundedCompute = expectedAuthority.bounded_compute;
    if (canonicalizeJcs(actualBoundedCompute ?? null) !== canonicalizeJcs(expectedBoundedCompute ?? null)) {
      errors.push(`${n.id}: bounded compute authority differs from the reviewed identity contract`);
    }
    const conflicts = actualAllow.filter(value => actualDeny.includes(value));
    if (conflicts.length) errors.push(`${n.id}: authority allow/deny conflict ${conflicts.join(',')}`);
  }
}

// Protect architectural boundaries explicitly.
const atlas = nodes.find(n => n.id === 'atlas');
if (atlas && !atlas.authority.allow.includes('authoritative-durable-state')) errors.push('atlas must retain durable-state authority');
for (const id of ['omen','hermes-node','aegis']) {
  const n = nodes.find(x => x.id === id);
  if (n && n.authority.allow.includes('authoritative-durable-state')) errors.push(`${id} must not gain durable-state authority implicitly`);
}

const registry = {
  schema_version: registrySchemaVersion,
  generated_at: new Date(now).toISOString(),
  scheduler: seed.scheduler,
  nodes
};
const registrySchemaErrors = validateSchema(registry, schema);
if (registrySchemaErrors.length) errors.push(...registrySchemaErrors.map(error => `registry schema: ${error}`));

if (warnings.length) console.error(warnings.join('\n'));
if (errors.length) {
  console.error(errors.map(e => `FABRIC_REGISTRY_INVALID: ${e}`).join('\n'));
  process.exit(2);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const temporaryOutPath = `${outPath}.${process.pid}.tmp`;
fs.writeFileSync(temporaryOutPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
fs.renameSync(temporaryOutPath, outPath);

console.log(`FABRIC_REGISTRY_ASSEMBLED: ${outPath}`);
for (const n of nodes) {
  console.log(`${n.id}: cpu=${n.cpus.length} dimm=${n.dimms.length} gpu=${n.gpus.length} disk=${n.disks.length} nic=${n.network.length} runtime=${n.runtimes.length} evidence=${n.evidence.confidence}`);
}
