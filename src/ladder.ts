import type { Hackathon, Round } from './types.js';
import { hoursUntil } from './util/time.js';

/**
 * Notification escalation logic (Part I §8). Pure — takes `now` so tests can
 * fake the clock. Every threshold is conditional on INCOMPLETENESS: tick all
 * deliverables and the escalation stops entirely.
 *
 * Bands (at most one urgency threshold per round per run, escalating
 * naturally across twice-daily runs — documented in DECISIONS.md):
 *   opens : within 48h after the submission window opened
 *   T-7d  : 72 <  t <= 168 hours remaining
 *   T-72h : 24 <  t <= 72
 *   T-24h : 6  <  t <= 24
 *   T-6h  : 0  <  t <= 6
 */

export type Threshold = 'opens' | 'T-7d' | 'T-72h' | 'T-24h' | 'T-6h';

const OPEN_WINDOW_HOURS = 48;

const BANDS: Array<{ threshold: Threshold; minH: number; maxH: number }> = [
  { threshold: 'T-7d', minH: 72, maxH: 168 },
  { threshold: 'T-72h', minH: 24, maxH: 72 },
  { threshold: 'T-24h', minH: 6, maxH: 24 },
  { threshold: 'T-6h', minH: 0, maxH: 6 },
];

/** Only events you are actually in get naged; candidates/done/missed don't. */
const NAGGABLE_STATUSES = new Set(['registered', 'active']);

function hasOpenItems(round: Round): boolean {
  return round.deliverables.some((d) => !d.done);
}

export function due(
  h: Hackathon,
  now: Date,
): Array<{ round: Round; threshold: Threshold }> {
  const out: Array<{ round: Round; threshold: Threshold }> = [];
  if (!NAGGABLE_STATUSES.has(h.status)) return out;

  for (const round of h.rounds) {
    // Eliminated in an earlier round stops ALL downstream noise.
    if (round.result === 'eliminated') continue;
    // A missing deadline is a visible gap (needs-review queue), never a nag.
    if (round.due_at === null) continue;
    // The property that keeps you reading instead of muting:
    if (!hasOpenItems(round)) continue;

    let t: number;
    try {
      t = hoursUntil(round.due_at, now);
    } catch {
      continue; // malformed timestamp: skip silently here; review flow owns it
    }

    const band = BANDS.find((b) => t > b.minH && t <= b.maxH);
    if (band) out.push({ round, threshold: band.threshold });

    // Informational: the round just opened and wants things from you.
    if (round.opens_at !== null) {
      try {
        const sinceOpen = -hoursUntil(round.opens_at, now); // negative = future
        if (
          sinceOpen >= 0 &&
          sinceOpen <= OPEN_WINDOW_HOURS &&
          t > 0 &&
          !out.some((e) => e.round === round && e.threshold === 'opens')
        ) {
          out.push({ round, threshold: 'opens' });
        }
      } catch {
        // bad opens_at: the due-date bands above still protect the user
      }
    }
  }
  return out;
}

/** Dedupe ledger entry shape, e.g. "r2:T-72h" (Part I §7 step 5). */
export function sentKey(roundN: number, threshold: Threshold): string {
  return `r${roundN}:${threshold}`;
}

/**
 * Events from due() filtered by the hackathon's dedupe ledger. Pure — the
 * caller sends, then records via markSent. A second run with the same clock
 * therefore sends nothing.
 */
export function selectUnsent(
  h: Hackathon,
  now: Date,
): Array<{ round: Round; threshold: Threshold }> {
  const already = new Set(h.sent ?? []);
  return due(h, now).filter(
    (e) => !already.has(sentKey(e.round.n, e.threshold)),
  );
}

/** Records actually-sent notifications on the record (mutates h.sent). */
export function markSent(
  h: Hackathon,
  events: Array<{ round: Round; threshold: Threshold }>,
): void {
  if (events.length === 0) return;
  const set = new Set(h.sent ?? []);
  for (const e of events) set.add(sentKey(e.round.n, e.threshold));
  h.sent = [...set];
}
