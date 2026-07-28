import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Every env var loadConfig() reads directly from process.env — kept in sync
// by hand since it mirrors the destructuring in env.ts rather than parsing it.
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'CREDENTIAL_ENCRYPTION_KEY',
  'PUBLIC_BACKEND_URL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
];

function readEnvExampleKeys(filename: string): Set<string> {
  const content = readFileSync(path.join(__dirname, '../../', filename), 'utf-8');
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const match = /^([A-Z0-9_]+)=/.exec(line.trim());
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

test('.env.example documents every environment variable loadConfig() requires', () => {
  const keys = readEnvExampleKeys('.env.example');
  for (const name of REQUIRED_ENV_VARS) {
    assert.ok(keys.has(name), `.env.example is missing ${name}`);
  }
});

test('.env.production.example documents every environment variable loadConfig() requires', () => {
  const keys = readEnvExampleKeys('.env.production.example');
  for (const name of REQUIRED_ENV_VARS) {
    assert.ok(keys.has(name), `.env.production.example is missing ${name}`);
  }
});

test('.env.production.example sets NODE_ENV=production', () => {
  const content = readFileSync(path.join(__dirname, '../../.env.production.example'), 'utf-8');
  assert.match(content, /^NODE_ENV=production$/m);
});
