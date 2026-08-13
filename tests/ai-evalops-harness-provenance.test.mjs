import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { immutableDigest, validateLkg, validateModel, validateRepository, validateSbom } from '../scripts/ai-evalops-harness/provenance-check.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('repository provenance inputs are internally consistent', () => {
  assert.deepEqual(validateRepository(root).errors, []);
});

test('immutable image references require a sha256 digest', () => {
  assert.equal(immutableDigest('node:22-bookworm-slim'), false);
  assert.equal(immutableDigest(`registry.example/app@sha256:${'a'.repeat(64)}`), true);
});

test('LKG records fail closed when evidence bindings are absent', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'config/ai-evalops-harness/provenance-policy.json')));
  const complete = JSON.parse(fs.readFileSync(path.join(root, policy.lastKnownGood.manifest)));
  assert.deepEqual(validateLkg(complete, policy.lastKnownGood.candidateRequiredFields), []);
  delete complete.testEvidenceSha256;
  assert.ok(validateLkg(complete, policy.lastKnownGood.candidateRequiredFields).includes('missing testEvidenceSha256'));
});

test('LKG values, model identity and SBOM bindings fail closed', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'config/ai-evalops-harness/provenance-policy.json')));
  assert.ok(validateLkg({ imageDigest: 'app:latest', approvedAt: 'someday', approvedBy: 'x' }, policy.lastKnownGood.requiredFields).length > 3);
  assert.ok(validateModel({ contextLength: 0 }, policy.models.requiredIdentityFields).length > 1);
  assert.ok(validateSbom({ bomFormat: 'Unknown', bindings: {} }, policy.sbom).length >= 4);
});

test('fixtures cannot resemble promotion or carry loose model metadata', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'config/ai-evalops-harness/provenance-policy.json')));
  const lkg = JSON.parse(fs.readFileSync(path.join(root, policy.lastKnownGood.manifest)));
  lkg.promotionEligible = true; lkg.approvedBy = 'operator'; lkg.approvedAt = new Date().toISOString();
  assert.ok(validateLkg(lkg, policy.lastKnownGood.candidateRequiredFields).some(error => error.includes('approval fields')));
  const model = JSON.parse(fs.readFileSync(path.join(root, policy.models.manifest)));
  model.provider = ' bad '; model.quantization = 'unknown'; model.promotionEligible = true;
  assert.ok(validateModel(model, policy.models.requiredIdentityFields).length >= 3);
});

test('checker detects package/lock drift without touching repository', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeh-010-'));
  for (const rel of ['package.json', 'pnpm-lock.yaml', 'requirements.txt', 'requirements-search.txt', 'requirements-execution-fabric.txt', 'requirements-constraints.txt', 'Dockerfile.local-app-proof', 'config/ai-evalops-harness/provenance-policy.json', 'config/ai-evalops-harness/model-binding.validation.json', 'config/ai-evalops-harness/sbom.validation.cdx.json', 'config/ai-evalops-harness/scan-result.validation.json', 'config/ai-evalops-harness/lkg.validation.json']) {
    const dest = path.join(tmp, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(root, rel), dest);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'))); pkg.dependencies.next = '0.0.0'; fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify(pkg));
  assert.ok(validateRepository(tmp).errors.some(error => error.includes('dependencies.next')));
  fs.copyFileSync(path.join(root, 'package.json'), path.join(tmp, 'package.json'));
  const lock = fs.readFileSync(path.join(tmp, 'pnpm-lock.yaml'), 'utf8').replace(/    dependencies:\r?\n/, '    dependencies:\n      undeclared-fixture:\n        specifier: 1.0.0\n        version: 1.0.0\n');
  fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), lock);
  assert.ok(validateRepository(tmp).errors.includes('lock importer has undeclared package undeclared-fixture'));
  fs.rmSync(tmp, { recursive: true, force: true });
});
