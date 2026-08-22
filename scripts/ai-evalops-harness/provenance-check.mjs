import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const norm = value => value.toLowerCase().replaceAll('_', '-');

export function immutableDigest(value, pattern = '^[^@\\s]+@sha256:[a-f0-9]{64}$') {
  return new RegExp(pattern).test(value);
}

export function validateLkg(value, required) {
  const errors = required.filter(key => typeof value?.[key] !== 'string' || value[key].trim().length === 0).map(key => `missing ${key}`);
  if (value?.fixtureOnly === true) {
    if (value.promotionEligible !== false) errors.push('fixture LKG must be non-promotable');
    if ('approvedAt' in value || 'approvedBy' in value) errors.push('fixture LKG must not contain approval fields');
  }
  const hex = /^[a-f0-9]{64}$/;
  const digest = /^sha256:[a-f0-9]{64}$/;
  for (const key of ['packageLockSha256', 'pythonLockSha256', 'sbomSha256', 'provenanceSha256', 'testEvidenceSha256']) if (value?.[key] && !hex.test(value[key])) errors.push(`invalid ${key}`);
  for (const key of ['modelManifestDigest', 'modelWeightDigest']) if (value?.[key] && !digest.test(value[key])) errors.push(`invalid ${key}`);
  if (value?.sourceCommit && !/^[a-f0-9]{40}$/.test(value.sourceCommit)) errors.push('invalid sourceCommit');
  if (value?.imageDigest && !immutableDigest(value.imageDigest)) errors.push('invalid imageDigest');
  if (value?.approvedAt && (!Number.isFinite(Date.parse(value.approvedAt)) || new Date(value.approvedAt).toISOString() !== value.approvedAt)) errors.push('invalid approvedAt');
  if (value?.approvedBy && !/^[A-Za-z0-9][A-Za-z0-9_.@-]{2,127}$/.test(value.approvedBy)) errors.push('invalid approvedBy');
  return errors;
}

