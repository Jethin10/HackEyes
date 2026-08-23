/**
 * Fetch wrapper: 15s timeout, 2 retries with linear backoff, a real browser
 * User-Agent, and a null-on-failure contract. External sites are allowed to
 * be down — callers treat `null` as "skip this source", never as a crash.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
/** Retries AFTER the initial attempt (so 3 total tries). */
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 750;

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  headers?: Record<string, string>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface InternalOptions extends HttpOptions {
  method: 'GET' | 'POST';
  body?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(
  url: string,
  opts: InternalOptions,
  attempt: number,
): Promise<{ ok: true; text: string } | { ok: false; retryable: boolean }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: opts.method,
      body: opts.body,
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        ...(opts.body !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...opts.headers,
      },
    });
    if (res.ok) {
      const text = await res.text();
      return { ok: true, text };
    }
    // Rate-limited or server-side trouble: worth another try.
    // Definitive client errors: not.
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, retryable };
  } catch {
    // Network error or abort: retryable.
    return { ok: false, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Shared implementation. Returns the response text, or null on failure. */
async function request(
  url: string,
  opts: InternalOptions,
): Promise<string | null> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await requestOnce(url, opts, attempt);
    if (result.ok) return result.text;
    if (!result.retryable || attempt === retries) break;
    await sleep(backoffMs * (attempt + 1));
  }
  return null;
}

export function httpGet(
  url: string,
  opts: HttpOptions = {},
): Promise<string | null> {
  return request(url, { ...opts, method: 'GET' });
}

export function httpPostJson(
  url: string,
  body: unknown,
  opts: HttpOptions = {},
): Promise<string | null> {
  return request(url, {
    ...opts,
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
