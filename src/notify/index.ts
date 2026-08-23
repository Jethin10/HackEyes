import type { Config, Hackathon, Round } from '../types.js';
import type { Threshold } from '../ladder.js';
import { formatDeadlineIst, hoursUntil } from '../util/time.js';

/**
 * Message composition + channel dispatch (Part I §8). Plain text, readable
 * on a phone lock screen. Names the SPECIFIC unfinished items — "deadline in
 * 6 days" is anxiety; "you haven't started the video" is information.
 */

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function humanDelta(hours: number): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

const TONE: Record<Threshold, string> = {
  opens: 'Submission window is open',
  'T-7d': 'One week left',
  'T-72h': 'Three days left',
  'T-24h': '24 hours left',
  'T-6h': 'FINAL WARNING',
};

export function composeNag(
  h: Hackathon,
  round: Round,
  threshold: Threshold,
  now: Date = new Date(),
): string {
  const lines: string[] = [];
  lines.push(`${h.name} - Round ${round.n} "${round.name}"`);

  if (threshold === 'opens') {
    lines.push(TONE.opens);
    if (round.opens_at) lines.push(`Opened ${formatDeadlineIst(round.opens_at)}`);
    lines.push('');
    lines.push('What it wants:');
  } else if (round.due_at !== null) {
    let t = Number.NaN;
    try {
      t = hoursUntil(round.due_at, now);
    } catch {
      // leave NaN; the formatted date still prints below
    }
    const when = Number.isNaN(t) ? '' : ` - in ${humanDelta(t)}`;
    lines.push(
      `Closes ${formatDeadlineIst(round.due_at)}${when} - ${TONE[threshold]}`,
    );
    lines.push('');
    lines.push('Still open:');
  }

  for (const d of round.deliverables.filter((x) => !x.done)) {
    lines.push(`  [ ]  ${d.label}`);
  }
  const done = round.deliverables.filter((x) => x.done);
  if (done.length > 0 && threshold !== 'opens') {
    lines.push('');
    lines.push('Done:');
    for (const d of done) lines.push(`  [x]  ${d.label}`);
  }

  if (round.submit_url) {
    lines.push('');
    lines.push(`Submit -> ${stripProtocol(round.submit_url)}`);
  } else if (threshold === 'opens' && h.url) {
    lines.push('');
    lines.push(`Details -> ${stripProtocol(h.url)}`);
  }
  return lines.join('\n');
}

/** Morning-digest line for a new discovery match. */
export function composeMatchLine(c: {
  name: string;
  url: string;
  location?: string;
}): string {
  const where = c.location ? ` (${c.location})` : '';
  return `  *  ${c.name}${where}\n     ${stripProtocol(c.url)}`;
}

// ---------------------------------------------------------------------------
// Quiet hours (Part I §10 notify.quiet_hours), evaluated in IST.
// ---------------------------------------------------------------------------

function currentHourIst(now: Date): number {
  const part = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    hour12: false,
  })
    .formatToParts(now)
    .find((p) => p.type === 'hour');
  return Number(part?.value ?? '0') % 24;
}

export function isQuietNow(cfg: Config, now: Date): boolean {
  const qh = cfg.notify.quiet_hours;
  if (!qh) return false;
  const [start, end] = qh;
  const hour = currentHourIst(now);
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

// ---------------------------------------------------------------------------
// Channel adapters
// ---------------------------------------------------------------------------

export interface SendOptions {
  /** Urgent messages (final warnings) break through quiet hours. */
  urgent?: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
}

async function postNtfy(
  message: string,
  topic: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  try {
    const res = await (fetchImpl ?? fetch)(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      body: message,
      headers: { 'content-type': 'text/plain', title: 'Submission Window' },
    });
    return res.ok;
  } catch (err) {
    console.warn(`notify/ntfy: failed: ${(err as Error).message}`);
    return false;
  }
}

async function postTelegram(
  message: string,
  token: string,
  chatId: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  try {
    const res = await (fetchImpl ?? fetch)(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          disable_web_page_preview: true,
        }),
      },
    );
    return res.ok;
  } catch (err) {
    console.warn(`notify/telegram: failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Sends `message` over the configured channel. Missing secrets log a warning
 * and no-op — never crash the run (§16). Suppressed-by-quiet-hours messages
* simply don't go out; the caller's dedupe ledger only records actual sends.
 */
export async function send(
  message: string,
  cfg: Config,
  opts: SendOptions = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  if (!opts.urgent && isQuietNow(cfg, now)) {
    console.log('notify: suppressed during quiet hours');
    return;
  }

  if (cfg.notify.channel === 'ntfy') {
    const topic = cfg.notify.topic || process.env['NTFY_TOPIC'] || '';
    if (!topic) {
      console.warn('notify: NTFY_TOPIC missing — skipping notification');
      return;
    }
    const ok = await postNtfy(message, topic, opts.fetchImpl);
    console.log(`notify/ntfy: ${ok ? 'sent' : 'failed'}`);
    return;
  }

  const token = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
  const chatId = process.env['TELEGRAM_CHAT_ID'] ?? '';
  if (!token || !chatId) {
    console.warn(
      'notify: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing — skipping notification',
    );
    return;
  }
  const ok = await postTelegram(message, token, chatId, opts.fetchImpl);
  console.log(`notify/telegram: ${ok ? 'sent' : 'failed'}`);
}