export function validateModel(value, required) {
  const errors = required.filter(key => value?.[key] === undefined || value[key] === null || value[key] === '').map(key => `missing model ${key}`);
  for (const key of ['manifestDigest', 'weightDigest', 'promptTemplateDigest']) if (value?.[key] && !/^sha256:[a-f0-9]{64}$/.test(value[key])) errors.push(`invalid model ${key}`);
  if (value?.contextLength && (!Number.isSafeInteger(value.contextLength) || value.contextLength < 1)) errors.push('invalid model contextLength');
  if (value?.fixtureOnly !== true || value?.promotionEligible !== false) errors.push('model fixture must be explicit and non-promotable');
  for (const key of ['provider', 'repository', 'license']) if (value?.[key] && (value[key] !== value[key].trim() || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{2,255}$/.test(value[key]))) errors.push(`invalid model ${key}`);
  if (value?.quantization && !['F16', 'BF16', 'Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'Q4_0'].includes(value.quantization)) errors.push('invalid model quantization');
  return errors;
}

export function validateSbom(value, policy) {
  const errors = [];
  const format = value?.bomFormat === 'CycloneDX' ? 'CycloneDX-JSON' : value?.spdxVersion ? 'SPDX-JSON' : undefined;
  if (!policy.acceptedFormats.includes(format)) errors.push('unaccepted SBOM format');
  for (const key of policy.requiredBindings) if (typeof value?.bindings?.[key] !== 'string' || value.bindings[key] === '') errors.push(`missing SBOM binding ${key}`);
  if (value?.bindings?.sourceCommit && !/^[a-f0-9]{40}$/.test(value.bindings.sourceCommit)) errors.push('invalid SBOM sourceCommit');
  if (value?.bindings?.imageDigest && !/^sha256:[a-f0-9]{64}$/.test(value.bindings.imageDigest)) errors.push('invalid SBOM imageDigest');
  if (value?.bindings?.documentSha256 && !/^[a-f0-9]{64}$/.test(value.bindings.documentSha256)) errors.push('invalid SBOM documentSha256');
  return errors;
}

function parseRequirement(line) {
  const clean = line.split('#')[0].trim();
  if (!clean || clean.startsWith('-')) return null;
  const match = clean.match(/^([A-Za-z0-9_.-]+)\s*(==|>=)\s*([A-Za-z0-9_.+-]+)$/);
  if (!match) throw new Error(`unsupported requirement: ${clean}`);
  return { name: norm(match[1]), op: match[2], version: match[3] };
}

function lockSpecifiers(text) {
  const result = new Map();
  let root = false, section = false, current;
  for (const line of text.split(/\r?\n/)) {
    if (line === '  .:') { root = true; continue; }
    if (root && /^  [^ ]/.test(line)) break;
    if (!root) continue;
    if (/^    (dependencies|devDependencies):$/.test(line)) { section = true; continue; }
    if (/^    [^ ]/.test(line)) { section = false; current = undefined; }
    const key = section && line.match(/^      ([^:]+):$/);
    if (key) { current = key[1].replace(/^['"]|['"]$/g, ''); continue; }
    const spec = section && current && line.match(/^        specifier: (.+)$/);
    if (spec) result.set(current, spec[1].replace(/^['"]|['"]$/g, ''));
  }
  return result;
}

export function validateRepository(root) {
  const errors = [];
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const policy = JSON.parse(read('config/ai-evalops-harness/provenance-policy.json'));
  const pkg = JSON.parse(read('package.json'));
  if (policy.authority !== 'validation-only' || policy.promotion.thisPolicyGrantsAuthority !== false) errors.push('policy must be non-authorizing');
  if (pkg.name !== policy.package.name || pkg.private !== true) errors.push('package identity/private metadata mismatch');
  if (pkg.packageManager !== policy.package.packageManager) errors.push('package manager drift');
  const lockText = read(policy.package.lockfile);
  if (!lockText.startsWith(`lockfileVersion: '${policy.package.lockfileVersion}'`)) errors.push('lockfile version drift');
  const locked = lockSpecifiers(lockText);
  const declared = new Map(Object.entries({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }));
  for (const [group, deps] of Object.entries({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies })) {
    for (const [name, spec] of Object.entries(deps ?? {})) if (locked.get(name) !== spec) errors.push(`${group}.${name} lock specifier drift`);
  }
  for (const name of locked.keys()) if (!declared.has(name)) errors.push(`lock importer has undeclared package ${name}`);
  const constraints = new Map();
  for (const line of read(policy.python.constraints).split(/\r?\n/)) {
    const item = parseRequirement(line); if (!item) continue;
    if (item.op !== '==' || constraints.has(item.name)) errors.push(`constraint must be unique and exact: ${item.name}`);
    constraints.set(item.name, item.version);
  }
  for (const file of policy.python.inputs) {
    const source = read(file);
    if (!source.split(/\r?\n/).some(line => line.trim() === `-c ${policy.python.constraints}`)) errors.push(`${file} does not include constraints`);
    for (const line of source.split(/\r?\n/)) {
      const item = parseRequirement(line); if (!item) continue;
      if (!constraints.has(item.name)) errors.push(`${file}:${item.name} is unconstrained`);
      if (item.op === '==' && constraints.get(item.name) !== item.version) errors.push(`${file}:${item.name} conflicts with constraint`);
    }
  }
  const docker = read('Dockerfile.local-app-proof');
  if (!docker.includes(`ARG ${policy.images.buildArgument}=`) || [...docker.matchAll(/^FROM (.+?)(?: AS .+)?$/gm)].some(m => m[1] !== `\${${policy.images.buildArgument}}`)) errors.push('Dockerfile base image is not routed through the provenance argument');
  errors.push(...validateModel(JSON.parse(read(policy.models.manifest)), policy.models.requiredIdentityFields));
  errors.push(...validateSbom(JSON.parse(read(policy.sbom.manifest)), policy.sbom));
  const scan = JSON.parse(read(policy.sbom.scanResult));
  if (scan.fixtureOnly !== true || scan.status !== 'NOT_SCANNED' || scan.promotionEligible !== false || scan.findings !== null) errors.push('validation scan artifact overclaims execution');
  errors.push(...validateLkg(JSON.parse(read(policy.lastKnownGood.manifest)), policy.lastKnownGood.candidateRequiredFields));
  if (policy.python.constraintsAreTransitiveLock !== false || policy.python.productionLockRequiresHashes !== true) errors.push('Python lock claims are unsafe');
  return { ok: errors.length === 0, errors, policyId: policy.policyId, validationOnly: true, networkAccessed: false, files: ['package.json', policy.package.lockfile, policy.python.constraints, ...policy.python.inputs, 'Dockerfile.local-app-proof', policy.models.manifest, policy.sbom.manifest, policy.sbom.scanResult, policy.lastKnownGood.manifest].map(file => ({ file, sha256: sha256(read(file)) })) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? '.');
  const result = validateRepository(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
