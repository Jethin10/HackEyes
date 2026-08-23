import { describe, expect, it } from 'vitest';
import { parseState, zConfig, zHackathon } from '../src/types.js';

const validHackathon = {
  id: 'unstop-hackx-2026',
  name: 'HackX 2026',
  source: 'unstop',
  url: 'https://unstop.com/hackathons/hackx-2026',
  detected_by: 'discovery',
  status: 'candidate',
  tags: ['ai'],
  rounds: [
    {
      n: 1,
      name: 'Idea Submission',
      opens_at: '2026-08-20T00:00:00+05:30',
      due_at: null,
      result: null,
      deliverables: [
        { id: 'deck', label: '5-slide deck', kind: 'slides', done: false },
      ],
    },
  ],
  last_seen: '2026-08-24T06:04:11Z',
};

describe('parseState', () => {
  it('accepts a valid empty state', () => {
    expect(parseState({ hackathons: [] })).toEqual([]);
  });

  it('accepts a valid populated state', () => {
    expect(parseState({ hackathons: [validHackathon] })).toHaveLength(1);
  });

  it('throws a readable error naming the bad field', () => {
    const bad = { hackathons: [{ ...validHackathon, url: 'not-a-url' }] };
    expect(() => parseState(bad)).toThrow(/state\.json failed validation[\s\S]*url/);
  });

  it('throws when a timestamp lacks an explicit offset', () => {
    const bad = JSON.parse(JSON.stringify(validHackathon));
    bad.rounds[0].opens_at = '2026-08-20T00:00:00'; // no offset
    expect(() => parseState({ hackathons: [bad] })).toThrow(/explicit UTC offset/);
  });

  it('throws on garbage input', () => {
    expect(() => parseState('nonsense')).toThrow();
    expect(() => parseState(null)).toThrow();
    expect(() => parseState({})).toThrow();
  });
});

describe('zHackathon / zConfig round-trip', () => {
  it('keeps unknown fields out of the parsed record', () => {
    const withJunk = { ...validHackathon, secret_field: 'oops' };
    const parsed = zHackathon.parse(withJunk) as unknown as Record<string, unknown>;
    expect(parsed['secret_field']).toBeUndefined();
  });

  it('accepts the Part I §10 example config shape', () => {
    const cfg = {
      interests: ['ai', 'agents'],
      exclude: ['biotech'],
      mode: ['online', 'hybrid'],
      regions: ['IN', 'remote'],
      team_size: { min: 1, max: 4 },
      min_prize_inr: 25000,
      min_lead_days: 5,
      platforms: ['unstop', 'mlh', 'devfolio', 'devpost'],
      notify: { channel: 'ntfy', topic: '', quiet_hours: [0, 7] },
      model: 'opencode/deepseek-v4-flash',
    };
    expect(() => zConfig.parse(cfg)).not.toThrow();
  });
});
