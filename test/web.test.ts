import { describe, expect, it } from 'vitest';
import {
  countdown,
  esc,
  nextUp,
  renderApp,
} from '../web/app.js';

// Node 22+ exposes fetch/Response; app.js only touches document behind a
// guard, so importing it here is safe.

const NOW = new Date('2026-09-17T06:00:00Z').getTime(); // T-60h before DUE

const STATE = {
  hackathons: [
    {
      id: 'unstop-hackx-2026',
      name: 'HackX 2026',
      source: 'unstop',
      url: 'https://unstop.com/hackathons/hackx-2026',
      detected_by: 'manual',
      status: 'registered',
      mode: 'online',
      location: 'India',
      tags: ['ai'],
      rounds: [
        {
          n: 1,
          name: 'Prototype',
          opens_at: null,
          due_at: '2026-09-19T23:59:00+05:30', // == 18:29Z -> ~2d12h out
          submit_url: 'https://unstop.com/hackx/submit',
          result: null,
          deliverables: [
            { id: 'demo', label: 'Working prototype, hosted', kind: 'build', done: false },
            { id: 'video', label: '3-minute demo video', kind: 'video', done: false },
            { id: 'repo', label: 'Public GitHub repo', kind: 'repo', done: true },
          ],
        },
      ],
      extraction: { model: 'm', confidence: 0.9, needs_review: false, parsed_at: 'x' },
      last_seen: '2026-09-01T00:00:00Z',
    },
    {
      id: 'devpost-mystery-2026',
      name: 'Mystery Hack <script>alert(1)</script>',
      source: 'devpost',
      url: 'https://mystery.devpost.com/',
      detected_by: 'discovery',
      status: 'candidate',
      tags: ['ai'],
      rounds: [],
      last_seen: '2026-09-01T00:00:00Z',
    },
    {
      id: 'mlh-shady-2026',
      name: 'Shady Extract',
      source: 'mlh',
      url: 'https://shady.mlh.io/',
      detected_by: 'discovery',
      status: 'active',
      tags: [],
      rounds: [],
      extraction: { model: 'm', confidence: 0.3, needs_review: true, parsed_at: 'x' },
      last_seen: '2026-09-01T00:00:00Z',
    },
  ],
};

describe('dashboard render functions', () => {
  it('nextUp picks the single most urgent actionable round', () => {
    const next = nextUp(STATE.hackathons, NOW);
    expect(next).not.toBeNull();
    expect(next!.h.id).toBe('unstop-hackx-2026');
    expect(next!.round.n).toBe(1);
  });

  it('skips all-done and eliminated rounds for Next up', () => {
    const doneState = [
      {
        id: 'x',
        status: 'registered',
        url: 'https://x',
        rounds: [
          {
            n: 1,
            name: 'R',
            due_at: '2026-09-19T23:59:00+05:30',
            result: 'eliminated',
            deliverables: [{ id: 'a', label: 'a', kind: 'other', done: false }],
          },
        ],
      },
    ];
    expect(nextUp(doneState, NOW)).toBeNull();
  });

  it('renders every section in spec order with the urgent event on top', () => {
    const html = renderApp(STATE, NOW);
    const order = [
      html.indexOf('Next up'),
      html.indexOf('Active board'),
      html.indexOf('Discovery feed'),
      html.indexOf('Needs review'),
      html.indexOf('Add by link'),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    expect(html).toContain('HackX 2026');
    // open items render as plain <li>; the [ ] marker is CSS ::before content
    expect(html).toContain('<li>Working prototype, hosted</li>');
    expect(html).toContain('<li>3-minute demo video</li>');
    // done items render as settled chips; unfinished ones are tappable buttons
    expect(html).toMatch(/<span class="chip">repo ✓<\/span>/);
    expect(html).toMatch(/<button class="chip chipbtn" data-tick data-h="[^"]*" data-d="demo"/);
    expect(html).toMatch(/data-d="ALL"/); // per-event "mark everything" button
    // urgency class within warn window (T-60h)
    expect(html).toMatch(/class="card nextup u-warn"/);
    expect(html).toContain('Submit');
  });

  it('escapes HTML in event names (no XSS from state.json)', () => {
    const html = renderApp(STATE, NOW);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows quiet state when nothing is actionable', () => {
    const empty = renderApp({ hackathons: [] }, NOW);
    expect(empty).toContain('Nothing due');
    expect(empty).toContain('No active hackathons');
    expect(empty).toContain('Add by link');
  });

  it('countdown buckets urgency correctly', () => {
    const due = new Date(NOW + 100 * 3_600_000).toISOString();
    expect(countdown(due, NOW).cls).toBe('u-ok');
    const soon = new Date(NOW + 5 * 3_600_000).toISOString();
    expect(countdown(soon, NOW).cls).toBe('u-danger');
    const past = new Date(NOW - 1).toISOString();
    expect(countdown(past, NOW).text).toBe('closed');
  });
});
