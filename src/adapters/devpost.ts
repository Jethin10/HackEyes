import { httpGet } from '../util/http.js';
import type { Candidate, Mode } from '../types.js';

/**
 * Devpost adapter — public JSON listing endpoint (Part I §4: "Easy").
 * Endpoint: GET https://devpost.com/api/hackathons
 */

const LISTING_URL = 'https://devpost.com/api/hackathons';

/** Approximate conversion for the prize floor check. See DECISIONS.md. */
export const USD_TO_INR = 90;
export const EUR_TO_INR = 98;

interface DevpostListing {
  hackathons?: Array<{
    title?: string;
    url?: string;
    open_state?: string;
    displayed_location?: { location?: string };
    themes?: Array<{ name?: string }>;
    prize_amount?: string;
    submission_period_dates?: string;
  }>;
}

function modeFromLocation(location: string | undefined): Mode | undefined {
  if (!location) return undefined;
  const l = location.toLowerCase();
  if (l.includes('online') && /,\s*\+|\+/.test(location)) return 'hybrid';
  if (l.includes('online')) return 'online';
  return 'onsite';
}

/** "$<span data-currency-value>740,000</span>" -> { currency: '$', amount: 740000 } */
export function parsePrizeAmount(raw: string | undefined): {
  amount: number;
  currency: string;
} | null {
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, '').trim();
  const m = text.match(/([€$₹])?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const amount = Number(m[2]!.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: m[1] ?? '$' };
}

export function toInr(amount: number, currency: string): number | undefined {
  switch (currency) {
    case '₹':
      return Math.round(amount);
    case '$':
      return Math.round(amount * USD_TO_INR);
    case '€':
      return Math.round(amount * EUR_TO_INR);
    default:
      return undefined; // unknown currency: omit rather than misjudge
  }
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * "Jul 31 - Oct 01, 2026" -> ISO strings with explicit Z offsets.
 * Devpost gives no timezone; UTC midnight is used deliberately (documented)
 * — discovery dates only feed lead-time filtering, never notifications.
 */
export function parseDevpostDates(
  raw: string | undefined,
): { starts_at: string | null; ends_at: string | null } {
  const fail = { starts_at: null, ends_at: null };
  if (!raw) return fail;
  const m = raw.match(
    /([A-Za-z]{3})\s+(\d{1,2})(?:\s*-\s*(?:(?:\s*([A-Za-z]{3})\s+(\d{1,2}))?),?\s*(\d{4}))?/,
  );
  if (!m) return fail;
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (monthName: string, dayS: string, yearS: string): string | null => {
    const month = MONTHS[monthName.toLowerCase()];
    const day = Number(dayS);
    const year = Number(yearS);
    if (!month || !day || !year) return null;
    return `${year}-${pad(month)}-${pad(day)}T00:00:00Z`;
  };

  const year = m[5];
  if (!year) return fail;
  const startM = m[1]!;
  const startD = m[2]!;
  // "Jul 31 - Oct 01, 2026": end month/day in groups 3/4; "Jul 31, 2026": none.
  const endMonth = m[3] ?? startM;
  const endDay = m[4] ?? startD;
  return {
    starts_at: iso(startM, startD, year),
    ends_at: iso(endMonth, endDay, m[3] ? year : year),
  };
}

/** Pure parser — tests run this against fixtures/devpost-listing.json. */
export function parseDevpostListing(jsonText: string): Candidate[] {
  const data = JSON.parse(jsonText) as DevpostListing;
  const out: Candidate[] = [];
  for (const h of data.hackathons ?? []) {
    if (!h.title || !h.url) continue;
    if (h.open_state && h.open_state !== 'open') continue;
    const prize = parsePrizeAmount(h.prize_amount);
    const dates = parseDevpostDates(h.submission_period_dates);
    out.push({
      source: 'devpost',
      name: h.title,
      url: h.url,
      tags: (h.themes ?? [])
        .map((t) => (t.name ?? '').trim().toLowerCase())
        .filter(Boolean),
      mode: modeFromLocation(h.displayed_location?.location),
      location: h.displayed_location?.location,
      starts_at: dates.starts_at,
      ends_at: dates.ends_at,
      ...(prize ? { prize_inr: toInr(prize.amount, prize.currency) } : {}),
    });
  }
  return out;
}

export function devpostAdapter() {
  return {
    name: 'devpost',
    async fetchListings(): Promise<Candidate[]> {
      try {
        const body = await httpGet(LISTING_URL);
        if (body === null) {
          console.warn('devpost: fetch failed');
          return [];
        }
        return parseDevpostListing(body);
      } catch (err) {
        console.warn(`devpost: parse failed: ${(err as Error).message}`);
        return [];
      }
    },
  };
}
