#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const seedPath = arg('--seed', 'config/execution-fabric/registry.seed.json');
const evidenceDir = arg('--evidence-dir', '.artifacts/execution-fabric');
const outPath = arg('--out', '.artifacts/execution-fabric/registry.snapshot.json');

const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const warnings = [];

function readProbe(nodeId) {
  const p = path.join(evidenceDir, `${nodeId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const x = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (x?.schema_version !== '0.1-node-probe' || x?.node?.id !== nodeId) {
      throw new Error('node id or probe schema mismatch');
    }
    return x;
  } catch (e) {
    warnings.push(`${nodeId}: invalid probe: ${e.message}`);
    return null;
  }
}

function isoMs(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : null;
}

const now = Date.now();
const dynamicTtl = 300;
const nodes = seed.nodes.map((declared) => {
  const probe = readProbe(declared.id);
  if (!probe) {
    return {
      ...declared,
      warnings: [...(declared.warnings || []), 'LIVE_PROBE_MISSING'],
      constraints: [...new Set([...(declared.constraints || []), 'not-schedulable-without-live-probe'])]
    };
  }

  const observedMs = isoMs(probe.evidence?.observed_at);
  const ageSeconds = observedMs == null ? null : Math.max(0, Math.floor((now - observedMs) / 1000));
  const stale = ageSeconds == null || ageSeconds > dynamicTtl;
  const mergedWarnings = [...(probe.node.warnings || [])];
  if (stale) mergedWarnings.push(`LIVE_PROBE_STALE age_seconds=${ageSeconds ?? 'unknown'}`);

  return {
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
    constraints: stale ? [...new Set([...(declared.constraints || []), 'not-schedulable-stale-evidence'])] : declared.constraints,
    warnings: [...new Set([...(declared.warnings || []).filter(x => !x.includes('require live probe')), ...mergedWarnings])]
  };
});

// Fail-closed semantic invariants.
const errors = [];
const ids = new Set();
for (const n of nodes) {
  if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
  ids.add(n.id);
  if (!n.authority?.allow || !n.authority?.deny) errors.push(`${n.id}: missing authority`);
  if (!n.evidence?.observed_at) errors.push(`${n.id}: missing evidence timestamp`);
  const diskSerials = new Set();
  for (const d of n.disks || []) {
    if (d.serial) {
      if (diskSerials.has(d.serial)) errors.push(`${n.id}: duplicate disk serial ${d.serial}`);
      diskSerials.add(d.serial);
    }
  }
}

// Protect architectural boundaries explicitly.
const atlas = nodes.find(n => n.id === 'atlas');
if (atlas && !atlas.authority.allow.includes('authoritative-durable-state')) errors.push('atlas must retain durable-state authority');
for (const id of ['omen','hermes-node','t5810-2']) {
  const n = nodes.find(x => x.id === id);
  if (n && n.authority.allow.includes('authoritative-durable-state')) errors.push(`${id} must not gain durable-state authority implicitly`);
}

const registry = {
  schema_version: '0.1',
  generated_at: new Date().toISOString(),
  nodes
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

if (warnings.length) console.error(warnings.join('\n'));
if (errors.length) {
  console.error(errors.map(e => `FABRIC_REGISTRY_INVALID: ${e}`).join('\n'));
  process.exit(2);
}

console.log(`FABRIC_REGISTRY_ASSEMBLED: ${outPath}`);
for (const n of nodes) {
  console.log(`${n.id}: cpu=${n.cpus.length} dimm=${n.dimms.length} gpu=${n.gpus.length} disk=${n.disks.length} nic=${n.network.length} runtime=${n.runtimes.length} evidence=${n.evidence.confidence}`);
}
