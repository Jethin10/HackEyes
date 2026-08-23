# Submission Window

A hackathon tracker that answers one question at 11pm on a Tuesday: **what is due next, and what exactly do I have to make for it?**

It finds hackathons on its own, notices which ones you're actually in, and nags you about **deliverables**, not deadlines. *"Prototype round in 6 days, you haven't started the video"* is useful. *"Deadline in 6 days"* is anxiety. Runs entirely on free tiers: GitHub Actions owns the cron, `state.json` in this repo owns the data, Vercel renders the dashboard.

---

## How it works

One scheduled job (`scan.yml`) runs seven steps:

| Step | What it does |
|---|---|
| 1 DISCOVER | Polls Devpost, MLH, Devfolio, Unstop via isolated adapters. One failing adapter never aborts the run. |
| 2 FILTER | Scores candidates against your `config.json`. Passes become tracked records. |
| 3 INGEST | *(Phase 3 — inbox auto-detect, not built yet.)* |
| 4 DEEP-PARSE | For events you're registered in: fetch page → strip → hash. Only re-parse if the hash changed (cost control). Free LLM extracts rounds + deliverables. Your `done:true` ticks are never overwritten. |
| 5 EVALUATE | Escalation ladder over incomplete deliverables: opens → T−7d → T−72h → T−24h → T−6h. All-done rounds go silent entirely. |
| 6 PERSIST | Writes `state.json`; the commit doubles as an audit log and keeps the schedule alive. |
| 7 NOTIFY | Sends phone notifications via ntfy.sh or Telegram. Silent when there's nothing to say. |

## Quick start

Prereqs: Node.js 22+ and npm. No accounts, no keys needed for the first dry run.

```bash
git clone https://github.com/Jethin10/HackEyes.git
cd HackEyes
npm install

# offline safety net: full unit suite, no network required
npm test

# first end-to-end run — discovers live, writes NOTHING, sends nothing
npm run scan:dry
```

You should see the seven `[n/7]` step logs and exit 0. That's the whole pipeline, safely.

## Setup (real runs)

### 1. Extraction key (required)

Create a free key at [opencode.ai](https://opencode.ai) and keep it handy:

```
OPENCODE_API_KEY=...
```

Free models need no billing details. The model id lives in `config.json` (`model`), so a lineup change is a config edit, not a code change. Without a key the job still runs — deep-parse logs a warning and skips, everything else works.

### 2. Notifications (pick one)

**ntfy.sh (no account):** install the app, subscribe to a hard-to-guess topic string, then either put `"topic"` inside `notify` in `config.json` or set the `NTFY_TOPIC` secret (config wins if both exist).

**Telegram:** message [@BotFather](https://t.me/BotFather) for a bot token, then get your chat id, then set both secrets:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Missing secrets are logged and skipped — they never crash a run.

### 3. Push the secrets into GitHub

Repo → Settings → Secrets and variables → Actions → New repository secret. Add whichever of the four names above you use.

That's it. The schedule in `scan.yml` (08:00 and 18:00 IST) takes over from the next push.

## Using it day to day

### Add a hackathon by link

The escape hatch for anything no adapter covers (WhatsApp-group finds, obscure sites):

- **On GitHub:** Actions → **scan** → Run workflow → paste the URL into **add_url** → Run.
- **Locally:** `npm run scan -- --add-url https://unstop.com/hackathons/some-event`

The URL becomes a *registered* event immediately; the same run deep-parses its rules page into rounds and deliverables. If the page states no explicit dates, the event lands in the **Needs review** section instead of guessing — a visible gap beats an invented deadline.

### Tick a deliverable done

- **On GitHub:** Actions → **tick** → Run workflow → enter the hackathon id and deliverable id (both visible on the dashboard / in `state.json`). Example: `unstop-hackx-2026` + `video`.
- **Locally:** `npm run tick -- unstop-hackx-2026 video`

Once every deliverable in a round is done, that round's escalation stops completely.

### Change your filter

Everything about what reaches you lives in [`config.json`](./config.json):

| Field | Meaning |
|---|---|
| `interests` | Tags that raise a candidate's score (tokenized matching: `"ai"` matches a `"Machine Learning/AI"` theme). |
| `exclude` | Hard veto. One excluded tag kills the candidate no matter how good the rest looks. |
| `mode` | Allowed formats, e.g. `["online", "hybrid"]`. Onsite-only events are dropped. |
| `regions` | Soft preference. `"remote"` also matches online events; `"IN"` matches "India". |
| `min_prize_inr` | Prize floor (USD/EUR prizes are converted with fixed rates — see DECISIONS.md). |
| `min_lead_days` | Skip anything closing too soon to actually enter. |
| `platforms` | Which adapters' results are eligible. |
| `notify.channel` / `topic` / `quiet_hours` | Delivery channel, ntfy topic, and IST quiet hours (final warnings break through anyway). |
| `model` | OpenCode Zen model id used for extraction. |

Scoring is deliberately dumb — weighted overlap, no model. Edit the file and see the difference at the next run.

### The dashboard

Static page in [`web/`](./web). Sections top-to-bottom: **Next up** (the single most urgent round + open items + submit link), **Active board** (rounds as rails, deliverables as chips — red ring means unfinished), **Discovery feed** (new matches), **Needs review** (low-confidence extractions — small, honest, life-saving), **Add by link** (how-to card).

Deploy: import this repo on [Vercel](https://vercel.com) (framework: Other, root directory: repo root). `vercel.json` rewrites `/` to the dashboard while keeping `/state.json` reachable. Local preview: `npx serve` from the repo root, open `/web/index.html`.

## Development

```bash
npm run build     # strict type-check (tsc --noEmit)
npm test          # vitest, fully offline
npm run scan:dry  # real pipeline, writes nothing, sends nothing
npm run scan      # real pipeline, persists + notifies
npm run tick -- <hackathon_id> <deliverable_id>
```

Three techniques keep the system honest without waiting a day:

- **Fixtures** — each adapter parses saved real responses in `fixtures/`; the suite passes with the network unplugged.
- **Injected clock** — the ladder takes `now` as a parameter; tests sit exactly T−60h from a fixture deadline and assert `T-72h`.
- **Dry run** — executes all seven steps against reality but writes nothing and sends nothing.

The single most protected invariant in the codebase: **a re-parse never un-ticks finished work.** `mergeRounds` preserves `done:true` by deliverable id even when organizers rename items, and keeps deliverables that vanish from the page. The test named after it fails loudly if anyone regresses this.

## Notes

- Unstop sits behind Cloudflare; when blocked you'll see one `unstop: blocked` line and the rest of the run continues. Registered events are covered by link-drop regardless.
- Devfolio's public API has been unavailable (see BLOCKERS.md); its adapter activates automatically when the endpoint returns.
- Gmail inbox auto-detect is Phase 3 — deliberately out of scope until manual adding annoys you.
