import { httpGet } from '../util/http.js';
import type { Candidate } from '../types.js';

/**
 * MLH adapter — static season page whose event data ships inside an Inertia
 * `<script data-page="app" type="application/json">` blob (Part I §4: "Easy").
 * MLH listings carry no topic tags; the registry synthesizes them from titles.
 */

const SEASON_URL = (year: number) => `https://mlh.io/seasons/${year}/events`;

interface MlhEvent {
  name?: string;
  url?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
  formatType?: string;
}

interface SeasonProps {
  props?: { upcomingEvents?: MlhEvent[] };
}

/** Extracts the embedded page-data JSON blob from a season page. */
export function extractPageData(html: string): unknown {
  const m = html.match(
    /<script[^>]*data-page="app"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) throw new Error('no data-page script blob found');
  return JSON.parse(m[1]!) as unknown;
}

function modeFromFormat(formatType: string | undefined): Candidate['mode'] {
  switch ((formatType ?? '').toLowerCase()) {
    case 'digital':
    case 'online':
      return 'online';
    case 'hybrid':
      return 'hybrid';
    default:
      return 'onsite';
  }
}

/** Pure parser — tests run this against fixtures/mlh-season.html. */
export function parseMlhSeason(html: string): Candidate[] {
  const page = extractPageData(html) as SeasonProps;
  const events = page.props?.upcomingEvents ?? [];
  const out: Candidate[] = [];
  for (const e of events) {
    if (!e.name || !e.url) continue;
    const url = e.url.startsWith('http') ? e.url : `https://mlh.io${e.url}`;
    out.push({
      source: 'mlh',
      name: e.name,
      url,
      tags: [], // synthesized from the title by the registry
      mode: modeFromFormat(e.formatType),
      location: e.location,
      starts_at: e.startsAt ?? null,
      ends_at: e.endsAt ?? null,
    });
  }
  return out;
}

async function fetchSeason(year: number): Promise<Candidate[]> {
  const body = await httpGet(SEASON_URL(year));
  if (body === null) {
    console.warn(`mlh: season ${year} fetch failed`);
    return [];
  }
  return parseMlhSeason(body);
}

export function mlhAdapter() {
  return {
    name: 'mlh',
    async fetchListings(): Promise<Candidate[]> {
      try {
        // Seasons span two calendar years; scan both, dedupe by URL.
        const y = new Date().getUTCFullYear();
        const [thisYear, nextYear] = await Promise.all([
          fetchSeason(y),
          fetchSeason(y + 1),
        ]);
        const byUrl = new Map<string, Candidate>();
        for (const c of [...thisYear, ...nextYear]) byUrl.set(c.url, c);
        return [...byUrl.values()];
      } catch (err) {
        console.warn(`mlh: unexpected failure: ${(err as Error).message}`);
        return [];
      }
    },
  };
}
