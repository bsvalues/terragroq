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
const expectedSeedSha256 = 'ca99a560c60bbb833faaa57a4fb5a6f2151cba77afb4ed491d8cd60ca20ebaec';
const expectedSchemaSha256 = 'eafef11faab3a10adb46cc3b23f9b274c6f3d1642be2c95f3d7f0f8bbf9c5776';

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
