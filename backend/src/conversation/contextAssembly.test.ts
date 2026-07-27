import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './contextAssembly';
import type { RankedDocumentChunkResult } from '../knowledge/types';
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

function documentChunk(overrides: Partial<RankedDocumentChunkResult> = {}): RankedDocumentChunkResult {
  return {
    id: 'chunk-1',
    documentId: 'doc-1',
    workspaceId: 'ws-1',
    chunkIndex: 0,
    section: null,
    content: 'Run npm install to set up the project.',
    createdAt: new Date().toISOString(),
    documentTitle: 'Setup Guide',
    score: 0.8,
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

test('buildSystemPrompt omits the documentation section when there are no chunks', () => {
  const prompt = buildSystemPrompt('rcs', [memory()], []);
  assert.doesNotMatch(prompt, /Relevant documentation/);
});

test('buildSystemPrompt includes document chunk content with document title and section', () => {
  const prompt = buildSystemPrompt(
    'development',
    [],
    [documentChunk({ documentTitle: 'Onboarding Guide', section: 'Step 1', content: 'Create an account.' })],
  );

  assert.match(prompt, /Relevant documentation for this workspace/);
  assert.match(prompt, /\[Onboarding Guide — Step 1\] Create an account\./);
});

test('buildSystemPrompt truncates an overly long document chunk', () => {
  const longContent = 'y'.repeat(1000);
  const prompt = buildSystemPrompt('rcs', [], [documentChunk({ content: longContent })]);

  assert.ok(!prompt.includes(longContent));
  assert.match(prompt, /y{500}…/);
});

test('buildSystemPrompt can render both memory and documentation sections together', () => {
  const prompt = buildSystemPrompt(
    'rcs',
    [memory({ content: 'Client prefers formal tone.' })],
    [documentChunk({ content: 'Proposal template lives in docs/proposal.md.' })],
  );

  assert.match(prompt, /Relevant memory for this workspace/);
  assert.match(prompt, /Relevant documentation for this workspace/);
  assert.match(prompt, /Client prefers formal tone\./);
  assert.match(prompt, /Proposal template lives in docs\/proposal\.md\./);
});
