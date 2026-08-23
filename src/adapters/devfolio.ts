import { httpPostJson } from '../util/http.js';
import type { Candidate, Mode } from '../types.js';

/**
 * Devfolio adapter — backing API behind the listing SPA (Part I §4: "Medium").
 *
 * NOTE (accepted outcome): as of this build the public API answers
 * `NotFoundError` for every known listing path, so live discovery from
 * Devfolio is expected to return [] until they expose it again. The parser
 * below matches their documented v2 search response and is covered by a
 * fixture; see BLOCKERS.md.
 */

const SEARCH_URL = 'https://api.devfolio.co/api/v2/hackathons/search';

interface DevfolioItem {
  name?: string;
  slug?: string;
  url?: string;
  website_url?: string;
  registration_deadline?: string;
  start_date?: string;
  ends_at?: string;
  mode_type?: string;
  location?: string;
  tags?: Array<string | { name?: string }>;
}

interface DevfolioResponse {
  hackathons?: DevfolioItem[];
  data?: DevfolioItem[];
  results?: DevfolioItem[];
}

function normTags(tags: DevfolioItem['tags']): string[] {
  return (tags ?? [])
    .map((t) => (typeof t === 'string' ? t : (t?.name ?? '')))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function modeFrom(modeType: string | undefined): Mode | undefined {
  switch ((modeType ?? '').toLowerCase()) {
    case 'online':
    case 'virtual':
      return 'online';
    case 'hybrid':
      return 'hybrid';
    case 'offline':
    case 'onsite':
      return 'onsite';
    default:
      return undefined;
  }
}

/** Tolerant pure parser — tests run this against fixtures/devfolio-search.json. */
export function parseDevfolioSearch(jsonText: string): Candidate[] {
  const data = JSON.parse(jsonText) as DevfolioResponse | DevfolioItem[];
  const items: DevfolioItem[] = Array.isArray(data)
    ? data
    : (data.hackathons ?? data.data ?? data.results ?? []);
  const out: Candidate[] = [];
  for (const h of items) {
    if (!h.name) continue;
    const url =
      h.url ??
      h.website_url ??
      (h.slug ? `https://devfolio.co/hackathons/${h.slug}` : undefined);
    if (!url) continue;
    out.push({
      source: 'devfolio',
      name: h.name,
      url,
      tags: normTags(h.tags),
      mode: modeFrom(h.mode_type),
      location: h.location,
      starts_at: h.start_date ?? null,
      ends_at: h.ends_at ?? h.registration_deadline ?? null,
    });
  }
  return out;
}

export function devfolioAdapter() {
  return {
    name: 'devfolio',
    async fetchListings(): Promise<Candidate[]> {
      try {
        const body = await httpPostJson(SEARCH_URL, { page: 1 }, {
          headers: {
            origin: 'https://devfolio.co',
            referer: 'https://devfolio.co/hackathons',
          },
        });
        if (body === null) {
          console.warn('devfolio: fetch failed (API may be unavailable)');
          return [];
        }
        return parseDevfolioSearch(body);
      } catch (err) {
        console.warn(`devfolio: parse failed: ${(err as Error).message}`);
        return [];
      }
    },
  };
}
