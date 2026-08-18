import type { MemoryCandidate } from './types';

/**
 * Orders extracted candidates by how worth-surfacing they are — highest
 * confidence×importance first — so a client showing multiple suggestions
 * from one message can lead with the strongest one. Pure and deterministic,
 * mirroring `backend/src/memory/ranking.ts`'s "no AI call, fully
 * unit-testable" reasoning for the same problem one layer down (ranking
 * already-stored memories rather than freshly-extracted candidates).
 */
export function rankMemoryCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  return [...candidates].sort((a, b) => b.confidence * b.importance - a.confidence * a.importance);
}
