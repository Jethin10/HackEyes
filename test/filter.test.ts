import { describe, expect, it } from 'vitest';
import { passes, score } from '../src/filter.js';
import type { Candidate, Config } from '../src/types.js';

const CFG: Config = {
  interests: ['ai', 'agents', 'ml', 'web3', 'fintech', 'devtools'],
  exclude: ['biotech', 'hardware-only'],
  mode: ['online', 'hybrid'],
  regions: ['IN', 'remote'],
  team_size: { min: 1, max: 4 },
  min_prize_inr: 25000,
  min_lead_days: 5,
  platforms: ['unstop', 'mlh', 'devfolio', 'devpost'],
  notify: { channel: 'ntfy', topic: '', quiet_hours: [0, 7] },
  model: 'opencode/deepseek-v4-flash',
};

const NOW = new Date('2026-08-24T06:00:00Z');

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    source: 'devpost',
    name: 'AI Agents Hack',
    url: 'https://ai-agents-hack.devpost.com/',
    tags: ['ai', 'agents'],
    mode: 'online',
    location: 'Remote',
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2026-09-23T23:59:00Z',
    prize_inr: 100000,
    ...overrides,
  };
}

describe('filter.score / passes', () => {
  it('clear match passes', () => {
    const s = score(candidate(), CFG, NOW);
    expect(s).toBeGreaterThanOrEqual(0.5);
    expect(passes(candidate(), CFG, NOW)).toBe(true);
  });

  it('clear miss fails (no interest overlap, wrong region)', () => {
    const c = candidate({
      tags: ['web'],
      location: 'Berlin, DE',
      prize_inr: 500000,
    });
    const s = score(c, CFG, NOW);
    expect(s).toBeLessThan(0.5);
    expect(passes(c, CFG, NOW)).toBe(false);
  });

  it('an excluded tag beats maximum tag overlap', () => {
    const c = candidate({
      tags: ['ai', 'agents', 'ml', 'web3', 'fintech', 'devtools', 'biotech'],
    });
    expect(score(c, CFG, NOW)).toBe(0);
    expect(passes(c, CFG, NOW)).toBe(false);
  });

  it('lead-time floor rejects events closing too soon to enter', () => {
    const c = candidate({ ends_at: '2026-08-26T23:59:00Z' }); // 2 days out
    expect(score(c, CFG, NOW)).toBe(0);
  });

  it('prize floor rejects below-floor prizes', () => {
    const c = candidate({ prize_inr: 10000 });
    expect(score(c, CFG, NOW)).toBe(0);
  });

  it('platform gate rejects unlisted sources', () => {
    const c = candidate({ source: 'obscure-forum' });
    expect(score(c, CFG, NOW)).toBe(0);
  });

  it('mode gate rejects onsite-only when config wants online/hybrid', () => {
    const c = candidate({ mode: 'onsite' });
    expect(score(c, CFG, NOW)).toBe(0);
  });

  it('unknown mode gets half credit but full overlap can still pass', () => {
    const c = candidate({ mode: undefined });
    const s = score(c, CFG, NOW);
    expect(s).toBeGreaterThan(0.5);
    expect(passes(c, CFG, NOW)).toBe(true);
  });

  it('perfect candidate scores exactly 1', () => {
    const c = candidate({
      tags: ['ai', 'agents', 'ml', 'web3', 'fintech', 'devtools'],
      location: 'India + Remote',
    });
    expect(score(c, CFG, NOW)).toBeCloseTo(1, 10);
  });

  it('indian city locations without the word "India" still earn tag+mode credit', () => {
    // MLH-style "Hyderabad, Telangana" — region component misses, rest carries.
    const c = candidate({ tags: ['ai'], location: 'Hyderabad, Telangana' });
    expect(score(c, CFG, NOW)).toBeGreaterThan(0.4);
  });

  it('score is always within 0..1', () => {
    for (const tags of [[], ['zzz'], ['ai']]) {
      const s = score(candidate({ tags }), CFG, NOW);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
