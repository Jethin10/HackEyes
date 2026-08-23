import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, runPipeline, tickDeliverable, type RunOptions } from '../src/main.js';
import type { ExtractResult } from '../src/extract.js';
import type { Adapter } from '../src/adapters/index.js';

const CONFIG = {
  interests: ['ai', 'agents'],
  exclude: ['biotech'],
  mode: ['online', 'hybrid'],
  regions: ['remote'],
  team_size: { min: 1, max: 4 },
  min_prize_inr: 25000,
  min_lead_days: 5,
  platforms: ['unstop', 'mlh', 'devfolio', 'devpost'],
  notify: { channel: 'ntfy' as const, quiet_hours: [0, 7] as [number, number] },
  model: 'opencode/test-model',
};

const DUE_SAFE = '2026-09-19T23:59:00+05:30';

const RULES_HTML = `
<html><head><style>x{}</style></head>
<header>nav</header><nav>menu</nav>
<body>
<h1>Agentic AI Hack 2026</h1>
<p>Round 1 closes 2026-09-19T23:59:00+05:30. Teams must submit a five-slide deck using the attached template and a public GitHub repo.</p>
</body></html>`;

const EXTRACTED: ExtractResult = {
  rounds: [
    {
      n: 1,
      name: 'Prototype Round',
      opens_at: null,
      due_at: '2026-09-19T23:59:00+05:30',
      submit_url: 'https://unstop.com/hackathon/agentic-ai-hack/submit',
      result: null,
      deliverables: [
        { id: 'deck', label: '5-slide deck, their template', kind: 'slides', done: false },
        { id: 'repo', label: 'Public GitHub repo', kind: 'repo', done: false },
      ],
    },
  ],
  confidence: 0.9,
  needs_review: false,
};

/** Clock sits inside the T-72h band relative to the extracted deadline. */
const NOW = new Date('2026-09-17T12:00:00+05:30');

interface Harness {
  run(opts?: Partial<RunOptions>): Promise<import('../src/main.js').RunSummary>;
  stateFile: string;
  sentMessages: string[];
}

async function harness(seedState: object[] = []): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'sw-main-'));
  const stateFile = join(dir, 'state.json');
  await writeFile(stateFile, JSON.stringify({ hackathons: seedState }), 'utf8');
  const configFile = join(dir, 'config.json');
  await writeFile(configFile, JSON.stringify(CONFIG), 'utf8');

  const sentMessages: string[] = [];

  const discoveryAdapter: Adapter = {
    name: 'stub-discovery',
    fetchListings: async () => [
      {
        source: 'devpost',
        name: 'Agentic AI Hack 2026',
        url: 'https://agentic-ai-hack.devpost.com/',
        tags: ['ai', 'agents'],
        mode: 'online',
        location: 'Online',
        starts_at: '2026-09-01T00:00:00Z',
        ends_at: '2026-09-30T00:00:00Z',
        prize_inr: 500000,
      },
    ],
  };

  const base: RunOptions = {
    now: NOW,
    statePath: stateFile,
    configPath: configFile,
    fetchAllImpl: async () => ({
      candidates: await discoveryAdapter.fetchListings(),
      failures: [],
    }),
    extractImpl: async () => EXTRACTED,
    sendImpl: async (message) => {
      sentMessages.push(message);
    },
    httpGetImpl: async () => RULES_HTML,
    log: () => {}, // keep test output clean
  };

  return {
    stateFile,
    sentMessages,
    run: (overrides = {}) => runPipeline({ ...base, ...overrides }),
  };
}

