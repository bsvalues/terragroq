#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

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
const warnings = [];
const probeWarnings = new Map();

const canonicalAuthority = {
  omen: {
    allow: ['interactive-development', 'operator-control', 'read-only-lab-inspection', 'transient-ssh-tunnel', 'burst-compute'],
    deny: ['authoritative-durable-state', 'county-production-write', 'pacs-production-write', 'unattended-critical-state']
  },
  'hermes-node': {
    allow: ['local-llm-inference', 'gpu-batch', 'agent-runtime', 'bounded-execution', 'ssh-control'],
    deny: ['authoritative-durable-state', 'county-production-write', 'pacs-production-write', 'direct-ollama-lan-exposure']
  },
  atlas: {
    allow: ['authoritative-durable-state', 'database-state', 'forge-storage', 'retrieval-index', 'backup-source', 'protected-data-read-when-authorized'],
    deny: ['noisy-unbounded-batch-by-default', 'county-production-write', 'pacs-production-write']
  },
  aegis: {
    allow: ['cpu-batch-candidate', 'ci-build-test-candidate', 'hash-verify-candidate', 'compression-candidate', 'etl-transform-candidate', 'docker-worker-candidate'],
    deny: ['authoritative-durable-state', 'backup-archive-until-storage-proven', 'nas-until-storage-proven', 'county-production-write', 'pacs-production-write', 'destructive-disk-action']
  },
  azure: {
    allow: [],
    deny: ['implicit-use', 'implicit-cost', 'implicit-protected-data-egress']
  }
};
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
  if (Array.isArray(value) && rule.items) {
    value.forEach((item, index) => errors.push(...validateSchema(item, rule.items, `${location}[${index}]`)));
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
    const x = JSON.parse(fs.readFileSync(p, 'utf8'));
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

const now = Date.now();
const dynamicTtl = 300;
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

const nodes = seed.nodes.map((declared) => {
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

// Fail-closed semantic invariants.
const errors = [];
const ids = new Set();
const globalDiskSerials = new Map();
const seedSchemaErrors = validateSchema(seed, schema);
if (seedSchemaErrors.length) errors.push(...seedSchemaErrors.map(error => `seed schema: ${error}`));
if (seed.scheduler?.state !== 'disabled' || seed.scheduler?.authority !== 'not-granted') {
  errors.push('scheduler must remain disabled and unauthorized in v0.1');
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
  if (expectedAuthority) {
    const rawAllow = n.authority?.allow ?? [];
    const rawDeny = n.authority?.deny ?? [];
    const actualAllow = [...new Set(rawAllow)].sort();
    const actualDeny = [...new Set(rawDeny)].sort();
    const expectedAllow = [...expectedAuthority.allow].sort();
    const expectedDeny = [...expectedAuthority.deny].sort();
    if (actualAllow.length !== rawAllow.length) errors.push(`${n.id}: duplicate authority allow entry`);
    if (actualDeny.length !== rawDeny.length) errors.push(`${n.id}: duplicate authority deny entry`);
    if (JSON.stringify(actualAllow) !== JSON.stringify(expectedAllow)) errors.push(`${n.id}: authority allow set differs from canonical v0.1 policy`);
    if (JSON.stringify(actualDeny) !== JSON.stringify(expectedDeny)) errors.push(`${n.id}: authority deny set differs from canonical v0.1 policy`);
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
  schema_version: '0.1',
  generated_at: new Date().toISOString(),
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
