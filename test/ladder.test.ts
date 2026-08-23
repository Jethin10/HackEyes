import { describe, expect, it } from 'vitest';
import { due, type Threshold } from '../src/ladder.js';
import type { Hackathon, Round } from '../src/types.js';

const DUE = '2026-09-19T23:59:00+05:30'; // == 2026-09-19T18:29:00Z

function hackathon(overrides: Partial<Hackathon> = {}, ...rounds: Round[]): Hackathon {
  return {
    id: 'unstop-hackx-2026',
    name: 'HackX 2026',
    source: 'unstop',
    url: 'https://unstop.com/hackathons/hackx-2026',
    detected_by: 'discovery',
    status: 'registered',
    tags: [],
    rounds,
    last_seen: '2026-08-24T00:00:00Z',
    ...overrides,
  };
}

function round(overrides: Partial<Round> = {}): Round {
  return {
    n: 1,
    name: 'Prototype',
    opens_at: null,
    due_at: DUE,
    result: null,
    deliverables: [
      { id: 'demo', label: 'Working prototype, hosted', kind: 'build', done: false },
      { id: 'video', label: '3-minute demo video', kind: 'video', done: false },
      { id: 'repo', label: 'Public GitHub repo', kind: 'repo', done: true },
    ],
    ...overrides,
  };
}

/** Hours before DUE (positive = in the future). */
function nowHoursBefore(h: number): Date {
  return new Date(new Date(DUE).getTime() - h * 3_600_000);
}

function thresholds(events: Array<{ threshold: Threshold }>): string[] {
  return events.map((e) => e.threshold);
}

describe('ladder.due — faked clock', () => {
  // Spec §19 example: exactly 2 days 12 hours out -> T-72h band
  it('fires T-72h at T−60h (the spec §19 scenario)', () => {
    const events = due(hackathon({}, round()), new Date('2026-09-17T12:00:00+05:30'));
    expect(thresholds(events)).toEqual(['T-72h']);
    expect(events[0]!.round.n).toBe(1);
  });

  it.each([
    [100, ['T-7d']],
    [60, ['T-72h']],
    [15, ['T-24h']],
    [3, ['T-6h']],
    [200, []],   // too early: nothing due yet
    [0.5, ['T-6h']], // final window still open while time remains
    [-1, []],    // deadline passed: no nag after the fact
  ])('at T−%fh fires %j', (hours, expected) => {
    const events = due(hackathon({}, round()), nowHoursBefore(hours));
    expect(thresholds(events)).toEqual(expected);
  });

  it('a round with every deliverable done produces NO notification at any distance', () => {
    const allDone = round({
      deliverables: round().deliverables.map((d) => ({ ...d, done: true })),
    });
    for (const h of [100, 60, 15, 3]) {
      expect(due(hackathon({}, allDone), nowHoursBefore(h))).toEqual([]);
    }
  });

  it('an eliminated round emits nothing', () => {
    const eliminated = round({ result: 'eliminated' });
    expect(due(hackathon({}, eliminated), nowHoursBefore(3))).toEqual([]);
  });

  it('a null due_at emits nothing (visible gap, not a guess)', () => {
    expect(due(hackathon({}, round({ due_at: null })), nowHoursBefore(3))).toEqual([]);
  });

  it('candidate / done / missed statuses never nag', () => {
    for (const status of ['candidate', 'done', 'missed', 'passed'] as const) {
      expect(
        due(hackathon({ status }, round()), nowHoursBefore(3)),
      ).toEqual([]);
    }
    expect(due(hackathon({ status: 'active' }, round()), nowHoursBefore(3))).toHaveLength(1);
  });

  it("emits 'opens' within 48h of the submission window opening", () => {
    const r = round({
      opens_at: '2026-09-05T00:00:00+05:30',
      due_at: '2026-09-19T23:59:00+05:30',
    });
    const justOpened = new Date('2026-09-05T10:00:00+05:30'); // 10h after open, t=354h
    const events = due(hackathon({}, r), justOpened);
    expect(thresholds(events)).toEqual(['opens']); // informational only

    const openedLongAgo = new Date('2026-09-12T00:00:00+05:30');
    expect(thresholds(due(hackathon({}, r), openedLongAgo))).toEqual([]); // t=190h, open+7d: nothing
  });

  it('multiple rounds escalate independently', () => {
    const r1 = round({ n: 1, name: 'Idea', due_at: DUE });
    const r2 = round({
      n: 2,
      name: 'Prototype',
      due_at: '2026-10-01T23:59:00+05:30', // far future from nowHoursBefore(60)
    });
    const events = due(hackathon({}, r1, r2), nowHoursBefore(60));
    expect(events.map((e) => e.round.n)).toEqual([1]); // r2 too far out
  });

  it('is pure: same inputs give same outputs, `now` is respected', () => {
    const h = hackathon({}, round());
    expect(thresholds(due(h, nowHoursBefore(60)))).toEqual(
      thresholds(due(h, nowHoursBefore(60))),
    );
    expect(thresholds(due(h, nowHoursBefore(100)))).toEqual(['T-7d']);
  });
});
