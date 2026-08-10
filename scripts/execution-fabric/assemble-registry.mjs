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
const corePath = path.join(scriptDirectory, 'assemble-registry-core.mjs');
const expectedSeedSha256 = 'a3406b2eaa9596866e3211e6f1256f37a395c0e7c3186a56217a3c8458c8b7b5';
const expectedSchemaSha256 = 'af36ba5e30431f819cedab2f48d5e883ca667a75690fcb7514f31c2441aae18f';

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

const environment = { ...process.env };
delete environment.FABRIC_NOW_UTC;
delete environment.FABRIC_ALLOW_TEST_CLOCK;
const result = spawnSync(process.execPath, [
  corePath,
  '--seed', canonicalSeedPath,
  '--schema', canonicalSchemaPath,
  ...forwarded,
], {
  cwd: repositoryRoot,
  env: environment,
  stdio: 'inherit',
});

if (result.error) fail(result.error.message);
process.exit(result.status ?? 2);
