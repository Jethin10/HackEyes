import { describe, expect, it } from 'vitest';
import { markSent, selectUnsent, sentKey } from '../src/ladder.js';
import type { Hackathon, Round } from '../src/types.js';

const DUE = '2026-09-19T23:59:00+05:30';

function hackathon(): Hackathon {
  return {
    id: 'unstop-hackx-2026',
    name: 'HackX 2026',
    source: 'unstop',
    url: 'https://unstop.com/hackathons/hackx-2026',
    detected_by: 'discovery',
    status: 'registered',
    tags: [],
    rounds: [
      {
        n: 2,
        name: 'Prototype',
        opens_at: null,
        due_at: DUE,
        result: null,
        deliverables: [
          { id: 'video', label: '3-minute demo video', kind: 'video', done: false },
        ],
      },
    ],
    last_seen: '2026-08-24T00:00:00Z',
  };
}

const NOW_T60 = new Date('2026-09-17T12:00:00+05:30'); // T-60h -> T-72h band

describe('dedupe of sent notifications', () => {
  it('first run selects the nag, second run with the same clock sends NOTHING', () => {
    const h = hackathon();
    const first = selectUnsent(h, NOW_T60);
    expect(first.map((e) => e.threshold)).toEqual(['T-72h']);

    markSent(h, first);
    expect(h.sent).toEqual([sentKey(2, 'T-72h')]);

    // The whole point (T10 acceptance): identical clock, empty output.
    expect(selectUnsent(h, NOW_T60)).toEqual([]);
  });

  it('escalation continues across thresholds despite the ledger', () => {
    const h = hackathon();
    markSent(h, selectUnsent(h, NOW_T60));

    const nextDay = new Date('2026-09-19T03:00:00+05:30'); // T-21h -> T-24h band
    const second = selectUnsent(h, nextDay);
    expect(second.map((e) => e.threshold)).toEqual(['T-24h']);
  });

  it('rounds dedupe independently', () => {
    const h = hackathon();
    h.rounds.push({
      n: 1,
      name: 'Idea',
      opens_at: null,
      due_at: DUE,
      result: null,
      deliverables: [
        { id: 'deck', label: '5-slide deck', kind: 'slides', done: false },
      ],
    });
    markSent(h, selectUnsent(h, NOW_T60));
    // r1:T-72h and r2:T-72h both recorded
    expect(h.sent).toEqual(['r2:T-72h', 'r1:T-72h']);
    expect(selectUnsent(h, NOW_T60)).toEqual([]);
  });

  it('markSent with no events leaves the record untouched', () => {
    const h = hackathon();
    markSent(h, []);
    expect(h.sent).toBeUndefined();
  });

  it('a completed round stops firing even if the ledger is empty', () => {
    const h = hackathon();
    h.rounds[0]!.deliverables[0]!.done = true;
    expect(selectUnsent(h, NOW_T60)).toEqual([]);
  });
});
