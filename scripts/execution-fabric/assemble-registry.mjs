#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalizeJcs } from './canonical-json.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const canonicalSeedPath = path.join(repositoryRoot, 'config', 'execution-fabric', 'registry.seed.json');
const canonicalSchemaPath = path.join(repositoryRoot, 'config', 'execution-fabric', 'registry.schema.json');
const canonicalIdentityContractPath = path.join(repositoryRoot, 'config', 'execution-fabric', 'node-identity-contract.json');
const corePath = path.join(scriptDirectory, 'assemble-registry-core.mjs');
const expectedSeedSha256 = 'a9ef6ab1f28cf1202e0605148dbb2b8d162a1515ad45ff88387e40036ac9f4d1';
const expectedSchemaSha256 = '3b1647ea39f37f936a18c4ec9127d5dba7bac490647ba11a5a098b4bcd7ff11f';
// The identity contract now owns the node roster, the hostname aliases and per-node authority. It is
// pinned here for the same reason the seed is: an unreviewed edit to authority must stop assembly,
// and moving those facts out of code must not move them out of review.
const expectedIdentityContractSha256 = '65e15ed4c29edd79c815276208625eea7e81a2863277f68e9f79b3e1489ea527';

function digest(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return crypto.createHash('sha256').update(canonicalizeJcs(value)).digest('hex');
}

function fail(message) {
  console.error(`FABRIC_REGISTRY_ENTRYPOINT_WALL: ${message}`);
  process.exit(2);
}

if (process.env.FABRIC_NOW_UTC != null || process.env.FABRIC_ALLOW_TEST_CLOCK != null) {
  fail('clock overrides are not accepted by the production entrypoint');
}

const forwarded = [];
for (let index = 0; index < process.argv.slice(2).length; index += 1) {
  const argument = process.argv.slice(2)[index];
  if (!['--evidence-dir', '--out'].includes(argument)) fail(`unsupported argument ${argument}`);
  const value = process.argv.slice(2)[index + 1];
  if (!value || value.startsWith('--')) fail(`${argument} requires a value`);
  forwarded.push(argument, value);
  index += 1;
}

if (digest(canonicalSeedPath) !== expectedSeedSha256) fail('canonical seed digest mismatch');
if (digest(canonicalSchemaPath) !== expectedSchemaSha256) fail('canonical schema digest mismatch');
if (digest(canonicalIdentityContractPath) !== expectedIdentityContractSha256) fail('canonical identity contract digest mismatch');

const environment = { ...process.env };
delete environment.FABRIC_NOW_UTC;
delete environment.FABRIC_ALLOW_TEST_CLOCK;
const result = spawnSync(process.execPath, [
  corePath,
  '--seed', canonicalSeedPath,
  '--schema', canonicalSchemaPath,
  '--identity-contract', canonicalIdentityContractPath,
  ...forwarded,
], {
  cwd: repositoryRoot,
  env: environment,
  stdio: 'inherit',
});

if (result.error) fail(result.error.message);
process.exit(result.status ?? 2);
