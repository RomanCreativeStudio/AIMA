import type { EmbeddingProvider } from '@aima/ai-engine';
import type { Queryable } from '../db/queryable';
import { toVectorLiteral } from '../db/vector';
import { WorkspaceNotFoundError } from '../types/errors';
import { chunkDocument } from './chunking';
import { DocumentNotFoundError } from './errors';
import { getDocumentParser } from './parsers/registry';
import type {
  Document,
  DocumentFormat,
  ImportDocumentInput,
  RankedDocumentChunkResult,
  ReindexDocumentInput,
} from './types';

const DEFAULT_MAX_CHUNK_CHARS = 1000;
const DEFAULT_SEARCH_LIMIT = 5;

/**
 * Owns the document ingestion lifecycle (docs/decisions/0005-knowledge-
 * ingestion.md): import, re-index, delete, list, get, and ranked search
 * over document_chunks. Mirrors MemoryService's shape (workspace isolation
 * enforced on every method, embeddings via the same EmbeddingProvider
 * abstraction) but is a separate table/service — documents are bulk
 * ingested reference material, not assistant-curated memory.
 */
export class DocumentService {
  constructor(
    private readonly db: Queryable,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly maxChunkChars: number = DEFAULT_MAX_CHUNK_CHARS,
  ) {}

  async importDocument(input: ImportDocumentInput): Promise<Document> {
    await this.assertWorkspaceExists(input.workspaceId);

    const parser = getDocumentParser(input.format);
    const parsed = await parser.parse(input.content);

    const result = await this.db.query(
      `INSERT INTO documents (workspace_id, title, format, source, tags, version, raw_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, workspace_id, title, format, source, tags, version, imported_at, updated_at`,
      [
        input.workspaceId,
        input.title ?? parsed.title ?? null,
        input.format,
        input.source ?? null,
        input.tags ?? [],
        input.version ?? null,
        parsed.content,
      ],
    );

    const document = mapDocumentRow(result.rows[0]);
    await this.indexChunks(document.id, input.workspaceId, parsed.content);

    return document;
  }

  /**
   * Re-chunks and re-embeds a document, either against newly supplied
   * content (re-parsed with the document's original format) or against its
   * existing stored content — useful if the chunking algorithm or
   * embedding provider changes and existing documents should catch up.
   */
  async reindexDocument(workspaceId: string, documentId: string, updates?: ReindexDocumentInput): Promise<Document> {
    const existing = await this.getDocumentRow(workspaceId, documentId);

    let rawContent = existing.raw_content;
    if (updates?.content !== undefined) {
      const parser = getDocumentParser(existing.format);
      const parsed = await parser.parse(updates.content);
      rawContent = parsed.content;
    }

    const version = updates?.version ?? existing.version;

    await this.db.query(
      `UPDATE documents SET raw_content = $1, version = $2, updated_at = now() WHERE id = $3 AND workspace_id = $4`,
      [rawContent, version, documentId, workspaceId],
    );

    await this.db.query('DELETE FROM document_chunks WHERE document_id = $1 AND workspace_id = $2', [
      documentId,
      workspaceId,
    ]);
    await this.indexChunks(documentId, workspaceId, rawContent);

    return this.getDocument(workspaceId, documentId);
  }

  async deleteDocument(workspaceId: string, documentId: string): Promise<void> {
    const result = await this.db.query('DELETE FROM documents WHERE id = $1 AND workspace_id = $2', [
      documentId,
      workspaceId,
    ]);
    if (result.rowCount === 0) {
      throw new DocumentNotFoundError(documentId, workspaceId);
    }
  }

  async listDocuments(workspaceId: string): Promise<Document[]> {
    const result = await this.db.query(
      `SELECT d.id, d.workspace_id, d.title, d.format, d.source, d.tags, d.version, d.imported_at, d.updated_at,
              COUNT(c.id)::int AS chunk_count
       FROM documents d
       LEFT JOIN document_chunks c ON c.document_id = d.id
       WHERE d.workspace_id = $1
       GROUP BY d.id
       ORDER BY d.imported_at DESC`,
      [workspaceId],
    );

    return result.rows.map(mapDocumentRow);
  }

