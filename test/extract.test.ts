import { describe, expect, it, vi } from 'vitest';
import { extractRounds, parseModelContent } from '../src/extract.js';

const VALID_MODEL_JSON = JSON.stringify({
  rounds: [
    {
      n: 1,
      name: 'Idea Submission',
      opens_at: '2026-08-20T00:00:00+05:30',
      due_at: '2026-09-02T23:59:00+05:30',
      submit_url: 'https://unstop.com/hackx/submit',
      deliverables: [
        { id: 'deck', label: '5-slide deck, their template', kind: 'slides' },
        { id: 'abstract', label: '200-word problem statement', kind: 'text' },
      ],
    },
    {
      n: 2,
      name: 'Prototype',
      opens_at: null,
      due_at: null,
      deliverables: [{ id: 'video', label: '3-minute demo video', kind: 'video' }],
    },
  ],
  confidence: 0.82,
});

function zenFetch(content: string, status = 200): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
      }),
      { status },
    )) as unknown as typeof fetch;
}

describe('extractRounds (mocked HTTP)', () => {
  it('never calls the network without an API key', async () => {
    const fetchMock = vi.fn();
    const out = await extractRounds('page', 'https://x.com', 'opencode/m', {
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiKey: '',
    });
    expect(out).toEqual({ rounds: [], confidence: 0, needs_review: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses a valid response with quoted labels and offsets intact', async () => {
    const out = await extractRounds('rules page text', 'https://x.com', 'opencode/deepseek-v4-flash', {
      apiKey: 'k',
      fetchImpl: zenFetch(VALID_MODEL_JSON),
    });
    expect(out.needs_review).toBe(false);
    expect(out.confidence).toBeCloseTo(0.82);
    expect(out.rounds).toHaveLength(2);
    expect(out.rounds[0]!.due_at).toBe('2026-09-02T23:59:00+05:30');
    expect(out.rounds[0]!.deliverables[0]!.label).toBe(
      '5-slide deck, their template',
    );
    expect(out.rounds[0]!.deliverables[0]!.done).toBe(false);
  });

  it('malformed JSON: retries once then returns the needs_review fallback', async () => {
    const fetchMock = vi.fn(
      zenFetch('this is not json {'),
    ) as unknown as typeof fetch;
    const spy = vi.fn(fetchMock);
    const out = await extractRounds('p', 'https://x.com', 'opencode/m', {
      apiKey: 'k',
      fetchImpl: spy as unknown as typeof fetch,
    });
    expect(out).toEqual({ rounds: [], confidence: 0, needs_review: true });
    expect(spy).toHaveBeenCalledTimes(2); // exactly one retry
  });

  it('schema-invalid JSON also gets one retry then degrades safely', async () => {
    const bad = JSON.stringify({ nonsense: true });
    const spy = vi.fn(zenFetch(bad));
    const out = await extractRounds('p', 'https://x.com', 'opencode/m', {
      apiKey: 'k',
      fetchImpl: spy as unknown as typeof fetch,
    });
    expect(out.needs_review).toBe(true);
    expect(out.rounds).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('HTTP failure never throws and returns needs_review', async () => {
    const failing: typeof fetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const out = await extractRounds('p', 'https://x.com', 'opencode/m', {
      apiKey: 'k',
      fetchImpl: failing,
    });
    expect(out).toEqual({ rounds: [], confidence: 0, needs_review: true });
  });

  it('a date missing its offset becomes null and forces needs_review', async () => {
    const naive = JSON.stringify({
      rounds: [
        {
          n: 1,
          name: 'Final',
          due_at: '2026-09-19T23:59:00', // NO offset — must not be guessed
          deliverables: [],
        },
      ],
      confidence: 0.9,
    });
    const out = await extractRounds('p', 'https://x.com', 'opencode/m', {
      apiKey: 'k',
      fetchImpl: zenFetch(naive),
    });
    expect(out.rounds[0]!.due_at).toBeNull();
    expect(out.needs_review).toBe(true);
  });

  it('low confidence forces needs_review', async () => {
    const low = JSON.stringify({ rounds: [], confidence: 0.4 });
    const out = await extractRounds('p', 'https://x.com', 'opencode/m', {
      apiKey: 'k',
      fetchImpl: zenFetch(low),
    });
    expect(out.needs_review).toBe(true);
  });
});

describe('parseModelContent sanitization', () => {
  it('defaults missing n/kind, slugifies ids, clamps confidence', () => {
    const out = parseModelContent(
      JSON.stringify({
        rounds: [
          {
            name: 'Demo Day',
            deliverables: [
              { label: 'Working prototype, hosted' }, // no id, no kind
            ],
          },
        ],
        confidence: 5, // clamp to 1
      }),
    );
    expect(out.rounds[0]!.n).toBe(1);
    expect(out.rounds[0]!.deliverables[0]!.id).toBe('working-prototype-hosted');
    expect(out.rounds[0]!.deliverables[0]!.kind).toBe('other');
    expect(out.confidence).toBe(1);
  });

  it('throws on non-JSON content (caller retries)', () => {
    expect(() => parseModelContent('nope')).toThrow(/not valid JSON/);
  });
});
