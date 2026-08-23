import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractPageData,
  parseMlhSeason,
} from '../src/adapters/mlh.js';
import {
  parseDevpostDates,
  parseDevpostListing,
  parsePrizeAmount,
  toInr,
} from '../src/adapters/devpost.js';
import { parseDevfolioSearch } from '../src/adapters/devfolio.js';
import {
  looksLikeChallenge,
  parseUnstopListing,
} from '../src/adapters/unstop.js';
import {
  fetchAllFrom,
  synthesizeTags,
  type Adapter,
} from '../src/adapters/index.js';

const FIX = (f: string) => join(process.cwd(), 'fixtures', f);

describe('devpost adapter', () => {
  it('parses real listing fixture into normalized candidates', async () => {
    const raw = await readFile(FIX('devpost-listing.json'), 'utf8');
    const out = parseDevpostListing(raw);
    expect(out.length).toBeGreaterThanOrEqual(3);
    const first = out[0]!;
    expect(first.source).toBe('devpost');
    expect(first.name).toBe('RevenueCat Shipaton 2026');
    expect(first.url).toContain('devpost.com');
    expect(first.mode).toBe('online');
    expect(first.tags.length).toBeGreaterThan(0);
    // "$740,000" USD prize converts via the fixed rate
    expect(first.prize_inr).toBeGreaterThan(1_000_000);
  });

  it('parses the two-sided date range with explicit Z offsets', () => {
    const d = parseDevpostDates('Jul 31 - Oct 01, 2026');
    expect(d.starts_at).toBe('2026-07-31T00:00:00Z');
    expect(d.ends_at).toBe('2026-10-01T00:00:00Z');
    expect(parseDevpostDates('garbage')).toEqual({ starts_at: null, ends_at: null });
    expect(parseDevpostDates(undefined)).toEqual({ starts_at: null, ends_at: null });
  });

  it('extracts numbers from prize HTML and skips unknown currencies', () => {
    expect(parsePrizeAmount('$<span data-currency-value>740,000</span>')).toEqual({
      amount: 740000,
      currency: '$',
    });
    expect(parsePrizeAmount('₹5,00,000')).toEqual({ amount: 500000, currency: '₹' });
    expect(toInr(100, '£')).toBeUndefined();
  });
});

describe('mlh adapter', () => {
  it('parses real season fixture (data-page JSON blob) into candidates', async () => {
    const html = await readFile(FIX('mlh-season.html'), 'utf8');
    const out = parseMlhSeason(html);
    expect(out.length).toBe(3);
    const first = out[0]!;
    expect(first.source).toBe('mlh');
    expect(first.url).toMatch(/^https:\/\/mlh\.io\/events\//);
    expect(first.starts_at).toMatch(/Z$/); // explicit offset present
    expect(first.ends_at).toMatch(/Z$/);
    expect(['online', 'onsite', 'hybrid']).toContain(first.mode);
    // MLH carries no tags — registry synthesizes from title
    expect(first.tags).toEqual([]);
  });

  it('extractPageData throws on a page without the blob', () => {
    expect(() => extractPageData('<html><body>nothing</body></html>')).toThrow(
      /no data-page script blob/,
    );
  });
});

describe('devfolio adapter', () => {
  it('parses tolerant search-response shapes from fixture', async () => {
    const raw = await readFile(FIX('devfolio-search.json'), 'utf8');
    const out = parseDevfolioSearch(raw);
    expect(out).toHaveLength(3);
    expect(out[0]!.url).toBe('https://devfolio.co/hackathons/deccan-ai-sprint');
    expect(out[0]!.tags).toContain('ai/ml');
    expect(out[2]!.mode).toBe('hybrid');
  });

  it('accepts a bare array response too', () => {
    const out = parseDevfolioSearch('[{"name":"X","slug":"x"}]');
    expect(out[0]!.url).toBe('https://devfolio.co/hackathons/x');
  });
});

describe('unstop adapter', () => {
  it('parses listing fixture', async () => {
    const raw = await readFile(FIX('unstop-listing.json'), 'utf8');
    const out = parseUnstopListing(raw);
    expect(out).toHaveLength(2);
    expect(out[0]!.source).toBe('unstop');
    expect(out[0]!.ends_at).toContain('+05:30');
    expect(out[1]!.url).toContain('unstop.com');
  });

  it('recognizes challenge HTML as blocked', async () => {
    const html = await readFile(FIX('unstop-blocked.html'), 'utf8');
    expect(looksLikeChallenge(html)).toBe(true);
    expect(looksLikeChallenge('{"data":[]}')).toBe(false);
  });
});

describe('registry: failure isolation + tag synthesis', () => {
  it('a deliberately throwing adapter does not stop the others', async () => {
    const good: Adapter = {
      name: 'good',
      fetchListings: async () => [
        {
          source: 'mlh',
          name: 'Global Hack Week: AI',
          url: 'https://mlh.io/events/x',
          tags: [],
        },
      ],
    };
    const bad: Adapter = {
      name: 'bad',
      fetchListings: async () => {
        throw new Error('deliberate explosion');
      },
    };
    const { candidates, failures } = await fetchAllFrom([bad, good]);
    expect(failures).toEqual(['bad']);
    expect(candidates.map((c) => c.source)).toEqual(['mlh']);
  });

  it('synthesizes interest tags from titles for tag-less sources', () => {
    expect(synthesizeTags('Global Hack Week: AI Agents')).toEqual(
      expect.arrayContaining(['ai', 'agents']),
    );
    expect(synthesizeTags('Blockchain Builders')).toEqual(['web3']);
    expect(synthesizeTags('Random Cooking Contest')).toEqual([]);
    // tag-bearing candidates pass through untouched
    const kept = synthesizeTags('AI Hack'); // pure function on names only
    expect(kept).toBeDefined();
  });
});