  async getDocument(workspaceId: string, documentId: string): Promise<Document> {
    const result = await this.db.query(
      `SELECT d.id, d.workspace_id, d.title, d.format, d.source, d.tags, d.version, d.imported_at, d.updated_at,
              COUNT(c.id)::int AS chunk_count
       FROM documents d
       LEFT JOIN document_chunks c ON c.document_id = d.id
       WHERE d.id = $1 AND d.workspace_id = $2
       GROUP BY d.id`,
      [documentId, workspaceId],
    );

    if (result.rows.length === 0) {
      throw new DocumentNotFoundError(documentId, workspaceId);
    }

    return mapDocumentRow(result.rows[0]);
  }

  /** Ranked semantic search over this workspace's document chunks only. */
  async search(workspaceId: string, query: string, limit: number = DEFAULT_SEARCH_LIMIT): Promise<RankedDocumentChunkResult[]> {
    const [embedding] = await this.embeddingProvider.embed([query]);
    const vector = toVectorLiteral(embedding);

    const result = await this.db.query(
      `SELECT c.id, c.document_id, c.workspace_id, c.chunk_index, c.section, c.content, c.created_at,
              d.title AS document_title,
              1 - (c.embedding <=> $2::vector) AS score
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.workspace_id = $1 AND c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $2::vector
       LIMIT $3`,
      [workspaceId, vector, limit],
    );

    return result.rows.map(mapRankedChunkRow);
  }

  private async indexChunks(documentId: string, workspaceId: string, content: string): Promise<void> {
    const drafts = chunkDocument(content, this.maxChunkChars);
    if (drafts.length === 0) {
      return;
    }

    const embeddings = await this.embeddingProvider.embed(drafts.map((draft) => draft.content));

    for (let i = 0; i < drafts.length; i++) {
      await this.db.query(
        `INSERT INTO document_chunks (document_id, workspace_id, chunk_index, section, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        [documentId, workspaceId, drafts[i].index, drafts[i].section, drafts[i].content, toVectorLiteral(embeddings[i])],
      );
    }
  }

  private async getDocumentRow(
    workspaceId: string,
    documentId: string,
  ): Promise<{ format: DocumentFormat; raw_content: string; version: string | null }> {
    const result = await this.db.query<{ format: DocumentFormat; raw_content: string; version: string | null }>(
      'SELECT format, raw_content, version FROM documents WHERE id = $1 AND workspace_id = $2',
      [documentId, workspaceId],
    );

    if (result.rows.length === 0) {
      throw new DocumentNotFoundError(documentId, workspaceId);
    }

    return result.rows[0];
  }

  private async assertWorkspaceExists(workspaceId: string): Promise<void> {
    const result = await this.db.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }
}

interface DocumentRow {
  id: string;
  workspace_id: string;
  title: string | null;
  format: DocumentFormat;
  source: string | null;
  tags: string[];
  version: string | null;
  imported_at: Date | string;
  updated_at: Date | string;
  chunk_count?: number;
}

function mapDocumentRow(row: DocumentRow): Document {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    format: row.format,
    source: row.source,
    tags: row.tags ?? [],
    version: row.version,
    importedAt: toIso(row.imported_at),
    updatedAt: toIso(row.updated_at),
    chunkCount: row.chunk_count,
  };
}

interface RankedChunkRow {
  id: string;
  document_id: string;
  workspace_id: string;
  chunk_index: number;
  section: string | null;
  content: string;
  created_at: Date | string;
  document_title: string | null;
  score: number;
}

function mapRankedChunkRow(row: RankedChunkRow): RankedDocumentChunkResult {
  return {
    id: row.id,
    documentId: row.document_id,
    workspaceId: row.workspace_id,
    chunkIndex: row.chunk_index,
    section: row.section,
    content: row.content,
    createdAt: toIso(row.created_at),
    documentTitle: row.document_title,
    score: Number(row.score),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
