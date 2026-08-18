import { DocumentFormatNotImplementedError } from '../errors';
import type { DocumentParser, ParsedDocument } from './types';

/**
 * PDF text extraction is deferred (docs/decisions/0005-knowledge-ingestion.md)
 * — this stub satisfies the DocumentParser interface so "pdf" is a
 * recognized format end-to-end (registry, API validation) without pulling
 * in a PDF parsing dependency before it's needed. Calling parse() fails
 * clearly rather than silently mis-chunking binary content as text.
 */
export class PdfDocumentParser implements DocumentParser {
  readonly format = 'pdf' as const;

  async parse(): Promise<ParsedDocument> {
    throw new DocumentFormatNotImplementedError('pdf');
  }
}
