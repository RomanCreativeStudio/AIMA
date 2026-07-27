import type { DocumentFormat } from '../types';
import type { DocumentParser } from './types';
import { MarkdownDocumentParser } from './MarkdownParser';
import { PlainTextDocumentParser } from './PlainTextParser';
import { PdfDocumentParser } from './PdfParser';

/**
 * The only place that knows which concrete DocumentParser classes exist.
 * Unlike AI_PROVIDER/EMBEDDING_PROVIDER, format isn't an environment
 * choice — it's supplied per-document — so this is a plain lookup, not an
 * env-driven factory.
 */
const PARSERS: Record<DocumentFormat, DocumentParser> = {
  markdown: new MarkdownDocumentParser(),
  plaintext: new PlainTextDocumentParser(),
  pdf: new PdfDocumentParser(),
};

export function getDocumentParser(format: DocumentFormat): DocumentParser {
  return PARSERS[format];
}
