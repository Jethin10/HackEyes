import { httpGet } from '../util/http.js';
import type { Candidate, Mode } from '../types.js';

/**
 * Unstop adapter — JSON API behind bot protection (Part I §4: "Hard").
 *
 * Strategy per spec: plain server-side fetch with realistic headers first.
 * If we get an HTML challenge instead of JSON: log "unstop: blocked" and
 * return []. That is an accepted outcome — the inbox route covers registered
 * events and link-drop covers everything else. No headless browser, ever.
 */

const LISTING_URL = 'https://unstop.com/api/public/hackathons';

interface UnstopItem {
  id?: number;
  title?: string;
  slug?: string;
  url?: string;
  start_date?: string;
  end_date?: string;
  location?: string;
  mode?: string;
  tags?: Array<string | { name?: string }>;
}

/** Accepts `{data:[...]}`, `{data:{data:[...]}}`, or a bare array. */
function extractItems(raw: unknown): UnstopItem[] {
  if (Array.isArray(raw)) return raw as UnstopItem[];
  if (raw && typeof raw === 'object') {
    const obj = raw as { data?: unknown };
    if (Array.isArray(obj.data)) return obj.data as UnstopItem[];
    if (obj.data && typeof obj.data === 'object') {
      const inner = obj.data as { data?: unknown };
      if (Array.isArray(inner.data)) return inner.data as UnstopItem[];
    }
  }
  return [];
}

/** Detects Cloudflare-style challenge HTML vs. a JSON API response. */
export function looksLikeChallenge(body: string): boolean {
  const head = body.slice(0, 4000).toLowerCase();
  return (
    head.includes('<!doctype html') ||
    head.includes('<html') ||
    head.includes('just a moment') ||
    head.includes('cf-challenge') ||
    head.includes('challenge-platform')
  );
}

function normTags(tags: Array<string | { name?: string }> | undefined): string[] {
  return (tags ?? [])
    .map((t) => (typeof t === 'string' ? t : (t?.name ?? '')))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function modeFrom(mode: string | undefined): Mode | undefined {
  switch ((mode ?? '').toLowerCase()) {
    case 'online':
    case 'virtual':
      return 'online';
    case 'hybrid':
      return 'hybrid';
    case 'offline':
    case 'in-person':
      return 'onsite';
    default:
      return undefined;
  }
}

/** Pure parser — tests run this against fixtures/unstop-listing.json. */
export function parseUnstopListing(jsonText: string): Candidate[] {
  const items = extractItems(JSON.parse(jsonText));
  const out: Candidate[] = [];
  for (const h of items) {
    if (!h.title || (!h.url && !h.slug && !h.id)) continue;
    out.push({
      source: 'unstop',
      name: h.title,
      url:
        h.url ??
        (h.slug
          ? `https://unstop.com/hackathons/${h.slug}`
          : `https://unstop.com/hackathon/${h.id}`),
      tags: normTags(h.tags),
      mode: modeFrom(h.mode),
      location: h.location,
      starts_at: h.start_date ?? null,
      ends_at: h.end_date ?? null,
    });
  }
  return out;
}

export function unstopAdapter() {
  return {
    name: 'unstop',
    async fetchListings(): Promise<Candidate[]> {
      try {
        const body = await httpGet(LISTING_URL, {
          headers: {
            accept: 'application/json, text/plain, */*',
            referer: 'https://unstop.com/hackathons',
          },
        });
        if (body === null || looksLikeChallenge(body)) {
          console.warn('unstop: blocked');
          return [];
        }
        return parseUnstopListing(body);
      } catch (err) {
        console.warn(`unstop: unexpected failure: ${(err as Error).message}`);
        return [];
      }
    },
  };
}
