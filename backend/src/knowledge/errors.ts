export class DocumentNotFoundError extends Error {
  constructor(documentId: string, workspaceId: string) {
    super(`Document ${documentId} was not found in workspace ${workspaceId}`);
    this.name = 'DocumentNotFoundError';
  }
}

/**
 * Thrown by a DocumentParser whose format is registered (so imports of that
 * format are recognized end-to-end — API validation, storage) but whose
 * real parsing logic is deferred (docs/decisions/0005-knowledge-ingestion.md).
 * Fails loudly rather than silently mis-chunking unparsed content.
 */
export class DocumentFormatNotImplementedError extends Error {
  constructor(format: string) {
    super(`Parsing for document format "${format}" is not implemented yet.`);
    this.name = 'DocumentFormatNotImplementedError';
  }
}
