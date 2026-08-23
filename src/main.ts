import { readFile } from 'node:fs/promises';
import { htmlToText } from './util/html.js';
import { sha256 } from './util/hash.js';
import { httpGet } from './util/http.js';
import { fetchAll } from './adapters/index.js';
import { extractRounds } from './extract.js';
import { markSent, selectUnsent, type Threshold } from './ladder.js';
import { composeMatchLine, composeNag, send } from './notify/index.js';
import { load, mergeRounds, save } from './state.js';
import { passes, score } from './filter.js';
import { zConfig, type Candidate, type Config, type Hackathon } from './types.js';

/**
 * The daily job (Part I §7): one workflow, seven steps.
 * Every dependency is injectable so the pipeline runs offline against
 * fixtures with a faked clock. One adapter failing never aborts the run.
 */

const STATE_PATH = 'state.json';
const CONFIG_PATH = 'config.json';

export interface QueuedSend {
  hackathon: Hackathon;
  roundN: number;
  threshold: Threshold;
  message: string;
  urgent: boolean;
}

export interface RunSummary {
  discovered: number;
  passedFilter: number;
  newRecords: number;
  adapterFailures: string[];
  parsedPages: number;
  skippedUnchanged: number;
  notificationsQueued: number;
  notificationsSent: number;
}

export interface RunOptions {
  dryRun?: boolean;
  now?: Date;
  statePath?: string;
  configPath?: string;
  /** Link-drop: register this URL before the run (Part I §9 Add by link). */
  addUrl?: string;
  fetchAllImpl?: typeof fetchAll;
  extractImpl?: typeof extractRounds;
  sendImpl?: typeof send;
  httpGetImpl?: typeof httpGet;
  log?: (line: string) => void;
}

function defaultLog(line: string): void {
  console.log(line);
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Canonical URL key: drop protocol/www/trailing slash, lowercase host side. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.toLowerCase();
  }
}

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const FALLBACK_CONFIG: Config = {
  interests: [],
  exclude: [],
  mode: ['online', 'hybrid'],
  regions: [],
  team_size: { min: 1, max: 4 },
  min_prize_inr: 0,
  min_lead_days: 0,
  platforms: ['unstop', 'mlh', 'devfolio', 'devpost'],
  notify: { channel: 'ntfy' },
  model: 'opencode/deepseek-v4-flash',
};

export async function loadConfig(path: string): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    console.warn(`config: ${path} missing — using minimal defaults`);
    return FALLBACK_CONFIG;
  }
  const parsed = zConfig.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`config.json invalid: ${parsed.error.message}`);
  }
  return parsed.data as Config;
}

function findExisting(list: Hackathon[], c: Candidate): Hackathon | undefined {
  const key = canonicalUrl(c.url);
  return (
    list.find((h) => canonicalUrl(h.url) === key) ??
    list.find(
      (h) =>
        h.source === c.source &&
        normalizedName(h.name) === normalizedName(c.name),
    )
  );
}

function applyCandidate(h: Hackathon, c: Candidate, now: Date): void {
  h.last_seen = now.toISOString();
  h.tags = [...new Set([...h.tags, ...c.tags])];
  if (c.mode && !h.mode) h.mode = c.mode;
  if (c.location && !h.location) h.location = c.location;
  if (c.prize_inr !== undefined && h.prize_inr === undefined) {
    h.prize_inr = c.prize_inr;
  }
}

