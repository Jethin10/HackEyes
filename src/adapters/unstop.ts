import { httpGet } from '../util/http.js';
import type { Candidate, Deliverable, Mode, Round } from '../types.js';

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

// ---------------------------------------------------------------------------
// Detail API — deterministic registration intake (no model involved)
// ---------------------------------------------------------------------------

/**
 * Unstop exposes full competition JSON publicly:
 * GET https://unstop.com/api/public/competition/{id}
 * Rounds live in rounds[n].details[] with ISO timestamps carrying explicit
 * +05:30 offsets, and deliverables quoted inside display_text HTML lists.
 */

/** Pulls the numeric id out of any unstop.com event URL. */
export function extractUnstopId(url: string): string | null {
  const m = url.match(/unstop\.com\/(?:hackathons|competitions|quizzes)\/[^/]*?(\d+)(?:\/|$)/);
  return m ? m[1]! : null;
}

const DETAIL_URL = (id: string) => `https://unstop.com/api/public/competition/${id}`;

interface UnstopDetailRound {
  round_order?: number;
  details?: Array<{
    title?: string;
    start_date?: string;
    end_date?: string;
    display_text?: string;
  }>;
}

interface UnstopDetailBody {
  data?: {
    competition?: {
      title?: string;
      start_date?: string;
      end_date?: string;
      organization_id?: number;
      web_url?: string;
      rounds?: UnstopDetailRound[];
    };
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function kindOf(label: string): string {
  const l = label.toLowerCase();
  if (/video|demo reel/.test(l)) return 'video';
  if (/github|repo/.test(l)) return 'repo';
  if (/deck|ppt|slide|present/.test(l)) return 'slides';
  if (/prototype|link|hosted|deploy|submit.*live/.test(l)) return 'build';
  if (/abstract|doc|pdf|report|answer|quiz|pptx/.test(l)) return 'text';
  return 'other';
}

function slugId(label: string, i: number): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-');
  return s || `item-${i + 1}`;
}

function deliverablesFrom(displayText: string | undefined): Deliverable[] {
  if (!displayText) return [];
  // Real requirements live in bullet lists (<ul>/<ol> items); everything else
  // on Unstop pages is prose, criteria, or policy — not something you submit.
  const items: string[] = [];
  const lists = displayText.match(/<(ul|ol)[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
  for (const list of lists) {
    for (const raw of list.match(/<li[^>]*>[\s\S]*?<\/li>/gi) ?? []) {
      const label = stripHtml(raw).replace(/\s+/g, ' ').trim();
      if (label.length > 2) items.push(label);
    }
  }
  return items.map((label, i) => ({
    id: slugId(label, i),
    label,
    kind: kindOf(label),
    done: false,
  }));
}

/** Pure parser for the public competition-detail API response. */
export function parseUnstopDetail(jsonText: string, sourceUrl: string): {
  name: string;
  url: string;
  starts_at: string | null;
  ends_at: string | null;
  rounds: Round[];
} {
  const body = JSON.parse(jsonText) as UnstopDetailBody;
  const c = body.data?.competition;
  if (!c) throw new Error('no competition in detail response');

  const rounds: Round[] = (c.rounds ?? []).map((r) => {
    const n = r.round_order ?? 0;
    const d = r.details?.[0] ?? {};
    const name = (d.title ?? `Round ${n}`).trim();
    let deliverables = deliverablesFrom(d.display_text);
    if (deliverables.length === 0) {
      // Nothing itemised — still give the user one thing they can tick off.
      deliverables = [
        { id: 'submission', label: `${name} submission (see event page)`, kind: 'other', done: false },
      ];
    }
    return {
      n,
      name,
      opens_at: d.start_date ?? null,
      due_at: d.end_date ?? null,
      result: null,
      deliverables,
    };
  });

  return {
    name: (c.title ?? 'Unstop event').trim(),
    url: sourceUrl,
    starts_at: c.start_date ?? null,
    ends_at: c.end_date ?? null,
    rounds: rounds.sort((a, b) => a.n - b.n),
  };
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
