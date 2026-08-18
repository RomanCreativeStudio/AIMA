import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDocumentParser } from './registry';
import { DocumentFormatNotImplementedError } from '../errors';

test('getDocumentParser("markdown") extracts the first heading as the title', async () => {
  const parser = getDocumentParser('markdown');
  const result = await parser.parse('# Getting Started\n\nRun npm install.');
  assert.equal(result.title, 'Getting Started');
  assert.match(result.content, /Run npm install\./);
});

test('getDocumentParser("markdown") leaves title undefined with no heading', async () => {
  const parser = getDocumentParser('markdown');
  const result = await parser.parse('Just a paragraph with no heading.');
  assert.equal(result.title, undefined);
});

test('getDocumentParser("plaintext") treats a short first line as the title', async () => {
  const parser = getDocumentParser('plaintext');
  const result = await parser.parse('Client Onboarding Notes\n\nThe client wants a redesign.');
  assert.equal(result.title, 'Client Onboarding Notes');
});

test('getDocumentParser("plaintext") leaves title undefined when the first line is too long', async () => {
  const parser = getDocumentParser('plaintext');
  const longFirstLine = 'x'.repeat(200);
  const result = await parser.parse(`${longFirstLine}\nmore text`);
  assert.equal(result.title, undefined);
});

test('getDocumentParser("pdf") throws DocumentFormatNotImplementedError', async () => {
  const parser = getDocumentParser('pdf');
  await assert.rejects(() => parser.parse('%PDF-1.4 ...'), DocumentFormatNotImplementedError);
});

test('each parser reports its own format', () => {
  assert.equal(getDocumentParser('markdown').format, 'markdown');
  assert.equal(getDocumentParser('plaintext').format, 'plaintext');
  assert.equal(getDocumentParser('pdf').format, 'pdf');
});
