import { describe, expect, it } from 'vitest';
import { httpGet, httpPostJson } from '../../src/util/http.js';

function okFetch(body: string): typeof fetch {
  return (async () =>
    new Response(body, { status: 200 })) as unknown as typeof fetch;
}

describe('httpGet', () => {
  it('returns body text on success', async () => {
    const out = await httpGet('https://example.com/x', {
      fetchImpl: okFetch('hello'),
      backoffMs: 1,
    });
    expect(out).toBe('hello');
  });

  it('retries a 500 and succeeds on a later attempt', async () => {
    let calls = 0;
    const flaky: typeof fetch = (async () => {
      calls++;
      if (calls < 3) return new Response('boom', { status: 500 });
      return new Response('recovered', { status: 200 });
    }) as unknown as typeof fetch;
    const out = await httpGet('https://example.com/x', {
      fetchImpl: flaky,
      backoffMs: 1,
    });
    expect(out).toBe('recovered');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('returns null after exhausting retries on persistent 500s', async () => {
    let calls = 0;
    const always500: typeof fetch = (async () => {
      calls++;
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;
    const out = await httpGet('https://example.com/x', {
      fetchImpl: always500,
      backoffMs: 1,
    });
    expect(out).toBeNull();
    expect(calls).toBe(3);
  });

  it('does NOT retry definitive client errors like 404', async () => {
    let calls = 0;
    const notFound: typeof fetch = (async () => {
      calls++;
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    const out = await httpGet('https://example.com/x', {
      fetchImpl: notFound,
      backoffMs: 1,
    });
    expect(out).toBeNull();
    expect(calls).toBe(1);
  });

  it('returns null on network failure instead of throwing', async () => {
    const broken: typeof fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      httpGet('https://example.com/x', { fetchImpl: broken, backoffMs: 1 }),
    ).resolves.toBeNull();
  });

  it('aborts on timeout and returns null', async () => {
    const never: typeof fetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('The operation was aborted')),
        );
      })) as unknown as typeof fetch;
    const out = await httpGet('https://example.com/slow', {
      fetchImpl: never,
      timeoutMs: 20,
      backoffMs: 1,
      retries: 0,
    });
    expect(out).toBeNull();
  });

  it('sends a browser User-Agent header', async () => {
    let seenUA = '';
    const spy: typeof fetch = (async (_url: string, init?: RequestInit) => {
      seenUA = String(new Headers(init?.headers).get('user-agent') ?? '');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await httpGet('https://example.com/x', { fetchImpl: spy });
    expect(seenUA).toMatch(/^Mozilla\/5\.0 \(/);
  });
});

describe('httpPostJson', () => {
  it('posts a JSON body with content-type json', async () => {
    let seenBody = '';
    let seenType = '';
    const spy: typeof fetch = (async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body);
      seenType = String(new Headers(init?.headers).get('content-type'));
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    const out = await httpPostJson(
      'https://example.com/api',
      { model: 'opencode/deepseek-v4-flash' },
      { fetchImpl: spy },
    );
    expect(out).toBe('{"ok":true}');
    expect(seenBody).toBe('{"model":"opencode/deepseek-v4-flash"}');
    expect(seenType).toContain('application/json');
  });
});
