import { describe, expect, it } from 'vitest';
import { load, mergeRounds, save } from '../src/state.js';
import type { Deliverable, Round } from '../src/types.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function del(id: string, overrides: Partial<Deliverable> = {}): Deliverable {
  return { id, label: `${id} label`, kind: 'other', done: false, ...overrides };
}

function round(n: number, deliverables: Deliverable[]): Round {
  return {
    n,
    name: `Round ${n}`,
    opens_at: null,
    due_at: null,
    result: null,
    deliverables,
  };
}

describe('mergeRounds — the function that must never un-tick work', () => {
  it('THE exact scenario: done:true survives a re-parse that changes the label', () => {
    const existing = [round(1, [del('deck', { done: true, label: 'old label' })])];
    const incoming = [round(1, [del('deck', { label: 'new label' })])];
    const out = mergeRounds(existing, incoming);
    expect(out[0]!.deliverables[0]!.label).toBe('new label');
    expect(out[0]!.deliverables[0]!.done).toBe(true);
  });

  it('preserves done:true on every matched id across a full re-parse', () => {
    const existing = [
      round(2, [
        del('demo', { done: true }),
        del('video', { done: false }),
        del('repo', { done: true }),
      ]),
    ];
    const incoming = [
      round(2, [del('demo'), del('video'), del('repo')]),
    ];
    const out = mergeRounds(existing, incoming);
    const byId = new Map(out[0]!.deliverables.map((d) => [d.id, d.done]));
    expect(byId.get('demo')).toBe(true);
    expect(byId.get('video')).toBe(false);
    expect(byId.get('repo')).toBe(true);
  });

  it('new deliverable ids arrive with done:false', () => {
    const existing = [round(1, [del('deck', { done: true })])];
    const incoming = [round(1, [del('deck'), del('video-new')])];
    const out = mergeRounds(existing, incoming);
    const video = out[0]!.deliverables.find((d) => d.id === 'video-new')!;
    expect(video.done).toBe(false);
  });

  it('a deliverable that disappears from incoming is kept, not deleted', () => {
    const existing = [round(1, [del('deck', { done: true }), del('abstract', { done: true })])];
    const incoming = [round(1, [del('deck')])]; // organizer dropped abstract
    const out = mergeRounds(existing, incoming);
    const ids = out[0]!.deliverables.map((d) => d.id);
    expect(ids).toContain('abstract');
    expect(out[0]!.deliverables.find((d) => d.id === 'abstract')!.done).toBe(true);
  });

  it('a round that disappears from incoming is kept, not deleted', () => {
    const existing = [
      { ...round(1, [del('deck', { done: true })]), result: 'eliminated' as const },
      round(2, [del('demo')]),
    ];
    const incoming = [round(2, [del('demo')])]; // page no longer lists round 1
    const out = mergeRounds(existing, incoming);
    expect(out.map((r) => r.n)).toContain(1);
    expect(out.find((r) => r.n === 1)!.result).toBe('eliminated');
  });

  it('matches rounds by n, not array order', () => {
    const existing = [
      round(1, [del('deck', { done: true })]),
      round(2, [del('demo', { done: true })]),
    ];
    const incoming = [round(2, [del('demo')]), round(1, [del('deck')])];
    const out = mergeRounds(existing, incoming);
    expect(out.find((r) => r.n === 1)!.deliverables[0]!.done).toBe(true);
    expect(out.find((r) => r.n === 2)!.deliverables[0]!.done).toBe(true);
  });

  it('takes dates and submit_url from incoming', () => {
    const existing = [
      {
        ...round(1, [del('deck')]),
        opens_at: null,
        due_at: null,
      },
    ];
    const incoming = [
      {
        ...round(1, [del('deck')]),
        opens_at: '2026-08-20T00:00:00+05:30',
        due_at: '2026-09-02T23:59:00+05:30',
        submit_url: 'https://unstop.com/x/submit',
      },
    ];
    const out = mergeRounds(existing, incoming);
    expect(out[0]!.due_at).toBe('2026-09-02T23:59:00+05:30');
    expect(out[0]!.opens_at).toBe('2026-08-20T00:00:00+05:30');
    expect(out[0]!.submit_url).toBe('https://unstop.com/x/submit');
  });

  it('preserves result (advanced/eliminated) from existing', () => {
    const existing = [{ ...round(1, [del('deck')]), result: 'advanced' as const }];
    const incoming = [round(1, [del('deck')])];
    expect(mergeRounds(existing, incoming)[0]!.result).toBe('advanced');
  });

  it('brand-new rounds get every deliverable forced to done:false', () => {
    // Even if an extractor hallucinated done:true, only user history marks work done.
    const incoming = [round(3, [del('pitch', { done: true })])];
    const out = mergeRounds([], incoming);
    expect(out[0]!.deliverables[0]!.done).toBe(false);
  });

  it('empty existing -> incoming with all deliverables done:false; empty incoming -> existing untouched', () => {
    const fromNothing = mergeRounds([], [round(1, [del('deck', { done: true })])]);
    expect(fromNothing[0]!.deliverables[0]!.done).toBe(false);

    const untouched = mergeRounds([round(1, [del('deck', { done: true })])], []);
    expect(untouched).toHaveLength(1);
    expect(untouched[0]!.deliverables[0]!.done).toBe(true);
  });

  it('returns rounds sorted by n', () => {
    const existing = [round(2, [del('demo')])];
    const incoming = [round(1, [del('deck')]), round(3, [del('pitch')])];
    expect(mergeRounds(existing, incoming).map((r) => r.n)).toEqual([1, 2, 3]);
  });
});

describe('load / save', () => {
  it('round-trips state through pretty-printed JSON with trailing newline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-state-'));
    const path = join(dir, 'state.json');
    try {
      await writeFile(path, '{"hackathons":[]}', 'utf8');
      expect(await load(path)).toEqual([]);

      const record = {
        id: 'x',
        name: 'X',
        source: 'manual',
        url: 'https://example.com/x',
        detected_by: 'manual' as const,
        status: 'registered' as const,
        tags: [],
        rounds: [],
        last_seen: '2026-08-24T00:00:00Z',
      };
      await save(path, [record]);
      const raw = await readFile(path, 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
      expect(raw).toContain('\n  "hackathons": [');
      expect((await load(path))[0]!.id).toBe('x');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('missing file loads as empty database', async () => {
    expect(await load(join(tmpdir(), 'definitely-missing-sw.json'))).toEqual([]);
  });

  it('corrupt file throws loudly instead of silently resetting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-state-'));
    const path = join(dir, 'bad.json');
    try {
      await writeFile(path, '{ oops', 'utf8');
      await expect(load(path)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
