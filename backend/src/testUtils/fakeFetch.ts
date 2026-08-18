/**
 * A minimal, injectable stand-in for `fetch` (Phase 2.7) — used by every
 * live connector/OAuth provider test so none of them ever makes a real
 * network call. Queues canned `Response`s in call order and records every
 * request it received, so a test can both control what a provider "sees"
 * back and assert exactly what it sent.
 */
export interface FakeFetchCall {
  url: string;
  init?: RequestInit;
}

export function createFakeFetch(responses: Array<{ status: number; body?: unknown }>): {
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
    // Response forbids a body on null-body statuses (204/205/304) — the Fetch spec, enforced by undici.
    const isNullBodyStatus = next.status === 204 || next.status === 205 || next.status === 304;
    const body = isNullBodyStatus ? null : next.body === undefined ? '' : JSON.stringify(next.body);
    return new Response(body, { status: next.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  return { fetchFn, calls };
}
