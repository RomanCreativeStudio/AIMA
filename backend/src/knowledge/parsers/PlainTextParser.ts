import type { DocumentParser, ParsedDocument } from './types';

const MAX_INFERRED_TITLE_LENGTH = 120;

/** Normalizes line endings; heuristically treats a short first line as a title. */
export class PlainTextDocumentParser implements DocumentParser {
  readonly format = 'plaintext' as const;

  async parse(raw: string): Promise<ParsedDocument> {
    const content = raw.replace(/\r\n/g, '\n').trim();
    const firstLine = content.split('\n')[0]?.trim();

    return {
      title: firstLine && firstLine.length > 0 && firstLine.length <= MAX_INFERRED_TITLE_LENGTH ? firstLine : undefined,
      content,
    };
  }
}
