/**
 * Offset-safe date helpers.
 *
 * Hackathon deadlines are stated in local time, and IST is a half-hour
 * offset — a sloppy UTC conversion misses a submission by thirty minutes.
 * Rule (Part I §3): every timestamp carries an explicit offset or it is
 * treated as absent.
 */

const OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** True if the ISO string carries an explicit UTC offset (or Z). */
export function hasExplicitOffset(iso: string): boolean {
  return OFFSET_RE.test(iso.trim());
}

/**
 * Hours from `now` until the given ISO timestamp.
 *
 * Parses with the embedded offset (never local time). Throws on a timestamp
 * without an explicit offset rather than silently guessing a zone — callers
 * upstream turn that into `needs_review`, never into an invented date.
 */
export function hoursUntil(iso: string, now: Date): number {
  const trimmed = iso.trim();
  if (!hasExplicitOffset(trimmed)) {
    throw new Error(
      `timestamp missing explicit UTC offset: "${iso}" — refusing to guess the zone`,
    );
  }
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) {
    throw new Error(`unparseable ISO timestamp: "${iso}"`);
  }
  return (t - now.getTime()) / 3_600_000;
}

/**
 * Formats a deadline for a phone lock screen, always in IST regardless of
 * the machine's timezone: "Fri 19 Sep, 23:59 IST".
 * Uses built-in Intl — no date library.
 */
export function formatDeadlineIst(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(t);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')} IST`;
}
