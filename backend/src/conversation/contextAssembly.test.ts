import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './contextAssembly';
import type { RankedMemoryResult } from '../memory/types';

function memory(overrides: Partial<RankedMemoryResult> = {}): RankedMemoryResult {
  return {
    id: 'mem-1',
    workspaceId: 'ws-1',
    scope: 'workspace',
    content: 'The client prefers email over phone calls.',
    source: null,
    conversationId: null,
    projectKey: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    score: 0.9,
    ...overrides,
  };
}

test('buildSystemPrompt names the correct workspace for each slug', () => {
  const rcsPrompt = buildSystemPrompt('rcs', []);
  const mfsPrompt = buildSystemPrompt('mfs', []);
  assert.match(rcsPrompt, /Roman Creative Studio/);
  assert.match(mfsPrompt, /Mythic Forge Studios/);
});

test('buildSystemPrompt notes when no relevant memory was found', () => {
  const prompt = buildSystemPrompt('personal', []);
  assert.match(prompt, /No relevant stored memory was found/);
});

test('buildSystemPrompt includes memory content and scope, ranked in order', () => {
  const prompt = buildSystemPrompt('mfs', [
    memory({ content: 'Kestrel is the protagonist.', scope: 'project' }),
    memory({ content: 'Season 1 ends on a cliffhanger.', scope: 'workspace' }),
  ]);

  assert.match(prompt, /1\. \(project\) Kestrel is the protagonist\./);
  assert.match(prompt, /2\. \(workspace\) Season 1 ends on a cliffhanger\./);
});

test('buildSystemPrompt truncates an overly long memory snippet', () => {
  const longContent = 'x'.repeat(1000);
  const prompt = buildSystemPrompt('development', [memory({ content: longContent })]);

  assert.ok(!prompt.includes(longContent), 'the full 1000-character memory should not appear verbatim');
  assert.match(prompt, /x{500}…/);
});

test('buildSystemPrompt always states AIMA never acts without approval', () => {
  const prompt = buildSystemPrompt('personal', []);
  assert.match(prompt, /never send external communication|without explicit user approval/);
});
