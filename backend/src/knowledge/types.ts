/** The formats a document can be imported as. PDF parsing is deferred — see parsers/PdfParser.ts. */
export const DOCUMENT_FORMATS = ['markdown', 'plaintext', 'pdf'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export interface ImportDocumentInput {
  workspaceId: string;
  format: DocumentFormat;
  /** Raw content as supplied by the caller (markdown/plaintext source, or PDF bytes as a string once that parser exists). */
  content: string;
  title?: string;
  source?: string;
  tags?: string[];
  version?: string;
}

export interface ReindexDocumentInput {
  /** New raw content to parse/chunk/embed. Omit to re-chunk the document's existing stored content unchanged. */
  content?: string;
  version?: string;
}

export interface Document {
  id: string;
  workspaceId: string;
  title: string | null;
  format: DocumentFormat;
  source: string | null;
  tags: string[];
  version: string | null;
  importedAt: string;
  updatedAt: string;
  /** Present on list/get views; omitted from the row returned immediately after import. */
  chunkCount?: number;
}

export interface DocumentChunkRecord {
  id: string;
  documentId: string;
  workspaceId: string;
  chunkIndex: number;
  section: string | null;
  content: string;
  createdAt: string;
}

export interface RankedDocumentChunkResult extends DocumentChunkRecord {
  /** Cosine similarity — higher is more relevant. */
  score: number;
  documentTitle: string | null;
}
