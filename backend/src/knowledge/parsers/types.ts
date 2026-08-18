import type { DocumentFormat } from '../types';

export interface ParsedDocument {
  title?: string;
  /** Plain text, ready for chunking. */
  content: string;
}

/**
 * Every document format AIMA can ingest implements this interface,
 * mirroring the AIProvider/EmbeddingProvider/IntentClassifier pattern —
 * callers only ever see DocumentParser, never a concrete implementation.
 */
export interface DocumentParser {
  readonly format: DocumentFormat;
  parse(raw: string): Promise<ParsedDocument>;
}
