import type { DocumentParser, ParsedDocument } from './types';

/** Normalizes line endings and lifts the first Markdown heading as a title — no further transformation. */
export class MarkdownDocumentParser implements DocumentParser {
  readonly format = 'markdown' as const;

  async parse(raw: string): Promise<ParsedDocument> {
    const content = raw.replace(/\r\n/g, '\n').trim();
    const headingMatch = /^#{1,6}\s+(.+)$/m.exec(content);

    return {
      title: headingMatch ? headingMatch[1].trim() : undefined,
      content,
    };
  }
}
