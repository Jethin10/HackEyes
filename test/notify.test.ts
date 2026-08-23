import { describe, expect, it, vi } from 'vitest';
import { composeNag, composeMatchLine, isQuietNow, send } from '../src/notify/index.js';
import type { Config, Hackathon, Round } from '../src/types.js';

const CFG: Config = {
  interests: [],
  exclude: [],
  mode: ['online'],
  regions: [],
  team_size: { min: 1, max: 4 },
  min_prize_inr: 0,
  min_lead_days: 0,
  platforms: [],
  notify: { channel: 'ntfy', topic: 'test-topic-xyz', quiet_hours: [0, 7] },
  model: 'opencode/deepseek-v4-flash',
};

const ROUND: Round = {
  n: 2,
  name: 'Prototype',
  opens_at: null,
  due_at: '2026-09-19T23:59:00+05:30', // Friday 19 Sep IST
  submit_url: 'https://unstop.com/hackx-2026/submit',
  result: null,
  deliverables: [
    { id: 'demo', label: 'Working prototype, hosted', kind: 'build', done: false },
    { id: 'video', label: '3-minute demo video', kind: 'video', done: false },
    { id: 'repo', label: 'Public GitHub repo', kind: 'repo', done: true },
  ],
};

function hackathon(): Hackathon {
  return {
    id: 'unstop-hackx-2026',
    name: 'HackX 2026',
    source: 'unstop',
    url: 'https://unstop.com/hackathons/hackx-2026',
    detected_by: 'discovery',
    status: 'registered',
    tags: [],
    rounds: [ROUND],
    last_seen: '2026-08-24T00:00:00Z',
  };
}

describe('composeNag — Part I §8 sample format', () => {
  it('renders the T-72h message with named open items and submit link', () => {
    const now = new Date('2026-09-17T12:00:00+05:30'); // in 2d 11h 59m -> "2d 11h"
    const msg = composeNag(hackathon(), ROUND, 'T-72h', now);
    expect(msg).toContain('HackX 2026 - Round 2 "Prototype"');
    expect(msg).toMatch(/Closes Sat 19 Sep, 23:59 IST - in 2d 11h/);
    expect(msg).toContain('Still open:');
    expect(msg).toContain('  [ ]  Working prototype, hosted');
    expect(msg).toContain('  [ ]  3-minute demo video');
    expect(msg).toContain('Done:');
    expect(msg).toContain('  [x]  Public GitHub repo');
    expect(msg).toContain('Submit -> unstop.com/hackx-2026/submit');
  });

  it('final warning is short and direct', () => {
    const now = new Date('2026-09-19T18:00:00+05:30'); // in 5h 59m
    const msg = composeNag(hackathon(), ROUND, 'T-6h', now);
    expect(msg).toContain('FINAL WARNING');
    expect(msg).toContain('Submit -> unstop.com/hackx-2026/submit');
  });

  it("the 'opens' informational tone lists what the round wants", () => {
    const r = { ...ROUND, opens_at: '2026-09-05T00:00:00+05:30' };
    const msg = composeNag(hackathon(), r, 'opens');
    expect(msg).toContain('Submission window is open');
    expect(msg).not.toContain('FINAL WARNING');
    expect(msg).toContain('What it wants:');
  });
});

describe('composeMatchLine', () => {
  it('formats a digest line without protocol noise', () => {
    const line = composeMatchLine({
      name: 'HackY',
      url: 'https://y.devpost.com/',
      location: 'Online',
    });
    expect(line).toContain('*  HackY (Online)');
    expect(line).toContain('y.devpost.com/');
    expect(line).not.toContain('https://');
  });
});

describe('quiet hours (IST)', () => {
  it('is quiet between 00:00 and 07:00 IST', () => {
    expect(isQuietNow(CFG, new Date('2026-08-24T02:30:00+05:30'))).toBe(true);
    // 14:00 the previous day in US Pacific == 02:30 IST next day
    expect(isQuietNow(CFG, new Date('2026-08-23T14:00:00-07:00'))).toBe(true);
  });

  it('is not quiet during the day', () => {
    expect(isQuietNow(CFG, new Date('2026-08-24T14:00:00+05:30'))).toBe(false);
  });

  it('no quiet_hours configured means never quiet', () => {
    const cfg = { ...CFG, notify: { ...CFG.notify, quiet_hours: undefined } };
    expect(isQuietNow(cfg, new Date('2026-08-24T02:30:00+05:30'))).toBe(false);
  });
});

describe('send dispatch', () => {
  function okFetchSpy() {
    return vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response('', { status: 200 }),
    );
  }

  it('ntfy channel posts plain text to the topic', async () => {
    const spy = okFetchSpy();
    await send('hello body', CFG, {
      fetchImpl: spy as unknown as typeof fetch,
      now: new Date('2026-08-24T14:00:00+05:30'),
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://ntfy.sh/test-topic-xyz');
    expect(init?.body).toBe('hello body');
  });

  it('missing topic warns and does NOT call fetch instead of crashing', async () => {
    const spy = okFetchSpy();
    const cfg = { ...CFG, notify: { ...CFG.notify, topic: '' } };
    await send('m', cfg, {
      fetchImpl: spy as unknown as typeof fetch,
      now: new Date('2026-08-24T14:00:00+05:30'),
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('telegram channel posts chat_id and text to the Bot API', async () => {
    const spy = okFetchSpy();
    process.env['TELEGRAM_BOT_TOKEN'] = 'tok';
    process.env['TELEGRAM_CHAT_ID'] = '42';
    try {
      await send('tg body', { ...CFG, notify: { channel: 'telegram' } }, {
        fetchImpl: spy as unknown as typeof fetch,
        now: new Date('2026-08-24T14:00:00+05:30'),
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0]!;
      expect(String(url)).toContain('api.telegram.org/bottok/sendMessage');
      expect(JSON.parse(String(init?.body))).toEqual({
        chat_id: '42',
        text: 'tg body',
        disable_web_page_preview: true,
      });
    } finally {
      delete process.env['TELEGRAM_BOT_TOKEN'];
      delete process.env['TELEGRAM_CHAT_ID'];
    }
  });

  it('suppresses non-urgent messages during quiet hours', async () => {
    const spy = okFetchSpy();
    await send('m', CFG, {
      fetchImpl: spy as unknown as typeof fetch,
      now: new Date('2026-08-24T03:00:00+05:30'), // 03:00 IST, inside [0,7)
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('urgent messages break through quiet hours', async () => {
    const spy = okFetchSpy();
    await send('final warning', CFG, {
      urgent: true,
      fetchImpl: spy as unknown as typeof fetch,
      now: new Date('2026-08-24T03:00:00+05:30'),
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('network failure resolves without throwing', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      send('m', CFG, {
        fetchImpl: failing as unknown as typeof fetch,
        now: new Date('2026-08-24T14:00:00+05:30'),
      }),
    ).resolves.toBeUndefined();
  });
});
