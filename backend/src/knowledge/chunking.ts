export interface DocumentChunkDraft {
  index: number;
  section: string | null;
  content: string;
}

interface ParagraphUnit {
  section: string | null;
  text: string;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

/**
 * Splits content into paragraph units, tracking the nearest preceding
 * Markdown heading as each unit's section. Plain text with no headings
 * simply gets `section: null` throughout. Blank lines are paragraph
 * separators; consecutive non-blank lines form one unit.
 */
function splitIntoParagraphs(content: string): ParagraphUnit[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const units: ParagraphUnit[] = [];

  let buffer: string[] = [];
  let currentSection: string | null = null;
  let bufferSection: string | null = null;

  const flush = () => {
    if (buffer.length > 0) {
      const text = buffer.join('\n').trim();
      if (text.length > 0) {
        units.push({ section: bufferSection, text });
      }
      buffer = [];
    }
  };

  for (const line of lines) {
    const headingMatch = HEADING_PATTERN.exec(line.trim());
    if (headingMatch) {
      currentSection = headingMatch[2].trim();
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    if (buffer.length === 0) {
      bufferSection = currentSection;
    }
    buffer.push(line);
  }
  flush();

  return units;
}

/**
 * Deterministic chunking suitable for embeddings: the same content and
 * maxChunkChars always produce the same chunks (docs/decisions/0005-
 * knowledge-ingestion.md). Paragraphs are packed greedily up to
 * maxChunkChars; a single paragraph larger than maxChunkChars is hard-split
 * at character boundaries so no chunk ever exceeds the limit.
 */
export function chunkDocument(content: string, maxChunkChars = 1000): DocumentChunkDraft[] {
  const units = splitIntoParagraphs(content);
  const chunks: DocumentChunkDraft[] = [];

  let bufferParagraphs: string[] = [];
  let bufferSection: string | null = null;

  const flushChunk = () => {
    if (bufferParagraphs.length > 0) {
      chunks.push({ index: chunks.length, section: bufferSection, content: bufferParagraphs.join('\n\n') });
      bufferParagraphs = [];
    }
  };

  for (const unit of units) {
    if (unit.text.length > maxChunkChars) {
      flushChunk();
      for (let offset = 0; offset < unit.text.length; offset += maxChunkChars) {
        chunks.push({
          index: chunks.length,
          section: unit.section,
          content: unit.text.slice(offset, offset + maxChunkChars),
        });
      }
      continue;
    }

    const currentLength = bufferParagraphs.join('\n\n').length;
    const prospectiveLength = currentLength === 0 ? unit.text.length : currentLength + 2 + unit.text.length;

    if (bufferParagraphs.length > 0 && prospectiveLength > maxChunkChars) {
      flushChunk();
    }

    if (bufferParagraphs.length === 0) {
      bufferSection = unit.section;
    }
    bufferParagraphs.push(unit.text);
  }
  flushChunk();

  return chunks;
}
