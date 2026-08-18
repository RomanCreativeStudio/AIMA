/** Formats an embedding as the text literal pgvector expects for a `::vector` cast parameter. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