describe('runPipeline end-to-end (offline, fixtures, faked clock)', () => {
  it('runs all seven steps: discovers, filters, parses, nags, persists', async () => {
    const h = await harness();
    const summary = await h.run();
    expect(summary.discovered).toBe(1);
    expect(summary.passedFilter).toBe(1);
    expect(summary.newRecords).toBe(1);
    expect(summary.parsedPages).toBe(0); // candidate status -> no deep-parse yet
    expect(summary.notificationsQueued).toBe(0);

    // Promote to registered (as if the user starred/tracked it), rerun.
    const raw = JSON.parse(await readFile(h.stateFile, 'utf8'));
    raw.hackathons[0].status = 'registered';
    await writeFile(h.stateFile, JSON.stringify(raw), 'utf8');

    const summary2 = await h.run();
    expect(summary2.parsedPages).toBe(1);
    expect(summary2.notificationsQueued).toBe(1); // T-72h nag
    expect(summary2.notificationsSent).toBe(1);
    // [0] was run 1's new-match digest; the nag came with run 2
    const nag = h.sentMessages.find((m) => m.includes('- Round 1'))!;
    expect(nag).toContain('Agentic AI Hack 2026 - Round 1');
    expect(nag).toContain('[ ]  5-slide deck, their template');

    // Ledger persisted?
    const after = JSON.parse(await readFile(h.stateFile, 'utf8'));
    expect(after.hackathons[0].sent).toEqual(['r1:T-72h']);
    await rm(h.stateFile, { recursive: true, force: true });
  });

  it('second run with the same clock sends nothing (dedupe through real state)', async () => {
    const h = await harness();
    // seed a registered record directly
    const seeded = [
      {
        id: 'devpost-agentic-ai-hack-2026',
        name: 'Agentic AI Hack 2026',
        source: 'devpost',
        url: 'https://agentic-ai-hack.devpost.com/',
        detected_by: 'discovery',
        status: 'registered',
        tags: ['ai', 'agents'],
        rounds: [],
        last_seen: NOW.toISOString(),
      },
    ];
    const dir = h.stateFile;
    await writeFile(dir, JSON.stringify({ hackathons: seeded }), 'utf8');

    await h.run(); // parse + first nag (no digest: record already existed)
    expect(h.sentMessages).toHaveLength(1);
    const secondSentCount = h.sentMessages.length;

    const summary = await h.run(); // same clock
    expect(summary.notificationsQueued).toBe(0);
    expect(summary.skippedUnchanged).toBe(1); // hash gate: no model call
    expect(h.sentMessages.length).toBe(secondSentCount); // NOTHING new
  });

  it('re-parse never un-ticks done:true (integration guarantee)', async () => {
    const seeded = [
      {
        id: 'devpost-agentic-ai-hack-2026',
        name: 'Agentic AI Hack 2026',
        source: 'devpost',
        url: 'https://agentic-ai-hack.devpost.com/',
        detected_by: 'manual',
        status: 'registered',
        tags: [],
        rounds: [
          {
            n: 1,
            name: 'Prototype Round',
            opens_at: null,
            due_at: '2026-09-19T23:59:00+05:30',
            result: null,
            deliverables: [
              { id: 'deck', label: 'old label', kind: 'slides', done: true },
            ],
          },
        ],
        last_seen: NOW.toISOString(),
      },
    ];
    const h = await harness(seeded);
    await h.run();

    const after = JSON.parse(await readFile(h.stateFile, 'utf8'));
    const deck = after.hackathons[0].rounds[0].deliverables.find(
      (d: { id: string }) => d.id === 'deck',
    );
    expect(deck.label).toBe('5-slide deck, their template'); // fresh label
    expect(deck.done).toBe(true); // preserved progress
  });

  it('dry-run sends nothing and writes nothing', async () => {
    const seeded = [
      {
        id: 'devpost-agentic-ai-hack-2026',
        name: 'Agentic AI Hack 2026',
        source: 'devpost',
        url: 'https://agentic-ai-hack.devpost.com/',
        detected_by: 'discovery',
        status: 'registered',
        tags: [],
        rounds: [],
        last_seen: NOW.toISOString(),
      },
    ];
    const h = await harness(seeded);
    const before = await readFile(h.stateFile, 'utf8');

    const lines: string[] = [];
    const summary = await h.run({
      dryRun: true,
      log: (l) => lines.push(l),
    });
    expect(summary.notificationsQueued).toBe(1);
    expect(summary.notificationsSent).toBe(0);
    expect(h.sentMessages).toEqual([]); // no sends
    expect(await readFile(h.stateFile, 'utf8')).toBe(before); // no writes
    expect(lines.join('\n')).toContain('would send');
    expect(lines.join('\n')).toContain('NOT written');
  });

  it('one failing adapter does not abort the run', async () => {
    const h = await harness();
    const failingImpl = async (): Promise<{
      candidates: never[];
      failures: string[];
    }> => ({ candidates: [], failures: ['unstop'] });
    const okRun = await h.run({
      fetchAllImpl: failingImpl as unknown as RunOptions['fetchAllImpl'],
    });
    expect(okRun.adapterFailures).toEqual(['unstop']);
    expect(okRun.passedFilter).toBe(0);
  });

  it('excluded-tag candidates are dropped silently', async () => {
    const h = await harness();
    const summary = await h.run({
      fetchAllImpl: async () => ({
        candidates: [
          {
            source: 'devpost',
            name: 'Biotech Bonanza',
            url: 'https://biotech.devpost.com/',
            tags: ['biotech'],
          },
        ],
        failures: [],
      }),
    });
    expect(summary.passedFilter).toBe(0);
    expect(summary.newRecords).toBe(0);
  });
});

describe('tick command', () => {
  it('marks a deliverable done and persists; unknown ids fail loudly', async () => {
    const seeded = [
      {
        id: 'x-hack',
        name: 'Hack',
        source: 'manual',
        url: 'https://example.com/h',
        detected_by: 'manual',
        status: 'registered',
        tags: [],
        rounds: [
          {
            n: 1,
            name: 'R1',
            opens_at: null,
            due_at: DUE_SAFE,
            result: null,
            deliverables: [{ id: 'video', label: 'video', kind: 'video', done: false }],
          },
        ],
        last_seen: NOW.toISOString(),
      },
    ];
    const dir = await mkdtemp(join(tmpdir(), 'sw-tick-'));
    const stateFile = join(dir, 'state.json');
    try {
      await writeFile(stateFile, JSON.stringify({ hackathons: seeded }), 'utf8');
      expect(await tickDeliverable('x-hack', 'video', stateFile)).toBe(true);
      const after = JSON.parse(await readFile(stateFile, 'utf8'));
      expect(after.hackathons[0].rounds[0].deliverables[0].done).toBe(true);

      expect(await tickDeliverable('missing', 'video', stateFile)).toBe(false);
      expect(await tickDeliverable('x-hack', 'nope', stateFile)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('CLI arg validation for tick', async () => {
    const code = await main(['tick']);
    expect(code).toBe(1);
  });
});

