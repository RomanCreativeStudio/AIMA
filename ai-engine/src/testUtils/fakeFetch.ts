/**
 * A minimal, injectable stand-in for `fetch` (mirrors `backend/src/testUtils/
 * fakeFetch.ts`, Phase 2.7) — used by every real voice provider test
 * (Phase 3.3, docs/decisions/0018-real-voice-provider-integration.md) so
 * none of them ever makes a real network call. Queues canned `Response`s in
 * call order and records every request it received.
 */
export interface FakeFetchCall {
  url: string;
  init?: RequestInit;
}

export function createFakeFetch(responses: Array<{ status: number; body?: unknown; isBinary?: boolean }>): {
  fetchFn: typeof fetch;
  calls: FakeFetchCall[];
} {
  const calls: FakeFetchCall[] = [];
  let callIndex = 0;

  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[callIndex];
    callIndex += 1;
    if (!next) {
      throw new Error(`createFakeFetch: no queued response for call #${callIndex} (${String(input)})`);
    }
    if (next.isBinary) {
      return new Response(next.body as Uint8Array, { status: next.status });
    }
    const isNullBodyStatus = next.status === 204 || next.status === 205 || next.status === 304;
    const body = isNullBodyStatus ? null : next.body === undefined ? '' : JSON.stringify(next.body);
    return new Response(body, { status: next.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  return { fetchFn, calls };
}

/** A `fetch` replacement that always rejects with an AbortError, simulating a client-side timeout. */
export function createAbortingFetch(): typeof fetch {
  return (async () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  }) as typeof fetch;
}