function recordFromUrl(url: string, now: Date): Hackathon {
  let host = 'web';
  let slug = 'event';
  try {
    const u = new URL(url);
    host = u.host.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    slug = parts[parts.length - 1] ?? slug;
  } catch {
    // caller validates; tolerate and use defaults
  }
  return {
    id: `manual-${slugify(slug)}`,
    name: slug
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase()),
    source: host.split('.')[0] ?? 'web',
    url,
    detected_by: 'manual',
    status: 'registered', // you say you're in it — deep-parse fills the rounds
    tags: [],
    rounds: [],
    registered_at: now.toISOString().slice(0, 10),
    last_seen: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runPipeline(opts: RunOptions = {}): Promise<RunSummary> {
  const log = opts.log ?? defaultLog;
  const now = opts.now ?? new Date();
  const statePath = opts.statePath ?? STATE_PATH;
  const dryRun = opts.dryRun ?? false;

  const discover = opts.fetchAllImpl ?? fetchAll;
  const extract = opts.extractImpl ?? extractRounds;
  const deliver = opts.sendImpl ?? send;
  const getPage = opts.httpGetImpl ?? httpGet;

  const summary: RunSummary = {
    discovered: 0,
    passedFilter: 0,
    newRecords: 0,
    adapterFailures: [],
    parsedPages: 0,
    skippedUnchanged: 0,
    notificationsQueued: 0,
    notificationsSent: 0,
  };

  const cfg = await loadConfig(opts.configPath ?? CONFIG_PATH);

  // -- 1. DISCOVER ----------------------------------------------------------
  log('[1/7] DISCOVER: polling sources...');
  const { candidates, failures } = await discover();
  summary.discovered = candidates.length;
  summary.adapterFailures = failures;
  log(
    `[1/7] DISCOVER: ${candidates.length} candidate(s)` +
      (failures.length > 0
        ? ` — failed adapters (continuing): ${failures.join(', ')}`
        : ''),
  );

  // -- 2. FILTER ------------------------------------------------------------
  log('[2/7] FILTER: scoring against your preferences...');
  const list = await load(statePath);

  // Link-drop (Input C): register the pasted URL as a tracked event.
  if (opts.addUrl) {
    const key = canonicalUrl(opts.addUrl);
    if (!list.some((h) => canonicalUrl(h.url) === key)) {
      const rec = recordFromUrl(opts.addUrl, now);
      list.push(rec);
      log(`[2/7] FILTER: link-drop added -> ${rec.id}`);
    } else {
      log('[2/7] FILTER: link-drop URL already tracked');
    }
  }

  const newRecords: Hackathon[] = [];
  for (const c of candidates) {
    if (!passes(c, cfg, now)) continue; // fail -> drop silently
    summary.passedFilter++;
    const existing = findExisting(list, c);
    if (existing) {
      applyCandidate(existing, c, now);
    } else {
      const record: Hackathon = {
        id: `${c.source}-${slugify(c.name)}`,
        name: c.name,
        source: c.source,
        url: c.url,
        detected_by: 'discovery',
        status: 'candidate',
        tags: [...c.tags],
        ...(c.mode ? { mode: c.mode } : {}),
        ...(c.location ? { location: c.location } : {}),
        ...(c.prize_inr !== undefined ? { prize_inr: c.prize_inr } : {}),
        rounds: [],
        last_seen: now.toISOString(),
      };
      list.push(record);
      newRecords.push(record);
      log(`[2/7] FILTER: new match -> ${record.id}`);
    }
  }
  summary.newRecords = newRecords.length;
  log(
    `[2/7] FILTER: ${summary.passedFilter} passed, ${newRecords.length} new`,
  );

  // -- 3. INGEST ------------------------------------------------------------
  log('[3/7] INGEST: inbox watcher arrives in Phase 3 — use link-drop / tick until then');

  // -- 4. DEEP-PARSE --------------------------------------------------------
  log('[4/7] DEEP-PARSE: registered/active events...');
  for (const h of list) {
    if (h.status !== 'registered' && h.status !== 'active') continue;
    const page = await getPage(h.url);
    if (page === null) {
      log(`[4/7] DEEP-PARSE: ${h.id}: page unreachable, skipping`);
      continue;
    }
    const text = htmlToText(page);
    const hash = `sha256:${sha256(text)}`;
    if (h.source_hash === hash) {
      summary.skippedUnchanged++;
      continue; // cost control: page unchanged -> no model call
    }
    const result = await extract(text, h.url, cfg.model);
    h.rounds = mergeRounds(h.rounds, result.rounds); // preserves done:true
    h.extraction = {
      model: cfg.model,
      confidence: result.confidence,
      needs_review: result.needs_review,
      parsed_at: now.toISOString(),
    };
    h.source_hash = hash;
    summary.parsedPages++;
    log(
      `[4/7] DEEP-PARSE: ${h.id}: ${result.rounds.length} round(s), confidence ${result.confidence.toFixed(2)}${result.needs_review ? ' [NEEDS REVIEW]' : ''}`,
    );
  }

  // -- 5. EVALUATE ----------------------------------------------------------
  log('[5/7] EVALUATE: escalation ladder over incomplete deliverables...');
  const queued: QueuedSend[] = [];
  for (const h of list) {
    for (const e of selectUnsent(h, now)) {
      queued.push({
        hackathon: h,
        roundN: e.round.n,
        threshold: e.threshold,
        message: composeNag(h, e.round, e.threshold, now),
        urgent: e.threshold === 'T-6h',
      });
    }
  }
  summary.notificationsQueued = queued.length;

  // -- 6. PERSIST -----------------------------------------------------------
  if (dryRun) {
    log('[6/7] PERSIST: dry run — state.json NOT written');
  } else {
    await save(statePath, list);
    log(`[6/7] PERSIST: ${list.length} record(s) -> ${statePath}`);
  }

  // -- 7. NOTIFY ------------------------------------------------------------
  log('[7/7] NOTIFY:');
  let sentCount = 0;
  if (queued.length === 0 && newRecords.length === 0) {
    log('[7/7] NOTIFY: nothing due and nothing new — staying silent');
  }
  for (const q of queued) {
    if (dryRun) {
      log(`[7/7] NOTIFY: would send (${q.threshold}${q.urgent ? ', urgent' : ''}):\n---\n${q.message}\n---`);
      continue;
    }
    await deliver(q.message, cfg, { urgent: q.urgent, now });
    // Record on the ledger against THIS run's event, then persist below —
    // a second run with the same clock must send nothing.
    const round = q.hackathon.rounds.find((r) => r.n === q.roundN);
    if (round) markSent(q.hackathon, [{ round, threshold: q.threshold }]);
    sentCount++;
  }
  if (!dryRun && sentCount > 0) {
    await save(statePath, list); // second write captures the dedupe ledger
  }

  // New matches roll into one digest line-batch — never standalone pings.
  if (newRecords.length > 0) {
    const digest = `New hackathon matches:\n\n${newRecords
      .map((h) => composeMatchLine(h))
      .join('\n')}`;
    if (dryRun) {
      log(`[7/7] NOTIFY: would send digest:\n---\n${digest}\n---`);
    } else {
      await deliver(digest, cfg, { now });
    }
  }

  summary.notificationsSent = sentCount;
  log(
    `DONE: ${summary.passedFilter} passed filter · ${summary.parsedPages} page(s) parsed · ${summary.skippedUnchanged} unchanged · ${sentCount} notification(s) sent`,
  );
  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry points
// ---------------------------------------------------------------------------

/** tick <hackathon_id> <deliverable_id>: set a deliverable to done:true. */
export async function tickDeliverable(
  hackathonId: string,
  deliverableId: string,
  statePath = STATE_PATH,
): Promise<boolean> {
  const list = await load(statePath);
  const h = list.find((x) => x.id === hackathonId);
  if (!h) {
    console.error(`tick: no hackathon with id "${hackathonId}"`);
    return false;
  }
  for (const round of h.rounds) {
    const d = round.deliverables.find((x) => x.id === deliverableId);
    if (d) {
      d.done = true;
      await save(statePath, list);
      console.log(`tick: ${hackathonId}/${deliverableId} marked done`);
      return true;
    }
  }
  console.error(
    `tick: no deliverable "${deliverableId}" in ${hackathonId} (ids: ${h.rounds.flatMap((r) => r.deliverables.map((x) => x.id)).join(', ') || 'none'})`,
  );
  return false;
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'tick') {
    const [, hackathonId, deliverableId] = argv;
    if (!hackathonId || !deliverableId) {
      console.error('usage: npm run tick -- <hackathon_id> <deliverable_id>');
      return 1;
    }
    return (await tickDeliverable(hackathonId, deliverableId)) ? 0 : 1;
  }
  const dryRun = argv.includes('--dry-run');
  const addUrlIndex = argv.indexOf('--add-url');
  const addUrl = addUrlIndex >= 0 ? (argv[addUrlIndex + 1] ?? '') : undefined;
  if (addUrl !== undefined && !addUrl) {
    console.error('usage: npm run scan -- --add-url <https://...>');
    return 1;
  }
  await runPipeline({
    dryRun,
    ...(addUrl ? { addUrl } : {}),
  });
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('main.ts')) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error('fatal:', err);
      process.exitCode = 1;
    });
}
